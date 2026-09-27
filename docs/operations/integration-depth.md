# Integration depth: implementation and release plan

## Intent

Make integration evidence navigable: endpoint → observed LAN client → switch or
access point → port → connected clients and downstream equipment. Extend the
same approach to cloud storage, host tasks and backup history. Keep facts scoped
to the provider connection and distinguish observations from inferred identity.

## Production discovery (read-only, 2026-09-27)

The managed UniFi site reports 115 adopted devices. Official device detail and
statistics endpoints provide physical ports, PoE state, CPU, memory, uplink rates
and radio details. The Network application's observations supply port names,
traffic/error counters and downstream attachment evidence. Linode provides
instance-scoped disks, boot profiles, attached volumes, firewalls and backups.
Slide provides agent-filtered backup jobs and snapshots.

The documented UniFi actions are device RESTART and port POWER_CYCLE. A generic
port reset is not available through this API; do not substitute disruptive
configuration changes or claim support. Documentation:
https://developer.ui.com/network/v9.4.17/openapi.json

## Execution plan

1. Add exact console/site-scoped network equipment inventory and detail reads,
   independently degradable telemetry, searchable equipment and port views,
   navigable upstream/downstream links and connected clients.
2. Add endpoint MAC evidence to network relationships and make uplinks clickable
   from machine and LAN-client views. Never join systems across sites by IP alone.
3. Add admin-only PoE cycling and device restart with a fresh server-side impact
   review, typed target confirmation, expiry, changed-target rejection, durable
   operation receipts and no automatic retries. No live disruptive testing.
4. Add independent, lazy provider detail sections: Linode disks/boot profiles/
   volumes/firewalls; Proxmox host tasks/storage/interface detail; Slide protected
   system backup and snapshot history, including provider-reported verification.
5. Validate scope isolation, redaction, stale reviews, replay/concurrency,
   unavailable/empty states, navigation, search and responsive layouts locally.
6. Fetch main and preserve the deployed ancestry. Inspect active deployment
   ownership and live baseline. Build and publish under the shared lock with
   immediate index comparison, rollback snapshot and post-deploy read-only checks.

## Boundaries

No arbitrary production reboots, port changes, backup restores, credential changes
or unrelated workloads. Existing Windows/Linux agents remain unchanged. API
acceptance means a request was submitted, not that a restart or recovery succeeded.
Inventory stays available while detailed sections load; caches are memory-only
and action preflights bypass cached reads.

Validation and deployment results will be recorded here and in WORKBOOK.md.

## Implemented

- A searchable equipment inspector with physical port layout, port counters and
  PoE draw; direct and downstream clients; upstream/downstream equipment links;
  CPU, memory, uplink rates, radio detail and firmware/heartbeat information.
- Machine and LAN-client uplinks open the same inspector. Machine relationships
  require a unique MAC match; duplicate MAC evidence is left unlinked. Machine
  matching uses the configured gateway's inventory; other sites remain explicitly
  scoped and never infer a system identity from a reused private IP.
- Fresh, expiring admin reviews for PoE power cycling and device restart, with
  affected known equipment, typed confirmation, configuration/connection drift
  rejection, durable receipts, audit events and at-most-once provider submission.
- Independent Linode disk, boot-profile, volume and firewall detail, with boot
  devices linked to their disk/volume. Proxmox host storage, bridges and task
  records open detail flyouts. Slide history stays on its originating connection,
  pages backup/snapshot records and shows provider-reported verification.
- Session-memory caching of equipment and provider detail. Optional data failures
  preserve available sections. No new frontend dependencies or endpoint agents.

## Validation before release

231 backend tests and 52 web unit tests pass. The complete Chromium/WebKit suite
passes 307 tests with one existing touch-specific skip. Eleven focused backend
checks also pass after normalizing the production provider's textual PoE wattage.
A final focused browser run covers the final layout/navigation refinements.
The standard-library preview server queue was enlarged to accommodate concurrent
browser workers; a fixture was updated to distinguish overview reads from the
new independent explorer reads.

Candidate readers were run read-only against production. A switch returned 26
ports, five direct clients, two downstream devices and two downstream clients;
an access point returned two clients and live statistics. Linode returned two
disks and one boot profile; Slide returned 25 jobs and 25 snapshots with pagination.
These observations validate the read paths, not the disruptive write outcomes.
Windows/Linux agent binaries, capabilities and the deployed 0.3.3 update remain
unchanged. No native code changed, so agent/platform and iOS checks were not rerun.
GitHub CI was not run for this release.

Synthetic previews: [switch ports](../screenshots/integration-depth/switch-ports.png)
and [mobile PoE review](../screenshots/integration-depth/poe-review-mobile.png).
