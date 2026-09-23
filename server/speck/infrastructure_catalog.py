"""Explicit operations shared by the console, server and optional LAN bridge."""

import re
import json
from urllib.parse import quote

from fastapi import HTTPException


def field(name, label, kind="text", default=None, options=None, required=True, minimum=None, maximum=None):
    return dict(
        name=name,
        label=label,
        type=kind,
        default=default,
        options=options,
        required=required,
        minimum=minimum,
        maximum=maximum,
    )


def operation(label, fields=(), method="POST", path="", danger=False):
    return dict(label=label, fields=list(fields), method=method, path=path, danger=danger)


NAME = field("name", "Name")
LABEL = field("label", "Name")
DOMAIN = field("domain", "Domain")
VMID = field("vmid", "VM ID", "number", minimum=100, maximum=999999999)
KEYS = field("authorized_keys", "SSH public keys (one per line)", "lines", required=False)
PASSWORD = field("root_pass", "Initial administrator password", "password")
BRIDGE_OPERATIONS = {
    "domains": operation("DNS domains", method="GET", path="/api/dns/domains"),
    "dns-records": operation("DNS records", [DOMAIN], "GET", "/api/dns/domains/{domain}/records"),
    "dns-linked": operation("Linked domains", method="GET", path="/api/dns/linked"),
    "dns-connections": operation("DNS connections", method="GET", path="/api/dns/connections"),
    "dns-status": operation("DNS scan status", method="GET", path="/api/dns/scan/status"),
    "dns-scan": operation("Refresh DNS cache", path="/api/dns/scan"),
    "dns-point": operation(
        "Point an A record",
        [DOMAIN, field("name", "Record name", default="@"), field("ip", "IPv4 address")],
        path="/api/dns/domains/{domain}/point",
        danger=True,
    ),
    "dns-add": operation(
        "Add DNS record",
        [
            DOMAIN,
            field("type", "Record type", options=["A", "AAAA", "CNAME", "TXT", "MX", "NS", "SRV", "CAA"]),
            NAME,
            field("data", "Value"),
            field("ttl", "TTL (seconds)", "number", 600, minimum=600),
            field("priority", "Priority", "number", required=False),
        ],
        path="/api/dns/domains/{domain}/records",
    ),
    "dns-delete": operation(
        "Delete DNS record set",
        [DOMAIN, field("rtype", "Record type"), NAME],
        "DELETE",
        "/api/dns/domains/{domain}/records/{rtype}/{name}",
        True,
    ),
    "pool": operation("Public IP pool", method="GET", path="/api/unifi/pool"),
    "clients": operation("LAN clients", method="GET", path="/api/unifi/clients"),
    "consoles": operation("UniFi consoles", method="GET", path="/api/unifi/consoles"),
    "exposures": operation("Public IP mappings", method="GET", path="/api/unifi/exposures"),
    "unifi-status": operation("Gateway status", method="GET", path="/api/unifi/status"),
    "expose": operation(
        "Assign public IP",
        [field("public_ip", "Public IP"), field("lan_ip", "LAN IP"), NAME],
        path="/api/unifi/expose",
        danger=True,
    ),
    "unexpose": operation(
        "Remove public IP mapping", [field("public_ip", "Public IP")], path="/api/unifi/unexpose", danger=True
    ),
    "ssh-keys": operation("SSH public keys", method="GET", path="/api/ssh/keys"),
    "ssh-generate": operation(
        "Generate SSH key", [NAME, field("comment", "Comment", required=False)], path="/api/ssh/generate"
    ),
    "ssh-register": operation(
        "Register SSH key with Linode",
        [LABEL, field("public_key", "SSH public key", "textarea")],
        path="/api/ssh/register",
    ),
    "proxmox-meta": operation("VM templates and capacity", method="GET", path="/api/proxmox/meta"),
    "proxmox-create": operation(
        "Provision AustinLand VM",
        [
            NAME,
            field("os", "Operating system", options=["debian13", "win11"]),
            field("node", "Node", default="auto"),
            field("cores", "CPU cores", "number", 2, minimum=1, maximum=64),
            field("memory_mb", "Memory (MiB)", "number", 4096, minimum=512),
            field("disk_gb", "Disk (GiB)", "number", 64, minimum=3),
            PASSWORD,
            KEYS,
        ],
        path="/api/proxmox/vms",
    ),
    "proxmox-migration": operation("VM migration preflight", [VMID], "GET", "/api/proxmox/vms/{vmid}/migration"),
    "proxmox-migrate": operation(
        "Migrate AustinLand VM",
        [VMID, field("target_node", "Destination node")],
        path="/api/proxmox/vms/{vmid}/migrate",
        danger=True,
    ),
    "proxmox-delete": operation(
        "Delete AustinLand VM and its public IP mapping", [VMID], "DELETE", "/api/proxmox/vms/{vmid}", True
    ),
}

BRIDGE_OPERATIONS["dns-replace"] = operation(
    "Replace DNS record set",
    [DOMAIN, field("rtype", "Record type"), NAME, field("records", "Records (JSON array)", "textarea")],
    "PUT",
    "/api/dns/domains/{domain}/records/{rtype}/{name}",
    True,
)
BRIDGE_OPERATIONS["dns-disconnect"] = operation(
    "Disconnect A record", [DOMAIN, NAME, field("ip", "IPv4 address")], path="/api/dns/disconnect", danger=True
)


def validate_args(spec, args):
    if not isinstance(args, dict) or set(args) - {f["name"] for f in spec["fields"]}:
        raise HTTPException(422, "Unexpected operation fields")
    result = {}
    for f in spec["fields"]:
        value = args.get(f["name"], f["default"])
        if value is None or value == "":
            if f["required"]:
                raise HTTPException(422, f["label"] + " is required")
            continue
        if f["type"] == "number":
            if isinstance(value, bool) or not isinstance(value, int):
                raise HTTPException(422, f["label"] + " must be an integer")
            if (f["minimum"] is not None and value < f["minimum"]) or (
                f["maximum"] is not None and value > f["maximum"]
            ):
                raise HTTPException(422, f["label"] + " is outside the allowed range")
        elif f["type"] == "lines":
            if (
                not isinstance(value, list)
                or len(value) > 50
                or any(not isinstance(v, str) or len(v) > 8192 for v in value)
            ):
                raise HTTPException(422, "Invalid public keys")
        elif not isinstance(value, str) or len(value) > 8192 or "\x00" in value:
            raise HTTPException(422, "Invalid text field")
        if f["options"] and value not in f["options"]:
            raise HTTPException(422, "Choose a supported " + f["label"])
        result[f["name"]] = value
    return result


def bridge_request(operation_id, args):
    if operation_id not in BRIDGE_OPERATIONS:
        raise HTTPException(404, "Unknown infrastructure operation")
    spec = BRIDGE_OPERATIONS[operation_id]
    args = validate_args(spec, args)
    path = spec["path"]
    for name in re.findall(r"\{(\w+)\}", path):
        value = str(args.pop(name))
        if value in (".", "..") or "/" in value or "\\" in value or "%" in value or "?" in value or "#" in value:
            raise HTTPException(422, "Invalid resource identifier")
        path = path.replace("{" + name + "}", quote(value, safe=""))
    if operation_id == "dns-replace":
        try:
            records = json.loads(args["records"])
        except ValueError:
            raise HTTPException(422, "Enter a valid JSON array of records") from None
        if (
            not isinstance(records, list)
            or not records
            or len(records) > 100
            or not all(
                isinstance(r, dict)
                and set(r) <= {"type", "name", "data", "ttl", "priority", "weight", "port", "service", "protocol"}
                for r in records
            )
        ):
            raise HTTPException(422, "Invalid DNS record set")
        args["records"] = records
    return spec["method"], path, args
