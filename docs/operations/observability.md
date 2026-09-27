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

Production acceptance is recorded below after publication. Live customer captures, provider schemas and
endpoint test logs are kept only in ignored `output/operations-overhaul/`.
