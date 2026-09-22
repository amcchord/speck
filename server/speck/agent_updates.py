"""Admin policy and authenticated idle-agent offers for offline-signed releases."""
import base64
import json
import os
import re
import time
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from speck.db import audit, db
from speck.jobs import get_device
from speck.security import require_admin, require_agent
from speck.update_key import PUBLIC_KEY

router = APIRouter()


def migrate(conn):
    conn.execute('''CREATE TABLE IF NOT EXISTS agent_updates(
      device_id TEXT PRIMARY KEY REFERENCES devices(id),version TEXT NOT NULL,status TEXT NOT NULL,
      attempted REAL NOT NULL,updated REAL NOT NULL,lease_until REAL NOT NULL DEFAULT 0)''')


def public_key():
    return os.environ.get('SPECK_AGENT_UPDATE_PUBLIC_KEY', PUBLIC_KEY)


def release_file():
    return Path(os.environ.get('SPECK_DOWNLOAD_DIR', 'output/downloads')) / 'agent-releases' / 'current.json'


def published():
    try:
        data = release_file().read_bytes()
        if len(data) > 65536:
            raise ValueError('Release too large')
        return json.loads(data)
    except FileNotFoundError:
        return None


def verified_release(platform, arch):
    try:
        release = published()
        envelope = (release or {}).get('releases', {}).get(platform + '-' + arch)
        if not envelope:
            return None
        data = base64.b64decode(envelope['payload'], validate=True)
        key = Ed25519PublicKey.from_public_bytes(base64.b64decode(public_key(), validate=True))
        key.verify(base64.b64decode(envelope['signature'], validate=True), data)
        manifest = json.loads(data)
        if manifest['platform'] != platform or manifest['arch'] != arch:
            raise ValueError('Release target mismatch')
        if not re.fullmatch(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)', manifest['version']):
            raise ValueError('Invalid version')
        if not (manifest['published_at'] <= time.time() + 300 < manifest['expires_at']
                and 0 < manifest['expires_at'] - manifest['published_at'] <= 90 * 86400):
            raise ValueError('Invalid release dates')
        return envelope, manifest
    except Exception:
        # Do not serve an unverified release or expose file/key material on errors.
        raise HTTPException(503, 'Agent release is invalid or expired') from None


def policy(conn):
    row = conn.execute("SELECT value FROM settings WHERE key='agent_updates'").fetchone()
    return json.loads(row['value']) if row else {'enabled': True}


def busy(conn, device_id):
    from speck.remote import sessions
    return any(s.device_id == device_id for s in list(sessions.values())) or bool(conn.execute(
        "SELECT 1 FROM jobs WHERE device_id=? AND status IN ('queued','leased','running') AND deadline>? LIMIT 1",
        (device_id, time.time())).fetchone())


def offer(device, *, claim=False, version=None):
    get_device(device['id'], approved=True)
    selected = verified_release(device['platform'], device['arch'])
    with db(write=claim) as conn:
        # Recheck approval inside the write transaction used to grant the update.
        row = conn.execute('SELECT d.approved,d.archived,i.revoked FROM devices d JOIN installations i ON i.id=d.installation_id WHERE d.id=?', (device['id'],)).fetchone()
        if not row or not row['approved'] or row['archived'] or row['revoked']:
            raise HTTPException(409, 'Device is not manageable')
        if not policy(conn)['enabled']:
            return {'enabled': False, 'reason': 'paused'}
        if not selected:
            return {'enabled': True, 'release': None}
        envelope, manifest = selected
        target = manifest['version']
        if claim and version != target:
            raise HTTPException(409, 'Agent release changed; check again')
        previous = conn.execute('SELECT * FROM agent_updates WHERE device_id=?', (device['id'],)).fetchone()
        if previous and previous['version'] == target and previous['status'] in ('failed', 'rollback_failed'):
            return {'enabled': False, 'reason': 'previous_attempt_failed'}
        if previous and previous['lease_until'] > time.time():
            return {'enabled': False, 'reason': 'installing'}
        if busy(conn, device['id']):
            return {'enabled': False, 'reason': 'busy'}
        if claim:
            now = time.time()
            conn.execute('INSERT INTO agent_updates VALUES(?,?,?,?,?,?) ON CONFLICT(device_id) DO UPDATE SET version=excluded.version,status=excluded.status,attempted=excluded.attempted,updated=excluded.updated,lease_until=excluded.lease_until',
                         (device['id'], target, 'installing', now, now, now + 300))
            audit(conn, 'agent', 'agent_update.started', device['id'], {'version': target})
        return {'enabled': True, 'release': envelope}


@router.get('/api/agent/update')
def agent_offer(device=Depends(require_agent)):
    return offer(device)


class Claim(BaseModel):
    version: str = Field(pattern=r'^\d+\.\d+\.\d+$', max_length=40)


@router.post('/api/agent/update/claim')
def claim(body: Claim, device=Depends(require_agent)):
    return offer(device, claim=True, version=body.version)


def record_checkin(conn, device_id, telemetry):
    row = conn.execute('SELECT * FROM agent_updates WHERE device_id=?', (device_id,)).fetchone()
    if not row:
        return
    state = telemetry.get('agent_update') or {}
    if not isinstance(state, dict) or state.get('version') != row['version']:
        return
    status = state.get('status')
    if status == 'current' and telemetry.get('version') != row['version']:
        return
    if status in ('current', 'failed', 'rollback_failed') and status != row['status']:
        conn.execute('UPDATE agent_updates SET status=?,updated=?,lease_until=0 WHERE device_id=?', (status, time.time(), device_id))
        audit(conn, 'agent', 'agent_update.' + status, device_id, {'version': row['version']})


@router.get('/api/agent-updates')
def status(user=Depends(require_admin)):
    with db() as conn:
        result = policy(conn)
        result['devices'] = [dict(r) for r in conn.execute('SELECT u.*,d.label FROM agent_updates u JOIN devices d ON d.id=u.device_id ORDER BY u.updated DESC')]
    release = published()
    result['version'] = (release or {}).get('version')
    return result


class Policy(BaseModel):
    enabled: bool


@router.put('/api/agent-updates')
def set_policy(body: Policy, user=Depends(require_admin)):
    with db(write=True) as conn:
        conn.execute("INSERT INTO settings VALUES('agent_updates',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (body.model_dump_json(),))
        audit(conn, user['username'], 'agent_update.policy', detail=body.model_dump())
    return body.model_dump()
