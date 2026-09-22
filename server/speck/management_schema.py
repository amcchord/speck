"""Additive, restart-safe migrations for an existing single-organization server."""


def migrate(conn):
    columns = {
        "users": {
            "role": "TEXT NOT NULL DEFAULT 'admin'",
            "disabled": "INTEGER NOT NULL DEFAULT 0",
            "totp_secret": "TEXT",
            "totp_pending": "TEXT",
            "totp_pending_until": "REAL",
            "totp_counter": "INTEGER NOT NULL DEFAULT -1",
            "recovery_codes": "TEXT NOT NULL DEFAULT '[]'",
        },
        "devices": {
            "site": "TEXT NOT NULL DEFAULT ''",
            "tags": "TEXT NOT NULL DEFAULT '[]'",
            "archived": "INTEGER NOT NULL DEFAULT 0",
            "maintenance_until": "REAL NOT NULL DEFAULT 0",
        },
    }
    for table, fields in columns.items():
        existing = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
        for name, definition in fields.items():
            if name not in existing:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {definition}")
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS alerts(
      id TEXT PRIMARY KEY,device_id TEXT REFERENCES devices(id),key TEXT NOT NULL,title TEXT NOT NULL,
      severity TEXT NOT NULL,opened REAL NOT NULL,updated REAL NOT NULL,acknowledged REAL,ack_actor TEXT,
      resolved REAL,resolve_actor TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS alerts_active ON alerts(device_id,key) WHERE resolved IS NULL;
    CREATE INDEX IF NOT EXISTS alerts_time ON alerts(opened);
    CREATE TABLE IF NOT EXISTS monitor_states(
      device_id TEXT NOT NULL REFERENCES devices(id),key TEXT NOT NULL,since REAL NOT NULL,
      PRIMARY KEY(device_id,key));
    CREATE TABLE IF NOT EXISTS monitor_overrides(
      device_id TEXT PRIMARY KEY REFERENCES devices(id),policy TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS schedules(
      id TEXT PRIMARY KEY,name TEXT NOT NULL,spec TEXT NOT NULL,owner_id TEXT NOT NULL REFERENCES users(id),
      created REAL NOT NULL,updated REAL NOT NULL,enabled INTEGER NOT NULL,interval_seconds INTEGER NOT NULL,
      next_run REAL NOT NULL,revision INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS schedule_runs(
      id TEXT PRIMARY KEY,schedule_id TEXT NOT NULL REFERENCES schedules(id),due REAL NOT NULL,
      created REAL NOT NULL,status TEXT NOT NULL,reason TEXT NOT NULL,batch_id TEXT REFERENCES batches(id),
      UNIQUE(schedule_id,due));
    """)

    existing = {r[1] for r in conn.execute("PRAGMA table_info(schedules)")}
    for name in ("request_id", "fingerprint"):
        if name not in existing:
            conn.execute(f"ALTER TABLE schedules ADD COLUMN {name} TEXT")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS schedules_request ON schedules(request_id)")
