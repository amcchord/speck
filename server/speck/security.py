import hashlib
import secrets
import time

from fastapi import Depends, HTTPException, Request, WebSocket

from speck.config import origin
from speck.db import audit, db

COOKIE = 'speck_session'


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def session_for(token):
    with db() as conn:
        row = conn.execute('SELECT sessions.*,users.username,users.role FROM sessions JOIN users ON users.id=sessions.user_id '
                           'WHERE token_hash=? AND expires>? AND users.disabled=0', (digest(token or ''), time.time())).fetchone()
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
    path = request.url.path
    if user['role'] == 'viewer':
        reads = {'/api/auth/me', '/api/devices', '/api/alerts', '/api/monitoring', '/api/audit/events', '/api/access/me'}
        personal = {'/api/auth/logout', '/api/access/password', '/api/access/sessions/revoke', '/api/access/totp/setup', '/api/access/totp/confirm', '/api/access/totp/disable'}
        if not ((request.method == 'GET' and path in reads) or path in personal or path == '/api/access/passkeys' or path.startswith('/api/access/passkeys/')):
            raise HTTPException(403, 'Viewer accounts can read inventory, alerts and audit history')
    if request.method not in ('GET', 'HEAD', 'OPTIONS') and path in ('/api/slide/connection', '/api/ai/settings') and user['role'] != 'admin':
        raise HTTPException(403, 'Administrator access required')
    return user


def require_admin(user=Depends(require_user)):
    if user['role'] != 'admin':
        raise HTTPException(403, 'Administrator access required')
    return user


def websocket_user(socket: WebSocket):
    if socket.headers.get('origin') != origin():
        raise HTTPException(403, 'Origin rejected')
    user = session_for(socket.cookies.get(COOKIE))
    if user['role'] == 'viewer':
        raise HTTPException(403, 'Remote access requires an operator')
    return user


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
    if device['archived'] and not request.url.path.endswith('/jobs/next'):
        raise HTTPException(403, 'This device is archived')
    if not device['approved'] and '/transfers/' in request.url.path:
        raise HTTPException(403, 'Approve this device before transferring files')
    return device


def issue_session(conn, row, response, passkey_id=None):
    token, csrf = secrets.token_urlsafe(40), secrets.token_urlsafe(32)
    conn.execute('DELETE FROM sessions WHERE expires<?', (time.time(),))
    conn.execute('INSERT INTO sessions(token_hash,user_id,csrf,expires,passkey_id) VALUES(?,?,?,?,?)',
                 (digest(token), row['id'], csrf, time.time() + 43200, passkey_id))
    audit(conn, row['username'], 'session.login', detail={'method': 'passkey' if passkey_id else 'password'})
    response.set_cookie(COOKIE, token, httponly=True, secure=origin().startswith('https://'), samesite='strict', max_age=43200)
    return {'username': row['username'], 'csrf': csrf, 'role': row['role']}
