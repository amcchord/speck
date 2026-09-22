"""Browser RDP/SSH/VNC through a one-session outbound agent tunnel and guacd."""
import asyncio
import codecs
import json
import ipaddress
import secrets
import time
from dataclasses import dataclass, field

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import Response
from pydantic import BaseModel, Field

from speck.config import unseal
from speck.db import audit, db, ident
from speck.jobs import create_job, get_device
from speck.security import agent_credentials, require_user, websocket_user

router = APIRouter()


def instruction(*values):
    return ','.join(f'{len(str(value))}.{value}' for value in values) + ';'


async def read_instruction(reader):
    """Read complete UTF-8 elements, never split a Guacamole instruction between frames."""
    values = []
    for _ in range(512):
        raw = await reader.readuntil(b'.')
        if len(raw) > 10 or not raw[:-1].isdigit():
            raise ValueError('Invalid Guacamole length')
        count = int(raw[:-1])
        if count > 16 * 1024 * 1024:
            raise ValueError('Guacamole element exceeds limit')
        decoder = codecs.getincrementaldecoder('utf-8')()
        value = decoder.decode(await reader.readexactly(count))
        while len(value) < count:
            value += decoder.decode(await reader.readexactly(count - len(value)))
        values.append(value)
        separator = await reader.readexactly(1)
        if separator == b';':
            return values
        if separator != b',':
            raise ValueError('Invalid Guacamole separator')
    raise ValueError('Too many Guacamole elements')


@dataclass
class Session:
    id: str
    device_id: str
    user_id: str
    secret: str
    config: dict
    width: int
    height: int
    created: float = field(default_factory=time.time)
    ready: asyncio.Event = field(default_factory=asyncio.Event)
    finished: asyncio.Event = field(default_factory=asyncio.Event)
    tcp: asyncio.Future | None = None
    listener: asyncio.Server | None = None
    agent: WebSocket | None = None
    browser_claimed: bool = False
    audio_streams: int = 0
    audio_bytes: int = 0
    audio_indexes: set = field(default_factory=set)
    instructions_sent: int = 0


sessions: dict[str, Session] = {}


async def close_session(session_id):
    session = sessions.pop(session_id, None)
    if not session:
        return
    session.finished.set()
    if session.listener:
        session.listener.close()
        await session.listener.wait_closed()
    if session.agent:
        try:
            await session.agent.close()
        except (RuntimeError, WebSocketDisconnect):
            pass
    if session.tcp and session.tcp.done() and not session.tcp.cancelled():
        _, writer = session.tcp.result()
        writer.close()


async def expire_session(session_id):
    await asyncio.sleep(120)
    session = sessions.get(session_id)
    if session and not session.browser_claimed:
        await close_session(session_id)


class StartSession(BaseModel):
    width: int = Field(default=1440, ge=640, le=3840)
    height: int = Field(default=900, ge=480, le=2160)


@router.post('/api/devices/{device_id}/remote/sessions')
async def start_session(device_id: str, body: StartSession, user=Depends(require_user)):
    device = get_device(device_id, approved=True)
    if not device['remote_secret']:
        raise HTTPException(409, 'Configure a remote connection first')
    if time.time() - device['last_seen'] > 75:
        raise HTTPException(409, 'Device is offline')
    if sum(s.user_id == user['user_id'] for s in sessions.values()) >= 4:
        raise HTTPException(429, 'Close an existing remote session first')
    session = Session(ident(), device_id, user['user_id'], secrets.token_urlsafe(32),
                      json.loads(unseal(device['remote_secret'])), body.width, body.height)
    session.tcp = asyncio.get_running_loop().create_future()
    async def connected(reader, writer):
        if session.tcp.done():
            writer.close()
            return
        session.tcp.set_result((reader, writer))
        await session.finished.wait()
        writer.close()
    session.listener = await asyncio.start_server(connected, '127.0.0.1', 0)
    sessions[session.id] = session
    try:
        create_job(device_id, 'tunnel', {'session_id': session.id, 'secret': session.secret, 'port': session.config['port'], 'timeout': 7200}, user['username'], 7200)
    except Exception:
        await close_session(session.id)
        raise
    asyncio.create_task(expire_session(session.id))
    with db(write=True) as conn:
        audit(conn, user['username'], 'remote.started', device_id, {'session_id': session.id, 'protocol': session.config['protocol']})
    return {'id': session.id, 'protocol': session.config['protocol']}


@router.websocket('/api/agent/tunnels/{session_id}')
async def agent_tunnel(socket: WebSocket, session_id: str):
    session = sessions.get(session_id)
    try:
        _, device = agent_credentials(socket.headers)
        if not session or not device or device['id'] != session.device_id or session.agent:
            raise HTTPException(403)
        if not secrets.compare_digest(socket.headers.get('x-speck-tunnel-secret', ''), session.secret):
            raise HTTPException(403)
    except HTTPException:
        await socket.close(code=1008)
        return
    await socket.accept()
    session.agent = socket
    session.ready.set()
    tasks = []
    try:
        reader, writer = await asyncio.wait_for(asyncio.shield(session.tcp), 120)
        async def from_agent():
            while True:
                value = await socket.receive_bytes()
                writer.write(value)
                await writer.drain()
        async def to_agent():
            while value := await reader.read(65536):
                await socket.send_bytes(value)
        tasks = [asyncio.create_task(from_agent()), asyncio.create_task(to_agent())]
        await asyncio.wait(tasks, timeout=7200, return_when=asyncio.FIRST_COMPLETED)
    except (TimeoutError, ConnectionError, WebSocketDisconnect):
        pass
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await close_session(session_id)


@router.websocket('/api/remote/sessions/{session_id}/ws')
async def browser_tunnel(socket: WebSocket, session_id: str):
    session = sessions.get(session_id)
    try:
        user = websocket_user(socket)
        if not session or session.user_id != user['user_id'] or session.browser_claimed:
            raise HTTPException(403)
    except HTTPException:
        await socket.close(code=1008)
        return
    session.browser_claimed = True
    await socket.accept(subprotocol='guacamole')
    writer = None
    tasks = []
    try:
        await asyncio.wait_for(session.ready.wait(), 40)
        reader, writer = await asyncio.open_connection('127.0.0.1', 4822)
        cfg = session.config
        writer.write(instruction('select', cfg['protocol']).encode())
        await writer.drain()
        args = await asyncio.wait_for(read_instruction(reader), 15)
        if args[0] != 'args':
            raise ValueError('Remote gateway handshake failed')
        params = {'VERSION_1_5_0': 'VERSION_1_5_0', 'VERSION_1_6_0': 'VERSION_1_6_0',
                  'hostname': '127.0.0.1', 'port': session.listener.sockets[0].getsockname()[1],
                  'username': cfg.get('username', ''), 'password': cfg.get('password', ''), 'domain': cfg.get('domain', ''),
                  'private-key': cfg.get('private_key', ''), 'passphrase': cfg.get('passphrase', ''),
                  'ignore-cert': str(cfg.get('ignore_certificate', False)).lower(), 'security': 'any',
                  'disable-audio': 'false', 'enable-audio-input': 'true', 'enable-wallpaper': 'true',
                  'enable-theming': 'true', 'enable-font-smoothing': 'true', 'resize-method': '',
                  'width': str(session.width), 'height': str(session.height), 'dpi': '96',
                  'color-depth': '24', 'server-layout': 'en-us-qwerty', 'client-name': 'Speck',
                  'font-size': '14', 'color-scheme': 'white-black', 'scrollback': '2000', 'timezone': 'UTC'}
        for values in [('size', session.width, session.height, 96), ('audio', 'audio/L16', 'audio/L8'),
                       ('video',), ('image', 'image/png', 'image/jpeg', 'image/webp'),
                       ('connect', *[params.get(key, '') for key in args[1:]])]:
            writer.write(instruction(*values).encode())
        await writer.drain()
        await socket.send_text(instruction('', session.id))
        async def to_browser():
            while True:
                message = await read_instruction(reader)
                session.instructions_sent += 1
                if message[0] == 'audio':
                    session.audio_streams += 1
                    session.audio_indexes.add(message[1])
                elif message[0] == 'blob' and message[1] in session.audio_indexes:
                    session.audio_bytes += len(message[2]) * 3 // 4
                await socket.send_text(instruction(*message))
        async def from_browser():
            while True:
                text = await socket.receive_text()
                if len(text) > 2 * 1024 * 1024:
                    raise ValueError('Remote input exceeds limit')
                if text.startswith('0.,4.ping,'):
                    await socket.send_text(text)
                else:
                    writer.write(text.encode())
                    await writer.drain()
        tasks = [asyncio.create_task(to_browser()), asyncio.create_task(from_browser())]
        remaining = min(7200, max(0, user['expires'] - time.time()))
        await asyncio.wait(tasks, timeout=remaining, return_when=asyncio.FIRST_COMPLETED)
    except (TimeoutError, ConnectionError, WebSocketDisconnect, asyncio.IncompleteReadError, ValueError):
        try:
            await socket.send_text(instruction('error', 'Remote connection ended or could not be established. Check credentials and the remote service.', 519))
        except (RuntimeError, WebSocketDisconnect):
            pass
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        if writer:
            writer.close()
        await close_session(session_id)
        with db(write=True) as conn:
            audit(conn, user['username'], 'remote.ended', session.device_id, {'session_id': session_id})
        try:
            await socket.close()
        except (RuntimeError, WebSocketDisconnect):
            pass


@router.get('/api/devices/{device_id}/remote/native.rdp')
def native_rdp(device_id: str, user=Depends(require_user)):
    device = get_device(device_id, approved=True)
    if not device['remote_secret']:
        raise HTTPException(409, 'Remote connection is not configured')
    cfg = json.loads(unseal(device['remote_secret']))
    if cfg['protocol'] != 'rdp':
        raise HTTPException(409, 'This connection is not RDP')
    telemetry = json.loads(device['telemetry'])
    addresses = [a['address'] for interface in telemetry.get('network', {}).get('interfaces', [])
                 for a in interface.get('addrs', []) if ':' not in a['address'] and not a['address'].startswith('127.')]
    if not addresses:
        raise HTTPException(409, 'No IPv4 address is reported')
    try:
        address = str(ipaddress.IPv4Address(addresses[0].split('/')[0]))
    except ValueError:
        raise HTTPException(409, 'Invalid reported IPv4 address') from None
    username = cfg.get('username', '').replace('\r', '').replace('\n', '')
    body = f'full address:s:{address}:{cfg["port"]}\nusername:s:{username}\naudiomode:i:0\naudiocapturemode:i:1\nredirectclipboard:i:1\ndisable wallpaper:i:0\nprompt for credentials:i:1\nscreen mode id:i:2\n'
    return Response(body, media_type='application/x-rdp', headers={'Content-Disposition': 'attachment; filename="Speck-remote.rdp"'})


@router.get('/api/remote/sessions/{session_id}/stats')
def session_stats(session_id: str, user=Depends(require_user)):
    session = sessions.get(session_id)
    if not session or session.user_id != user['user_id']:
        raise HTTPException(404, 'Session is not active')
    return {'instructions_sent': session.instructions_sent, 'audio_streams': session.audio_streams, 'audio_bytes': session.audio_bytes}
