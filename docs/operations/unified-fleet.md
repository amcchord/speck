# Unified machine inventory

Fleet lists machines discovered by Proxmox, Linode and Slide alongside Speck
endpoints. A joined machine has one row and one details pane. Its provider buttons
open the existing scoped management tools, including Proxmox and Slide VM consoles.
Only eligible endpoint agents participate in endpoint bulk actions.

Client, Speck agent, location/host, provider and machine type are available as
sortable columns. Agent coverage can be filtered or highlighted. **Columns** lets
each signed-in user choose visibility, order and pixel widths; Machine remains
visible. Sorting and highlighting are saved with the user's preferences. On narrow
screens the chosen columns appear in the same order within machine cards.

## Identity and client membership

`GET /api/fleet` builds the machine view; `/api/devices` retains its endpoint-only
contract for existing clients and integrations. It joins exact one-to-one Proxmox
hardware UUIDs to endpoint hardware fingerprints. Existing original-endpoint Slide
agent IDs and unique interface MACs can join Slide protection/appliance records.
Names and IP addresses are never identity evidence. VM IDs are cluster scoped;
Slide object IDs are API-origin scoped. Conflicting UUIDs, multiple endpoints or
multiple Proxmox guests cannot be bridged into one machine. Slide restores remain
separate from their protected originals, even if a MAC is copied.

Client names come from Slide's client directory. Protected machines inherit an
appliance's client when no explicit machine client is present; a recovery VM
inherits its source machine's client. A joined Proxmox machine receives that same
membership. Multiple client memberships remain visible as a conflict; an unknown
client is shown as Unassigned. Speck Sites remain separate and are not rewritten.
This does not automatically enroll or install any endpoint agent.

Machine power state is separate from endpoint/host agent connectivity. A running VM
can therefore show an offline Speck agent. Identity evidence and conflicts are
visible in the machine pane; the coverage filter includes identity review.

## Caching and access

Provider snapshots refresh at most once per minute during ordinary reads; Refresh
requests a fresh inventory. The last successful normalized snapshot is encrypted
in SQLite and retained on an outage, with an explicit stale marker and timestamp.
An unavailable provider never silently erases known machines. A successful read
removes resources no longer reported by that provider. Provider actions still
resolve their target freshly and retain their existing authorization, confirmation
and audit behavior.

Viewer accounts can read this inventory and edit their own column preferences.
They cannot use provider controls. Provider credentials, recovery passwords and
raw Slide scripts are excluded from normalized inventory. Cached snapshots are
scoped to the saved connection configuration so changed credentials cannot reuse
a previous connection's snapshot.

## Validation and release

Identity tests cover UUID matching, MAC bridges, conflicting and duplicated UUIDs,
restore/source separation, client conflicts and unknown identities. API tests cover
outage retention, successful removal, encrypted snapshots, client inheritance,
secret exclusion, preference validation, CSRF and viewer scope. Chromium/WebKit
checks cover client sorting, agent filtering/highlighting, saved column order,
widths and visibility, provider/endpoint panes, and responsive geometry.

Release evidence and the matching rollback location are retained privately under
`output/unified-fleet/`. The release replaces server/web only; endpoint/host agent
binaries, credentials, Sites, recovery policies and provider VM state are preserved.
Rollback restores the saved server and web directories, then restarts Speck. The
new cache/preferences tables are additive and may remain when rolling back code.

Production release `7148553` is live and included in merged PR #17 (`531ee39`).
The full local core gate and hosted PR checks passed. Live Chromium and WebKit
verified the joined inventory, client membership, saved columns and agent filters;
all ten Proxmox endpoint matches and eight infrastructure connectors were healthy.
The consistent data/configuration/runtime rollback snapshot is
`/var/lib/speck-rollback/20260923T083900Z-unified-fleet-7148553`.

## Settings account and immediate backups

The pending client/backup fix includes the existing Slide account from Settings
as `Slide (Settings)` alongside Infrastructure accounts. Credentials stay in their
original encrypted setting; edit that account through Settings. An identical API
origin and credential is fetched once, while different accounts on the same
origin remain separate. Fleet joins the protected record through its existing
Slide agent ID and reads its client membership from that account. It does not
infer clients from machine names or change assignments in Slide.

**Back up machine** on a protected machine submits immediately and shows the
request receipt. No target-name entry is needed. The server still resolves the
resource under its account and enforces administrator access, CSRF, audit logging
and request deduplication. Retrying a lost response reuses the same request ID.
Other provider management actions retain their existing confirmation behavior.
