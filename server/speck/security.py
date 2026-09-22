import hashlib
import secrets
import time

from fastapi import HTTPException, Request, WebSocket

from speck.config import origin
from speck.db import db

COOKIE = 'speck_session'


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def session_for(token):
    with db() as conn:
        row = conn.execute('SELECT sessions.*,users.username FROM sessions JOIN users ON users.id=sessions.user_id '
                           'WHERE token_hash=? AND expires>?', (digest(token or ''), time.time())).fetchone()
    if not row:
        raise HTTPException(401, 'Sign in to Speck')
    return dict(row)


def require_user(request: Request):
    user = session_for(request.cookies.get(COOKIE))
    if request.method not in ('GET', 'HEAD', 'OPTIONS'):
        if request.headers.get('origin') != origin():
            raise HTTPException(403, 'Origin rejected')
        if not secrets.compare_digest(user['csrf'], request.headers.get('x-csrf-token', '')):
            raise HTTPException(403, 'CSRF token rejected')
    return user


def websocket_user(socket: WebSocket):
    if socket.headers.get('origin') != origin():
        raise HTTPException(403, 'Origin rejected')
    return session_for(socket.cookies.get(COOKIE))


def agent_credentials(headers):
    auth = headers.get('authorization', '')
    token = auth[7:] if auth.startswith('Bearer ') else ''
    hardware = headers.get('x-speck-hardware', '')
    if not token or not hardware or len(hardware) > 128:
        raise HTTPException(401, 'Agent authentication required')
    with db() as conn:
        installation = conn.execute('SELECT * FROM installations WHERE token_hash=? AND revoked=0', (digest(token),)).fetchone()
        if not installation:
            raise HTTPException(401, 'Agent credential rejected')
        device = conn.execute('SELECT * FROM devices WHERE installation_id=? AND hardware_id=?', (installation['id'], hardware)).fetchone()
    return dict(installation), dict(device) if device else None


def require_agent(request: Request):
    installation, device = agent_credentials(request.headers)
    if not device:
        raise HTTPException(409, 'Check in before requesting work')
    return device
