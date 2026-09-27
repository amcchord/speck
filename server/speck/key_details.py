"""Credential metadata and recorded system associations. Never returns secret material."""

import json
import time

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field

from speck.config import unseal
from speck.db import audit, db


def migrate(conn):
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS key_systems(
      kind TEXT NOT NULL,name TEXT NOT NULL,target_id TEXT NOT NULL,label TEXT NOT NULL,
      source TEXT NOT NULL,note TEXT NOT NULL DEFAULT '',created REAL NOT NULL,created_by TEXT NOT NULL,
      PRIMARY KEY(kind,name,target_id));
    CREATE INDEX IF NOT EXISTS audit_key_name ON audit(json_extract(detail,'$.name'),at DESC) WHERE json_valid(detail);
    CREATE INDEX IF NOT EXISTS audit_key_filename ON audit(json_extract(detail,'$.filename'),at DESC) WHERE json_valid(detail);
    CREATE INDEX IF NOT EXISTS audit_key_service ON audit(json_extract(detail,'$.service'),at DESC) WHERE json_valid(detail);
    """)


def history(conn, kind, name):
    field = {'vault': 'name', 'ssh': 'name', 'handoff': 'filename', 'provider': 'service'}[kind]
    prefix = {'vault': 'vault.', 'ssh': 'ssh.', 'handoff': 'context.', 'provider': 'vault.provider.'}[kind]
    # Project only metadata; arbitrary audit detail can contain confidential data.
    rows = conn.execute(
        f"SELECT at,actor,action FROM audit WHERE json_valid(detail) AND json_extract(detail,'$.{field}')=? "
        "AND substr(action,1,?)=? ORDER BY at DESC LIMIT 50", (name, len(prefix), prefix),
    ).fetchall()
    access = {'vault': ('vault.reveal', 'vault.reveal.env', 'vault.provision.reused', 'vault.provisioned'),
              'ssh': ('ssh.private_revealed',), 'handoff': ('context.read',), 'provider': ('vault.provider.checked',)}[kind]
    last = conn.execute(
        f"SELECT at,actor,action FROM audit WHERE json_valid(detail) AND json_extract(detail,'$.{field}')=? "
        f"AND action IN ({','.join('?' for _ in access)}) ORDER BY at DESC LIMIT 1", (name, *access),
    ).fetchone()
    return {'events': [dict(r) for r in rows], 'last_access': dict(last) if last else None}


def targets(conn):
    """Only locally held inventory; opening the vault never waits for a provider."""
    from speck.fleet import resource_key

    result = {r['id']: {'id': r['id'], 'label': r['label'], 'description': 'Speck endpoint', 'device_id': r['id']}
              for r in conn.execute('SELECT id,label FROM devices WHERE archived=0')}
    for row in conn.execute('SELECT payload FROM fleet_inventory_cache WHERE connection_id IN (SELECT id FROM infrastructure_connections)'):
        for resource in json.loads(unseal(row['payload'])).get('resources', []):
            key = resource_key(resource)
            result[key] = {'id': key, 'label': resource.get('name') or resource['id'],
                           'description': ' · '.join(str(v) for v in [resource['provider'], resource.get('connection_name'), resource.get('node')] if v),
                           'resource': {k: resource.get(k) for k in ('connection_id', 'provider', 'kind', 'id')}}
    return sorted(result.values(), key=lambda r: str(r['label']).casefold())


def details(kind, name):
    with db() as conn:
        result = history(conn, kind, name)
        links = conn.execute('SELECT * FROM key_systems WHERE kind=? AND name=? ORDER BY label', (kind, name)).fetchall()
        known = {t['id']: t for t in targets(conn)} if links else {}
        result['systems'] = [dict(r) | {'target': known.get(r['target_id'])} for r in links]
    result['coverage'] = 'Activity records access through Speck. Use outside Speck is not observed. System associations describe recorded configuration, not a live authentication check.'
    return result


class SystemLink(BaseModel):
    model_config = ConfigDict(extra='forbid')
    target_id: str = Field(min_length=1, max_length=512)
    note: str = Field(default='', max_length=500)


def associate(conn, kind, name, target_id, label, actor, source='Recorded by administrator', note=''):
    conn.execute('INSERT OR REPLACE INTO key_systems VALUES(?,?,?,?,?,?,?,?)',
                 (kind, name, target_id, label, source, note, time.time(), actor))
    audit(conn, actor, ('vault' if kind == 'vault' else 'ssh') + '.system_linked',
          detail={'name': name, 'target_id': target_id, 'label': label})


def link(kind, name, body, user):
    # Broad inventory selection is for interactive administrators, not prefix-limited vault tokens.
    if user.get('via') == 'token':
        raise HTTPException(403, 'Manage system associations from a signed-in administrator session')
    with db(write=True) as conn:
        target = next((t for t in targets(conn) if t['id'] == body.target_id), None)
        if not target:
            raise HTTPException(404, 'System is no longer in the local inventory; refresh Fleet first')
        associate(conn, kind, name, target['id'], target['label'], user['username'], note=body.note.strip())
    return {'ok': True}


def unlink(kind, name, target_id, user):
    if user.get('via') == 'token':
        raise HTTPException(403, 'Manage system associations from a signed-in administrator session')
    with db(write=True) as conn:
        conn.execute('DELETE FROM key_systems WHERE kind=? AND name=? AND target_id=?', (kind, name, target_id))
        audit(conn, user['username'], ('vault' if kind == 'vault' else 'ssh') + '.system_unlinked', detail={'name': name, 'target_id': target_id})
    return {'ok': True}
