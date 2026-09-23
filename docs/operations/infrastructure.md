# Infrastructure management

Infrastructure groups resources by connection and host. The Proxmox host row and
its guests stay together; IDs are scoped to the connection so identical VM IDs in
different clusters cannot collide. Filters cover providers, connections and
management coverage.

**Proxmox only** means Speck discovered a resource through Proxmox and has no
verified endpoint-agent match. **Speck agent online/offline** requires an exact
hardware UUID match to an existing, non-archived endpoint. Duplicate provider or
endpoint identities are marked for review, never guessed from a name or IP.
The specialized **host agent** is a separate connector, not an endpoint agent
installed inside every guest. Matched guests link to their existing Speck device
pane, preserving approval and enrollment status.

## Capabilities

| Resource | Available without an endpoint agent |
| --- | --- |
| Proxmox host | Inventory, resource usage, storage/network details, recent tasks, metrics, guarded reboot/shutdown |
| Proxmox VM | Power, CPU/memory configuration, full clone, migration, snapshots, stopped-guest deletion, metrics, provider screen console |
| Proxmox container | Power, resource configuration, migration, snapshots, metrics and stopped-guest deletion |
| VM with QEMU guest agent | OS, interfaces, filesystems, commands and bounded text-file reads/writes |
| Slide appliance | Inventory, storage, protected agents, network settings, rename, backup, reboot and poweroff |
| Slide virtual machine | Inventory, start/stop, CPU/memory, enable/disable console and provider screen console |
| Linode instance | Inventory, details/backups, creation, rename, power and deletion |
| AustinLand | DNS, public IPs/NAT, LAN clients, UniFi consoles, public SSH keys and template-based VM provisioning/migration |

Provider consoles use the existing Guacamole gateway and support keyboard, mouse,
touch, Ctrl+Alt+Del, scaling and fullscreen. Connector-backed Proxmox connections require the host connector on
the guest's current node. Slide requires an enabled VNC console and a secure
provider WebSocket endpoint. Provider passwords remain in server memory, never in
the browser. Connections are scoped to the signed-in user, expire with the session,
and close on disconnect, account revocation or connector removal. They do not
require an endpoint agent or guest RDP service. Container consoles are not implemented. Token-backed Proxmox connections now use
the provider VNC API directly; see [machine views and screen previews](proxmox-machine-experience.md)
for capabilities, privacy and release status.

QEMU guest-agent operations require a working QEMU agent inside the guest; it is
separate from Speck. They do not provide Speck's persistent monitoring, patching,
full file-transfer UI or desktop-session integrations. Snapshot/migration support
also depends on the host's storage and VM configuration. Asynchronous provider
writes are recorded as **submitted**, not claimed complete; inspect provider tasks
and refresh inventory to confirm completion.

## Connect a Proxmox cluster

An administrator adds a Proxmox connection with **Use outbound agent**, then
chooses **Enroll host**. Each enrollment is single use and expires after 15 minutes.
On each desired Proxmox host, download and inspect `/downloads/install-proxmox.sh`,
set `SPECK_SERVER` to the HTTPS Speck origin and supply the enrollment JSON through
standard input. Never put enrollment or provider credentials in shell arguments.

The installer verifies the published binary checksum, preserves existing
enrollment, and creates `speck-proxmox.service`. State is root-only in
`/etc/speck-proxmox/`; the binary is `/usr/local/sbin/speck-proxmox`.
The host polls Speck over HTTPS and opens outbound WebSockets for consoles. No
listening port, inbound NAT rule, host API token or central root password is needed.
One agent can manage its cluster via `pvesh`; installing one per host provides
availability and local screen-console access.

The connector has a fixed API-path/argument allowlist. It uses `pvesh` with argv,
never a host shell, and reads only UUID/MAC/QEMU-agent metadata from guest configs.
The console uses Proxmox's `qm vncproxy` with a fresh per-session VNC password.
Guest commands explicitly use the QEMU agent, not a host-shell escape.
Requests are leased once, journaled before execution, and never automatically
re-executed after a crash. Pending results are reported as uncertain after a
restart. Investigate before submitting another write. Revoke a connector in the
Connections view; its active provider consoles close immediately.

The specialized connector is versioned separately from ordinary endpoint agents.
Upgrades currently require replacing the binary and restarting only its service;
ordinary endpoint auto-update packages do not overwrite this connector.
Version 0.1.1 uses a valid DMI hardware UUID when the host has an empty Linux
machine-id. Enrollment pins that identity source; later creation of a machine-id
does not invalidate the agent, and older enrollments retain their original identity.
Version 0.1.2 reports the running version on authenticated heartbeats, so manual
upgrades appear in Connections without reenrollment. Older agents remain compatible.

## Other providers and AustinLand

Linode and Slide credentials are encrypted with `SPECK_ENCRYPTION_KEY`. Multiple
Slide accounts and multiple Proxmox clusters are supported. Existing Slide
recovery settings are independent and preserved. Only administrators may change
provider connections or execute infrastructure writes; operators can inspect
resources, perform provider reads and open consoles. Viewer accounts retain their
existing restricted inventory access.

AustinLand uses an outbound Python worker on the AustinLand host. Add an
AustinLand connection with **Use outbound agent**, issue an enrollment, and run:

```sh
PYTHONPATH=server uv run python -m speck.infrastructure_bridge --config /private/path/agent.json --enroll
PYTHONPATH=server uv run python -m speck.infrastructure_bridge --config /private/path/agent.json --run
```

Provide the enrollment JSON through stdin on the first command. Run the second
under the host's service manager with automatic restart. The worker only calls
localhost AustinLand using an explicit operation allowlist. It cannot export the
vault, generate credential-containing context files, or stop AustinLand. SSH key
operations return public keys only. The Mac/AustinLand service must remain online
for these workflows; Proxmox, Slide and Linode management are independent.
An authenticated loopback HTTP bridge transport is also supported for existing
SSH-tunnel deployments, but the default setup requires no tunnel or listening port.

All writes require an exact target-name confirmation and a unique request ID.
Retries of the same request return its durable receipt rather than replaying it.
Bodies containing passwords/scripts are not written to audit history. Provider
errors do not echo credentials. Connection failures are shown independently so
one unreachable cluster does not hide the rest of the inventory.

## Release and rollback

Run `./scripts/check-local.sh core` before release. The build produces the host
connector, installer, service file and a separate `PROXMOX-SHA256SUMS`; publish
those files without replacing ordinary signed endpoint-update artifacts.

Retain a consistent database, server code, web tree and environment backup before
restarting the backend. Wait for active recovery/remote work to finish. Compare
current-main ancestry and live asset hashes immediately before release. Rolling
back the server/web code leaves additive infrastructure tables unused; preserve
the current database to retain subsequent endpoint activity. Disable connector
services first if rolling back to a server without connector endpoints. Provider
resources are never removed by rollback or disconnecting a connection.

### September 23 production acceptance

PR #14 deployed server/web `45d02df`; connector `2651859` runs as version 0.1.1.
The local core gate passed 138 backend tests, Linux race/runtime checks, platform
builds, 28 web units and 98 Chromium/WebKit scenarios. Hosted checks also passed.
The connector identity correction passed its additional regression/race tests.

Live acceptance covered inventory and node/guest placement on two Proxmox clusters,
ten exact endpoint matches, both Slide accounts and Linode. Seven host agents plus
the AustinLand worker call home. Provider details, QEMU guest OS/network, metrics,
snapshot listing and a harmless guest command passed. Proxmox consoles rendered on
both clusters, including WebKit, and a Slide VM console rendered in Chromium.
The Slide console setting was restored after testing. Destructive provider actions,
full provisioning/migration and host power were validated with guarded protocol
tests, not executed against existing production workloads.

The backed-up release preserved identities, approvals, archived state, Slide links,
accounts, recovery records, settings and existing signed endpoint-update artifacts.
The pre-release server/web/data/config backup is
`/var/lib/speck-rollback/20260923T071434Z-infrastructure-45d02df`.
Private deployment records, target IDs and screenshots are in the infrastructure
worktree's ignored `output/infrastructure/`; they are not public gallery assets.

The final backend/connector update is `848bbc5` (connector 0.1.2); web assets are
unchanged. All seven host enrollment files retained their exact hashes. Nineteen
infrastructure tests, Go race checks and hosted checks passed. Live checks confirmed
all connections/agents healthy, published artifact hashes, restored console settings
and AustinLand DNS, public-IP, SSH-key and provisioning-metadata reads. The Mac and
its AustinLand application must remain online for delegated AustinLand operations.

The final follow-up backup is
`/var/lib/speck-rollback/20260923T074120Z-infrastructure-848bbc5`.
A conservative check rolled back an earlier attempt because `management_tick` and
`slide_restore_sync` advanced normally. Those two transient state keys were then
excluded; protected configuration, identities and recovery records still passed
the invariant checks. The original pre-feature backup above remains available.
