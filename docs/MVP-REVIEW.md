# Speck RMM MVP review

Review baseline: `5d89e3c`, September 22, 2026. Scope: one organization,
Windows and Linux managed endpoints, browser-first operations. “Implemented”
means code exists; it does not imply a real-device acceptance test passed.
The desktop-quality branch owns native clients and remote interaction testing.

| Capability | Baseline finding | MVP acceptance / action |
| --- | --- | --- |
| Enrollment and clone identity | Implemented; documented Windows/Linux verification | Preserve distinct original/restored hardware identities and approval. Add retirement and explicit installation credential revocation. |
| Inventory and health | Implemented host, disk, memory, CPU, services, active app, network | Add site/tags, persistent actionable alerts, acknowledgement, maintenance and service policies. Installed-software inventory remains a follow-up. |
| Remote access | Browser RDP/SSH/VNC, outbound tunnel, native fallback implemented | Parent task verifies native clipboard, keys, fullscreen, audio and packaging. Do not infer audio success from transport counters. |
| Commands and files | Implemented with leases, hashes, bounded payloads and audit | Expire all stale jobs even when devices never reconnect; preserve unknown outcomes instead of replay. |
| Patch management | Native update inventory/selected installation implemented | Add scheduled scans. Existing real Windows patch application needs disposable-endpoint verification; no automatic reboot. |
| Software and scripts | Versioned templates, atomic bulk preview/confirm implemented | Add durable scheduled reviewed templates, explicit target snapshots, revision checks and skipped-run history. |
| Access | One bootstrap admin; secure sessions, CSRF, Argon2 | Add admin/operator/viewer accounts, password changes, optional TOTP/recovery codes and immediate account/session revocation. |
| Audit | Last 200 events only | Filter by actor/action/device/time, cursor pagination and bounded export. No credential or script contents in new events. |
| Monitoring | No persistent policies or inbox | Deduplicate offline/stale telemetry/CPU/RAM/disk/service/job alerts. Do not clear resource alerts from missing or stale telemetry. |
| Scheduling | None | Single-worker/multi-worker safe occurrence claim; no missed-run storm, no retry of uncertain commands, disable with owner access. |
| Slide recovery | Inventory, backups, isolated plan restore and app proof implemented; documented local three-machine recovery | Preserve clone binding and review gates. Cloud recovery, external VPN and unattended recurring recovery remain unverified/not included. |
| Release operations | Builds and preview packages; single-node SQLite | Document backup/rollback and retained limits. Native signing/notarization remains a release requirement owned by the parent task. |

## Implementation acceptance

- Existing databases migrate twice without losing accounts, jobs, approval,
  remote secrets, installation tokens or Slide links.
- An alert survives restart, never duplicates while active, acknowledges,
  resolves on valid recovery, and suppresses new alerts during maintenance.
- A schedule uses the exact reviewed device IDs and template revision. Concurrent
  ticks create one occurrence; offline/busy/retired targets skip the occurrence,
  and an edited template requires a new review. Restart never replays a command.
- Archived hardware stays distinguishable from its originals and recovery clones.
  Shared installation revocation names all affected instances and is explicit.
- Viewer cannot issue commands, obtain screen/file content, or start remote
  access. Operator cannot change provider credentials or accounts. The last
  enabled administrator cannot be disabled or demoted.
- TOTP setup requires a fresh password and valid code; secrets are encrypted,
  recovery codes hashed and single use, and accepted time steps cannot replay.
- Local desktop/mobile browser review uses synthetic machines and no real
  credentials or patient information in screenshots.

## Results of this implementation

| Addition | Implemented | Verification |
| --- | --- | --- |
| Persistent alerts and per-machine policies | Offline, stale inventory, CPU/RAM/disk, watched services, failed/expired/unknown jobs; acknowledgement, recovery, maintenance, history cursors, nav count and worker health | Windows/Linux telemetry tests, malformed/stale data, deduplication, hysteresis, restart persistence; browser acknowledgement and desktop/mobile layouts |
| Schedules | Reviewed native scans/templates, pinned revisions, explicit target sets, idempotent creation, atomic occurrence claims, pause/resume, missed-run handling and retained results | Concurrent workers, duplicate creation, missed runs, offline mixed-platform targets, template edits and owner access changes; browser create/review/pause flow |
| Organization and lifecycle | Site/tags, maintenance, archive/restore, original/clone-aware shared credential revocation | Queue cancellation, credential rejection, original/clone preservation and consent-set revalidation; browser device policy editor |
| Access | Admin/operator/viewer, personal password/session management, optional TOTP and single-use recovery codes | Backend permission boundaries, legacy migration, last-admin protection, password/session invalidation, encrypted secrets, OTP replay rejection; viewer-only UI navigation and controls |
| Audit | Actor/action/machine/time filters, stable cursor and loaded-record JSON export | Backend cursor/filter checks; browser audit filtering and mobile scroll containment |
| Job and remote lifecycle | Periodic expiry even for disconnected endpoints; unapproval closes management; failed tunnel creation cleans its listener | Job expiry and listener cleanup regression tests; existing control-plane tests retained |

Local validation: **35 Python tests passed**, Ruff passed, TypeScript/Vite build
passed. The new tests use real temporary SQLite databases and synthetic Windows
and Linux telemetry. The existing agent binaries and protocols were not changed. Live deployment
acceptance subsequently completed scheduled update scans on Windows and Linux.

Browser review used an isolated local server and synthetic machines/accounts.
Checked 1280×720 desktop and 390×844 mobile layouts, alert acknowledgement,
schedule review/create/pause, account settings, policy editor, audit filters and
viewer restrictions. Fixed an empty machine-filter bug, short-screen navigation
overflow, mobile navigation density, unstyled device links and policy form sizing.
No page-level horizontal overflow was observed at the mobile breakpoint; wide
audit tables scroll inside their container. [Screenshots and provenance](screenshots/mvp-review/README.md).

## MVP verdict and remaining gates

This branch closes the main operational gaps for a **single-organization RMM MVP
candidate**. The management release was deployed September 22, 2026 from `92831ae`
with consistent private database/data/config/code backups. The parent desktop-quality
task completed the Desktop 0.2.1 release; its main
commit `2a4068a` is merged into this branch. Native platform limits remain in
[desktop qualification](desktop-quality.md).

GitHub CI passed. Combined local validation passed 35 Python tests, 7 microphone
lifecycle tests, 10 desktop tests, Ruff and TypeScript/Vite. Existing Safari login
survived deployment. Scheduled native scans completed on the lab Windows exam PC
and Linux caller. Disposable account/agent tests verified role and session boundaries,
TOTP/recovery replay protection, alerts/acknowledgement/recovery, maintenance,
archive/restore, credential revocation and audit. All QA schedules are inactive;
test accounts are disabled and test installations revoked. Original and restored
identities, credentials, Slide bindings and recovery state matched their preflight
fingerprints. [Deployment evidence and rollback](operations/management-rollout.md).

Remaining release gates:

1. Complete real Windows selected-patch and MSI installation acceptance; update
   inventory alone does not prove successful application.
2. Complete the cloud Slide recovery/external connectivity matrix before claiming
   all recovery destinations work. Existing local recovery evidence remains valid.
3. Enable two-factor for real operators and agree on account recovery/retention.
   Organization-wide mandatory MFA, SSO and independent security review remain open.

Next product increments: installed-software inventory, external alert escalation,
volume exclusions, supported retention cleanup, controlled patch/reboot windows,
signed agent updates and scheduled recovery orchestration with preserved clone
review gates. Multi-tenant isolation, billing and ticketing are beyond this MVP.
