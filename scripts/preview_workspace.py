"""Connected Home fixtures. Uses only synthetic endpoints and documentation addresses."""


def workspace_fixture(route, devices, now):
    resource = {
        "provider": "proxmox", "kind": "qemu", "connection_id": "c1",
        "connection_name": "Clinic cluster", "node": "pve-1", "status": "running",
    }
    if route == "/api/fleet":
        machines = [
            dict(d, has_endpoint_agent=True, has_speck_agent=True, site="Demo Clinic", **({
                "resources": [dict(resource, id=str(101+i), name=d["label"])],
                "identity_evidence": ["Hardware UUID"],
            } if i < 3 else {}))
            for i, d in enumerate(devices)
        ]
        machines += [
            {"id": "host-1", "label": "pve-1", "has_endpoint_agent": False, "has_speck_agent": True,
             "agent_status": "Host agent online", "kind": "node", "state": "online",
             "resources": [dict(resource, kind="node", id="pve-1", name="pve-1")]},
            {"id": "vm-only", "label": "LAB-UBUNTU", "has_endpoint_agent": False, "has_speck_agent": False,
             "agent_status": "No Speck agent", "kind": "qemu", "state": "running",
             "resources": [dict(resource, id="201", name="LAB-UBUNTU")]},
        ]
        return {"machines": machines, "checked_at": now,
                "connections": [{"id": "c1", "name": "Clinic cluster", "provider": "proxmox", "status": "connected"}]}
    if route == "/api/network/map":
        return {"machines": [
            {"id": "frontdesk", "label": "BYD-FRONTDESK", "lan": [{"ip": "192.0.2.24", "source": "unifi_mac"}], "public": [], "dns": []},
            {"id": "server", "label": "BYD-SERVER", "lan": [{"ip": "192.0.2.20", "source": "unifi_mac"}],
             "public": [{"ip": "203.0.113.10", "via": "unifi_nat", "mapping": "clinic-portal"}],
             "dns": [{"fqdn": "portal.example-clinic.com"}]},
            {"id": "pbx", "label": "BYD-PBX", "lan": [{"ip": "192.0.2.30", "source": "reported"}], "public": [], "dns": []},
        ], "ips": {}, "checked_at": now, "clients_checked": True, "zones_cached": 1}
    return None
