import base64
import json
import time

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from speck.agent_updates import record_checkin
from speck.db import db
from test_control_plane import enroll


@pytest.fixture
def release(tmp_path, monkeypatch):
    key = Ed25519PrivateKey.generate()
    public = base64.b64encode(key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode()
    monkeypatch.setenv('SPECK_AGENT_UPDATE_PUBLIC_KEY', public)
    monkeypatch.setenv('SPECK_DOWNLOAD_DIR', str(tmp_path))
    root = tmp_path / 'agent-releases'
    root.mkdir()
    manifest = {'version': '0.3.1', 'platform': 'linux', 'arch': 'amd64', 'published_at': time.time()-1,
                'expires_at': time.time()+86400, 'files': []}

    def publish(**changes):
        payload = json.dumps(manifest | changes).encode()
        envelope = {'payload': base64.b64encode(payload).decode(), 'signature': base64.b64encode(key.sign(payload)).decode()}
        (root / 'current.json').write_text(json.dumps({'version': '0.3.1', 'releases': {'linux-amd64': envelope}}))
        return envelope
    return publish, public


def test_offer_policy_signature_and_enrollment_key(client, release):
    publish, public = release
    device, headers = enroll(client)
    assert device['update_public_key'] == public
    assert client.get('/api/agent/update', headers=headers).json() == {'enabled': True, 'release': None}
    envelope = publish()
    assert client.get('/api/agent/update', headers=headers).json()['release'] == envelope
    assert client.put('/api/agent-updates', json={'enabled': False}).status_code == 200
    assert client.get('/api/agent/update', headers=headers).json()['reason'] == 'paused'
    assert client.post('/api/agent/update/claim', headers=headers, json={'version': '0.3.1'}).json()['enabled'] is False
    assert client.put('/api/agent-updates', json={'enabled': True}).status_code == 200
    publish(expires_at=time.time()-1)
    assert client.get('/api/agent/update', headers=headers).status_code == 503
    publish(platform='windows')
    assert client.get('/api/agent/update', headers=headers).status_code == 503
    envelope = publish()
    from speck.agent_updates import release_file
    envelope['payload'] = base64.b64encode(b'{"version":"99.0.0"}').decode()
    release_file().write_text(json.dumps({'releases': {'linux-amd64': envelope}}))
    assert client.get('/api/agent/update', headers=headers).status_code == 503


def test_claim_serializes_jobs_and_requires_confirmed_checkin(client, release):
    release[0]()
    device, headers = enroll(client)
    url = '/api/agent/update/claim'
    assert client.post(url, headers=headers, json={'version': '0.4.0'}).status_code == 409
    assert client.post(url, headers=headers, json={'version': '0.3.1'}).json()['enabled']
    assert client.post(url, headers=headers, json={'version': '0.3.1'}).json()['reason'] == 'installing'
    client.put('/api/devices/'+device['device_id']+'/remote', json={'protocol': 'ssh', 'port': 22})
    assert client.post('/api/devices/'+device['device_id']+'/remote/sessions', json={}).status_code == 409
    job = client.post('/api/devices/'+device['device_id']+'/jobs', json={'kind': 'command', 'payload': {'script': 'echo update-proof'}}).json()
    assert client.get('/api/agent/jobs/next', headers=headers).json()['job'] is None
    def checkin(status):
        return client.post('/api/agent/check-in', headers=headers, json={'hostname': 'testbox', 'platform': 'linux', 'arch': 'amd64',
                'telemetry': {'version': '0.3.1', 'agent_update': {'version': '0.3.1', 'status': status}}})
    assert checkin('installing').status_code == 200
    assert client.get('/api/agent/jobs/next', headers=headers).json()['job'] is None
    assert checkin('current').status_code == 200
    assert client.get('/api/agent/jobs/next', headers=headers).json()['job']['id'] == job['id']
    assert client.get('/api/agent-updates').json()['devices'][0]['status'] == 'current'


@pytest.mark.parametrize('status', ['queued', 'leased', 'running'])
def test_busy_jobs_defer_updates(client, release, status):
    release[0]()
    device, headers = enroll(client)
    job = client.post('/api/devices/'+device['device_id']+'/jobs', json={'kind': 'command', 'payload': {'script': 'echo proof'}}).json()['id']
    with db(write=True) as conn:
        conn.execute('UPDATE jobs SET status=? WHERE id=?', (status, job))
    assert client.get('/api/agent/update', headers=headers).json()['reason'] == 'busy'
    assert client.post('/api/agent/update/claim', headers=headers, json={'version': '0.3.1'}).json()['reason'] == 'busy'


def test_live_remote_and_unapproved_clone_defer_updates(client, release):
    release[0]()
    device, headers = enroll(client)
    identifier = device['device_id']
    with db(write=True) as conn:
        conn.execute('UPDATE devices SET telemetry=? WHERE id=?', (json.dumps({'capabilities': {'web_shell': True, 'desktop': 'headless'}}), identifier))
    session = client.post('/api/devices/'+identifier+'/remote/sessions', json={}).json()['id']
    with db(write=True) as conn:
        conn.execute("UPDATE jobs SET status='complete' WHERE device_id=?", (identifier,))
    assert client.get('/api/agent/update', headers=headers).json()['reason'] == 'busy'
    client.delete('/api/remote/sessions/'+session)
    clone = headers | {'X-Speck-Hardware': 'hardware-restored-123'}
    client.post('/api/agent/check-in', headers=clone, json={'hostname': 'clone', 'platform': 'linux', 'arch': 'amd64', 'telemetry': {}})
    assert client.get('/api/agent/update', headers=clone).status_code == 409
    with db(write=True) as conn:
        conn.execute('UPDATE installations SET revoked=1 WHERE id=?', (device['installation_id'],))
    assert client.get('/api/agent/update', headers=headers).status_code == 401


@pytest.mark.parametrize('failure', ['failed', 'rollback_failed'])
def test_failure_blocks_repeat_but_not_later_release(client, release, failure):
    release[0]()
    device, headers = enroll(client)
    assert client.post('/api/agent/update/claim', headers=headers, json={'version': '0.3.1'}).json()['enabled']
    with db(write=True) as conn:
        record_checkin(conn, device['device_id'], {'version': '0.3.0', 'agent_update': {'version': '0.3.1', 'status': failure}})
    assert client.get('/api/agent/update', headers=headers).json()['reason'] == 'previous_attempt_failed'
    release[0](version='0.3.2')
    assert client.get('/api/agent/update', headers=headers).json()['enabled']


def test_expired_lease_releases_jobs_and_policy_is_admin_csrf_protected(client, release):
    release[0]()
    device, headers = enroll(client)
    client.post('/api/agent/update/claim', headers=headers, json={'version': '0.3.1'})
    with db(write=True) as conn:
        conn.execute('UPDATE agent_updates SET lease_until=?', (time.time()-1,))
    job = client.post('/api/devices/'+device['device_id']+'/jobs', json={'kind': 'command', 'payload': {'script': 'echo proof'}}).json()['id']
    assert client.get('/api/agent/jobs/next', headers=headers).json()['job']['id'] == job
    assert client.put('/api/agent-updates', json={'enabled': False}, headers={'X-CSRF-Token': ''}).status_code == 403
    client.post('/api/access/users', json={'username': 'operator', 'password': 'test-only-operator-password', 'role': 'operator'})
    client.post('/api/auth/logout')
    response = client.post('/api/auth/login', json={'username': 'operator', 'password': 'test-only-operator-password'}).json()
    client.headers['X-CSRF-Token'] = response['csrf']
    assert client.get('/api/agent-updates').status_code == 403
    assert client.put('/api/agent-updates', json={'enabled': False}).status_code == 403
