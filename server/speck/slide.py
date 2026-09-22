"""Slide public API integration with durable, isolated recovery runs.

Mutations are never automatically retried: ambiguous outcomes require inspection.
"""
import asyncio
import ipaddress
import json
import re
import time
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator

from speck.config import seal, unseal
from speck.db import audit, db, ident
from speck.jobs import create_job, get_device, public_job
from speck.security import require_user

router = APIRouter()
workers = set()
RESOURCES = {'device', 'agent', 'backup', 'snapshot', 'network', 'restore/virt', 'restore/file', 'restore/image'}


def settings():
    with db() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key='slide'").fetchone()
    if not row:
        raise HTTPException(409, 'Connect Slide in Settings first')
    return json.loads(unseal(row['value']))


class Slide:
    def __init__(self, config=None):
        self.config = config or settings()

    async def request(self, method, path, body=None, params=None):
        # No redirects: credentials must never follow a provider redirect.
        async with httpx.AsyncClient(timeout=45, follow_redirects=False) as client:
            for attempt in range(3 if method == 'GET' else 1):
                try:
                    response = await client.request(method, self.config['url'] + '/v1/' + path,
                        headers={'Authorization': 'Bearer ' + self.config['token']}, json=body, params=params)
                except httpx.HTTPError:
                    raise HTTPException(502, 'Slide request failed. For a write, inspect Slide before retrying; its outcome may be unknown.') from None
                if response.status_code == 429 and method == 'GET' and attempt < 2:
                    await asyncio.sleep(1 + attempt)
                    continue
                if response.status_code >= 300:
                    raise HTTPException(502, f'Slide returned HTTP {response.status_code}. Check the provider activity before retrying a write.')
                return response.json() if response.content else {}
        raise HTTPException(502, 'Slide rate limit exceeded')

    async def listing(self, resource, params=None):
        result, offset, seen = [], 0, set()
        for _ in range(100):
            page = await self.request('GET', resource, params=(params or {}) | {'limit': 50, 'offset': offset})
            result.extend(page.get('data', []))
            next_offset = page.get('pagination', {}).get('next_offset')
            if next_offset is None:
                return result
            if next_offset in seen or next_offset == offset:
                raise HTTPException(502, 'Slide returned a repeated pagination cursor')
            seen.add(next_offset)
            offset = next_offset
        raise HTTPException(502, 'Slide inventory exceeds the configured page limit')


def safe_provider(value):
    """Inventory never needs provider-issued passwords, private keys or API tokens."""
    if isinstance(value, dict):
        return {k: safe_provider(v) for k, v in value.items() if not any(s in k.lower() for s in ('password', 'passphrase', 'private_key', 'token', 'secret'))}
    if isinstance(value, list):
        return [safe_provider(v) for v in value]
    return value


class Connection(BaseModel):
    url: str = Field(default='https://api.slide.tech', max_length=256)
    token: str = Field(min_length=10, max_length=4096)

    @model_validator(mode='after')
    def valid_origin(self):
        parsed = urlparse(self.url)
        if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('', '/'):
            raise ValueError('Use an HTTPS API origin without a path, query or credentials')
        self.url = self.url.rstrip('/')
        return self


@router.get('/api/slide/connection')
def connection_status(user=Depends(require_user)):
    try:
        cfg = settings()
    except HTTPException:
        return {'connected': False}
    return {'connected': True, 'url': cfg['url']}


@router.put('/api/slide/connection')
async def connect(body: Connection, user=Depends(require_user)):
    await Slide(body.model_dump()).request('GET', 'device', params={'limit': 1})
    with db(write=True) as conn:
        conn.execute("INSERT OR REPLACE INTO settings VALUES('slide',?)", (seal(body.model_dump_json()),))
        audit(conn, user['username'], 'slide.connected', detail={'url': body.url})
    return {'connected': True, 'url': body.url}


@router.get('/api/slide/inventory')
async def inventory(resource: str = 'agent', agent_id: str | None = None, user=Depends(require_user)):
    if resource not in RESOURCES:
        raise HTTPException(422, 'Unsupported Slide resource')
    params = {'agent_id': agent_id} if agent_id else None
    return safe_provider(await Slide().listing(resource, params))


class BackupRequest(BaseModel):
    agent_id: str = Field(pattern=r'^a_[a-z0-9]{12}$')


@router.post('/api/slide/backups')
async def backup(body: BackupRequest, user=Depends(require_user)):
    with db(write=True) as conn:
        audit(conn, user['username'], 'slide.backup.requested', detail={'agent_id': body.agent_id})
    return await Slide().request('POST', 'backup', body.model_dump())


class Member(BaseModel):
    device_id: str = Field(pattern=r'^[a-f0-9]{32}$')
    slide_agent_id: str = Field(pattern=r'^a_[a-z0-9]{12}$')
    restore_device_id: str = Field(pattern=r'^d_[a-z0-9]{12}$')
    cpu_count: int = Field(default=2, ge=1, le=16)
    memory_in_mb: int = Field(default=4096, ge=1024, le=32768)
    baseline_script: str = Field(min_length=1, max_length=65536)
    # Must print stable proof (JSON is recommended); nonzero exits fail the test.
    recovery_script: str = Field(min_length=1, max_length=65536)
    compare_output: bool = True


class Plan(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    members: list[Member] = Field(min_length=1, max_length=12)
    router_prefix: str = '10.217.0.1/24'
    dhcp_range_start: str = '10.217.0.100'
    dhcp_range_end: str = '10.217.0.200'
    wg_prefix: str = '10.218.0.1/24'
    client_id: str = Field(default='', pattern=r'^(c_[a-z0-9]{12})?$')
    timeout_minutes: int = Field(default=120, ge=10, le=1440)

    @model_validator(mode='after')
    def validate_network(self):
        net = ipaddress.ip_interface(self.router_prefix)
        wg = ipaddress.ip_interface(self.wg_prefix)
        if net.version != 4 or not net.is_private or not wg.is_private or net.network.overlaps(wg.network):
            raise ValueError('Use separate private IPv4 recovery and WireGuard subnets')
        start, end = ipaddress.ip_address(self.dhcp_range_start), ipaddress.ip_address(self.dhcp_range_end)
        if start not in net.network or end not in net.network or start > end or start <= net.ip <= end:
            raise ValueError('DHCP range must belong to the recovery subnet and exclude its router')
        if len({m.device_id for m in self.members}) != len(self.members):
            raise ValueError('Each source device must appear only once')
        return self


@router.get('/api/recovery/plans')
def plans(user=Depends(require_user)):
    with db() as conn:
        return [{'id': r['id'], 'name': r['name'], 'created': r['created'], 'spec': json.loads(unseal(r['spec']))}
                for r in conn.execute('SELECT * FROM recovery_plans ORDER BY created DESC')]


@router.post('/api/recovery/plans')
def plan_create(body: Plan, user=Depends(require_user)):
    for member in body.members:
        device = get_device(member.device_id, approved=True)
        if device['slide_agent_id'] != member.slide_agent_id:
            raise HTTPException(409, 'Link each source device to its Slide agent before creating a plan')
    plan_id = ident()
    with db(write=True) as conn:
        conn.execute('INSERT INTO recovery_plans VALUES(?,?,?,?)', (plan_id, body.name, seal(body.model_dump_json()), time.time()))
        audit(conn, user['username'], 'recovery.plan_created', detail={'plan_id': plan_id})
    return {'id': plan_id}


@router.put('/api/recovery/plans/{plan_id}')
def plan_update(plan_id: str, body: Plan, user=Depends(require_user)):
    for member in body.members:
        device = get_device(member.device_id, approved=True)
        if device['slide_agent_id'] != member.slide_agent_id:
            raise HTTPException(409, 'Source device and Slide agent do not match')
    with db(write=True) as conn:
        if not conn.execute('SELECT 1 FROM recovery_plans WHERE id=?', (plan_id,)).fetchone():
            raise HTTPException(404, 'Plan not found')
        if conn.execute('SELECT 1 FROM recovery_runs WHERE plan_id=?', (plan_id,)).fetchone():
            raise HTTPException(409, 'Plans with run history are immutable. Create a new plan version.')
        conn.execute('UPDATE recovery_plans SET name=?,spec=? WHERE id=?', (body.name, seal(body.model_dump_json()), plan_id))
        audit(conn, user['username'], 'recovery.plan_updated', detail={'plan_id': plan_id})
    return {'ok': True}


def run_load(run_id):
    with db() as conn:
        row = conn.execute('SELECT * FROM recovery_runs WHERE id=?', (run_id,)).fetchone()
    if not row:
        raise HTTPException(404, 'Recovery run not found')
    obj = dict(row)
    obj['state'] = json.loads(obj['state'])
    obj['report'] = json.loads(obj['report'])
    return obj


def run_save(run_id, state, phase, status='running', report=None):
    with db(write=True) as conn:
        conn.execute('UPDATE recovery_runs SET state=?,phase=?,status=?,updated=? WHERE id=?',
                     (json.dumps(state), phase, status, time.time(), run_id))
        if report is not None:
            conn.execute('UPDATE recovery_runs SET report=? WHERE id=?', (json.dumps(report), run_id))


def spawn(coro):
    task = asyncio.create_task(coro)
    workers.add(task)
    task.add_done_callback(workers.discard)


@router.get('/api/recovery/runs')
def runs(user=Depends(require_user)):
    with db() as conn:
        ids = [r['id'] for r in conn.execute('SELECT id FROM recovery_runs ORDER BY created DESC LIMIT 100')]
    return [run_load(i) for i in ids]


@router.post('/api/recovery/plans/{plan_id}/runs')
async def run_start(plan_id: str, user=Depends(require_user)):
    settings()
    with db(write=True) as conn:
        row = conn.execute('SELECT * FROM recovery_plans WHERE id=?', (plan_id,)).fetchone()
        if not row:
            raise HTTPException(404, 'Plan not found')
        if conn.execute("SELECT 1 FROM recovery_runs WHERE status IN ('running','awaiting_clones','needs_attention')").fetchone():
            raise HTTPException(409, 'Finish or stop the active recovery run before starting another')
        spec = Plan.model_validate_json(unseal(row['spec']))
        run_id = ident()
        state = {'actor': user['username'], 'members': [], 'network_id': None, 'name': row['name']}
        conn.execute('INSERT INTO recovery_runs(id,plan_id,status,phase,created,updated,state) VALUES(?,?,?,?,?,?,?)',
                     (run_id, plan_id, 'running', 'baseline', time.time(), time.time(), json.dumps(state)))
        audit(conn, user['username'], 'recovery.started', detail={'run_id': run_id})
    spawn(execute_run(run_id, spec, state))
    return {'id': run_id}


async def wait_job(job_id, timeout=240):
    deadline = time.time() + timeout
    while time.time() < deadline:
        with db() as conn:
            row = conn.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()
        if row and row['status'] in ('complete', 'failed', 'unknown', 'expired'):
            obj = public_job(row)
            if obj['status'] != 'complete' or obj['result'].get('exit_code', 0) != 0 or obj['result'].get('truncated'):
                raise RuntimeError('A recovery check failed; inspect its job output')
            return obj['result']
        await asyncio.sleep(2)
    raise RuntimeError('Timed out waiting for a recovery check')


async def mutation(slide, run_id, state, path, body, target, key):
    # A crash after the provider acts but before local persistence is ambiguous.
    # The durable journal forces operator reconciliation instead of duplicate VMs.
    state['pending_mutation'] = {'path': path, 'started': time.time(), 'resource_key': key}
    run_save(run_id, state, path)
    value = await slide.request('POST', path, body)
    if not value.get(key):
        raise RuntimeError('Provider response did not contain the created resource ID')
    target[key] = value[key]
    state.pop('pending_mutation', None)
    run_save(run_id, state, path)
    return value


async def execute_run(run_id, spec, state):
    slide = Slide()
    try:
        for member in spec.members:
            source = get_device(member.device_id, approved=True)
            if time.time() - source['last_seen'] > 75:
                raise RuntimeError('A source device is offline')
            entry = {'source_device_id': member.device_id, 'installation_id': source['installation_id'],
                     'slide_agent_id': member.slide_agent_id, 'restore_device_id': member.restore_device_id}
            state['members'].append(entry)
            entry['baseline_job_id'] = create_job(member.device_id, 'command', {'script': member.baseline_script, 'timeout': 180}, state['actor'], 180)
            run_save(run_id, state, 'baseline')
            entry['baseline'] = await wait_job(entry['baseline_job_id'])
            await mutation(slide, run_id, state, 'backup', {'agent_id': member.slide_agent_id}, entry, 'backup_id')
        run_save(run_id, state, 'backup')
        deadline = time.time() + spec.timeout_minutes * 60
        while time.time() < deadline:
            for entry in state['members']:
                value = await slide.request('GET', 'backup/' + entry['backup_id'])
                entry['backup_status'] = value['status']
                if value['status'] in ('failed', 'canceled'):
                    raise RuntimeError('A Slide backup failed; inspect its provider status')
                if value['status'] == 'succeeded':
                    entry['snapshot_id'] = value['snapshot_id']
            run_save(run_id, state, 'backup')
            if all(e.get('snapshot_id') for e in state['members']):
                break
            await asyncio.sleep(10)
        else:
            raise RuntimeError('Backup deadline exceeded')
        # A shared isolated network lets applications communicate across restored VMs.
        net = {k: getattr(spec, k) for k in ('router_prefix', 'dhcp_range_start', 'dhcp_range_end', 'wg_prefix', 'client_id')}
        net.update(name='Speck ' + run_id[:10], type='standard', dhcp=True, internet=True, wg=True,
                   nameservers=['1.1.1.1', '1.0.0.1'], comments='Owned by Speck recovery run ' + run_id)
        await mutation(slide, run_id, state, 'network', net, state, 'network_id')
        for member, entry in zip(spec.members, state['members'], strict=True):
            # Validate that this snapshot belongs to the source and is present at the target.
            snapshot = await slide.request('GET', 'snapshot/' + entry['snapshot_id'])
            if snapshot['agent_id'] != member.slide_agent_id:
                raise RuntimeError('Snapshot source does not match the recovery plan')
            while not any(location.get('device_id') == member.restore_device_id for location in snapshot.get('locations', [])):
                if time.time() > deadline:
                    raise RuntimeError('Snapshot did not reach the restore appliance before the replication deadline')
                run_save(run_id, state, 'replication')
                await asyncio.sleep(10)
                snapshot = await slide.request('GET', 'snapshot/' + entry['snapshot_id'])
            entry['snapshot_verification'] = safe_provider(snapshot)
            await mutation(slide, run_id, state, 'restore/virt', {
                'snapshot_id': entry['snapshot_id'], 'device_id': member.restore_device_id,
                'cpu_count': member.cpu_count, 'memory_in_mb': member.memory_in_mb,
                'network_type': 'network-id', 'network_source': state['network_id'], 'purpose': 'disaster', 'vnc_enabled': True}, entry, 'virt_id')
        run_save(run_id, state, 'approve_restored_instances', 'awaiting_clones')
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        state['error'] = exc.detail if isinstance(exc, HTTPException) else str(exc)
        run_save(run_id, state, 'attention', 'needs_attention')


class BindClones(BaseModel):
    # Explicit pairing prevents an unrelated clone being mistaken for this restore.
    devices: dict[str, str]


@router.post('/api/recovery/runs/{run_id}/verify')
async def verify(run_id: str, body: BindClones, user=Depends(require_user)):
    run = run_load(run_id)
    if run['status'] != 'awaiting_clones':
        raise HTTPException(409, 'This run is not ready for restored-instance checks')
    with db() as conn:
        row = conn.execute('SELECT spec FROM recovery_plans WHERE id=?', (run['plan_id'],)).fetchone()
    spec, state = Plan.model_validate_json(unseal(row['spec'])), run['state']
    used = set()
    for entry in state['members']:
        restored_id = body.devices.get(entry['source_device_id'])
        restored = get_device(restored_id, approved=True)
        if restored_id == entry['source_device_id'] or restored_id in used or restored['installation_id'] != entry['installation_id'] or restored['created'] < run['created'] or time.time() - restored['last_seen'] > 75:
            raise HTTPException(409, 'Select a distinct, approved, online restored instance created during this run for each source')
        used.add(restored_id)
        entry['restored_device_id'] = restored_id
    run_save(run_id, state, 'application_checks')
    spawn(verify_run(run_id, spec, state))
    return {'ok': True}


async def verify_run(run_id, spec, state):
    report = {'members': [], 'passed': False}
    try:
        for member, entry in zip(spec.members, state['members'], strict=True):
            entry['verify_job_id'] = create_job(entry['restored_device_id'], 'command', {'script': member.recovery_script, 'timeout': 180}, state['actor'], 180)
            run_save(run_id, state, 'application_checks')
            result = await wait_job(entry['verify_job_id'])
            matched = result.get('stdout', '').strip() == entry['baseline'].get('stdout', '').strip()
            report['members'].append({'source_device_id': member.device_id, 'restored_device_id': entry['restored_device_id'],
                'baseline_job_id': entry['baseline_job_id'], 'verify_job_id': entry['verify_job_id'],
                'compared': member.compare_output, 'output_matches': matched,
                'passed': matched if member.compare_output else True})
        report['passed'] = all(m['passed'] for m in report['members'])
        run_save(run_id, state, 'complete', 'passed' if report['passed'] else 'failed', report)
    except Exception as exc:
        state['error'] = str(exc)
        run_save(run_id, state, 'attention', 'needs_attention', report)


@router.post('/api/recovery/runs/{run_id}/stop')
async def stop_run(run_id: str, user=Depends(require_user)):
    run = run_load(run_id)
    if run['status'] == 'running':
        raise HTTPException(409, 'Wait for the active step to finish before stopping this run')
    state = run['state']
    slide = Slide()
    # Stop only VMs created and recorded by this run. Keep snapshots and reports.
    for entry in state['members']:
        if entry.get('virt_id'):
            if not re.fullmatch(r'virt_[a-z0-9]{12}', entry['virt_id']):
                raise HTTPException(409, 'Invalid recorded VM identity')
            await slide.request('PATCH', 'restore/virt/' + entry['virt_id'], {'state': 'stopped'})
    run_save(run_id, state, 'stopped', 'stopped', run['report'])
    with db(write=True) as conn:
        audit(conn, user['username'], 'recovery.stopped', detail={'run_id': run_id})
    return {'ok': True, 'retained': 'Snapshots, stopped VMs, network and evidence are retained for inspection.'}
