import json
import time

import pytest
from starlette.websockets import WebSocketDisconnect

from speck.config import unseal
from speck.db import db
from speck.remote import sessions
from test_control_plane import enroll


def machine(client, *, desktop='headless', platform='linux', shell=True):
    device, headers = enroll(client)
    with db(write=True) as conn:
        conn.execute('UPDATE devices SET platform=?,telemetry=? WHERE id=?', (
            platform, json.dumps({'capabilities': {'desktop': desktop, 'web_shell': shell}}), device['device_id']))
    return device['device_id'], headers


def start(client, device, **body):
    response = client.post(f'/api/devices/{device}/remote/sessions', json=body)
    assert response.status_code == 200, response.text
    return response.json()['id']


def agent_headers(headers, session):
    return headers | {'X-Speck-Tunnel-Secret': sessions[session].secret}


@pytest.mark.parametrize('desktop,platform,shell,configured,expected', [
    ('headless', 'linux', True, 'rdp', 'shell'),
    ('headless', 'linux', True, 'ssh', 'shell'),
    ('headless', 'linux', True, None, 'shell'),
    ('available', 'linux', True, 'vnc', 'vnc'),
    ('unknown', 'linux', True, 'rdp', 'rdp'),
    ('unknown', 'linux', True, 'ssh', 'shell'),
    ('available', 'linux', True, 'ssh', 'ssh'),
    ('unknown', 'linux', True, None, 'shell'),
    ('headless', 'linux', False, 'ssh', 'ssh'),
    ('unknown', 'linux', False, None, None),
    ('headless', 'windows', True, 'rdp', 'rdp'),
])
def test_default_selection_preserves_desktops_and_old_agents(client, desktop, platform, shell, configured, expected):
    device, _ = machine(client, desktop=desktop, platform=platform, shell=shell)
    if configured:
        client.put(f'/api/devices/{device}/remote', json={'protocol': configured, 'port': 22, 'password': 'private'})
    item = client.get('/api/devices').json()[0]
    assert item['remote_protocol'] == expected
    assert item['remote_configured'] == bool(expected)
    assert item['configured_remote_protocol'] == configured
    assert 'private' not in json.dumps(item)
    if expected:
        session = start(client, device)
        assert sessions[session].config['protocol'] == expected
        client.delete(f'/api/remote/sessions/{session}')


def test_saved_connection_override_and_bounded_shell_job(client):
    device, _ = machine(client)
    client.put(f'/api/devices/{device}/remote', json={'protocol': 'rdp', 'port': 3389})
    session = start(client, device, mode='connection')
    assert sessions[session].config['protocol'] == 'rdp'
    client.delete(f'/api/remote/sessions/{session}')
    session = start(client, device, cols=123, rows=42)
    with db() as conn:
        job = conn.execute("SELECT * FROM jobs WHERE kind='shell'").fetchone()
    payload = json.loads(unseal(job['payload']))
    assert (payload['cols'], payload['rows'], payload['timeout']) == (123, 42, 7200)
    assert 'port' not in payload
    client.delete(f'/api/remote/sessions/{session}')
    with db() as conn:
        assert conn.execute('SELECT status FROM jobs WHERE id=?', (job['id'],)).fetchone()[0] == 'cancelled'
    assert client.post(f'/api/devices/{device}/remote/sessions', json={'cols': 99999}).status_code == 422


def test_shell_duplex_resize_single_claim_and_no_recording(client):
    device, headers = machine(client)
    session = start(client, device)
    with client.websocket_connect(f'wss://testserver/api/agent/tunnels/{session}', headers=agent_headers(headers, session)) as agent:
        agent.send_json({'type': 'ready'})
        with client.websocket_connect(f'wss://testserver/api/remote/sessions/{session}/ws', subprotocols=['speck-shell']) as browser:
            assert browser.receive_json() == {'type': 'ready'}
            agent.send_bytes('héllo\r\n$ '.encode())
            assert browser.receive_bytes() == 'héllo\r\n$ '.encode()
            browser.send_json({'type': 'ack'})
            browser.send_json({'type': 'input', 'data': 'printf private-terminal-input\r'})
            assert agent.receive_json() == {'type': 'input', 'data': 'printf private-terminal-input\r'}
            browser.send_json({'type': 'resize', 'cols': 132, 'rows': 43})
            assert agent.receive_json() == {'type': 'resize', 'cols': 132, 'rows': 43}
            with pytest.raises(WebSocketDisconnect):
                with client.websocket_connect(f'wss://testserver/api/remote/sessions/{session}/ws', subprotocols=['speck-shell']):
                    pass
            browser.close()
            with pytest.raises(WebSocketDisconnect):
                agent.receive_bytes()
    assert session not in sessions
    with db() as conn:
        assert 'private-terminal-input' not in str([tuple(r) for r in conn.execute('SELECT * FROM audit')])
        assert 'private-terminal-input' not in str([tuple(r) for r in conn.execute('SELECT * FROM jobs')])


def test_shell_rejects_other_device_wrong_secret_and_origin(client):
    device, headers = machine(client)
    _, other_headers = enroll(client, 'different-device-123')
    session = start(client, device)
    for invalid in [agent_headers(other_headers, session), headers | {'X-Speck-Tunnel-Secret': 'wrong'}]:
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(f'wss://testserver/api/agent/tunnels/{session}', headers=invalid):
                pass
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f'wss://testserver/api/remote/sessions/{session}/ws', headers={'Origin': 'https://attacker.test'}):
            pass
    client.delete(f'/api/remote/sessions/{session}')


@pytest.mark.parametrize('message', [[], {'type': 'resize', 'cols': -1, 'rows': 20}, {'type': 'resize', 'cols': True, 'rows': 20}, {'type': 'input', 'data': 'x' * 16385}, {'type': 'execute', 'script': 'bad'}])
def test_invalid_shell_input_closes_session(client, message):
    device, headers = machine(client)
    session = start(client, device)
    with client.websocket_connect(f'wss://testserver/api/agent/tunnels/{session}', headers=agent_headers(headers, session)) as agent:
        agent.send_json({'type': 'ready'})
        with client.websocket_connect(f'wss://testserver/api/remote/sessions/{session}/ws', subprotocols=['speck-shell']) as browser:
            assert browser.receive_json()['type'] == 'ready'
            browser.send_json(message)
            assert browser.receive_json()['type'] == 'error'
            with pytest.raises(WebSocketDisconnect):
                browser.receive_json()
    assert session not in sessions


def test_shell_permissions_offline_and_revocation(client):
    device, headers = machine(client)
    with db(write=True) as conn:
        conn.execute('UPDATE devices SET last_seen=? WHERE id=?', (time.time() - 100, device))
    assert client.post(f'/api/devices/{device}/remote/sessions', json={}).status_code == 409
    with db(write=True) as conn:
        conn.execute('UPDATE devices SET last_seen=?,approved=0 WHERE id=?', (time.time(), device))
    assert client.post(f'/api/devices/{device}/remote/sessions', json={}).status_code == 409
    with db(write=True) as conn:
        conn.execute('UPDATE devices SET approved=1 WHERE id=?', (device,))
    session = start(client, device)
    with client.websocket_connect(f'wss://testserver/api/agent/tunnels/{session}', headers=agent_headers(headers, session)) as agent:
        agent.send_json({'type': 'ready'})
        with client.websocket_connect(f'wss://testserver/api/remote/sessions/{session}/ws', subprotocols=['speck-shell']) as browser:
            assert browser.receive_json()['type'] == 'ready'
            assert client.post('/api/auth/logout').status_code == 200
            with pytest.raises(WebSocketDisconnect):
                browser.receive_json()
    assert session not in sessions


def test_viewer_and_different_operator_cannot_claim_shell(client):
    device, _ = machine(client)
    session = start(client, device)
    user = client.post('/api/access/users', json={'username': 'viewer', 'password': 'test-only-viewer-password', 'role': 'viewer'}).json()['id']
    # Preserve the original owner session while signing this client into another account.
    result = client.post('/api/auth/login', json={'username': 'viewer', 'password': 'test-only-viewer-password'}).json()
    client.headers['X-CSRF-Token'] = result['csrf']
    assert client.post(f'/api/devices/{device}/remote/sessions', json={}).status_code == 403
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f'wss://testserver/api/remote/sessions/{session}/ws'):
            pass
    with db(write=True) as conn:
        conn.execute("UPDATE users SET role='operator' WHERE id=?", (user,))
    assert client.delete(f'/api/remote/sessions/{session}').status_code == 404
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f'wss://testserver/api/remote/sessions/{session}/ws'):
            pass


def test_shell_session_limit_expiry_and_closed_tickets(client):
    device, headers = machine(client)
    opened = [start(client, device) for _ in range(4)]
    assert client.post(f'/api/devices/{device}/remote/sessions', json={}).status_code == 429
    session = opened.pop()
    credentials = agent_headers(headers, session)
    client.delete(f'/api/remote/sessions/{session}')
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f'wss://testserver/api/agent/tunnels/{session}', headers=credentials):
            pass
    session = opened.pop()
    sessions[session].created = time.time() - 7201
    with client.websocket_connect(f'wss://testserver/api/remote/sessions/{session}/ws', subprotocols=['speck-shell']) as browser:
        with pytest.raises(WebSocketDisconnect):
            browser.receive_json()
    assert session not in sessions
    for session in opened:
        client.delete(f'/api/remote/sessions/{session}')
