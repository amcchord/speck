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

## 2026-09-22 — Native account-transition isolation and build 2

Integration review found that delayed authentication/refresh/logout responses could
cross an account change. Commit `5eef9ae` binds native UI tasks, multi-step commands
and transfer polling to their original session generation; invalidates local state
immediately on sign-out; rejects old response/401 effects; and separates each
login's WKWebView data store. Existing native navigation resets between accounts.

Twenty unit tests pass on iPhone and iPad, including nine deterministic delayed
response/operation regressions without real network or Keychain access. Repeated
native action/script/sign-in smoke and live Windows/Linux commands, verified file
transfers, Windows RDP controls/rotation and Linux SSH keyboard input pass.
Build 2 archive and distribution export succeed. Build 1 was briefly assigned,
then removed from the tester group and expired; it is superseded by build 2.
No backend/agent deployment, recovery run or identity change was needed for this
fix. The final Apple/GitHub release state is in `docs/ios-quality.md`.

Apple processed build 2 successfully and reports IN_BETA_TESTING for the internal
Speck testing group. What-to-test notes include physical-device acceptance items.
All GitHub checks at `5eef9ae` pass, including Xcode 26's 20 native unit tests.
The temporary local upload key was removed; the scoped key remains in AustinLand.

## 2026-09-22 — Passkey implementation

Branch `codex/passkeys`, based on merged iOS main `8adc266`, adds WebAuthn backend
verification, account controls, administrator reset and browser-native sign-in.
Desktop adds its signed Mac authenticator and a cross-platform browser approval
bound to the initiating client. iOS adds AuthenticationServices and associated
domains while preserving session-generation guards. No personal credential is
created as part of development. Automated crypto and native tests pass; release
qualification, deployment and distribution are in progress under `output/passkeys`.

## 2026-09-22 — Passkey rollout and app releases

The backed-up server rollout from `8ae506b` is live, with disposable real-signature
acceptance for enrollment, sign-in, replay, viewer permissions, revocation and the
one-time desktop verifier. The acceptance account was disabled and its keys reset.
Original/restore identities, credentials, provider settings and recovery bindings
were checked before/after. Static follow-ups preserve the service PID; private
backup/deployment evidence is in `output/passkeys/`.

Desktop 0.2.2 publishes all seven platform packages and SHA256SUMS. Gatekeeper
accepts both profiled, notarized Mac architectures; Apple silicon launch and
browser-handoff cancellation pass. Notarization alone did not make an earlier
profile-less Mac build launchable; that build was never published and a release
hook now enforces the profile. Windows/Linux CI packages pass; physical passkey
ceremonies remain device acceptance.

Apple reports native 0.1.1 (4) VALID and IN_BETA_TESTING in the existing internal
group. Build 3 was withdrawn after final review added explicit selected-server/RP
matching before any native ceremony. Twenty-five native, 57 backend, 24 web and
14 desktop tests pass; Xcode 26 CI also passes. UI cancellation, narrow layouts and
passkey management were reviewed and captured without personal credentials. No
endpoint credentials, agent packages, Slide recovery identities or retained cloud
resources were changed. Upload keys were temporary; AustinLand remains the source.

## 2026-09-22 — Compact Fleet and cached navigation

`ed04607` is deployed as a static-only release. Header consolidation moves the
table roughly 133 pixels earlier; 46-pixel desktop rows replace 80.75-pixel rows.
Windows/Linux icons, separate CPU/RAM columns and labeled action icons reduce
repetition. Mobile keeps accessible touch targets. Search, filters, sort, page,
selection, preview state and scroll survive navigation; background failures keep
the cached table and sign-out resets it. No inventory is written to browser storage.

Native Safari and 320/390/1024/1280-pixel Chromium were reviewed. Delayed, failed,
first-load, cached-return and sign-out cases passed; live navigation restored 11
filtered rows before the response. TypeScript/Vite, 24 web tests, 14 desktop tests
and GitHub Checks pass. Public captures are synthetic. Previous static assets are
backed up and service identity/environment were preserved. See compact-fleet
operations notes and ignored `output/compact-fleet/` for exact release evidence.

## 2026-09-22 — Row-wide Fleet activation and contextual pane

`codex/fleet-row-pane`, runtime `d1692a8`, is deployed. Ordinary row cells and blank
space open details; interactive controls and text selection remain independent.
Non-modal presentation keeps the Fleet accessible and highlights the open machine.
A short entrance respects reduced motion, and mobile prevents background scroll.
Replacements remove old detail DOM immediately; navigation/sign-out remove the
pane, nested modals retain Escape, and dismissal returns keyboard focus.

TypeScript/Vite, 24 existing web tests, desktop/mobile Chromium, and live CPU-cell
activation passed. Two original synthetic screenshots and digests are committed.
Static rollout retained rollback assets and verified service identity/environment,
HTTPS health and exact public asset bytes. No backend restart, device command,
remote session or recovery action was triggered. Private evidence is under
`output/fleet-row-pane/`; shared-style rollout coordination is with visual-audit.

## 2026-09-22 — Shared web and native visual audit

Frontend `2c22311` is live, integrating the compact Fleet and non-modal pane.
Shared controls replace repeated CSS overrides; distinct navigation icons and
text-first cards/metrics reduce visual repetition. Native sign-in spans the full
iPad and landscape iPhone width. Native 0.1.2 (5) is VALID and IN_BETA_TESTING in
the existing Speck testing group.

Forty Chromium/WebKit scenarios cover 13 pages, seven machine tabs, eight dialogs
and remote/empty/error states at 320–1440px. Native 25-unit/eight-iPad-UI checks
and corrected iPhone sign-in/dark checks pass, alongside 57 backend, 24 web and
14 desktop tests. The installed Mac app was relaunched and its live Fleet/Settings
checked. New UI CI and documented theme ownership guard against drift.

Deployment verified served hashes, health, service PID/start time and 18 preserved
device identities. No endpoint/recovery action or backend restart. Rollback is
`/var/lib/speck-rollback/20260922T202255Z-visual-audit-2c22311/web`. See
`docs/operations/visual-audit.md`; private evidence is in audit-worktree
`output/visual-audit/`. Physical devices and Windows/Linux runtime qualification
remain as documented in the platform matrices.

## 2026-09-22 — Compact individual machine overview

Worktree `worktrees/machine-overview`, branch `codex/machine-overview`, based on
main `290ed31`. The pane begins with name/connectivity and IP/OS/uptime/report
facts. CPU, memory, storage and foreground app/user share space with a contained
16:9 preview. Narrow screens prioritize health. System and organization sections
use less vertical space; missing values and stale offline reports stay explicit.

Machine-specific CSS now owns the pane/preview layout. Preview failures remain
local to the frame, with retry and policy-off behavior retained. TypeScript/Vite,
24 web tests and 62 Chromium/WebKit scenarios pass. Four original synthetic
captures were reviewed; measurements and limits are in the machine-overview
operations note. No production or live endpoint changes, push or integration.
Next step: review, then explicitly authorized integration/static deployment.

## 2026-09-22 — Authorized machine overview static deployment

Deployed runtime `37105be` at 20:58 UTC from `codex/machine-overview`. Clean-source
and previous-release preflights passed; rebuild matched the tested index exactly.
Retained the preceding web tree and old hashed assets, staged the new assets,
and atomically replaced the index. HTTPS/index/asset hashes, service identity,
environment and 18 machine identities/Slide bindings pass. Live Chromium/WebKit
checks confirmed desktop/mobile BYD-EXAM01 facts, preview geometry and tab
navigation, with no runtime errors. Verification logins were signed out.

No backend restart, endpoint/preview-policy operation, agent update or recovery
action occurred. Rollback and private evidence paths are in the machine-overview
operations record. Source is retained locally; GitHub integration was not part
of this deployment. The requested production rollout is complete.
