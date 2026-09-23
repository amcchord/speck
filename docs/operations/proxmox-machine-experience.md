# Proxmox machine experience

Proxmox VMs and containers now have a shared, structured workspace in Fleet and
Infrastructure. Fleet opens it directly for machines without a Speck endpoint;
joined endpoints retain their agent overview and open it from their provider button.

The overview shows power state, CPU, memory, uptime, OS, IP addresses, hardware,
virtual disks, guest filesystem usage, network adapters and recent tasks. Separate
tabs show the last hour of CPU/memory/network/disk performance, snapshots and
activity. Common power actions stay visible; remaining operations use More actions
and retain their existing role, exact-name confirmation and durable receipt rules.
Configured OS types are identified as configuration when guest OS reporting is
unavailable. Disk capacity and guest filesystem usage remain distinct.

Status, configuration and tasks are independently bounded reads. Missing rights,
a stopped guest, a missing QEMU guest agent, and partial failures leave the rest of
the page useful. Guest OS/network/filesystem reads are requested after the initial
overview; charts and snapshots are fetched when their tabs are selected. Refresh
details explicitly reloads the data. Guests are always resolved to their current
node before management requests. No endpoint is enrolled or installed by opening
this view, and Fleet's existing machine identity rules are preserved.

## Screens

A running VM automatically receives one read-only console capture when its view
opens. Refresh preview captures another frame. The session closes after capture,
on navigation, or on error; a server deadline closes read-only sessions after 65
seconds as a fallback. Guacamole receives `read-only`, `disable-copy`, and
`disable-paste` parameters. The preview never sends keyboard/mouse events or wakes
a blank screen. Its image stays in the pane's memory and is not saved on the
server, in local storage, or in the inventory cache. Save screenshot downloads a
PNG only when requested. Console sessions also have a Save screenshot button.

Screen control explicitly opens the full keyboard/mouse console, with existing
Ctrl+Alt+Del, scaling, touch, fullscreen and reconnect controls. It waits for an
in-progress preview to close first. Concurrent sessions for the same provider VM
are rejected rather than replacing an active operator's console. Viewer accounts
remain inventory-only. Operators and admins can preview/control; infrastructure
writes remain admin-only.

Connections using an outbound Proxmox host connector retain the existing
`qm vncproxy` tunnel; no connector or endpoint update is required. The connector
must be online on the VM's current node. Connections using an API token now use
`POST .../vncproxy` (websocket and generated-password options), followed by the
scoped `vncwebsocket` endpoint through the same Guacamole gateway. They require
network access from Speck to the configured API origin and Proxmox `VM.Console`
permission. Provider credentials/tickets remain server-side, certificate policy
comes from the saved connection, and WebSocket redirects are rejected. Generated
password responses and older password-prefixed VNC tickets are supported.
Containers do not expose a graphical console in this implementation. VMs configured
with a serial-only or disabled display explain that a graphical display is needed;
opening their inventory does not attempt a screen session.

API references: [Proxmox QEMU API source](https://github.com/proxmox/qemu-server/blob/master/src/PVE/API2/Qemu.pm),
[Guacamole VNC configuration](https://guacamole.apache.org/doc/gug/configuring-guacamole.html#vnc).

## Validation and production release — September 23, 2026

The user authorized production deployment and GitHub publication. Runtime
`84eb09e` is live from `codex/proxmox-machine-experience`. Integration `7227267`
includes current main `7a51f07`, the deployed Fleet/Slide improvements and Alerts/AI
runtime `65f668d` / record `f0836b3`. Those previously local changes are included
in [PR #19](https://github.com/amcchord/speck/pull/19).

The combined local core gate passed in 141 seconds: 173 backend tests, Go agent
and connector race checks, platform builds, 31 web units and 171 Chromium/WebKit
cases, with one existing platform-specific skip. Live acceptance found a VM using
`vga=serial0`; the follow-up explains unavailable graphical access while retaining
its useful inventory. Three additional regressions cover serial/disabled displays,
and the final full backend suite passes 176 tests. Ruff passes. The web bundle
is unchanged by that follow-up.

Visual inspection also caught captures completing on the initial transparent
size/sync frame. Runtime `84eb09e` waits for painted pixels and still accepts opaque
black guest screens without waking the VM. Four new Chromium/WebKit cases verify
delayed image data and black screens; all 24 affected browser cases and the final
TypeScript/Vite build pass. Final live capture checks require painted, visible
pixels and include inspection of the actual downloaded PNGs.

Both configured Proxmox clusters use outbound host connectors. Actual graphical
VMs on each cluster passed in Chromium and WebKit: 1280×800 previews, PNG downloads,
OS/network/filesystem reads, hardware/network/performance/snapshot/activity tabs,
explicit console connection, harmless Shift key and mouse-movement transport.
Preview sessions closed after their frame; no input was emitted during capture.
Desktop Chromium and 390px WebKit Fleet panes rendered directly with working
previews and no horizontal overflow. Stopped and serial-only VMs kept inventory,
explained their screen state and created no console session. The operator's saved
coverage preference was preserved (the test browser alone displayed all machines).
All test consoles and authentication sessions were closed afterward. No guest
power, snapshot, migration, recovery, command execution or installation action
was performed. Private captures remain in ignored `output/proxmox-release/`;
public gallery captures remain synthetic.

API-token console transport has automated protocol, ticket, redirect and cleanup
coverage. Neither production cluster has a saved API token, so direct-token live
acceptance remains unverified. Missing guest-agent and partial-provider failure
paths are covered locally; installed guest agents responded on the live graphical
VMs tested. No connector or endpoint binary update was needed.

The initial release audited the previous live backend and every current web file
against committed source, then backed up server/web/data/configuration before a
coordinated restart. It preserved accounts, credentials, endpoint/connector
identities, Slide associations, settings, policies, saved Fleet preferences and
recovery records. Database integrity and foreign keys passed. The final release
matches all 31 backend files and all 26 publicly served build files. The final
audit found no remaining gateway connections. No dependency or schema change.

Live index SHA256:
`360648be5d27fec9e68d4394f6ee7efde82c22a3566f5e7ab311872939f0ece3`.
Full rollback to the pre-feature release:
`/var/lib/speck-rollback/20260923T135859Z-proxmox-machine-7227267`.
The display-capability and first-frame follow-ups also retained:
`/var/lib/speck-rollback/20260923T140558Z-proxmox-machine-6787c42` and
`/var/lib/speck-rollback/20260923T141400Z-proxmox-machine-84eb09e`.
Restore the matching `server` and `web` trees and restart Speck after checking for
active work. Keep the current database; this feature has no migration to reverse.
Use AGENTS.md's current-main, live-baseline and single-owner checks for the next
release. Detailed local logs, deployment records and audits are retained in the
worktree's ignored `output/proxmox-release/`.
