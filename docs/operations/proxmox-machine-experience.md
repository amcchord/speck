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
Containers do not expose a graphical console in this implementation.

API references: [Proxmox QEMU API source](https://github.com/proxmox/qemu-server/blob/master/src/PVE/API2/Qemu.pm),
[Guacamole VNC configuration](https://guacamole.apache.org/doc/gug/configuring-guacamole.html#vnc).

## Validation and release status

Implementation branch: `codex/proxmox-machine-experience`, in
`worktrees/proxmox-machine-experience`. The branch includes the deployed Fleet
runtime `1158014` and its release record `6faaf5c`, merged as `f1df14d`, so the
new header controls, agent-only switch, layout and Slide fixes are preserved.
No production system, VM, connector binary or provider setting was changed by
this task. No commits were pushed.

The consolidated local core gate passes: 162 backend tests, Go agent/connector race
checks, all agent builds, 31 web unit tests and 153 Chromium/WebKit browser cases,
with one existing skip. Two additional backend regressions then verify real local
WebSocket redirect rejection and the read-only gateway handshake. The final
backend suite passes 164 tests; the affected browser suite passes 41 cases with
one existing skip, and the final web build passes. Logs are recorded in ignored
`output/proxmox-machine/`. Browser fixtures include synthetic console images,
protocol frames, keyboard input, screenshot downloads, stopped/guest-agent/busy
states and late-session cleanup. They are not live Proxmox acceptance evidence.

Before publishing: follow AGENTS.md's current-main ancestry and live-baseline
checks, obtain deployment authorization, coordinate the release owner, and back
up server/web/data/configuration using the existing runbook. Publish server and
web together; leave host/endpoint binaries and provider configuration intact.
The last communicated live index was
`345fd0a01d73991905b9d7d159db9280a18c65719b376cf132b91d7134025c69`;
inspect it again immediately before a release, rather than treating it as current.

Live acceptance remains: open a running VM on each connector-backed cluster in
Chromium and WebKit, confirm a real screen preview and explicit console input,
then verify a token-backed connection against the installed Proxmox version and
permissions. Confirm that a stopped VM and a VM without a guest agent retain
useful inventory. Do not infer that these cases passed from mocked browser or API
tests. Roll back by restoring the matching server and web trees and restarting
Speck; this feature adds no database migration or agent update.
