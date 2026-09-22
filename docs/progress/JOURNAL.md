# Project journal

## 2026-09-22 — Fleet operations and native client preview

Started at `443f17c` on `codex/fleet-operations`. Implemented table/drawer UI,
per-device preview policy, Windows/Linux patching, atomic/idempotent bulk jobs,
parameterized templates, encrypted OpenAI settings and reviewed computer-use
steps. Added full-frame remote access and Electron desktop packaging. Integrated
the separately authorized orbit-animation subagent's CSS.

Validated 15 Python tests, four Linux Go tests, agent cross-builds, the web build,
two desktop URL/origin tests and packaging on all three platforms. Deployed with
private server/database/environment/download backups and five endpoint rollback
copies. No live jobs/recovery runs were active at the deployment preflights.

Live tests passed: all original agent upgrades, five health scripts, five native
update inventories, two Linux package deployments, Windows active-session preview
and purge, OpenAI drafts and a reviewed navigation click, Linux remote keyboard,
Windows remote audio, fullscreen and clipboard/key macros. Fixed a mobile drawer
width error and a gateway RDP live-resize assertion; stable resolution with fit
and 100% modes avoids the failing gateway path. Preserved Slide and clone state.

Refreshed ten public screenshots with original-byte digests. Native application
UI checks were blocked by the locked Mac and remain explicitly unverified. Next:
complete that matrix, sign/notarize distributed clients and test Windows installers
and patch application on disposable systems. See roadmap and private rollout record.

## 2026-09-22 — Native desktop quality release

Native macOS/Windows use revealed actual clipboard, keyboard, fullscreen, audio
statistics and microphone cleanup failures. Corrected them and added focused
regressions. Windows setup now uses Speck artwork. Verified upgrades and retained
sign-in on Windows 11, Mac browser handoff, Windows RDP, Linux SSH, shared clipboard
and key macros. Native Windows output audio and synthetic microphone recording
succeeded. Removed a false microphone timeout while the remote app is idle.

Both Mac packages are signed/notarized/stapled; assessment passed. No physical
microphone, Linux GUI or Intel Mac runtime pass is claimed. Published qualification
matrix and native workspace captures. Static web deployment only; backend, Slide,
agent identities and retained recoveries were not changed.


## 2026-09-22 — Management MVP review

Forked review work is contained in `worktrees/mvp-review`, branch `codex/mvp-review`.
Implemented health/service/job alerts with persistent state, maintenance and
acknowledgement; site/tags and reversible retirement; shared installation revocation
that lists originals/clones; reviewed scheduled scans/templates with idempotent
creation and atomic occurrences; operator/viewer roles, optional TOTP/recovery
codes and session/password controls; filtered audit and export. Added legacy-schema
migration, job-expiry and remote-listener cleanup coverage. Source implementation
commit `68f5948`; parent desktop main `2a4068a` integrated by `c2391a3`.

Local combined validation: 35 Python tests, 7 microphone tests, 10 desktop tests,
Ruff and TypeScript/Vite passed. Real temporary SQLite databases and synthetic
Windows/Linux telemetry cover the new backend behavior. Browser review at desktop
and mobile sizes exercised alert acknowledgement, schedule create/review/pause,
audit filters, device policy and viewer-only controls. Six original screenshots
with hashes are in `docs/screenshots/mvp-review/`.

No live backend, VM, agent, backup or recovery changes. Added PyOTP to pinned runtime
dependencies. Review and coordinated deployment/real-endpoint acceptance remain;
rollback must restore matching code and database so old authentication cannot
silently bypass the new roles. See `docs/MVP-REVIEW.md` and `docs/management.md`.

## 2026-09-22 — Management deployment and Safari selects

The user explicitly authorized deployment. Source `92831ae` normalizes Safari
select appearance/height/chevrons while retaining native menus and keyboard use;
also repairs the missing opening option tag for Ctrl + Alt + Del. Native Safari
fleet filtering and the live connected remote toolbar were visually verified;
added an original-byte synthetic Safari screenshot to the public gallery.

Deployed matching server/web assets and pinned PyOTP dependency with complete
private code/venv/config/data/SQLite backups. A verification-wrapper syntax error
triggered the first attempt's matching rollback; checked service/schema/integrity,
corrected the wrapper, and redeployed successfully. Preflight had no active jobs,
recoveries or remotes. Identity, account hash, provider settings and recovery
fingerprints survived; existing Safari login and all eight live originals/restores
continued working. No provider recovery or backup resources were changed.

Live scheduled Windows/Linux native scans completed with exit zero. Disposable
account/agent tests passed role/session controls, TOTP/recovery/replay, service
alert acknowledgement/recovery, organization/maintenance, archive/restore, shared
credential-revocation boundary and audit. QA identities are disabled/revoked and
QA schedules inactive. Tests: 35 Python, 7 microphone, 10 desktop, Ruff and web build;
GitHub checks passed. See `docs/operations/management-rollout.md` for exact backup
and rollback, verification limits, and private evidence location. Coordinate the
separate Downloads and iOS tasks after this main merge.
