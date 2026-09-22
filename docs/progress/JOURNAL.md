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

## 2026-09-22 — Desktop downloads

Added a branded Downloads page with direct Windows x64, Mac Apple silicon/Intel,
and Linux x64 installers, ZIP alternatives, release notes and checksums. Links
are available in the sidebar, sign-in, Settings and desktop handoff. Public
access needs no account; managed-machine actions retain their authentication.

Integrated after MVP main a812248, preserving MFA, viewer navigation, Safari
select styling and remote shortcut markup. Fixed sign-out routing and checked
320/390-pixel mobile layouts, desktop layout and the native-client external-link
policy. All seven artifacts and checksums respond as HTTP 200 attachments.
TypeScript/Vite pass. Live public access, sign-in, Downloads, Settings round trip,
MVP navigation, matching asset bundle and HTTPS health were verified.

Deployed static assets only, with the preceding MVP web tree retained for rollback.
No backend restart, agent changes or recovery actions. Private deployment evidence
is under `output/desktop-downloads/`; original screenshot bytes and digests are
in `docs/screenshots/downloads/`.

## 2026-09-22 — Loading states and Safari first-screen recovery

- Branch `codex/windows-session-start`, PR #3, runtime source
  `8b83c7fd6e172d75a488980180d29a38e85c5f4f`, based on Downloads/MVP main `bfe4564`.
- Added a shared accessible/reduced-motion orbit loader to boot, asynchronous
  pages/refreshes, machine panels and remote startup. Response generations and
  detached-panel checks prevent delayed responses from replacing newer views.
- Safari/WebKit's image streams now use Guacamole's Image decoder, which releases
  its task on load or failure; rejected ImageBitmap promises in the bundled path
  otherwise leave the queue blocked. Remote readiness observes actual render
  statistics and visible pixels, with a single button-free wake, one bounded
  reconnect, operator-input protection and manual controls. Background time does
  not consume the reconnect budget; leaving cancels it. Stable RDP size retained.
- Validation: 18 web tests, 10 desktop tests, 35 Python tests, Ruff, TypeScript/Vite
  and GitHub checks passed. Native Safari rendered a valid frame after a corrupt
  frame with ImageBitmap forced to fail. Retained manual regression fixture.
  Real frontend under three-second API delay verified loading/errors, mobile,
  page navigation and drawer changes. Public gallery has three original captures
  with dimensions/digests. Private live captures remain in ignored output.
- Static deployment at 16:21 UTC retained the prior web tree before copying new
  assets and atomically replacing index.html. Exact public asset bytes matched
  `index-g3WzwBIm.js` and `index-BMV8_m27.css`. HTTPS health, unchanged environment
  fingerprint, service PID and service start time passed. No restart or backend,
  agent, account, recovery, provider or original/clone identity mutation.
- Live native Safari: original Windows 11 front desk, Windows Server 2025 and
  restored front desk displayed without Ctrl+Alt+Del. Manual reconnect,
  fullscreen, Win+R and Escape passed. Chromium Windows desktop and Linux SSH
  rendered successfully; browser console had no warnings/errors. Own remote
  sessions and QA tabs were closed. Exam machine reserved for concurrent iOS QA.
- Rollback: preceding web tree retained under the private release path recorded
  in `output/windows-session-start/deployment.json`. Restore its assets before
  atomically replacing index.html; no database restore or restart is needed.
- Limitation: original intermittent foreground black screen was not reliably
  reproduced. The decode failure and recovery behavior are demonstrated; further
  reports may have distinct Windows/display causes. iOS native qualification
  continues separately. No broader RMM qualification claims changed.

## 2026-09-22 — Native iOS UI qualification and remote keyboard

Forked work in `worktrees/ios-testflight`, branch `codex/ios-testflight`, builds a
universal SwiftUI app with native fleet, commands, networking, files, alerts,
operations and saved Slide recovery workflows. Created the Speck RMM App Store
Connect record and internal tester group using the scoped AustinLand key.

The user's screenshot review prompted centered/shared action styling, adaptive
iPad details, visible search, accessibility reflow, literal script input and a
pinned run action. Twenty-eight unretouched synthetic captures document the app.
Both simulators pass 11 unit and seven UI scenarios. Signed simulator integration
passed real login/Keychain, Windows/Linux commands and 256 KiB verified transfers
with test-file cleanup. Live WKWebView RDP/SSH rendered; mobile SSH text entry
executed the expected harmless marker command. Device audio and older OS checks
remain explicit limits.

The shared remote Keyboard dialog supports text, Return/newlines, Tab, Escape and
Backspace. Web tests (21) and TypeScript/Vite pass. A static-only release from
`9ea115d`, then aligned-keyboard polish `acd0555`, preserved the running backend process and environment, retained rollback
assets and verified downloaded asset hashes. No new backups/restores, patch installs
or identity changes. Release archive and App Store distribution export succeeded;
export required Apple's system tools first in PATH to avoid a Homebrew rsync
incompatibility. TestFlight status is recorded in `docs/ios-quality.md`.
