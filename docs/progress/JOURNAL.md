# Project journal

## 2026-09-22 — Slide restore lifecycle cleanup

Runtime `e5d37c6` adds persistent restore identity tracking, conservative provider
deletion confirmation and reversible retirement of offline restored endpoints.
The Slide page exposes policy, status and a manual synchronization action.
Provider listing validation and 20 focused regressions guard original identities,
stopped VMs, errors, changed scope, role/CSRF boundaries and archive behavior.
All 77 backend tests, 24 web tests, server Ruff and TypeScript/Vite pass.

Deployed above the previously live machine overview, retaining its interface.
Database/runtime/configuration rollback was captured before the backend restart.
Source and served asset hashes plus health pass. A real-provider acceptance run
confirmed the unattended worker archived five copies after its grace period;
all originals and shared credentials remained active, with history preserved.
Slide controls and the cleaned Fleet passed live browser checks. Exact customer
evidence stays private. Integration is in draft PR #9.

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

## 2026-09-22 — Preview persistence, capture recovery and desktop presence

`codex/preview-reliability` / PR #10 fixes indefinitely loading previews, isolates
native capture behind an eight-second process limit, and retains a single encrypted
checkpoint every five minutes. Opt-out/archive/revoke delete the live and saved
image; clone identities remain separate. Browser requests are bounded and recover
without mistaking the loading logo for a screen. The open machine pane previously
stopped Fleet polling: it now updates health/user/desktop/app in place. Agent 0.2.2
reports Windows sessions and Linux logind users independently of the foreground
window, with explicit historical app timestamps after disconnect.

Deployed backed-up backend `adc694d`, static/agent `4089388`, and Linux discovery
`c175646`. All five originals are online with unchanged enrollment identities,
accounts, provider settings and recovery associations. All three Windows originals
passed live current/disconnected presence checks; exam preview checkpoints advanced
after five minutes and survived loss of live memory. Validation: 82 backend, 28 web,
72 browser, seven Linux and four Windows tests plus builds/GitHub checks. Headless
Linux has no graphical capture acceptance. See the preview operations note for
rollback paths and exact qualification. No provider recovery, patch deployment,
password change or resource cleanup was performed.

## 2026-09-22 — Taskbar names in the active app column

`codex/app-display-name` / PR #11 replaces executable-first Fleet labels with the
already-reported window title, including historical apps. Empty titles fall back
to the executable. Search matches both, and tooltips retain executable details.
Static runtime `6420df3` is deployed with atomic index replacement, retained old
assets and rollback at
`/var/lib/speck-rollback/20260922T231219Z-app-display-name-6420df3/web`.
Public hashes, HTTPS health, backend process/environment and five device identities
passed verification. The TypeScript/Vite build, 28 web unit checks and existing
Chrome/Safari pane-refresh scenarios passed. Live Chrome/Safari verified window
titles and title/executable search for all three Windows originals with no browser
errors. Verification logins signed out; endpoint agents and backend were unchanged.
Private release and acceptance records: `output/app-display-name/` in the worktree.

## 2026-09-22 — Headless web shell implementation

Contained branch/worktree `codex/headless-webshell`, from main `290ed31`, adds
Linux desktop capability detection, a bounded authenticated PTY relay and a
responsive xterm.js workspace selected by the Fleet screen action. Existing
connections and credentials are preserved; a saved connection remains available
from the terminal. Agent startup/disconnect, cross-builds, role/identity/session
restrictions, browser behavior and native label compilation were verified.
A Linux runtime test caught and fixed a blocking PTY descriptor on resize/close.
Screenshots are synthetic, original and include hashes. Full validation and
rollout instructions: `docs/operations/web-shell.md`. No shared branch push,
production deployment, live endpoint command or credentials change. The next
action is review and authorization for the coordinated release.

Before handoff, rebased the feature onto main `b6dfb32` and resolved the
Fleet/telemetry changes while retaining all recent overview, preview and lifecycle
behavior. Combined validation: 104 backend, 28 web unit tests, full Windows/Linux
build script, Linux race tests and all 80 browser checks pass.

## 2026-09-22 — Signed automatic agent updates implemented

User authorized deploying the headless web shell and requested automatic updates.
Previously updates required rerunning installers. Agent 0.3.1 now checks signed,
expiring Ed25519 release offers; enforces target, increasing version and hashes;
claims an idle lease; and uses a separate protected helper for service replacement.
It restores previous executables when the new agent cannot check in. Windows
refreshes its desktop helper without a password or elevated interactive token.
Admin policy pauses future installs. The signing seed is held only in its scoped
AustinLand vault entry; source/server contain the public trust anchor.

113 backend tests, Linux race/real-PTY and update transaction tests, all platform
builds, 28 web unit tests and 80 existing browser checks passed; added dedicated
pause/resume browser checks. Production preflight found an active remote session,
so no service/endpoint changes have occurred. The next step is the backed-up
coordinated release and Linux/Windows canary, retaining every original identity.

## 2026-09-22 — Headless shell and automatic updates deployed

User explicitly authorized restarting despite the open remote session. Deployed
server/agent source `0a09f6b`; full rollback is
`/var/lib/speck-rollback/20260922T232347Z-agent-updates-0a09f6b`. Identity/account/
provider/recovery/policy/environment hashes and SQLite integrity remained intact.

Bootstrapped one Linux and one Windows canary, then the remaining three originals.
All five independently fetched and verified signed 0.3.1, claimed the idle lease,
installed and checked in. Five start/current audit pairs, endpoint hashes, running
services/helpers, retained backups and unchanged enrollment files prove the flow.
Automatic updates remain enabled. Removed temporary public bootstrap binaries.

Live headless screen actions passed shell execution, Unicode, actual PTY resize,
Ctrl+C, disconnect/reconnect on both Linux originals; Windows RDP rendered its
desktop. Live testing exposed xterm accessibility mode suppressing Unicode input;
`ddd5a97` made it optional, and final web `5d1e39d` kept its control compact. Both
follow-ups were static-only, preserving the backend process and environment.
Final static backup: `/var/lib/speck-rollback/20260922T233544Z-shell-controls-5d1e39d/web`.

113 backend tests, 28 web unit checks, 84 browser scenarios including targeted
reruns, Linux race/PTY/update transactions and all platform builds pass; iOS
simulator build was verified during shell implementation. ARM64 runtime, physical
iOS and a real Linux graphical desktop are still unverified. Public screenshots
are synthetic originals with hashes; private live evidence stays in ignored
`output/agent-updates/`. Local task branch is committed; no GitHub push or merge.

Final validation also found main had advanced with PR #11's app-title display
change after the original branch baseline. The initial web rollout omitted it.
Coordinated with the active app-label task, which owns the combined static repair
from main plus `5d1e39d`; this task holds further deployments. The original feature
checks remain valid, and no further backend or endpoint changes are needed.
## 2026-09-22 — Restore app titles in the combined production release

The user reported executable names after PR #11 had been deployed. Production
index `bb287bf0…` came from the subsequent `5d1e39d` shell release, whose older
base omitted PR #11. Merged latest main and that exact deployed source into
`8ba0f74`, then merged rollout documentation `d8e829b`. Runtime changes relative
to `5d1e39d` are only the app-title/search repair. The shell task held deployments.

Published static `8ba0f74` with an inspected-index precondition, atomic index
replacement and retained old assets. Backup:
`/var/lib/speck-rollback/20260922T233949Z-app-name-release-sync-8ba0f74/web`.
Public index `0aedb3b1…` and referenced assets match the build. Service identity,
environment and five original device identities are unchanged. Reloaded Safari
Fleet visibly reports Molar Office Manager, ByteWing Imaging and Server Manager,
while Linux retains web-shell actions. Build, 28 web checks and 22 focused browser
cases pass. No backend restart or endpoint operation was needed. Added release
coordination rules to AGENTS.md; combined GitHub integration owns the final state.

## 2026-09-22 — Local release checks

The user requested local checks after slow hosted runs. Added the documented
`scripts/check-local.sh core|ios|all` entry point and local-primary guidance;
GitHub CI remains enabled and required branch checks still apply. Core runs
Python lint/tests, Linux agent race tests (Docker on macOS), all agent/web builds,
web units and Chrome/Safari browser checks. iOS prefers booted simulators, waits
for boot readiness and runs iPhone units plus iPad sign-in without parallel clones.

Executed both groups on the combined release: core passed in 112s (113 backend,
agent race checks, all platform builds, 28 web units, 84 browser cases); iOS passed
in 36s (25 iPhone units and the portrait/landscape sign-in test) on Xcode 27/iOS 27.
Hosted iPhone units passed; hosted iPad failed before assertions because the runner
timed out launching Speck. Preserved that separate result in the PR record rather
than relabeling it success. No required branch checks are configured. Logs and
xcresults are in ignored `output/local-checks/` in the integration worktree.

## 2026-09-22 — Current TestFlight and desktop auto-updates

Worktree `worktrees/client-updates`, branch `codex/client-updates`, PR #13. Runtime
`68de4bd` adds the fixed GitHub updater, stable-only checks after launch/every six
hours, background downloads and install-on-quit. Manual restart is explicit;
remote content cannot supply feeds or trigger native updates. Updated CI retains
update manifests/blockmaps, and the release verifier checks all final packages.

Published desktop 0.2.3 with all seven platform packages, three manifests,
blockmaps and checksums (16 files; GitHub digests match local files). Both Mac apps
pass strict signing, Apple notarization/stapling and Gatekeeper. A signed isolated
bootstrap downloaded and installed the actual 0.2.3 ZIP on quit, then relaunched
and reported current against the public GitHub feed. Windows/Linux x64 feeds were
also checked with the real updater library. Full Windows/Linux updater-install
runtime and Intel execution remain unverified; Windows remains unsigned.

Universal TestFlight 0.1.3 (6) is VALID/IN_BETA_TESTING in the existing Speck
internal group. It includes the native headless Linux routing from current main.
Local validation passed 19 desktop regressions, 25 iPhone units, one iPad
portrait/landscape UI test, 28 web units, TypeScript/Vite and 84 Chromium/WebKit
cases. Three-platform packaging and core GitHub checks passed for runtime source.
The hosted iOS job was still running when this release record was written; local
Xcode 27 results are the release gate, not a claim that hosted iOS passed.

Static Downloads runtime `2b01150` is live, preserving all previously deployed
features. The index and served asset hashes match; service PID/start time and
server environment are unchanged. Desktop/phone live checks show 0.2.3 and all
current links without overflow. Rollback:
`/var/lib/speck-rollback/20260923T004907Z-client-updates-2b01150/web`.
No backend restart, agent operation, recovery change or credential change occurred.

Installed 0.2.3 in `/Applications/Speck Desktop.app`. The old running app used by
the concurrent demo was preserved and needs to be closed before opening that
new installation. Existing desktop 0.2.2 users need one bootstrap installer
upgrade; future updates are automatic. No claim is made that every remote
operator's installation was discovered or replaced. Temporary QA processes/feed
were stopped and signing key files removed. Private evidence and artifacts:
`worktrees/client-updates/output/client-updates/`.

## 2026-09-23 — Site-scoped Slide Chat integration

Branch `codex/chat-integration` adds administrator-issued, hashed, expiring and
revocable integration tokens, scoped to one exact named Site. The API reads
existing inventory/health, volumes, services, open alerts and patch reports;
normal session/agent endpoints reject its credentials. Chat maps the exact Site
to one Slide client and independently checks scope. No agent build is required.

The current production backend matches main `9b33085` and the latest Downloads
web baseline (`383ed5a0…`); no unpublished runtime work is being replaced. Local
validation includes 120 backend, 28 web unit and six new Chromium/WebKit token
lifecycle checks, TypeScript/Vite and Ruff. Production release and live cross-app
acceptance are being coordinated with the Chat deployment owner. Exact private
baseline/deployment evidence remains under `output/chat-integration/`.


Production release `682fc0d` completed at 01:46 UTC September 23, with full private
rollback `/var/lib/speck-rollback/20260923T014640Z-chat-integration-682fc0d`.
All 90 browser checks passed, and the final deployment preserved device/account/
MFA/provider/recovery/preview/environment invariants. Public asset bytes and health
match the release. Positive public Chat connection and companion reads, Site and
client isolation, and revocation propagation passed against Speck. The isolated
QA workspace/source/companion token and transient Speck access were cleaned up;
no fleet Site assignments or customer mappings were changed. User setup through
Speck Settings and Chat Connections is the next action for each desired client.

## 2026-09-23 — Infrastructure management implementation

Branch `codex/infrastructure` starts at current main `50c191a`, whose backend
matches the inspected live deployment. Added an Infrastructure page, encrypted
connections, audited/idempotent writes, Proxmox host/guest hierarchy and exact
hardware matching. The outbound host connector manages Proxmox without storing a
host API password, and relays provider screen consoles through the existing
remote gateway. Slide box/VM and Linode management plus an outbound AustinLand
operations bridge are included. Existing Slide recovery settings are preserved.

Local core checks passed in 122 seconds: 138 backend, Linux agent/connector race
tests, platform builds, 28 web units and 98 browser cases. Chrome/Safari desktop
and mobile infrastructure layouts were inspected. Production release is held
until the concurrent dental rehearsal can tolerate the backend restart; the
release owner is this infrastructure task. See the infrastructure operations guide
for capability limits, enrollment, session security and rollback.

## 2026-09-23 — Unified Fleet and client membership

Branch `codex/unified-fleet` starts at `661edc4`. Fleet combines exact provider and
endpoint identities into one machine view, adds client inheritance from Slide,
agent coverage filters/highlighting and sortable configurable columns saved per
user. Provider-only machines use the same pane and existing management controls.
Encrypted provider snapshots preserve known machines during outages. Existing
Sites and endpoint identity/enrollment records are not changed.

Read-only live validation joined all ten Proxmox endpoint matches, with no identity
or client conflicts. Synthetic Chromium/WebKit tests cover sorting, filtering,
column persistence, shared machine panes and responsive layouts; identity/API
tests cover collisions, restoration, clients, cache and authorization. Release
owner: this infrastructure task. Exact baseline, checks and release/rollback
records are private under `output/unified-fleet/`.

Unified Fleet production release `7148553` completed at 08:39 UTC; PR #17 merged
as `531ee39`. The release waited for the dental task's normal remote-session
cleanup, then passed pre/post identity, account, provider, lifecycle/recovery,
Site, connector credential and environment invariants. All provider sources and
eight infrastructure workers are healthy. Live Chromium desktop and WebKit mobile
checks verified all ten Proxmox endpoint joins, client display, agent filters,
column persistence and shared panes without browser errors. Test preferences
were restored. No provider VM actions or agent binary upgrades were performed.

The core gate passed in 123 seconds (154 backend, Linux agent/connector races,
platform builds, 28 web units, 110 browser cases). Final session-scoping and layout
changes passed 12 Fleet and 22 overview browser cases; all hosted PR checks passed.
Matching rollback: `/var/lib/speck-rollback/20260923T083900Z-unified-fleet-7148553`.
Private release, invariant and live-browser evidence: `output/unified-fleet/`.

## 2026-09-23 — Machine flyout gutters and drag-and-drop columns

Implemented on `codex/fleet-ui-polish` in `worktrees/fleet-ui-polish`, based on
current GitHub main `7a51f07`. Moved inventory-section styles into machine.css and
shared desktop/mobile gutters with the title, facts and body. Replaced the large
arrow-button column form with a compact scrollable editor in fleet-columns.ts:
mouse/pen/touch handles, drop marker, auto-scroll, keyboard arrows/Home/End,
Escape cancellation and status announcements. Width fields are opt-in; visibility
and a required Machine label are explicit. Save/Cancel remain visible. Reset
preserves unrelated sorting and highlighting; saved preference schema is unchanged.

Validation: TypeScript/Vite build, 28 existing web units, and all 119 applicable
browser scenarios pass in Chromium/WebKit. One WebKit copy of the Chromium input
protocol touch test is intentionally skipped. The actual Chromium touch drag and
ordinary touch scroll pass. Regression coverage includes save/reload, both drag
directions, keyboard focus, drag cancellation, draft cancellation, reset, footer
visibility at 320–1440px, and matching flyout gutters for endpoints/provider VMs.
Five original synthetic screenshot captures and digests are retained under
`docs/screenshots/fleet-ui-polish`; inspected desktop, mobile and width layouts.

No production, backend, agent, provider, credential, shared Git history or
endpoint actions. No new dependency. Physical iOS touch remains unverified.
Next: user review and explicit static-deployment authorization; preserve current
main and any newer live work during the required release preflight.
