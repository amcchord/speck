# Management rollout · September 22, 2026

Deployed server and web source: `92831ae254c753fc16d8829b6c2d1cd4f28d2e7c`.
The existing Desktop 0.2.1 packages and 0.2.0 endpoint agents were retained.
Production: https://speckrmm.com. Pull request: [#1](https://github.com/amcchord/speck/pull/1).

## Preflight and backup

Preflight found no queued/leased/running jobs, active recovery runs or guacd
connections. Thirteen enrolled instances were retained: five live originals,
three live restored machines and five stopped, unapproved prior test instances.
SQLite integrity and foreign-key checks passed.

The release retained root-private backups under
`/opt/speck/rollback/20260922T151537Z-mvp-92831ae`:

- `server/`, `web/`, `requirements.txt`, `venv/` and the service unit;
- stopped-service `data/`, including transfers, plus `consistent-snapshot.db`;
- `config/`, preserving the existing encryption key and environment;
- dependency versions and non-secret identity/configuration fingerprints.

The first deployment attempt hit a syntax error in its verification wrapper;
the error trap restored matching prior code, dependencies and data. Service
health, legacy schema and SQLite integrity were checked before retrying. The
corrected attempt installed the pinned PyOTP dependency and matching server/web
assets, restarted the service, and passed migration and invariant checks.
No provider credentials, downloads, agent binaries or proxy/firewall settings changed.

## Verification

- Existing credentials and an already signed-in Safari session worked after the
  migration; existing users became administrators without password changes.
- The periodic monitoring worker reported healthy. All five original machines and
  three retained restores resumed fresh telemetry.
- Device/installation/hardware IDs, approval, remote secrets, original account
  hashes, Slide/provider settings and all recovery plans/runs matched preflight
  fingerprints. SQLite integrity and foreign-key checks passed after migration.
- One reviewed, one-time native patch scan ran successfully on the Windows exam
  PC and Linux caller. Both command results returned exit code zero and persisted
  fresh update inventories. Retrying creation returned the same schedule.
- A version-pinned recurring Linux health template was reviewed, created and
  paused before its first occurrence; it enqueued no commands.
- A disposable account exercised viewer/operator/admin boundaries, TOTP setup,
  OTP replay rejection, one-use recovery codes, role-change session revocation
  and disabled-account rejection. The real operator's MFA/password was untouched.
- A synthetic agent's stopped-service alert opened after its hold period,
  acknowledged, and resolved through fresh healthy telemetry. A second disposable
  identity exercised organization/maintenance, archive/restore and isolated
  credential revocation. The acceptance wrapper initially requested `status=all`
  instead of the API's `state=all`; the corrected query confirmed the original
  alert was resolved by the monitor, not by test cleanup.
- Filtered audit history recorded the work. All QA schedules are inactive; the QA
  account is disabled and both synthetic installations are revoked and archived.
  Their audit/results remain available; no real endpoint was retired or revoked.
- Native Safari visually verified fleet selects, mouse/keyboard filtering, the
  connected RDP toolbar and all shortcut menu entries. The controls retain native
  semantics, use a consistent chevron/height and preserve forced-color rendering.
  This check does not claim a new qualification of Safari audio/remote input.
- Local verification: 35 Python tests, 7 microphone lifecycle tests, 10 desktop
  tests, Ruff and TypeScript/Vite passed. GitHub checks passed on the deployed head.

Private scripts, job IDs, API evidence and the real remote capture are under
ignored `output/mvp-review/`. Public [screenshots](../screenshots/mvp-review/README.md)
use synthetic local data and preserve original PNG bytes.

## Rollback

Keep one Uvicorn worker. Before rollback, stop new work and inspect jobs, remote
sessions and provider operations created after the snapshot. Their external
side effects cannot be reversed by restoring SQLite. Retain a new complete backup
of the current state before replacing anything.

Stop `speck`; restore the snapshot's matching `server/`, `web/`, `venv/`,
`requirements.txt`, `config/` and `data/` to their original paths. Preserve root-only
configuration, the `speck` data owner and restricted data permissions. Verify SQLite
integrity/foreign keys, then start `speck` and check HTTPS health, original login,
agent telemetry and identity/provider invariants. Do not replace only the code:
pre-role authentication would grant newly created operator/viewer accounts wider
access. Do not replay jobs whose execution status is uncertain.

Windows selected-patch/MSI installation, cloud recovery/external VPN and remaining
native runtime/audio qualification remain separate [release gates](../ROADMAP.md).
