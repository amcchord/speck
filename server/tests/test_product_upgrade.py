import time

from speck.db import audit, db, initialize
from speck.vault import CHECKS
from test_fleet_operations import batch, managed


def test_provider_history_survives_restart_without_claiming_current_health(client):
    CHECKS.clear()
    with db(write=True) as conn:
        audit(conn, "test-operator", "vault.provider.checked", detail={"service": "openai", "ok": True})
    row = next(s for s in client.get('/api/keys/services').json() if s['service'] == 'openai')
    assert row['last_check']['historical'] is True
    assert row['last_check']['ok'] is True
    assert row['last_check']['checked_at'] > time.time() - 10


def test_schedule_edit_requires_fresh_review_and_does_not_replay_missed_runs(client):
    device, _ = managed(client)
    operation = batch([device['device_id']])
    body = {'operation': operation, 'first_run': time.time()+3600, 'interval_seconds': 86400, 'confirmed': True}
    result = client.post('/api/schedules', json=body)
    assert result.status_code == 200
    schedule_id = result.json()['id']
    edited = body | {'revision': 1, 'operation': operation | {'name': 'Reviewed replacement'}}
    assert client.put('/api/schedules/'+schedule_id, json=edited | {'confirmed': False}).status_code == 422
    assert client.put('/api/schedules/'+schedule_id, json=edited | {'first_run': time.time()-60}).status_code == 422
    assert client.put('/api/schedules/'+schedule_id, json=edited).status_code == 200
    assert client.put('/api/schedules/'+schedule_id, json=edited).status_code == 409
    assert client.get('/api/jobs').json() == []
    schedule = client.get('/api/schedules').json()[0]
    assert schedule['revision'] == 2 and schedule['name'] == 'Reviewed replacement'


def test_template_revisions_preserve_encrypted_history_across_migration(client):
    spec = {'name':'Example script','platform':'linux','category':'script','script':'echo first','parameters':[],'timeout':60}
    result = client.post('/api/templates', json=spec).json()
    template_id = result['id']
    assert client.put('/api/templates/'+template_id,json=spec | {'script':'echo second'}).status_code == 200
    initialize()
    history = client.get('/api/templates/'+template_id+'/revisions').json()
    assert [h['revision'] for h in history] == [2,1]
    assert history[1]['template']['script'] == 'echo first'
    with db() as conn:
        assert all('echo' not in row['spec'] for row in conn.execute('SELECT spec FROM template_revisions'))
