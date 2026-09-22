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
