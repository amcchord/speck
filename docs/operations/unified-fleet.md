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

The column editor supports drag handles (mouse or touch) and keyboard arrows,
Home and End. Escape cancels an active drag. **Adjust widths** reveals pixel-width
fields; the scrollable list keeps Save/Cancel visible. Changes apply only after
**Save columns**. **Reset defaults** restores column order, visibility and widths
while preserving sorting and agent highlighting.

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

### September 23 static UI refinement

User-authorized runtime `8cd12c7` is live, preserving main `7a51f07` and the
inspected unified-Fleet baseline. Client/provider details now share the machine
pane's 20px desktop / 16px phone gutters. The column editor above replaces the
large arrow-button form. [Synthetic screenshots](../screenshots/fleet-ui-polish/README.md).

The release retained the previous complete web directory and existing assets,
staged new assets, checked the live index under the shared deployment lock, and
atomically replaced only the index. Public index SHA-256:
`0253cdc4ea82ae07617afc9447b9b80cc1ec2cbe9b42adfd7471bff03dd3f855`.
Backend/process/environment and protected identities/accounts/providers were
unchanged. Live desktop Chromium and mobile WebKit verified padding, drag/save/
reload and layouts with no page errors. Test preferences were restored and
authentication sessions closed. There was no agent/provider operation or restart.

Static rollback directory:
`/var/lib/speck-rollback/20260923T130226Z-fleet-ui-polish-8cd12c7/web`.
To reverse only this release, first confirm its index is still live, take the
shared release lock, then atomically replace `/opt/speck/web/index.html` with the
backup's index. All old assets remain present; no backend restart is required.
Exact deployment and private browser evidence: `output/fleet-ui-polish/` in the
task worktree. Source is local on `codex/fleet-ui-polish`; future releases must
include it until GitHub integration is explicitly authorized.

## Settings account and immediate backups

Runtime `7141ea0` includes the existing Slide account from Settings
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


September 23 client/backup release `7141ea0` is live, with the earlier flyout and
column changes preserved. Before release, 29 live backend files matched main and
26 current web files matched committed `8cd12c7`; the runtime dependency manifest
also matched Git. Retained historical hashed web assets are rollback compatibility
files, not uncaptured source edits. After release, every backend/current web file
and public JS/CSS response matched the committed build.

Live desktop Chromium and phone WebKit verified client membership, the correct
Slide account, no target-name field and an immediate backup POST. That POST was
intercepted for acceptance; no real backup was requested. Preserved-state checks
include saved Fleet columns. Full rollback (server, web, consistent database and
private configuration):
`/var/lib/speck-rollback/20260923T131146Z-slide-client-backup-fix-7141ea0`.
For a code rollback, stop Speck, restore the saved server/web trees and restart;
this release does not require database or dependency changes.

## Compact toolbar, header controls and saved agent coverage

The toolbar keeps search and **Speck agents only** visible. The switch saves to
the signed-in user's Fleet preferences and survives page reloads, navigation,
sign-out and later sign-in. It includes both installed endpoint agents and
specialized host agents, including offline agents. Existing users default to all
machines until they choose a coverage filter. No database migration is needed.

**Filters** groups status, operating system and additional agent coverage choices.
Active advanced filters appear as removable chips with a count on the button.
Clearing these filters retains an enabled agent-only switch. **View** groups
column settings, agent highlighting, screen previews and sort controls, including
sorting on phone layouts where table headers are hidden.

Click a desktop header to sort; click again to reverse the direction. Drag it to
move the entire column, or focus it and press Alt+Left/Right. A visible insertion
marker and floating label show the destination; Escape cancels. Dragging does not
change sorting. The order saves immediately while preserving hidden column slots,
selection, search and scroll position. Selection and Connect stay fixed.

[Synthetic desktop and phone gallery](../screenshots/fleet-toolbar/README.md).
