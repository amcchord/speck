# Speck working record

Branch: `codex/fleet-operations`. Independent Windows/Linux RMM repository.

## Implemented

- Go agents, Windows desktop helper, Linux systemd and X11 observer.
- FastAPI/SQLite control plane; Argon2 login, CSRF, one-use enrollment, job leases,
  encrypted secrets/payloads and audited administration.
- TypeScript console, browser Guacamole gateway over outbound agent tunnels,
  native RDP download, commands, files, services and detailed networking.
- Slide inventory, backups, isolated recovery plans, clone approval and proof checks.
- Public-facing copy uses the requested “A LITTLE LIGHTWEIGHT RMM” tagline and
  functional labels, without marketing filler.

## Verification

- Python: eight focused security/recovery tests pass.
- Go: Linux execution/output, no-overwrite and journal-failure tests pass on Linux.
- Windows/Linux builds and TypeScript production build pass.
- Live lab: five Windows/Linux devices enrolled; commands on all five; verified
  binary file transfers on Windows and Linux; Windows browser desktop and audio
  output; Linux browser SSH with keyboard command execution.
- A real three-machine Slide recovery test passed on a local appliance: Windows
  server, Windows front desk, and Linux PBX. Fresh restored instances matched
  their provider hardware identities and were approved separately.
- Application evidence matched the originals: 240 synthetic charts, 660
  appointments, 105 imaging studies and 210 image files; database integrity,
  complete row/file hashes, front-desk API calls, and PBX service/configuration.
- Restored Windows startup and static networking were tested. A sample address
  script includes automatic DHCP rollback if its health check fails.
- Browser mouse and keyboard operated the live Windows imaging application.
- Restored front-desk browser RDP worked after its pending Windows updates
  completed. Its softphone registered with the restored PBX; an internal test
  call rang and was answered through the browser. Softphone audio in this
  restored session remains unverified.
- GitHub Actions passed on the public repository after implementation fixes.

Private deployment state, lab identifiers and operator scripts are in ignored
`output/`. Credentials live in the local operator vault and deployed secret
stores, never in source. Read `docs/security.md` for the initial release's limits.

## Next action

The service is live and source is public at https://github.com/amcchord/speck.
Successful restored VMs are retained for demonstration; prior failed test VMs
are stopped and their evidence is retained. The private operator record identifies
these resources and their cleanup procedure.

Cloud VM recovery, external client WireGuard access, a real microphone input,
and Linux graphical desktop/audio remain unverified. Windows RDP speaker audio
transport and Linux browser SSH were exercised. External phone routing was not
switched from the original PBX. This is an early single-administrator release;
see the capability and security limits in README.md and docs/security.md.

## Brand identity — September 22, 2026

The shared identity is recorded in `brand/README.md`: vector mark/wordmark, Inter,
forest/fern/lime/paper tokens, native icons, naming and concise product voice.
The same assets build the web console and Windows executable resources. Both
installers, service descriptions and agent help use the shared identity.

`docs/screenshots/README.md` is the public gallery; `scripts/preview.py` serves
read-only synthetic fixtures against the actual frontend. `docs/ui-review.md`
records the visual review, responsive and contrast fixes, and verification limits.
The README links the guide and gallery. Public captures contain no credentials.

Static site/downloads were deployed without restarting the control plane. All
five original dental endpoints were upgraded and reported online. Their previous
binaries and the prior static release remain available in private rollback paths.
Details and checks are under `output/brand-review/`; no additional recovery run
was started. Future UI changes should follow the brand guide and refresh the
gallery when their visible behavior changes.

The final gallery contains 19 unretouched captures with dimensions, digests and
provenance in `docs/screenshots/manifest.json`. Linux SSH and Windows RDP captures
show the real installed agent help; console screenshots use synthetic fixtures.

## Fleet operations and remote workspace — September 22, 2026

Speck 0.2 adds the fleet table/drawer, direct screen and prompt actions, opt-in
previews, patch inventory/install workflow, bulk templates, OpenAI drafting and
reviewed computer steps. The operator client is packaged for Windows x64,
macOS Intel/Apple silicon and Linux x64. See `docs/operations.md`, the current
`docs/screenshots/v0.2/` gallery, `docs/ui-review.md` and `docs/ROADMAP.md`.

All five original agents run 0.2.0 and retain their Slide links. Real health
templates and native update scans succeeded on all five; the Linux software
package template succeeded on both Linux systems. Windows active-session preview
capture and immediate policy-off removal were verified. OpenAI text drafting
and a reviewed UI click were tested. Existing restores and backups were preserved.

RDP now uses explicit stable resolution plus client fit/100% modes. Dynamic
resolution triggered a Guacamole/FreeRDP assertion; final fullscreen tests retained
working key macros, clipboard and mouse input. Linux SSH key input was verified.
Desktop packages passed platform CI; native UI tests remain pending because the
operator Mac was locked. Signing/notarization, Windows MSI/patch installation on
disposable targets and other limitations are tracked in the roadmap.

Private rollback snapshots, deployment scripts, binary validation, live evidence
and release artifacts are under ignored `output/fleet-review/`. Server, database,
environment and previous downloads are retained under private server rollback
paths. Server restart preflights checked for active jobs and recovery runs.
The orbit subagent's source was integrated from `worktrees/orbit-animation`; that
worktree is retained, with its original uncommitted source, for explicit cleanup.

## Desktop quality — September 22, 2026

Desktop 0.2.1 was exercised on the unlocked Mac and a Windows 11 lab VM. Fixed
asynchronous native clipboard APIs, remote edit-key routing, native fullscreen
state/Escape, closed-window deep links, sound controls and microphone ownership.
A synthetic microphone stream was recorded on the remote Windows endpoint;
this also caught and fixed an incorrect timeout while waiting for the remote app
to begin recording. Seven microphone lifecycle and ten desktop tests pass.

Both Mac architectures are Developer ID signed, Apple-notarized and stapled;
Gatekeeper assessment passed. Windows installer upgrades, retained login, RDP,
clipboard, key macros, fullscreen and audio transport were verified. Windows is
still unsigned. Linux desktop interaction, Intel Mac execution and physical mic
quality remain unverified. Full details: `docs/desktop-quality.md`.

Only static web assets were deployed for this update, with rollback retained.
No backend restart, agent identity change or recovery cleanup occurred. Native
artifacts and private evidence are under `output/desktop-quality/`. The separate
MVP task owns backend feature work in its isolated worktree; coordinate releases.

## Management MVP rollout — September 22, 2026

`codex/mvp-review` / PR #1 deploys persistent monitoring, reviewed scheduled scans
and templates, endpoint organization/retirement, admin/operator/viewer roles,
optional TOTP and filtered audit. Source `92831ae` also fixes Safari select styling
and the malformed Ctrl + Alt + Del option. Existing operator credentials are unchanged.

Live Windows/Linux scheduled scans and disposable account/agent acceptance passed.
All original/clone identities, Slide bindings and recovery resources were preserved;
QA accounts/installations are disabled/revoked and QA schedules inactive. Matching
code/data/config/dependency backups remain private on the server. See
`docs/operations/management-rollout.md`, `docs/progress/CURRENT.md` and the public
synthetic management/Safari screenshots. Windows patch/MSI installation, cloud
recovery and remaining native runtime checks retain their documented limits.

## Desktop downloads — September 22, 2026

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

## Loading and Safari session startup — September 22, 2026

Static source `8b83c7f` adds the shared accessible orbit loader across asynchronous
pages and machine panels, discards stale navigation responses, and waits for a
rendered first screen before declaring remote readiness. Safari/WebKit uses the
Image decoder to avoid a rejected ImageBitmap blocking the frame queue. Blank
startup has a single bounded reconnect and manual controls, with cancellation and
operator-input protection. See `docs/operations/session-startup.md` and the
[loading gallery](docs/screenshots/loading/README.md).

Native Safari connected to Windows 11, Windows Server 2025 and the restored
front desk without Ctrl+Alt+Del. Reconnect, fullscreen and Win+R/Escape worked.
Chromium Windows RDP and Linux SSH also rendered successfully. A forced corrupt
image regression passed in Safari; three-second API latency, errors, rapid
navigation and mobile loading were checked locally. 18 web, 10 desktop and 35
Python tests, Ruff, TypeScript/Vite and GitHub checks passed. No service restart,
backend/agent/config changes, new recovery run or resource cleanup occurred.
The previous web tree and exact deployment evidence are in private rollback and
`output/windows-session-start/`. The original intermittent symptom could not be
consistently reproduced; this removes a demonstrated decode failure and provides
bounded recovery rather than claiming every black-screen cause is eliminated.

## Native iPhone/iPad beta — September 22, 2026

`ios/` contains the universal SwiftUI operator app, sharing the existing server's
permissions and APIs. See `ios/README.md`, `docs/ios-quality.md` and the 28-image
synthetic gallery. App Store Connect and the internal Speck testing group are set
up. **0.1.0 (2)** is in internal TestFlight testing after UI review, live acceptance
and the session-isolation fix. Credentials remain in AustinLand; the temporary
upload-key file was removed after distribution.

Native UI checks cover both simulator form factors, dark/light, landscape, large
text, centered actions, search and literal code entry. Native login, Windows/Linux
commands and verified binary transfers passed against the live lab. WKWebView
rendered Windows RDP and Linux SSH; the mobile keyboard executed a harmless SSH
command. Physical-device audio and older OS versions remain open.

The shared remote toolbar adds touch text entry and control keys. Static rollout
preserved the service process and environment, with the previous web tree retained
for rollback. No backend restart, agent/Slide identity changes or recovery cleanup.
Private deployment and release evidence: `output/ios/` in `worktrees/ios-testflight`.

## Passkeys — September 22, 2026

`codex/passkeys` adds user-verified WebAuthn, account enrollment/name/removal,
administrator lost-key reset, a verifier-bound desktop browser handoff and native
iPhone/iPad AuthenticationServices. Desktop 0.2.2 enables Mac Touch ID/account
selection and browser fallback across all three desktop platforms. Native build
0.1.1 (4) adds associated-domain entitlements. See `docs/passkeys.md`.

Protocol tests use real ECDSA signatures; web/desktop and native session-isolation
checks cover the new flows. Private release evidence: `output/passkeys/`.
The backed-up backend rollout from `8ae506b` and subsequent static updates are live.
Desktop [0.2.2](https://github.com/amcchord/speck/releases/tag/v0.2.2) publishes all
seven platform packages plus checksums. Both Mac architectures are profiled, signed,
notarized and stapled; the Apple silicon app launches and browser handoff/cancellation
work. iOS **0.1.1 (4)** is VALID and IN_BETA_TESTING in the existing Speck testing
group; build 3 was withdrawn. Apple’s association CDN serves the correct identity.

57 Python, 24 web, 14 desktop and 25 native unit tests pass, alongside live disposable
passkey protocol/revocation acceptance. Physical biometric/provider ceremonies and
Windows/Linux passkey runtime acceptance remain open. Original/restored identities,
passwords, provider settings, Slide bindings and endpoint credentials were verified
preserved. Final web updates preserve the running backend process. No new recovery,
patch or software-deployment action was triggered. See the passkey screenshot gallery.

## Compact Fleet and navigation cache — September 22, 2026

Static source `ed04607` combines the Fleet header, adds single-line
46-pixel rows with OS and action icons, and preserves table state while refreshing
cached inventory in the background. Search, filters, sorting, selection and scroll
survive navigation. Cold visits retain the orbit loader; sign-out clears the cache.
Native Safari and responsive Chromium checks passed, including delayed/failed
refresh and logout isolation. The public gallery contains only synthetic data.

24 web and 14 desktop tests, TypeScript/Vite and GitHub Checks pass. Live filtered
navigation returned the table before the background response. Only static assets
were updated; service PID/start time and environment were unchanged. Rollback:
`/var/lib/speck-rollback/20260922T195747Z-compact-fleet-ed04607/web`.
See `docs/operations/compact-fleet.md`; private evidence: `output/compact-fleet/`.

## Fleet row and pane — September 22, 2026

Runtime `d1692a8` opens machine details from ordinary row content and blank space.
The pane is non-modal with a 180 ms entrance; the current row stays highlighted
and visible rows can switch directly. Other dialogs remain modal. Keyboard
activation, Escape/focus restoration, bulk selection and quick actions retain
independent behavior. Mobile fills the screen without scrolling the fleet behind
it; reduced motion disables animation. See `docs/operations/fleet-row-pane.md` and
the original synthetic screenshots in `docs/screenshots/fleet-row-pane/`.

TypeScript/Vite and 24 web tests passed; desktop/mobile Chromium and live row
activation were checked. Static files match the build; backend PID/start time,
environment and HTTPS health are preserved. Prior web assets remain available
for rollback. No new agent package, endpoint operation or recovery action was
needed. The visual-audit task will integrate this change before its next rollout.

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

## Compact machine overview — September 22, 2026

Local branch `codex/machine-overview` starts from main `290ed31`. Machine name,
Online/Offline state, copyable IP, OS/version, uptime and last report lead the pane.
The 16:9 preview shares a row with CPU, memory, storage and active-app/user details;
mobile leads with health. Organization controls and system metadata are compact.
Missing/offline telemetry and preview failures remain explicit.

TypeScript/Vite, 24 web unit tests and 62 Chromium/WebKit UI scenarios pass. Four
synthetic screenshots were visually inspected. At 1440 × 960, CPU/memory move up
363 pixels and storage 534 pixels compared with main. See
`docs/operations/machine-overview.md` and `docs/screenshots/machine-overview/`.
No push, integration, deployment or live endpoint action occurred. Review and an
explicitly authorized static release are the next steps.

## Machine overview rollout — September 22, 2026

At the user's request, runtime `37105be` was deployed as static web assets, with
a complete prior-web backup and atomic index replacement. Served asset hashes
and HTTPS health pass. The backend process/environment and all 18 device IDs
and Slide links remain unchanged. Live Chromium/WebKit desktop/mobile checks
on BYD-EXAM01 verified status/IP, 16:9 preview and tab navigation. No endpoint
operation or service restart occurred. See `docs/operations/machine-overview.md`
for rollback and ignored `output/machine-overview/` for exact private evidence.
The runtime and release records remain on local `codex/machine-overview`; no
GitHub push or merge was performed as part of this deployment.

## Slide restore lifecycle — September 22, 2026

The Slide integration now correlates provider restore IDs/MACs with separate
Speck clone identities, including restores created by external runbooks. A
background poll archives offline copies only after repeated exact-resource 404
responses, a five-minute grace period and unchanged source/clone/provider scope.
Originals, shared enrollment credentials, audit/jobs/recovery history and stopped
VMs are preserved. The Slide page exposes status, a manual check and an admin
policy toggle. Provider inventory validation rejects malformed pagination/data.

Twenty focused regressions exercise deletion, stopped/online machines, API
failures, ambiguous hardware, source changes, token rotation, restart persistence,
archive/check-in behavior, role/CSRF boundaries and policy disabling. The complete
backend suite (77 tests) and 24 web checks pass; server Ruff and TypeScript/Vite
pass. Runtime `e5d37c6` is deployed with the previously live machine overview
preserved. The backend restart followed a consistent SQLite and runtime/config
backup at `/var/lib/speck-rollback/20260922T214123Z-restore-cleanup`.
No endpoint packages or provider credentials changed. The scheduled worker
retained removed restores through the grace period, then automatically archived
all five tracked copies at 21:51:36 UTC. Audit actors confirm `slide-sync` performed
the archives. All five originals remain online and manageable, with identical
device, installation and protected-agent identities. The live Slide controls and
five-machine Fleet were checked; a subsequent **Check now** was a no-op.
Private proof stays outside this public repository. Draft integration PR:
https://github.com/amcchord/speck/pull/9.

## Preview reliability and desktop presence — September 22, 2026

PR #10 combines bounded capture/request recovery, an encrypted five-minute saved
preview, and corrected user/desktop/app reporting. Server runtime `adc694d`, web
runtime `4089388` and final Linux discovery `c175646` are deployed. All five
original agents run 0.2.2 with their existing identities. The machine overview and
restore-cleanup changes already in production are preserved in this integration.

The open machine pane now continues inventory refreshes every 15 seconds without
resetting its preview. Windows signed-in users come from session enumeration;
Linux uses logind with a login-record fallback. Current and historical apps are
separate, and a disconnected user remains visibly signed in. Live checks on all
three Windows originals verified current desktop/user/app/preview and subsequent
in-place disconnected/last-app updates. The exam machine passed a real five-minute
save interval and saved fallback; all saved images loaded with empty process memory.

82 backend, 28 web, 72 browser scenarios, seven Linux and four Windows agent tests
pass. Linux graphical capture remains unverified on the headless lab hosts.
Release/rollback details, privacy behavior and synthetic captures:
`docs/operations/preview-reliability.md`. Private proof: the preview-reliability
worktree's ignored `output/preview-reliability/`. Refresh the console once to load
the new asset bundle; no operator desktop or iOS package update is required for
the hosted console changes.

## Active app display names — September 22, 2026

Web runtime `6420df3` displays the existing foreground window title in Fleet for
current and last-observed apps, matching the taskbar label. Blank titles fall back
to the executable, which remains in the tooltip and searchable alongside the title.
The static rollout preserved the backend process/environment and all five original
device identities. Live Chromium/WebKit checks verified titles and both search
forms on the three Windows machines. Build, 28 web checks and the existing
Chromium/WebKit pane-refresh checks pass. No agent update was needed.

Rollback index and assets:
`/var/lib/speck-rollback/20260922T231219Z-app-display-name-6420df3/web`.
Private deployment/evidence: `worktrees/app-display-name/output/app-display-name/`.
Integration: https://github.com/amcchord/speck/pull/11.

## Headless web shell — September 22, 2026

Implemented in `worktrees/headless-webshell` on `codex/headless-webshell` from
main `b6dfb32`, preserving the latest machine overview, preview and restore-lifecycle changes. Headless Linux screen actions open an agent PTY in an xterm.js
workspace without SSH configuration. Includes search, copy/paste, resize, full
screen and teardown; preserves existing graphical connections and old agents.
Server, Linux runtime, cross-build, browser and iOS build checks passed.
No production release or endpoint changes. See [implementation and release order](docs/operations/web-shell.md)
and [synthetic gallery](docs/screenshots/web-shell/README.md).

## Automatic agent updates — September 22, 2026

The user authorized the web-shell release and requested automatic agent upgrades.
The same worktree adds signed Windows/Linux releases, idle claims, detached service
replacement with authenticated health confirmation, rollback and admin pause.
The new 0.3.1 agent retains enrollment and includes the headless PTY shell.
Local checks pass; a live remote session currently defers the coordinated release.
See [publishing and recovery](docs/operations/agent-updates.md).

## Headless shell and automatic-update rollout — September 22, 2026

Both features are live. Runtime/agent `0a09f6b`, final web `5d1e39d`. After the user
authorized disconnecting an active session, the backed-up server release preserved
all identities and protected settings. Linux/Windows canaries and then all five
originals upgraded themselves from updater bootstrap 0.3.0 to signed 0.3.1. Every
service, executable hash, previous-binary backup and original enrollment hash
passed verification. Both Linux shells and Windows RDP passed live acceptance.
Unicode input required making xterm's accessibility mode optional; browser
regressions and final mobile captures cover that fix. Automatic updates are on;
Settings provides an admin pause. Local commits remain unpushed. See the
[release record](docs/operations/agent-updates.md#september-22-rollout).

## Combined release repair — September 22, 2026

The shell rollout was based on main before PR #11 and accidentally restored the
executable-first app labels. Combined web `8ba0f74` merges latest main with deployed
shell `5d1e39d`; its only runtime changes relative to the live shell release are
the app-title and search fix. The static repair is verified in Safari Fleet and
retains the newer shell/updater. Backend, agents, settings and identities remain
unchanged. Build, 28 web checks and 22 focused Chrome/Safari checks pass.
Rollback: `/var/lib/speck-rollback/20260922T233949Z-app-name-release-sync-8ba0f74/web`.
Private evidence: `worktrees/app-name-release-sync/output/app-name-release-sync/`.
The integration includes the shell task's rollout documentation `d8e829b` and
adds explicit current-main, deployed-baseline and single-owner release rules.

At the user's request, release checks now run locally first through
`scripts/check-local.sh core|ios|all`; GitHub remains secondary. This combined
release passed the local core suite in 112 seconds (113 backend, Linux agent race
tests, platform builds, 28 web unit and 84 browser checks). iPhone unit tests (25)
and iPad portrait/landscape sign-in passed in 36 seconds on Xcode 27 / iOS 27.
Hosted iPhone tests passed, but hosted iPad execution failed before assertions
because Xcode timed out launching the app after an 11m34s job. That hosted failure
is retained as distinct evidence; no required branch checks were configured or
bypassed. Logs and simulator test results remain in ignored `output/local-checks/`.

## Native client updates — September 22, 2026

Desktop 0.2.3 introduces background stable-release checks, automatic downloads and
installation on normal quit for Windows NSIS, both Mac architectures, Linux
AppImage and deb. Help provides a manual check and an explicit restart choice.
Older clients need one installer upgrade. The packaged feed is fixed to Speck's
GitHub releases, with no renderer-controlled update IPC. See
`docs/operations/desktop-updates.md` for publication, integrity checks and rollback.

The universal iPhone/iPad 0.1.3 (6), built from main plus this release, is VALID and
IN_BETA_TESTING in the existing Speck testing group. It includes the native
headless-web-shell change missing from build 5. Desktop release runtime is
`68de4bd`; all seven packages and update metadata are published at `v0.2.3`.
Both Mac apps are Developer ID signed, provisioned, notarized and stapled.

19 desktop regressions, 25 native units and the iPad portrait/landscape sign-in
check pass locally; all three desktop platform packaging jobs pass. An isolated
signed Mac bootstrap installed 0.2.3 on normal quit and relaunched successfully;
the packaged app then queried the live GitHub feed and confirmed it was current.
The Windows, Mac and Linux release feeds match 0.2.3 and final package hashes.
Windows remains unsigned; full Windows/Linux update-install runtime acceptance
and Intel Mac execution remain open. No such results are inferred from packaging.

The Mac now has 0.2.3 in `/Applications/Speck Desktop.app`. The older desktop
process used by the active demo was deliberately left running; open the new app
from Applications after that session finishes. Private artifacts, TestFlight
responses and updater evidence are in `worktrees/client-updates/output/client-updates/`.

## Infrastructure and outbound Proxmox agents — September 23, 2026

`codex/infrastructure` adds encrypted multi-provider connections, clustered host /
guest inventory, exact endpoint UUID matching, Linode, Slide boxes/VMs, and an
allowlisted outbound AustinLand bridge. The specialized root Proxmox connector
calls home and journals leased requests before execution. Guest management
includes snapshots, migration, resources, QEMU-agent commands/text files and
provider consoles through the existing Guacamole gateway. Provider credentials
remain server-side. See [operations](docs/operations/infrastructure.md).

Local core validation passed: 138 backend tests, Linux race/runtime tests, all
platform builds, 28 web units and 98 Chromium/WebKit scenarios. Additional targeted
checks cover the final Slide naming and infrastructure forms. PR #14 is merged;
server/web `45d02df` is live after the dental rehearsal cleared the restart.
Connector `2651859` (0.1.1) adds a pinned hardware-UUID fallback for hosts whose
Linux machine-id is empty; its regression and race tests pass.

Seven Proxmox host agents and the outbound AustinLand worker are enrolled. The
inventory covers two clusters, both Slide connections and Linode; ten existing
endpoint agents matched by exact hardware identity. Live Proxmox consoles on
both clusters and a Slide VM rendered through Guacamole. Chromium and WebKit
passed; the temporary Slide console-enable setting was restored. Provider detail,
guest OS/network, metrics/snapshots and a harmless QEMU guest-agent command passed.
No guest power, recovery, snapshot or deletion operation was needed for acceptance.

The release preserves all prior endpoint identities, approval/archive state,
Slide associations, accounts, schedules, recovery data, provider settings and signed
endpoint-update artifacts. Rollback:
`/var/lib/speck-rollback/20260923T071434Z-infrastructure-45d02df`.
Private baseline, build logs, screenshots and deployment/enrollment evidence remain
in ignored `worktrees/infrastructure/output/infrastructure/`.

Follow-up backend/connector `848bbc5` reports upgraded agent versions on authenticated
heartbeats while retaining older heartbeat compatibility. All seven hosts now run
and report 0.1.2, with identical enrollment-file hashes. The 19 infrastructure
regressions, Go race checks and hosted checks pass. Final live checks confirm all
six connections and eight connectors, served code/artifact hashes, provider reads,
AustinLand provisioning metadata and the restored Slide console setting.

The follow-up backup is
`/var/lib/speck-rollback/20260923T074120Z-infrastructure-848bbc5`.
An earlier attempt exercised code rollback when the invariant checker included
two naturally changing worker timestamps; only those transient state keys were
excluded before retrying. All protected settings and existing identities remain
verified. AustinLand continues using its existing application and credentials;
its outbound worker runs under the Mac user service manager. AustinLand itself
must remain running with LAN access for those delegated workflows.

## Fleet flyout and column editor — September 23, 2026

Local `codex/fleet-ui-polish` in `worktrees/fleet-ui-polish` starts from main
`7a51f07`. The machine identity section now aligns with the pane heading, facts
and content on desktop/mobile. A compact column editor adds mouse/touch dragging,
keyboard ordering, auto-scroll, optional width fields, explicit visibility and a
persistent Save/Cancel footer. Drafts and existing saved preferences are retained;
reset changes columns without resetting sorting or highlighting.

TypeScript/Vite, 28 web units and 119 Chromium/WebKit UI tests pass. One WebKit
copy of the Chromium-specific touch test is skipped; the actual Chromium touch
case passes. Five synthetic screenshots were reviewed; see the
[gallery](docs/screenshots/fleet-ui-polish/README.md). No production deployment,
backend/agent action, GitHub push or merge. Next: review and explicitly authorize
a static release after current-main and live-baseline preflight.

## Settings Slide client membership and backup button — September 23, 2026

Local `codex/slide-client-backup-fix` includes the existing Settings Slide account
in Fleet and Infrastructure, without migrating credentials or changing provider
assignments. Protected-machine backups submit on the first click, with existing
account scoping, permissions, audit and retry deduplication. The fix is combined
with deployed flyout/column runtime `8cd12c7`.

Read-only provider replay verifies all five reported originals' clients and all
ten Proxmox/endpoint joins. See `docs/progress/JOURNAL.md` for validation and
`docs/operations/unified-fleet.md` for behavior. Production release remains pending
explicit user authorization; no live backups were requested for testing.
