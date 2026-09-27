# Resource details and navigation

The shared resource flyout keeps the list visible on desktop and fills the screen
on phones. It covers infrastructure resources, Slide inventory, DNS domains,
public IPs, LAN clients and UniFi consoles. Existing machine management remains
available, with a fuller provider view for hosts and other provider-only machines.
Editing, destructive operations and their confirmation forms retain their existing
modal review flow.

## Reading a resource

The overview leads with identity, state and capacity, then groups information by
the work it supports:

- Linode instances: processors, allocated memory/storage, addresses, region,
  backup protection and recent backups, OS image and configuration.
- Proxmox hosts: utilization, memory, processor, storage, host networks and guests.
  Guest links use the explicit connection and host, never a global name match.
- Slide: schedules and retention, appliance capacity, backup timing, boot and
  filesystem verification, recovery VM sizing, and recovery network configuration.
  Related appliance, agent and snapshot links resolve exact provider IDs. Large
  histories have search and show 100 entries at a time. Appliance details load
  their protected systems through the shared inventory cache.
- Network: routing, DNS names, LAN connection information, gateway role and
  related machines. An address association is not presented as identity proof.

Technical provider fields remain in a collapsed, structured section. Nested data
is formatted as fields and lists; sensitive field names are redacted recursively.
Unknown values stay unknown. A reported provider state does not imply application
recovery or backup validation. Provider detail failures retain the inventory
summary and an explicit failure notice.

Escape dismisses the top inspector, preserves any separate confirmation dialog,
and returns focus to the originating control, including in Safari. A late response
cannot replace a different inspector. Sign-out closes all inspectors and clears
their inventory context.

## Loading and freshness

Reusable inventory reads share a bounded, memory-only session cache. Simultaneous
reads of the same path share a request, and returned values are isolated copies.
Fleet navigation reuses data for 15 seconds; most provider/network inventories
for 30 seconds; domain lists for 60 seconds; operation catalogs for five minutes.
No snapshot is served after five minutes. The cache holds at most 160 paths.

On return to a page, a usable saved snapshot renders immediately. Older snapshots
refresh in the background. The header reports saved data, background activity,
refresh failures and newly available data. **Show latest** applies updated data
without replacing an in-progress inspection or form automatically. Refresh forces
a network read. Cold visits and explicit refreshes still depend on provider speed;
the change does not claim instantaneous uncached provider responses.

Fleet's live telemetry poll still reads current server data every 15 seconds. It
does not force provider inventory refreshes, nor invoke Slide cleanup. The existing
explicit Fleet Refresh behavior continues to perform its reviewed cleanup check.
Slide inventory and cleanup status load concurrently rather than in sequence.

The allowlist excludes credential reveals, authentication, previews, guest command
results and mutation preflight reads. Successful or failed mutation attempts
invalidate reusable reads; ephemeral console session work and Fleet presentation
preferences do not invalidate unrelated inventory. Logout/session expiry clears
the cache and pending reads cannot populate the next session. Nothing is stored
in browser persistent storage.

## Validation and release

The unit suite covers cache reuse, refresh failure, hard expiry, coalescing,
consumer cancellation, invalidation/session boundaries, provider units, identity
scoping and recursive redaction. Browser coverage includes the new flyouts at
1440/834/390 pixels, nested confirmations, Safari focus, exact relationships,
late responses, slow providers, explicit refresh, network details, sign-out and
live telemetry polling. Exact release results and production acceptance are
recorded in WORKBOOK.md and the current-state record.

Private release evidence is kept in ignored `output/resource-details-release/`.
Provider operations, backup submissions, remote sessions and endpoint actions are
not part of production UI acceptance. Existing Windows/Linux qualification limits
remain unchanged.

Released September 27 as `20260927T151514Z-resource-details-8a7e266`, source
`8a7e266`, preserving main and the deployed Home release. Build, 51 units and
261 browser checks pass, with one existing skip. Live desktop Chromium and
tablet/phone WebKit acceptance passed without errors or operational writes.
All 26 public files match; the backend, environment, PID and identity/configuration
fingerprints stayed unchanged. [Full release record](../../WORKBOOK.md).

Measured return visits in one paired production run:

| Page | Before | After |
| --- | ---: | ---: |
| Infrastructure | 1293 ms | 19 ms |
| Slide | 179 ms | 5 ms |
| Network | 789 ms | 34 ms |

These are observed navigation timings, not latency guarantees. Cold loads remain
provider-dependent. Rollback static tree:
`/var/lib/speck-rollback/20260927T151514Z-resource-details-8a7e266/web`.
Source is committed locally; future releases must preserve `8a7e266` until it is
merged to main. No push or GitHub merge was performed.
