#!/usr/bin/env python3
"""Serve the real built console with synthetic, local-only screenshot fixtures.

No database, agent, vault, external requests or remote control. All writes other
than the local preview sign-in/enrollment demonstration are rejected.
"""

import json
import sys
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parents[1] / "server"))
from speck.operations import STARTERS
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
from preview_fixtures import provider_fixture
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

ROOT = Path(__file__).resolve().parents[1]
NOW = 1790071200
GB = 1024**3


def device(key, label, platform, online=True, approved=True, restored=False):
    win = platform == "windows"
    server = key in ("server", "restored-server")
    services = [
        {"name": "SpeckAgent", "display_name": "Speck Agent", "status": "running"},
        {
            "name": "MolarOfficeService" if win else "asterisk",
            "display_name": "Molar Office scheduling" if win else "Asterisk phone system",
            "status": "running",
        },
        {
            "name": "TermService" if win else "ssh",
            "display_name": "Remote Desktop Services" if win else "OpenSSH server",
            "status": "running",
        },
        {"name": "SlideAgent" if win else "slide-agent", "display_name": "Slide backup agent", "status": "running"},
        {"name": "Dnscache" if win else "systemd-resolved", "display_name": "DNS resolver", "status": "running"},
        {
            "name": "Spooler" if win else "cron",
            "display_name": "Print Spooler" if win else "Scheduled tasks",
            "status": "stopped",
        },
    ]
    return {
        "id": key,
        "label": label,
        "hostname": label.split(" ·")[0],
        "platform": platform,
        "arch": "amd64",
        "online": online,
        "approved": approved,
        "restored_from": "original" if restored else None,
        "last_seen": NOW if online else NOW - 86400,
        "created": NOW - 86400 * 10,
        "remote_protocol": "rdp" if win else "ssh",
        "remote_configured": True,
        "preview": {"enabled": False, "available": False},
        "slide_agent_id": "demo-" + key,
        "telemetry": {
            "version": "0.2.0",
            "capabilities": {"managed_operations": True, "screen_preview": True},
            "cpu_percent": 8.4 if win else 3.2,
            "memory": {"usedPercent": 34, "used": 2.7 * GB, "total": 8 * GB},
            "host": {
                "platform": "Windows Server 2025" if server else "Windows 11 Pro" if win else "Debian GNU/Linux",
                "platformVersion": "2025" if server else "24H2" if win else "13",
                "kernelVersion": "10.0.26100" if win else "6.12.0",
                "uptime": 234010,
            },
            "disks": [{"path": "C:\\" if win else "/", "total": 128 * GB, "used": 38.4 * GB, "usedPercent": 30}],
            "active_app": {
                "title": "Molar Office · Appointment book",
                "process": "MolarOffice.exe",
                "user": "Reception",
            }
            if win and not server
            else None,
            "services": services,
            "network": {
                "interfaces": [
                    {
                        "name": "Ethernet" if win else "eth0",
                        "addrs": [{"address": "192.0.2.24/24"}],
                        "mac": "02:00:00:00:00:24",
                        "mtu": 1500,
                        "flags": ["up", "broadcast"],
                    }
                ],
                "routes": [{"destination": "0.0.0.0/0", "gateway": "192.0.2.1", "interface": "Ethernet"}],
                "dns_servers": ["192.0.2.1"],
                "counters": [{"name": "Ethernet", "bytes_sent": 18454216, "bytes_recv": 228609231}],
                "connections": [
                    {
                        "process": p,
                        "pid": pid,
                        "local": {"ip": "192.0.2.24", "port": port},
                        "remote": {"ip": ip, "port": dest},
                        "status": "ESTABLISHED",
                    }
                    for p, pid, port, ip, dest in [
                        ("speck-agent.exe", 2412, 50142, "198.51.100.10", 443),
                        ("MolarOffice.exe", 5080, 51004, "192.0.2.20", 8080),
                        ("MicroSIP.exe", 3160, 50201, "192.0.2.21", 5060),
                    ]
                ],
            },
        },
    }


DEVICES = [
    device("frontdesk", "BYD-FRONTDESK", "windows"),
    device("server", "BYD-SERVER", "windows"),
    device("pbx", "BYD-PBX", "linux"),
    device("exam", "BYD-EXAM01", "windows"),
    device("caller", "BYD-CALLER", "linux"),
    device("restored-server", "BYD-SERVER · restored", "windows", restored=True),
    device("restored-pbx", "BYD-PBX · restored", "linux", restored=True),
    device("restored-frontdesk", "BYD-FRONTDESK · restored", "windows", restored=True),
]
MEMBERS = [
    {
        "source_device_id": key,
        "restored_device_id": "restored-" + key,
        "backup_status": "succeeded",
        "virt_id": "demo-vm-" + key,
    }
    for key in ["server", "pbx", "frontdesk"]
]
PLAN = {
    "id": "demo-plan",
    "name": "Brace Yourself Dental",
    "spec": {"router_prefix": "192.0.2.1/24", "members": MEMBERS},
}
RUN = {
    "id": "demo-run",
    "status": "passed",
    "phase": "complete",
    "created": NOW - 600,
    "state": {"name": "Brace Yourself Dental", "members": MEMBERS},
    "report": {
        "passed": True,
        "members": [{"source_device_id": m["source_device_id"], "passed": True, "compared": True} for m in MEMBERS],
    },
}
JOBS = [
    {
        "id": "demo-job-" + str(i),
        "kind": kind,
        "device_id": key,
        "status": "complete",
        "created": NOW - i * 320,
        "result": {"exit_code": 0, "stdout": out, "truncated": False},
    }
    for i, (kind, key, out) in enumerate(
        [
            ("command", "frontdesk", "Patient charts: 240\nAppointments: 660\nImaging studies: 105\nIntegrity: OK\n"),
            ("files.download", "server", "SHA-256 verified. Transfer complete.\n"),
            ("network.probe", "pbx", "192.0.2.21 reachable, 1.8 ms\n"),
            ("command", "restored-server", "Recovery application checks matched.\n"),
        ]
    )
]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def send(self, value, status=200, cookie=None):
        data = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        url = urlparse(self.path)
        route = url.path
        if route.startswith("/api/"):
            if route == "/api/auth/me":
                return self.send(
                    {"username": "demo", "csrf": "preview-only", "role": "admin"}
                    if "speck-gallery=1" in self.headers.get("Cookie", "")
                    else {"detail": "Sign in to preview"},
                    200 if "speck-gallery=1" in self.headers.get("Cookie", "") else 401,
                )
            resources = {
                "/api/monitoring": {"healthy": True, "default": {"enabled": True, "offline_seconds": 180, "hold_seconds": 120, "cpu_percent": 90, "memory_percent": 90, "disk_percent": 90, "services": []}, "overrides": {}},
                "/api/alerts": {"counts": {"active": 2, "unacknowledged": 1}, "next_cursor": None, "items": [
                    {"id": "demo-alert-1", "device_id": "caller", "label": "BYD-CALLER", "title": "Machine stopped reporting", "severity": "warning", "key": "offline", "opened": NOW - 3600, "acknowledged": None, "resolved": None},
                    {"id": "demo-alert-2", "device_id": "server", "label": "BYD-SERVER", "title": "Disk usage exceeds monitoring policy", "severity": "critical", "key": "disk", "opened": NOW - 1800, "acknowledged": NOW - 600, "ack_actor": "demo", "resolved": None},
                ]},
                "/api/schedules": [{"id": "demo-schedule", "name": "Daily update inventory", "enabled": True, "owner": "demo", "interval_seconds": 86400, "next_run": NOW + 86400, "operation": {"kind": "patch.scan", "device_ids": ["frontdesk", "server", "pbx"]}, "runs": [{"status": "complete", "due": NOW, "reason": "All three machines reported their available updates."}]}],
                "/api/audit/events": {"next_cursor": None, "items": [{"id": i + 1, "action": action, "actor": "demo", "label": "BYD-SERVER", "at": NOW - i * 180, "detail": {"device": "BYD-SERVER"}} for i, action in enumerate(["recovery.verify", "remote.open", "files.download", "device.approve"])]},
                "/api/access/me": {"username": "demo", "role": "admin", "mfa_enabled": False, "sessions": 1, "recovery_codes_remaining": 0},
                "/api/access/users": [{"id": "preview-operator", "username": "demo", "role": "admin", "disabled": False, "mfa_enabled": False, "passkey_count": 2}],
                "/api/access/passkeys": [
                    {"id": "preview-laptop", "name": "Office laptop", "created": NOW - 86400, "last_used": NOW, "backed_up": True},
                    {"id": "preview-phone", "name": "Phone", "created": NOW - 3600, "last_used": None, "backed_up": True},
                ],
                "/api/devices": DEVICES,
                "/api/fleet": {"machines": DEVICES, "connections": [], "checked_at": NOW},
                "/api/fleet/preferences": {"order": ["name","status","client","agent","location","app","cpu","memory","address","provider","kind","site","seen","preview"], "visible": ["name","status","client","agent","location","app","cpu","memory","address"], "widths": {}, "sort": "name", "direction": "asc", "highlight_agents": False, "agent_filter": "all"},
                "/api/integrations/tokens": {"tokens": [], "sites": ["Demo Clinic"]},
                "/api/agent-updates": {"enabled": True, "version": "0.3.1", "devices": []},
                "/api/templates": [dict(t, builtin=True, revision=1) for t in STARTERS],
                "/api/batches": [],
                "/api/ai/settings": {"configured": True, "model": "gpt-5.4-mini"},
                "/api/patches": [{"device_id": d['id'], "scanned": NOW, "report": {"manager": "windows" if d['platform']=='windows' else "apt", "reboot_required": False, "total": 2, "updates": [{"id": "demo-update-1", "title": "Security intelligence update" if d['platform']=='windows' else "openssl", "version": "1.0", "severity": "Security"},{"id": "demo-update-2", "title": "Cumulative quality update" if d['platform']=='windows' else "curl", "version": "1.1", "severity": "Recommended"}]}} for d in DEVICES if not d['restored_from']],
                "/api/recovery/plans": [PLAN],
                "/api/recovery/runs": [RUN],
                "/api/slide/connection": {"connected": True, "url": "https://api.slide.tech"},
                "/api/jobs": JOBS,
                "/api/audit": [
                    {"action": action, "actor": "demo", "at": NOW - i * 180, "detail": {"device": name}}
                    for i, (action, name) in enumerate(
                        [
                            ("recovery.verify", "Brace Yourself Dental"),
                            ("remote.open", "BYD-FRONTDESK"),
                            ("files.download", "BYD-SERVER"),
                            ("device.approve", "BYD-PBX · restored"),
                        ]
                    )
                ],
            }
            fixture = provider_fixture(route, parse_qs(url.query), NOW)
            if fixture is not None:
                return self.send(fixture)
            if route.endswith('/preview-status'):
                return self.send({"enabled": False, "available": False})
            if route in resources:
                return self.send(resources[route])
            if route == "/api/slide/inventory":
                kind = parse_qs(url.query).get("resource", ["agent"])[0]
                return self.send(
                    [
                        {
                            "agent_id": "demo-" + key,
                            "display_name": label,
                            "hostname": label,
                            "status": "healthy",
                            "last_backup": "2026-09-22T10:00:00Z",
                            "resource": kind,
                        }
                        for key, label in [("server", "BYD-SERVER"), ("pbx", "BYD-PBX"), ("frontdesk", "BYD-FRONTDESK")]
                    ]
                )
            if route == "/api/transfers":
                return self.send(
                    [
                        {
                            "id": "demo-transfer",
                            "name": "recovery-evidence.json",
                            "direction": "download",
                            "size": 12684,
                            "status": "ready",
                        }
                    ]
                )
            if route.startswith("/api/jobs/"):
                return self.send(JOBS[0])
            return self.send({"detail": "Not available in the screenshot preview"}, 404)
        if route.startswith("/brand/"):
            file = (ROOT / route.lstrip("/")).resolve()
        else:
            file = (ROOT / "web/dist" / route.lstrip("/")).resolve()
            if not file.is_file():
                file = ROOT / "web/dist/index.html"
        if not file.is_relative_to(ROOT / "brand") and not file.is_relative_to(ROOT / "web/dist"):
            return self.send({"detail": "Not found"}, 404)
        if not file.is_file():
            return self.send({"detail": "Not found"}, 404)
        import mimetypes

        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(file)[0] or "application/octet-stream")
        self.end_headers()
        self.wfile.write(file.read_bytes())

    def do_POST(self):
        if self.path == "/api/fleet/preferences":
            return self.send(json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0)))))
        if self.path == "/api/auth/login":
            return self.send(
                {"username": "demo", "csrf": "preview-only", "role": "admin"}, cookie="speck-gallery=1; Path=/; SameSite=Strict"
            )
        if self.path == "/api/auth/logout":
            return self.send({"ok": True}, cookie="speck-gallery=; Path=/; Max-Age=0; SameSite=Strict")
        if self.path == "/api/enrollments":
            return self.send({"token": "PREVIEW-ONLY-NOT-A-VALID-TOKEN", "server": "https://speck.example"})
        return self.send({"detail": "Read-only screenshot preview. No device or provider action was performed."}, 409)

    do_PUT = do_POST
    do_PATCH = do_POST
    do_DELETE = do_POST


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8741)
    args = parser.parse_args()
    if not (ROOT / "web/dist/index.html").exists():
        raise SystemExit("Build first: ./scripts/build.sh")
    print(f"Speck screenshot preview: http://127.0.0.1:{args.port} (synthetic data; loopback only)", flush=True)
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()
