import json
import time

from fastapi import HTTPException

from speck.config import seal, unseal
from speck.db import audit, db, ident

KINDS = {'command', 'service.control', 'network.check', 'files.list', 'files.upload', 'files.download', 'tunnel', 'shell'}


def get_device(device_id, approved=False):
    with db() as conn:
        row = conn.execute('SELECT d.*,i.revoked FROM devices d JOIN installations i ON i.id=d.installation_id WHERE d.id=?', (device_id,)).fetchone()
    if not row:
        raise HTTPException(404, 'Device not found')
    if approved and (row['archived'] or row['revoked']):
        raise HTTPException(409, 'This device is retired or its credential was revoked')
    if approved and not row['approved']:
        raise HTTPException(409, 'Approve this restored instance before managing it')
    return dict(row)


def create_job(device_id, kind, payload, actor, timeout=60):
    get_device(device_id, approved=True)
    if kind not in KINDS:
        raise HTTPException(400, 'Unsupported job kind')
    job_id = ident()
    with db(write=True) as conn:
        state = conn.execute('SELECT d.approved,d.archived,i.revoked FROM devices d JOIN installations i ON i.id=d.installation_id WHERE d.id=?', (device_id,)).fetchone()
        if not state or not state['approved'] or state['archived'] or state['revoked']:
            raise HTTPException(409, 'This device is not manageable')
        if kind in {'tunnel', 'shell'} and conn.execute(
                'SELECT 1 FROM agent_updates WHERE device_id=? AND lease_until>?',
                (device_id, time.time())).fetchone():
            raise HTTPException(409, 'The agent is updating. Try connecting again shortly.')
        conn.execute('INSERT INTO jobs(id,device_id,kind,payload,status,created,deadline,actor) VALUES(?,?,?,?,?,?,?,?)',
                     (job_id, device_id, kind, seal(json.dumps(payload)), 'queued', time.time(), time.time() + timeout + 120, actor))
        audit(conn, actor, 'job.created', device_id, {'job_id': job_id, 'kind': kind})
    return job_id


def public_job(row, include_payload=False):
    obj = dict(row)
    obj.pop('lease_hash', None)
    payload = obj.pop('payload', None)
    obj['result'] = json.loads(obj['result']) if obj.get('result') else None
    if include_payload:
        obj['payload'] = json.loads(unseal(payload))
    return obj
