import json
import os
import sqlite3
import time
import uuid
from contextlib import contextmanager

from argon2 import PasswordHasher

from speck.config import cipher, data_dir


def ident():
    return uuid.uuid4().hex


@contextmanager
def db(write=False):
    conn = sqlite3.connect(data_dir() / 'speck.db', timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys=ON')
    try:
        if write:
            conn.execute('BEGIN IMMEDIATE')
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def audit(conn, actor, action, device_id=None, detail=None):
    conn.execute('INSERT INTO audit(at,actor,action,device_id,detail) VALUES(?,?,?,?,?)',
                 (time.time(), actor, action, device_id, json.dumps(detail or {})))


def initialize():
    cipher()
    data_dir().mkdir(parents=True, exist_ok=True, mode=0o700)
    (data_dir() / 'transfers').mkdir(exist_ok=True, mode=0o700)
    with db() as conn:
        conn.execute('PRAGMA journal_mode=WAL')
        conn.executescript('''
        CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),
          csrf TEXT NOT NULL,expires REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS login_attempts(ip TEXT NOT NULL,at REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS enrollments(token_hash TEXT PRIMARY KEY,label TEXT NOT NULL,expires REAL NOT NULL,used REAL);
        CREATE TABLE IF NOT EXISTS installations(id TEXT PRIMARY KEY,token_hash TEXT UNIQUE NOT NULL,created REAL NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,installation_id TEXT NOT NULL REFERENCES installations(id),
          hardware_id TEXT NOT NULL,hostname TEXT NOT NULL,label TEXT NOT NULL,platform TEXT NOT NULL,arch TEXT NOT NULL,
          created REAL NOT NULL,last_seen REAL NOT NULL,approved INTEGER NOT NULL,telemetry TEXT NOT NULL DEFAULT '{}',
          slide_agent_id TEXT,remote_secret TEXT,UNIQUE(installation_id,hardware_id));
        CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,device_id TEXT NOT NULL REFERENCES devices(id),kind TEXT NOT NULL,
          payload TEXT NOT NULL,status TEXT NOT NULL,created REAL NOT NULL,started REAL,finished REAL,deadline REAL NOT NULL,
          lease_hash TEXT,result TEXT,actor TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS jobs_device ON jobs(device_id,status,created);
        CREATE TABLE IF NOT EXISTS transfers(id TEXT PRIMARY KEY,device_id TEXT NOT NULL REFERENCES devices(id),direction TEXT NOT NULL,
          name TEXT NOT NULL,path TEXT NOT NULL,status TEXT NOT NULL,sha256 TEXT,size INTEGER,created REAL NOT NULL,job_id TEXT);
        CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS recovery_plans(id TEXT PRIMARY KEY,name TEXT NOT NULL,spec TEXT NOT NULL,created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS recovery_runs(id TEXT PRIMARY KEY,plan_id TEXT NOT NULL REFERENCES recovery_plans(id),
          status TEXT NOT NULL,phase TEXT NOT NULL,created REAL NOT NULL,updated REAL NOT NULL,state TEXT NOT NULL,report TEXT NOT NULL DEFAULT '{}');
        CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,at REAL NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,device_id TEXT,detail TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS device_policies(device_id TEXT PRIMARY KEY REFERENCES devices(id),preview_enabled INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS templates(id TEXT PRIMARY KEY,name TEXT NOT NULL,platform TEXT NOT NULL,category TEXT NOT NULL,spec TEXT NOT NULL,revision INTEGER NOT NULL,updated REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS batches(id TEXT PRIMARY KEY,request_id TEXT UNIQUE NOT NULL,fingerprint TEXT NOT NULL,name TEXT NOT NULL,kind TEXT NOT NULL,actor TEXT NOT NULL,created REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS batch_jobs(batch_id TEXT NOT NULL REFERENCES batches(id),job_id TEXT UNIQUE NOT NULL REFERENCES jobs(id),device_id TEXT NOT NULL REFERENCES devices(id));
        CREATE TABLE IF NOT EXISTS patch_reports(device_id TEXT PRIMARY KEY REFERENCES devices(id),job_id TEXT NOT NULL,scanned REAL NOT NULL,report TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS ai_requests(id TEXT PRIMARY KEY,actor TEXT NOT NULL,created REAL NOT NULL);
        ''')
        if not conn.execute('SELECT 1 FROM users LIMIT 1').fetchone():
            password = os.environ.get('SPECK_BOOTSTRAP_PASSWORD', '')
            if len(password) < 16:
                raise RuntimeError('A new installation requires SPECK_BOOTSTRAP_PASSWORD (16+ characters)')
            conn.execute('INSERT INTO users VALUES(?,?,?)', (ident(), os.environ.get('SPECK_ADMIN_USERNAME', 'admin'), PasswordHasher().hash(password)))
    os.chmod(data_dir() / 'speck.db', 0o600)
