"""Speck's authenticated control plane. Remote endpoints always dial out over TLS."""
import asyncio
import hashlib
import json
import os
import secrets
import time
from contextlib import asynccontextmanager
from pathlib import Path

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError
from fastapi import Depends, FastAPI, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from speck.config import data_dir, origin, seal, unseal
from speck.db import audit, db, ident, initialize
from speck.jobs import create_job, get_device, public_job
from speck.security import COOKIE, agent_credentials, digest, issue_session, require_agent, require_user


@asynccontextmanager
async def lifespan(app):
    initialize()
    # An interrupted command is not safe to replay automatically.
    with db(write=True) as conn:
        conn.execute("UPDATE jobs SET status='unknown',finished=? WHERE status IN ('leased','running')", (time.time(),))
        conn.execute("DELETE FROM monitor_states")
        conn.execute("UPDATE recovery_runs SET status='needs_attention',phase='interrupted',updated=? WHERE status='running'", (time.time(),))
    from speck.scheduling import worker, stop_worker
    management_task = asyncio.create_task(worker())
    from speck.restore_lifecycle import worker as restore_worker
    restore_task = asyncio.create_task(restore_worker())
    try:
        yield
    finally:
        await stop_worker(management_task)
        await stop_worker(restore_task)
    from speck.remote import sessions, close_session
    from speck.slide import workers
    for session_id in list(sessions):
        await close_session(session_id)
    for task in workers:
        task.cancel()


app = FastAPI(title='Speck', version='0.2.0', lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware('http')
async def headers(request: Request, call_next):
    try:
        if int(request.headers.get('content-length', '0')) > 260 * 1024 * 1024:
            return Response(status_code=413)
    except ValueError:
        return Response(status_code=400)
    response = await call_next(request)
    response.headers.update({'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
                             'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'microphone=(self), camera=()',
                             'Cache-Control': 'no-store',
                             'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"})
    return response


@app.get('/.well-known/apple-app-site-association')
def apple_association():
    # App identifiers are public signing identities, never provider credentials.
    default = '7PTN7E8EDS.com.speckrmm.ios' if origin() == 'https://speckrmm.com' else ''
    apps = [value.strip() for value in os.environ.get('SPECK_APPLE_APP_IDS', default).split(',') if value.strip()]
    return {'webcredentials': {'apps': apps}}


@app.get('/health')
def health():
    return {'ok': True, 'service': 'speck', 'version': '0.2.0'}


class Login(BaseModel):
    username: str = Field(max_length=100)
    password: str = Field(max_length=256)
    code: str = Field(default="", max_length=40)


@app.post('/api/auth/login')
def login(body: Login, request: Request, response: Response):
    if request.headers.get('origin') != origin():
        raise HTTPException(403, 'Origin rejected')
    ip = request.client.host
    account_attempt = 'login:' + body.username
    with db(write=True) as conn:
        conn.execute('DELETE FROM login_attempts WHERE at<?', (time.time() - 900,))
        if any(conn.execute('SELECT count(*) FROM login_attempts WHERE ip=?', (key,)).fetchone()[0] >= 10 for key in (ip, account_attempt)):
            raise HTTPException(429, 'Too many sign-in attempts. Try again in 15 minutes.')
        conn.executemany('INSERT INTO login_attempts VALUES(?,?)', [(key, time.time()) for key in (ip, account_attempt)])
        row = conn.execute('SELECT * FROM users WHERE username=?', (body.username,)).fetchone()
    try:
        if not row or row['disabled']:
            # Avoid a fast path that reveals valid usernames.
            PasswordHasher().verify(PasswordHasher().hash('unused-random-password'), body.password)
            raise VerificationError('Invalid user')
        PasswordHasher().verify(row['password_hash'], body.password)
    except VerificationError:
        raise HTTPException(401, 'Incorrect username or password') from None
    with db(write=True) as conn:
        from speck.access import check_second_factor
        current = conn.execute('SELECT * FROM users WHERE id=? AND disabled=0', (row['id'],)).fetchone()
        if not current or current['password_hash'] != row['password_hash'] or not check_second_factor(conn, current, body.code):
            raise HTTPException(401, 'Incorrect credentials or authenticator code')
        conn.execute('DELETE FROM login_attempts WHERE ip IN (?,?)', (ip, account_attempt))
        return issue_session(conn, current, response)


@app.get('/api/auth/me')
def me(user=Depends(require_user)):
    return {'username': user['username'], 'csrf': user['csrf'], 'role': user['role']}


@app.post('/api/auth/logout')
async def logout(response: Response, user=Depends(require_user)):
    with db(write=True) as conn:
        conn.execute('DELETE FROM sessions WHERE token_hash=?', (user['token_hash'],))
    from speck.remote import sessions, close_session
    for session_id, session in list(sessions.items()):
        if session.user_id == user["user_id"]:
            await close_session(session_id)
    response.delete_cookie(COOKIE)
    return {'ok': True}


class Enrollment(BaseModel):
    label: str = Field(min_length=1, max_length=80)


@app.post('/api/enrollments')
def enrollment(body: Enrollment, user=Depends(require_user)):
    token = secrets.token_urlsafe(32)
    expires = time.time() + 900
    with db(write=True) as conn:
        conn.execute('INSERT INTO enrollments VALUES(?,?,?,NULL)', (digest(token), body.label, expires))
        audit(conn, user['username'], 'enrollment.created', detail={'label': body.label})
    return {'token': token, 'expires': expires, 'server': origin()}


class Enroll(BaseModel):
    token: str = Field(min_length=20, max_length=100)
    hardware_id: str = Field(min_length=10, max_length=128)
    hostname: str = Field(min_length=1, max_length=100)
    platform: str = Field(pattern='^(windows|linux)$')
    arch: str = Field(max_length=20)


@app.post('/api/agent/enroll')
def enroll(body: Enroll):
    token = secrets.token_urlsafe(40)
    installation_id, device_id = ident(), ident()
    with db(write=True) as conn:
        row = conn.execute('SELECT * FROM enrollments WHERE token_hash=? AND used IS NULL AND expires>?',
                           (digest(body.token), time.time())).fetchone()
        if not row:
            raise HTTPException(401, 'Enrollment token is expired or already used')
        conn.execute('UPDATE enrollments SET used=? WHERE token_hash=?', (time.time(), digest(body.token)))
        conn.execute('INSERT INTO installations(id,token_hash,created) VALUES(?,?,?)', (installation_id, digest(token), time.time()))
        conn.execute('INSERT INTO devices(id,installation_id,hardware_id,hostname,label,platform,arch,created,last_seen,approved) '
                     'VALUES(?,?,?,?,?,?,?,?,?,1)', (device_id, installation_id, body.hardware_id, body.hostname,
                     row['label'], body.platform, body.arch, time.time(), time.time()))
        audit(conn, 'agent', 'device.enrolled', device_id)
    return {'token': token, 'installation_id': installation_id, 'device_id': device_id}


class Checkin(BaseModel):
    hostname: str = Field(min_length=1, max_length=100)
    platform: str = Field(pattern='^(windows|linux)$')
    arch: str = Field(max_length=20)
    telemetry: dict


@app.post('/api/agent/check-in')
def checkin(body: Checkin, request: Request):
    installation, device = agent_credentials(request.headers)
    telemetry = json.dumps(body.telemetry)
    if len(telemetry) > 1024 * 1024:
        raise HTTPException(413, 'Telemetry exceeds limit')
    with db(write=True) as conn:
        if not device:
            # Backup clones share installation credentials. Hardware identity keeps
            # their inventory and commands distinct, with operator approval required.
            device_id = ident()
            conn.execute('INSERT INTO devices(id,installation_id,hardware_id,hostname,label,platform,arch,created,last_seen,approved) '
                         'VALUES(?,?,?,?,?,?,?,?,?,0)', (device_id, installation['id'], request.headers['x-speck-hardware'],
                         body.hostname, body.hostname + ' · recovery candidate', body.platform, body.arch, time.time(), time.time()))
            audit(conn, 'agent', 'device.clone_discovered', device_id)
        else:
            device_id = device['id']
        conn.execute('UPDATE devices SET hostname=?,telemetry=?,last_seen=? WHERE id=?',
                     (body.hostname, telemetry, time.time(), device_id))
    return {'ok': True, 'device_id': device_id, 'approved': bool(device and device['approved'] and not device['archived'])}


@app.get('/api/devices')
def devices(include_archived: bool = False, user=Depends(require_user)):
    with db() as conn:
        rows = conn.execute('SELECT d.*,i.revoked FROM devices d JOIN installations i ON i.id=d.installation_id WHERE (? OR d.archived=0) ORDER BY d.label', (include_archived,)).fetchall()
        from speck.monitoring import policy_for
        monitoring = {row['id']: policy_for(conn, row['id']).enabled for row in rows}
    result = []
    for row in rows:
        obj = dict(row)
        connection = obj.pop('remote_secret')
        obj['remote_configured'] = bool(connection)
        obj['remote_protocol'] = json.loads(unseal(connection)).get('protocol') if connection else None
        obj['telemetry'] = json.loads(obj['telemetry'])
        obj['tags'] = json.loads(obj['tags'])
        obj['monitoring_enabled'] = monitoring[obj['id']]
        obj['manageable'] = bool(obj['approved'] and not obj['archived'] and not obj['revoked'])
        obj['online'] = time.time() - obj['last_seen'] < 75
        from speck.screens import screen_info
        obj['preview'] = screen_info(obj)
        result.append(obj)
    return result


class DeviceUpdate(BaseModel):
    label: str = Field(min_length=1, max_length=80)
    approved: bool
    slide_agent_id: str | None = Field(default=None, max_length=80)


@app.patch('/api/devices/{device_id}')
async def update_device(device_id: str, body: DeviceUpdate, user=Depends(require_user)):
    get_device(device_id)
    with db(write=True) as conn:
        conn.execute('UPDATE devices SET label=?,approved=?,slide_agent_id=? WHERE id=?',
                     (body.label, int(body.approved), body.slide_agent_id, device_id))
        if not body.approved:
            from speck.management import stop_management
            stop_management(conn, device_id, user['username'])
        audit(conn, user['username'], 'device.updated', device_id, {'approved': body.approved})
    if not body.approved:
        from speck.management import close_devices
        await close_devices([device_id])
    return {'ok': True}


class RemoteConfig(BaseModel):
    protocol: str = Field(pattern='^(rdp|ssh|vnc)$')
    port: int = Field(ge=1, le=65535)
    username: str = Field(default='', max_length=100)
    password: str = Field(default='', max_length=256)
    domain: str = Field(default='', max_length=100)
    ignore_certificate: bool = False
    private_key: str = Field(default="", max_length=16384)
    passphrase: str = Field(default="", max_length=256)


@app.put('/api/devices/{device_id}/remote')
def configure_remote(device_id: str, body: RemoteConfig, user=Depends(require_user)):
    get_device(device_id, approved=True)
    with db(write=True) as conn:
        conn.execute('UPDATE devices SET remote_secret=? WHERE id=?', (seal(body.model_dump_json()), device_id))
        audit(conn, user['username'], 'remote.configured', device_id, {'protocol': body.protocol})
    return {'ok': True}


class JobRequest(BaseModel):
    kind: str = Field(pattern='^(command|service.control|network.check|files.list)$')
    payload: dict
    timeout: int = Field(default=60, ge=5, le=180)


@app.post('/api/devices/{device_id}/jobs')
def submit_job(device_id: str, body: JobRequest, user=Depends(require_user)):
    if body.kind == 'command':
        script = body.payload.get('script')
        if not isinstance(script, str) or not script.strip() or len(script) > 65536 or '\0' in script:
            raise HTTPException(422, 'Provide a script of 1–65536 characters')
        if body.payload.get('shell', 'auto') not in ('auto', 'powershell', 'sh'):
            raise HTTPException(422, 'Unsupported shell')
    payload = body.payload | {'timeout': body.timeout}
    return {'id': create_job(device_id, body.kind, payload, user['username'], body.timeout)}


@app.get('/api/jobs')
def jobs(device_id: str | None = None, user=Depends(require_user)):
    with db() as conn:
        rows = conn.execute('SELECT * FROM jobs WHERE (? IS NULL OR device_id=?) ORDER BY created DESC LIMIT 100', (device_id, device_id)).fetchall()
    return [public_job(row) for row in rows]


@app.get('/api/jobs/{job_id}')
def job(job_id: str, user=Depends(require_user)):
    with db() as conn:
        row = conn.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()
    if not row:
        raise HTTPException(404, 'Job not found')
    return public_job(row)


@app.get('/api/agent/jobs/next')
def next_job(device=Depends(require_agent)):
    if not device['approved'] or device['archived']:
        return {'job': None}
    with db(write=True) as conn:
        state = conn.execute('SELECT d.approved,d.archived,i.revoked FROM devices d JOIN installations i ON i.id=d.installation_id WHERE d.id=?', (device['id'],)).fetchone()
        if not state or not state['approved'] or state['archived'] or state['revoked']:
            return {'job': None}
        conn.execute("UPDATE jobs SET status=CASE WHEN status='queued' THEN 'expired' ELSE 'unknown' END,finished=? "
                     "WHERE device_id=? AND status IN ('queued','leased','running') AND deadline<?", (time.time(), device['id'], time.time()))
        row = conn.execute("SELECT * FROM jobs WHERE device_id=? AND status='queued' ORDER BY created LIMIT 1", (device['id'],)).fetchone()
        if not row:
            return {'job': None}
        lease = secrets.token_urlsafe(32)
        conn.execute("UPDATE jobs SET status='leased',lease_hash=?,started=? WHERE id=?", (digest(lease), time.time(), row['id']))
        result = public_job(row, include_payload=True) | {'lease': lease}
    return {'job': result}


class JobResult(BaseModel):
    lease: str = Field(max_length=100)
    status: str = Field(pattern='^(running|complete|failed)$')
    result: dict = Field(default_factory=dict)


@app.post('/api/agent/jobs/{job_id}')
def job_result(job_id: str, body: JobResult, device=Depends(require_agent)):
    encoded = json.dumps(body.result)
    if len(encoded) > 2 * 1024 * 1024:
        raise HTTPException(413, 'Result exceeds limit')
    with db(write=True) as conn:
        row = conn.execute('SELECT * FROM jobs WHERE id=? AND device_id=?', (job_id, device['id'])).fetchone()
        if not row or not secrets.compare_digest(row['lease_hash'] or '', digest(body.lease)):
            raise HTTPException(403, 'Job lease rejected')
        if row['status'] in ('complete', 'failed'):
            return {'ok': True}
        if row['status'] not in ('leased', 'running'):
            raise HTTPException(409, 'Job is no longer active')
        conn.execute('UPDATE jobs SET status=?,result=?,finished=? WHERE id=?',
                     (body.status, encoded, time.time() if body.status != 'running' else None, job_id))
        if body.status != 'running':
            from speck.operations import record_patch_result
            record_patch_result(conn, row, body.result)
            audit(conn, 'agent', 'job.' + body.status, device['id'], {'job_id': job_id, 'kind': row['kind']})
    return {'ok': True}


@app.get('/api/audit')
def audit_log(user=Depends(require_user)):
    with db() as conn:
        return [dict(r) | {'detail': json.loads(r['detail'])} for r in conn.execute('SELECT * FROM audit ORDER BY id DESC LIMIT 200')]


async def store_stream(stream, destination, maximum=256 * 1024 * 1024):
    checksum, total = hashlib.sha256(), 0
    temporary = destination.with_suffix('.part')
    try:
        with temporary.open('xb') as handle:
            os.chmod(temporary, 0o600)
            async for chunk in stream:
                total += len(chunk)
                if total > maximum:
                    raise HTTPException(413, 'Transfer limit is 256 MiB')
                checksum.update(chunk)
                handle.write(chunk)
            handle.flush()
            os.fsync(handle.fileno())
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
    return total, checksum.hexdigest()


@app.post('/api/devices/{device_id}/files/upload')
async def upload(device_id: str, path: str, file: UploadFile, overwrite: bool = False, user=Depends(require_user)):
    get_device(device_id, approved=True)
    transfer_id = ident()
    async def chunks():
        while chunk := await file.read(65536):
            yield chunk
    total, checksum = await store_stream(chunks(), data_dir() / 'transfers' / transfer_id)
    with db(write=True) as conn:
        conn.execute('INSERT INTO transfers(id,device_id,direction,name,path,status,sha256,size,created) VALUES(?,?,?,?,?,?,?,?,?)',
                     (transfer_id, device_id, 'upload', (file.filename or 'upload').replace('\\', '/').split('/')[-1], path,
                      'ready', checksum, total, time.time()))
    job_id = create_job(device_id, 'files.upload', {'transfer_id': transfer_id, 'path': path, 'sha256': checksum, 'overwrite': overwrite}, user['username'], 180)
    with db(write=True) as conn:
        conn.execute('UPDATE transfers SET job_id=? WHERE id=?', (job_id, transfer_id))
    return {'id': transfer_id, 'job_id': job_id, 'sha256': checksum, 'size': total}


class DownloadRequest(BaseModel):
    path: str = Field(min_length=1, max_length=2000)


@app.post('/api/devices/{device_id}/files/download')
def download(device_id: str, body: DownloadRequest, user=Depends(require_user)):
    get_device(device_id, approved=True)
    transfer_id = ident()
    with db(write=True) as conn:
        conn.execute('INSERT INTO transfers(id,device_id,direction,name,path,status,created) VALUES(?,?,?,?,?,?,?)',
                     (transfer_id, device_id, 'download', body.path.replace('\\', '/').split('/')[-1], body.path, 'waiting', time.time()))
    job_id = create_job(device_id, 'files.download', {'transfer_id': transfer_id, 'path': body.path}, user['username'], 180)
    with db(write=True) as conn:
        conn.execute('UPDATE transfers SET job_id=? WHERE id=?', (job_id, transfer_id))
    return {'id': transfer_id, 'job_id': job_id}


@app.get('/api/transfers')
def transfers(device_id: str, user=Depends(require_user)):
    with db() as conn:
        return [dict(r) for r in conn.execute('SELECT * FROM transfers WHERE device_id=? ORDER BY created DESC LIMIT 50', (device_id,))]


@app.get('/api/transfers/{transfer_id}/file')
def transfer_file(transfer_id: str, user=Depends(require_user)):
    with db() as conn:
        row = conn.execute("SELECT * FROM transfers WHERE id=? AND status='ready'", (transfer_id,)).fetchone()
    if not row:
        raise HTTPException(404, 'Transfer is not ready')
    return FileResponse(data_dir() / 'transfers' / row['id'], filename=row['name'], media_type='application/octet-stream', headers={'X-Content-SHA256': row['sha256']})


@app.get('/api/agent/transfers/{transfer_id}')
def agent_transfer(transfer_id: str, device=Depends(require_agent)):
    with db() as conn:
        row = conn.execute("SELECT * FROM transfers WHERE id=? AND device_id=? AND direction='upload' AND status='ready'", (transfer_id, device['id'])).fetchone()
    if not row:
        raise HTTPException(404, 'Transfer unavailable')
    return FileResponse(data_dir() / 'transfers' / row['id'], media_type='application/octet-stream')


@app.put('/api/agent/transfers/{transfer_id}')
async def agent_upload(transfer_id: str, request: Request, device=Depends(require_agent)):
    with db(write=True) as conn:
        row = conn.execute("SELECT * FROM transfers WHERE id=? AND device_id=? AND direction='download' AND status='waiting'", (transfer_id, device['id'])).fetchone()
        if not row:
            raise HTTPException(409, 'Transfer unavailable or already uploaded')
        conn.execute("UPDATE transfers SET status='receiving' WHERE id=?", (transfer_id,))
    try:
        total, checksum = await store_stream(request.stream(), data_dir() / 'transfers' / row['id'])
        expected = request.headers.get('x-content-sha256')
        if not expected or not secrets.compare_digest(checksum, expected):
            raise HTTPException(422, 'File checksum mismatch')
        with db(write=True) as conn:
            conn.execute("UPDATE transfers SET status='ready',size=?,sha256=? WHERE id=?", (total, checksum, transfer_id))
    except Exception:
        (data_dir() / 'transfers' / row['id']).unlink(missing_ok=True)
        with db(write=True) as conn:
            conn.execute("UPDATE transfers SET status='failed' WHERE id=?", (transfer_id,))
        raise
    return {'ok': True, 'sha256': checksum, 'size': total}


# Feature routers are registered before the console's fallback route.
from speck.remote import router as remote_router  # noqa: E402
from speck.slide import router as slide_router  # noqa: E402
app.include_router(remote_router)
app.include_router(slide_router)
from speck.restore_lifecycle import router as restore_lifecycle_router  # noqa: E402
app.include_router(restore_lifecycle_router)
from speck.operations import router as operations_router  # noqa: E402
from speck.screens import router as screens_router  # noqa: E402
from speck.assistant import router as assistant_router  # noqa: E402
app.include_router(operations_router)
app.include_router(screens_router)
app.include_router(assistant_router)
from speck.access import router as access_router  # noqa: E402
app.include_router(access_router)
from speck.passkeys import router as passkeys_router  # noqa: E402
app.include_router(passkeys_router)
from speck.management import router as management_router  # noqa: E402
from speck.monitoring import router as monitoring_router  # noqa: E402
app.include_router(management_router)
app.include_router(monitoring_router)
from speck.scheduling import router as scheduling_router  # noqa: E402
app.include_router(scheduling_router)

downloads = Path(os.environ.get('SPECK_DOWNLOAD_DIR', 'output/downloads'))
if downloads.exists():
    app.mount('/downloads', StaticFiles(directory=downloads), name='downloads')

web = Path(os.environ.get('SPECK_WEB_DIR', 'web/dist'))
if web.exists():
    app.mount('/assets', StaticFiles(directory=web / 'assets'), name='assets')

    @app.get('/{path:path}')
    def console(path: str):
        if path.startswith(('api/', 'ws/')):
            raise HTTPException(404)
        return FileResponse(web / 'index.html')
