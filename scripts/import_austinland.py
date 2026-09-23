#!/usr/bin/env python3
"""Copy AustinLand's data into Speck through Speck's API.

Reads (never modifies) an AustinLand checkout and ~/.ssh public keys, then
imports into Speck with an administrator API token that has admin, keys:read
and keys:write scopes:

- provider credentials (OpenAI admin, Anthropic, Twilio, GoDaddy, UniFi);
- vault entries, preserving minted-key metadata so revocation keeps working;
- remaining AustinLand LAN credentials as one static vault entry;
- the GoDaddy domain/zone cache and AustinLand's public IP mappings;
- LLM handoff files and SSH public keys (private keys stay on this Mac);
- optionally, AustinLand's Linode/Proxmox tokens as infrastructure connections.

Existing Speck entries are never overwritten. Secret values are sent only to
Speck and never printed. Speck's own roots of trust (its deployment secrets and
agent-release signing key) are excluded by default: they must not be stored in
the system they protect.

    SPECK_URL=https://speckrmm.com SPECK_TOKEN=speck_pat_... \\
      uv run python scripts/import_austinland.py --austinland ~/Development/AustinLand --dry-run
"""

import argparse
import json
import os
import sys
from pathlib import Path

import httpx

EXCLUDED = {"speck-rmm", "speck-agent-release-signing"}
PROVIDERS = {
    "openai": {"OPENAI_ADMIN_KEY": "OpenAIAdminKey"},
    "anthropic": {"ANTHROPIC_API_KEY": "AnthropicKey"},
    "twilio": {"TWILIO_ACCOUNT_SID": "TwilioAccountSid", "TWILIO_AUTH_TOKEN": "TwilioAuthToken"},
    "godaddy": {"GODADDY_API_KEY": "GoDaddyKey", "GODADDY_API_SECRET": "GoDaddySecret"},
    "unifi": {"UNIFI_API_KEY": "UnifiCloudKey"},
}
LAN_CREDENTIALS = {
    "UNIFI_LOCAL_API_KEY": "UnifiLocalKey",
    "UNIFI_GATEWAY": "UnifiGateway",
    "PROXMOX_HOST": "ProxmoxHost",
    "PROXMOX_TOKEN_ID": "ProxmoxTokenId",
    "PROXMOX_TOKEN_SECRET": "ProxmoxTokenSecret",
    "PROXMOX_CONSOLE_USER": "ProxmoxConsoleUser",
    "PROXMOX_CONSOLE_PASSWORD": "ProxmoxConsolePass",
    "WINDOWS_PRODUCT_KEY": "WindowsProductKey",
}


def read_env(path):
    values = {}
    if path.exists():
        for line in path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                values[key.strip()] = value.strip()
    return values


def read_json(path, fallback):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return fallback


def plan(root, ssh_dir, include_excluded=False):
    env = read_env(root / ".env")
    data = root / "data"
    vault = read_json(data / "keyvault.json", {"keys": []}).get("keys", [])
    entries, excluded = [], []
    for entry in vault:
        if entry["name"] in EXCLUDED and not include_excluded:
            excluded.append(entry["name"])
            continue
        entries.append({k: entry.get(k) for k in ("name", "service", "kind", "project", "notes", "meta", "secrets", "created")})
    lan = {target: env[source] for target, source in LAN_CREDENTIALS.items() if env.get(source)}
    if lan:
        entries.append({
            "name": "austinland-lan-credentials",
            "service": "austinland",
            "kind": "static",
            "project": None,
            "notes": "AustinLand credentials for the 50 Day Street LAN: the local UniFi Network key, "
                     "the Proxmox API token and console user, and the Windows template product key.",
            "meta": {},
            "secrets": lan,
        })
    providers = {}
    for service, fields in PROVIDERS.items():
        secrets = {target: env[source] for target, source in fields.items() if env.get(source)}
        if len(secrets) == len(fields):
            providers[service] = {"secrets": secrets, "settings": {"UNIFI_GATEWAY": env.get("UnifiGateway", "")} if service == "unifi" else {}}
    domains = read_json(data / "domains.json", {})
    records = read_json(data / "records.json", {})
    exposures = read_json(data / "unifi.json", {}).get("exposures", [])
    contexts = []
    for path in sorted((data / "contexts").glob("*.md")):
        contexts.append({"filename": path.name, "markdown": path.read_text(), "created": path.stat().st_mtime})
    keys = []
    for pub in sorted(ssh_dir.glob("*.pub")):
        line = pub.read_text().strip()
        if line.count(" ") >= 1:
            keys.append({"name": pub.stem, "public_key": line,
                         "purpose": "AustinLand handoff key" if pub.stem.startswith("austinland-") else "Workstation public key",
                         "created": pub.stat().st_mtime})
    return {
        "env": env,
        "providers": providers,
        "entries": entries,
        "excluded": excluded,
        "dns": {"domains": domains.get("domains", []), "domains_fetched_at": domains.get("fetched_at"), "zones": records},
        "exposures": exposures,
        "contexts": contexts,
        "ssh": keys,
    }


def summary(p):
    return {
        "providers": sorted(p["providers"]),
        "vault_entries": len(p["entries"]),
        "excluded_entries": p["excluded"],
        "domains": len(p["dns"]["domains"]),
        "zones": len(p["dns"]["zones"]),
        "exposures": len(p["exposures"]),
        "handoff_files": len(p["contexts"]),
        "ssh_public_keys": len(p["ssh"]),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--austinland", type=Path, default=Path.home() / "Development/AustinLand")
    parser.add_argument("--ssh-dir", type=Path, default=Path.home() / ".ssh")
    parser.add_argument("--dry-run", action="store_true", help="Print what would be imported (no values)")
    parser.add_argument("--include-speck-secrets", action="store_true", help="Also import Speck's own deployment/signing entries")
    parser.add_argument("--linode-connection", action="store_true", help="Add AustinLand's Linode token as a connection if none exists")
    parser.add_argument("--proxmox-token-connection", action="store_true",
                        help="Add AustinLand's direct Proxmox API token connection (LAN-only; for a Speck on this network)")
    parser.add_argument("--replace-providers", action="store_true", help="Overwrite already-configured provider credentials")
    options = parser.parse_args()

    p = plan(options.austinland.expanduser(), options.ssh_dir.expanduser(), options.include_speck_secrets)
    print(json.dumps({"plan": summary(p)}, indent=2))
    if options.dry_run:
        return
    url, token = os.environ.get("SPECK_URL", "").rstrip("/"), os.environ.get("SPECK_TOKEN", "")
    if not url or not token:
        sys.exit("Set SPECK_URL and SPECK_TOKEN (an admin token with admin, keys:read and keys:write)")
    client = httpx.Client(base_url=url, headers={"Authorization": "Bearer " + token}, timeout=120)

    def call(method, path, body=None):
        response = client.request(method, path, json=body)
        if response.status_code >= 400:
            sys.exit(f"{method} {path} failed with HTTP {response.status_code}: {response.text[:300]}")
        return response.json()

    me = call("GET", "/api/whoami")
    missing = {"admin", "keys:read", "keys:write"} - set(me.get("scopes", []))
    if me.get("role") != "admin" or missing:
        sys.exit("The token needs an administrator with admin, keys:read and keys:write scopes")
    results = {}
    configured = {s["service"]: s["configured"] for s in call("GET", "/api/keys/services")}
    results["providers"] = {}
    for service, body in p["providers"].items():
        if configured.get(service) and not options.replace_providers:
            results["providers"][service] = "kept existing"
            continue
        call("PUT", "/api/keys/services/" + service, body)
        results["providers"][service] = "imported"
    results["vault"] = call("POST", "/api/keys/import", {"source": "austinland", "entries": p["entries"]})
    results["dns"] = call("POST", "/api/dns/import", p["dns"])
    results["exposures"] = call("POST", "/api/unifi/exposures/import", {"exposures": p["exposures"]})
    results["handoffs"] = call("POST", "/api/context/import", {"files": p["contexts"]})
    results["ssh"] = call("POST", "/api/ssh/import", {"keys": p["ssh"]})
    connections = call("GET", "/api/infrastructure/connections")
    env = p["env"]
    if options.linode_connection and env.get("Linode"):
        if any(c["provider"] == "linode" for c in connections):
            results["linode_connection"] = "kept existing"
        else:
            call("POST", "/api/infrastructure/connections",
                 {"name": "Linode", "provider": "linode", "url": "https://api.linode.com", "token": env["Linode"]})
            results["linode_connection"] = "added"
    if options.proxmox_token_connection and env.get("ProxmoxTokenSecret"):
        origin = "https://" + env.get("ProxmoxHost", "192.168.100.220") + ":8006"
        if any(c["provider"] == "proxmox" and c.get("url") == origin for c in connections):
            results["proxmox_connection"] = "kept existing"
        else:
            call("POST", "/api/infrastructure/connections",
                 {"name": "austinland cluster (API token)", "provider": "proxmox", "url": origin,
                  "token_id": env["ProxmoxTokenId"], "token": env["ProxmoxTokenSecret"], "verify_tls": False})
            results["proxmox_connection"] = "added"
    for key in ("vault", "exposures", "handoffs", "ssh"):
        results[key] = {"created": len(results[key]["created"]), "skipped": len(results[key]["skipped"])}
    print(json.dumps({"results": results}, indent=2))


if __name__ == "__main__":
    main()
