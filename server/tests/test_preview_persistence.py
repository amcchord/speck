import base64
import time

from test_fleet_operations import managed
from speck.config import unseal
from speck.db import db
from speck import screens


def setup(client):
    screens.frames.clear()
    screens.reports.clear()
    device, headers = managed(client)
    path = '/api/devices/' + device['device_id']
    assert client.put(path + '/preview-policy', json={'enabled': True}).status_code == 200
    return device, headers, path


def frame(at, label=b'one'):
    jpeg = b'\xff\xd8\xff' + label + b'\xff\xd9'
    return {'jpeg': base64.b64encode(jpeg).decode(), 'captured_at': at, 'width': 640, 'height': 360}


def test_checkpoint_cadence_encryption_restart_and_offline(client, monkeypatch):
    device, headers, path = setup(client)
    now = time.time()
    clock = [now]
    monkeypatch.setattr(screens.time, 'time', lambda: clock[0])
    first = frame(now)
    assert client.put('/api/agent/preview', headers=headers, json=first).status_code == 200
    with db() as conn:
        row = conn.execute('SELECT * FROM preview_snapshots').fetchone()
        assert row['jpeg'] != first['jpeg']
        assert unseal(row['jpeg']) == first['jpeg']
    clock[0] += 100
    second = frame(clock[0], b'two')
    assert client.put('/api/agent/preview', headers=headers, json=second).status_code == 200
    assert client.get(path + '/preview').content == base64.b64decode(second['jpeg'])
    # A restart loses live memory, but the five-minute checkpoint remains.
    screens.frames.clear()
    screens.reports.clear()
    status = client.get(path + '/preview-status').json()
    assert status['source'] == 'saved' and status['state'] == 'offline'
    assert status['captured_at'] == first['captured_at']
    assert client.get(path + '/preview').content == base64.b64decode(first['jpeg'])
    clock[0] = now + 300
    third = frame(clock[0], b'three')
    assert client.put('/api/agent/preview', headers=headers, json=third).status_code == 200
    screens.frames.clear()
    response = client.get(path + '/preview')
    assert response.content == base64.b64decode(third['jpeg'])
    assert response.headers['cache-control'] == 'no-store'
    assert response.headers['x-speck-preview-source'] == 'saved'
    with db() as conn:
        assert conn.execute('SELECT COUNT(*) FROM preview_snapshots').fetchone()[0] == 1


def test_disable_archive_revoke_purge_and_do_not_restore_on_reenable(client):
    for action in ('disable', 'archive', 'revoke'):
        device, headers, path = setup(client)
        assert client.put('/api/agent/preview', headers=headers, json=frame(time.time())).status_code == 200
        if action == 'disable':
            assert client.put(path + '/preview-policy', json={'enabled': False}).status_code == 200
            assert client.put(path + '/preview-policy', json={'enabled': True}).status_code == 200
        elif action == 'archive':
            assert client.put(path + '/archive', json={'archived': True}).status_code == 200
        else:
            inst = client.get(path + '/installation').json()
            assert client.post(path + '/installation/revoke', json={
                'affected_device_ids': [d['id'] for d in inst['devices']], 'confirmed': True,
            }).status_code == 200
        assert client.get(path + '/preview').status_code in (404, 409)
        assert device['device_id'] not in screens.frames
        with db() as conn:
            assert conn.execute('SELECT COUNT(*) FROM preview_snapshots WHERE device_id=?', (device['device_id'],)).fetchone()[0] == 0


def test_saved_frame_does_not_regress_and_old_capture_is_not_live(client, monkeypatch):
    _, headers, path = setup(client)
    now = time.time()
    assert client.put('/api/agent/preview', headers=headers, json=frame(now)).status_code == 200
    assert client.put('/api/agent/preview', headers=headers, json=frame(now - 10, b'old')).status_code == 200
    assert client.get(path + '/preview-status').json()['captured_at'] == now
    monkeypatch.setattr(screens.time, 'time', lambda: now + 46)
    assert client.get(path + '/preview-status').json()['source'] == 'saved'
    assert client.put('/api/agent/preview', headers=headers, json=frame(now)).status_code == 422


def test_capture_reports_and_viewer_protection(client):
    _, headers, path = setup(client)
    for state in ('no_desktop', 'helper_unavailable', 'capture_failed', 'capture_timeout', 'unsupported'):
        assert client.put('/api/agent/preview-status', headers=headers, json={'state': state}).status_code == 200
        assert client.get(path + '/preview-status').json()['state'] == state
    assert client.put('/api/agent/preview-status', headers=headers, json={'state': 'arbitrary error'}).status_code == 422
    assert client.put('/api/agent/preview', headers=headers, json=frame(time.time())).status_code == 200
    with db(write=True) as conn:
        conn.execute("UPDATE users SET role='viewer' WHERE username='admin'")
    assert client.get(path + '/preview').status_code == 403
    assert client.get(path + '/preview-status').status_code == 403


def test_retirement_racing_upload_cannot_recreate_snapshot(client):
    device, _, _ = setup(client)
    from speck.jobs import get_device
    from speck.management import stop_management
    from fastapi import HTTPException
    import pytest
    authenticated = get_device(device['device_id'])
    with db(write=True) as conn:
        conn.execute('UPDATE devices SET archived=1 WHERE id=?', (device['device_id'],))
        stop_management(conn, device['device_id'], 'test')
    with pytest.raises(HTTPException) as error:
        screens.upload_frame(screens.Frame(**frame(time.time())), authenticated)
    assert error.value.status_code == 403
    with db() as conn:
        assert conn.execute('SELECT COUNT(*) FROM preview_snapshots').fetchone()[0] == 0
