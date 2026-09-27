# Infrastructure, network observability and interactive terminals

The Infrastructure workspace brings connection coverage, host/guest groups and
agent links together. Connections have their own flyouts. Activity receipts open
inspectors with actor, timestamps and provider evidence; target navigation uses
an exact resource ID in its original connection, never a display-name match.
General Activity uses the same inspector pattern.

Linode instance details request native CPU, IPv4/IPv6 and disk/swap history for
one hour or 24 hours. Proxmox hosts use native RRD history for one hour, day, week
or month; existing guest performance/management tools remain available. Linode
network readings are bits/sec and disk readings are blocks/sec. Proxmox network
and disk readings are bytes/sec. Missing measurements remain gaps. Guest memory,
processes and services cannot be inferred from Linode statistics; they require
an endpoint agent. Browser reads share the existing bounded session cache.

Network opens on Sites & health. UniFi-reported locations appear on an
OpenStreetMap street map with pan, zoom, fit, keyboard markers, health coloring,
site details and co-located site selection. Sites without coordinates remain in
the cards; no IP geolocation or invented coordinates are used. Leaflet loads on
demand. Tiles use the official HTTPS endpoint, normal browser cache headers,
visible attribution and origin-only referrers. Only visible tiles are requested;
there is no bulk/offline download. CSP permits tile images from that single host.
Tile failure keeps site markers/cards usable. Automated browser checks substitute
synthetic tiles to avoid automated load on OSM's community infrastructure.

Site clients are scoped to an exact account console and Network site reference.
The managed gateway also enriches its existing client list with observation time,
network/VLAN, uplink/port, vendor, Wi-Fi experience/signal and traffic where the
provider reports those fields. Presence uses recent observations, not connection
start time. Old entries remain available under All reported. Private addresses
from another site never acquire managed-gateway machine links. Optional telemetry
failure falls back to basic inventory, without fabricating quality readings.

Shell/PowerShell now open live xterm sessions inside the machine flyout. Scripts
have their own tab and retain the existing AI review, template and audited job
workflow. Closing the drawer or changing tabs closes the session. Reconnect is a
fresh session. Linux uses its existing PTY. Windows agent 0.3.2 adds ConPTY with
PowerShell, PSReadLine in-session editing/history, UTF-8, resize and Ctrl+C.
Windows 10 1809 / Server 2019 or newer is required. Legacy agents show an update
explanation and retain the script runner. Configured Windows RDP remains the
screen action. The Windows shell has a minimal environment, no profile, disabled
PSReadLine disk history, isolated standard handles and a kill-on-close job object.
Session authorization, expiry, agent identity checks and bounded transport remain
shared with the existing terminal relay. No schema migration is required.

## Primary references

- [Linode instance statistics](https://techdocs.akamai.com/linode-api/reference/get-linode-stats)
- [Leaflet 1.9.4 API](https://leafletjs.com/reference.html)
- [OpenStreetMap tile policy](https://operations.osmfoundation.org/policies/tiles/)
- [Microsoft ConPTY standard handle isolation](https://github.com/microsoft/terminal/discussions/15814)

## Validation and release

Local `./scripts/check-local.sh core` passed: 214 backend tests, Linux agent
and connector race tests, Windows amd64 / Linux amd64 and arm64 builds,
51 web units and 273 Chromium/WebKit browser checks (one existing touch-only
skip). Eighteen focused browser checks then passed after the final map
accessibility and terminal shortcut refinements, including 390px terminals,
failed map tiles and a deliberately delayed DNS response.

The real Windows 11 ConPTY test passed with redirected parent handles: persistent
PowerShell variables, Unicode, resize, Ctrl+C, disabled disk history, a minimal
environment and child-process cleanup. The test did not alter enrollment or the
running agent. Linux PTY behavior passed under the race detector. Windows ARM,
physical iOS and older Windows versions have not been qualified.

Live customer captures, provider schemas and endpoint test logs are kept only
in ignored `output/operations-overhaul/`.

### Production release

Published `3a282acf74ea78917be7081108b0706a0f57645c` as
`20260927T173225Z-observability-3a282ac`. Before the production build, origin/main
was fetched and confirmed an ancestor; the unmerged Home and resource-detail
releases were preserved. The current task held the shared deployment lock.
All deployed backend files and the live index matched the inspected baseline,
including an immediate index comparison before publication. No active job or
recovery blocked the restart.

All 27 public web files matched the candidate hashes. Live authenticated reads
verified Linode CPU/network/disk history (285 samples), Proxmox host and guest
CPU/memory/network history (1,440 samples), all 17 reported Network-site
locations and client observations on both the managed gateway and another site.
Unreported host disk rates and guest I/O wait remain explicitly unavailable.

Windows and Linux canaries run agent 0.3.2 with preserved enrollment identities
and retained binary backups. Real authenticated TLS WebSocket sessions passed
persistent state, Unicode, resize, Ctrl+C, disconnect and fresh reconnect on both.
The Windows desktop helper hash and running user-session helper were verified;
Windows retains its configured RDP screen default. The signed 0.3.2 update
pointer and all four downloadable binaries were published after canary acceptance.
Remaining eligible agents use the existing idle-only update policy.

Service health, unchanged environment, identities, accounts, provider connections,
connector enrollments and recovery policies were verified. SQLite integrity and
foreign keys passed; no validation shell remained active. No native application
release, recovery operation, GitHub push/merge or unrelated workload change was
performed. Hosted CI was not run for these local commits.

Rollback is retained at
`/var/lib/speck-rollback/20260927T173225Z-observability-3a282ac` with previous
server, web, downloads, configuration and a consistent SQLite snapshot. A rollback
should restore server/web and the previous agent-update pointer under the shared
lock, while preserving database writes made since release; no schema changed.
Existing agents do not automatically downgrade. Restore their retained binaries
when needed, preserving each endpoint's original configuration and identity.

Public [screenshots](../screenshots/observability/README.md) use synthetic data.

The 0.3.2 automatic rollout exposed one Windows helper-file replacement failure;
rollback restored the old agent and kept the endpoint online. Windows offers were
held while agent 0.3.3 was prepared. The updater now waits for desktop helpers to
exit, retries transient executable locks for at most 15 seconds, and uses the
verified candidate for its updater helper so future installer fixes apply during
the current upgrade. Real Windows tests cover released and persistent file locks,
identity preservation, the complete staged transaction and rollback scenarios.
Linux agent/connector race tests passed again. Final rollout evidence follows.

### Final agent rollout

Agent source `e6fbfd2` ships signed version 0.3.3. All ten approved endpoints
(six Windows amd64, four Linux amd64) are online on 0.3.3, advertise interactive
shells and report current update state. There are no installing, failed or
rollback-failed updates. The six unapproved recovery candidates remain unchanged.

Legacy installers copied their old updater executable, so three Windows endpoints
needed an operator-triggered repair using the newly verified, signed installer.
The corrected installer succeeded, preserved each identity, verified both
installed binaries and retained backups. Future updates from 0.3.3 use the signed
candidate as their updater. Real Windows/Linux TLS shell acceptance passed again
on 0.3.3: session state, Unicode, resize, Ctrl+C, disconnect and fresh reconnect.
Final server/configuration/database checks passed with no active validation shell.

The web/backend release remains `3a282ac`; the agent release is `e6fbfd2`. Both
are required ancestors for the next deployment until merged to main. The final
release record and per-endpoint evidence remain in the same private output and
rollback directories. The automatic-update policy was preserved and all platform
offers are enabled again.
