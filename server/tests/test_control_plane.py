import asyncio
import hashlib
import time

import pytest

from speck.db import db
from speck.remote import instruction, read_instruction
from speck.slide import Plan, Slide, safe_provider




def enroll(client, hardware='hardware-original-123', label='Test machine'):
    token = client.post('/api/enrollments', json={'label': label}).json()['token']
    body = {'token': token, 'hardware_id': hardware, 'hostname': 'testbox', 'platform': 'linux', 'arch': 'amd64'}
    response = client.post('/api/agent/enroll', json=body)
    assert response.status_code == 200
    assert client.post('/api/agent/enroll', json=body).status_code == 401
    obj = response.json()
    return obj, {'Authorization': 'Bearer ' + obj['token'], 'X-Speck-Hardware': hardware}


def test_login_csrf_session_revocation(client):
    assert client.post('/api/enrollments', json={'label': 'wrong origin'}, headers={'Origin': 'https://attacker.test'}).status_code == 403
    assert client.post('/api/enrollments', json={'label': 'no csrf'}, headers={'X-CSRF-Token': ''}).status_code == 403
    assert client.post('/api/auth/logout').status_code == 200
    assert client.get('/api/devices').status_code == 401


def test_clone_identity_cannot_receive_original_jobs(client):
    original, headers = enroll(client)
    job = client.post('/api/devices/' + original['device_id'] + '/jobs', json={'kind': 'command', 'payload': {'script': 'echo proof'}}).json()['id']
    clone_headers = headers | {'X-Speck-Hardware': 'hardware-restored-456'}
    checkin = client.post('/api/agent/check-in', headers=clone_headers, json={'hostname': 'testbox', 'platform': 'linux', 'arch': 'amd64', 'telemetry': {}}).json()
    assert checkin['device_id'] != original['device_id']
    assert checkin['approved'] is False
    assert client.get('/api/agent/jobs/next', headers=clone_headers).json() == {'job': None}
    assert client.post('/api/devices/' + checkin['device_id'] + '/jobs', json={'kind': 'command', 'payload': {'script': 'echo denied'}}).status_code == 409
    lease = client.get('/api/agent/jobs/next', headers=headers).json()['job']
    assert lease['id'] == job
    assert client.post('/api/agent/jobs/' + job, headers=clone_headers, json={'lease': lease['lease'], 'status': 'complete'}).status_code == 403
    assert client.post('/api/agent/jobs/' + job, headers=headers, json={'lease': 'wrong', 'status': 'complete'}).status_code == 403
    assert client.post('/api/agent/jobs/' + job, headers=headers, json={'lease': lease['lease'], 'status': 'complete', 'result': {'stdout': 'proof'}}).status_code == 200
    public = client.get('/api/jobs/' + job).json()
    assert 'payload' not in public and 'lease_hash' not in public
    assert client.get('/api/agent/jobs/next', headers=headers).json() == {'job': None}


def test_transfer_ownership_integrity_and_replay(client):
    original, headers = enroll(client)
    _, other = enroll(client, 'other-hardware-123')
    transfer = client.post('/api/devices/' + original['device_id'] + '/files/download', json={'path': '/tmp/proof'}).json()
    path = '/api/agent/transfers/' + transfer['id']
    assert client.put(path, headers=other, content=b'proof').status_code == 409
    assert client.put(path, headers=headers | {'X-Content-SHA256': 'incorrect'}, content=b'proof').status_code == 422
    assert client.get('/api/transfers/' + transfer['id'] + '/file').status_code == 404
    transfer = client.post('/api/devices/' + original['device_id'] + '/files/download', json={'path': '/tmp/proof'}).json()
    path = '/api/agent/transfers/' + transfer['id']
    payload = b'proof\x00binary\xff'
    checksum = hashlib.sha256(payload).hexdigest()
    assert client.put(path, headers=headers | {'X-Content-SHA256': checksum}, content=payload).status_code == 200
    assert client.get('/api/transfers/' + transfer['id'] + '/file').content == payload
    assert client.put(path, headers=headers | {'X-Content-SHA256': checksum}, content=payload).status_code == 409


def test_enrollment_expiry_and_credentials_encrypted(client):
    token = client.post('/api/enrollments', json={'label': 'expires'}).json()['token']
    with db(write=True) as conn:
        conn.execute('UPDATE enrollments SET expires=?', (time.time()-1,))
    assert client.post('/api/agent/enroll', json={'token': token, 'hardware_id': 'hardware-123', 'hostname': 'x', 'platform': 'linux', 'arch': 'amd64'}).status_code == 401
    original, _ = enroll(client)
    password = 'distinct-test-password-never-in-plaintext'
    assert client.put('/api/devices/'+original['device_id']+'/remote', json={'protocol': 'rdp', 'port': 3389, 'password': password}).status_code == 200
    with db() as conn:
        row = conn.execute('SELECT remote_secret FROM devices WHERE id=?', (original['device_id'],)).fetchone()
        assert password not in row['remote_secret']
    assert password not in client.get('/api/devices').text


def test_guacamole_unicode_chunking():
    async def read():
        reader = asyncio.StreamReader()
        encoded = instruction('clipboard', 'café 漢字', '').encode()
        for chunk in encoded:
            reader.feed_data(bytes([chunk]))
        reader.feed_eof()
        assert await read_instruction(reader) == ['clipboard', 'café 漢字', '']
    asyncio.run(read())


def test_slide_pagination_and_secret_redaction():
    slide = Slide({'url': 'https://example.test', 'token': 'test'})
    calls = []
    async def request(method, path, body=None, params=None):
        calls.append(params['offset'])
        if params['offset'] == 0:
            return {'data': [{'id': 1}], 'pagination': {'next_offset': 100}}
        return {'data': [{'id': 2}], 'pagination': {'next_offset': None}}
    slide.request = request
    assert asyncio.run(slide.listing('device')) == [{'id': 1}, {'id': 2}]
    assert calls == [0, 100]
    assert safe_provider({'vnc_password': 'secret', 'nested': [{'private_key': 'secret', 'name': 'safe'}]}) == {'nested': [{'name': 'safe'}]}


def test_recovery_requires_distinct_isolated_subnets():
    member = {'device_id': 'a'*32, 'slide_agent_id': 'a_0123456789ab', 'restore_device_id': 'd_0123456789ab', 'baseline_script': 'echo proof', 'recovery_script': 'echo proof'}
    assert Plan(name='Example', members=[member]).members
    with pytest.raises(ValueError):
        Plan(name='Example', members=[member], wg_prefix='10.217.0.2/24')
    with pytest.raises(ValueError):
        Plan(name='Example', members=[member], dhcp_range_start='192.168.1.2')
    with pytest.raises(ValueError):
        Plan(name='Example', members=[member, member])


def test_ambiguous_provider_mutation_keeps_durable_journal(client):
    from fastapi import HTTPException
    from speck.config import seal
    from speck.db import ident
    from speck.slide import mutation, run_load
    plan_id, run_id = ident(), ident()
    state = {'members': [], 'network_id': None}
    with db(write=True) as conn:
        conn.execute('INSERT INTO recovery_plans VALUES(?,?,?,?)', (plan_id, 'test', seal('{}'), time.time()))
        conn.execute('INSERT INTO recovery_runs(id,plan_id,status,phase,created,updated,state) VALUES(?,?,?,?,?,?,?)',
                     (run_id, plan_id, 'running', 'test', time.time(), time.time(), '{}'))
    class LostReply:
        calls = 0
        async def request(self, *args, **kwargs):
            self.calls += 1
            assert run_load(run_id)['state']['pending_mutation']['path'] == 'network'
            raise HTTPException(502, 'Reply lost')
    provider = LostReply()
    with pytest.raises(HTTPException):
        asyncio.run(mutation(provider, run_id, state, 'network', {}, state, 'network_id'))
    assert provider.calls == 1
    assert run_load(run_id)['state']['pending_mutation']['resource_key'] == 'network_id'
