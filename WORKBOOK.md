# Speck working record

## Local project home — September 23, 2026

The canonical project folder is now `~/Development/SpeckRMM`. Open that folder
as the SpeckRMM project in Codex. The primary checkout, all 22 linked worktrees,
Git history, pending work, build outputs and private operator artifacts moved
together from `~/Development/Speck`. Branches and commits were preserved.

`~/Development/Speck` remains a compatibility symlink for existing task paths and
local environments. The infrastructure bridge LaunchAgent and the desktop client
were reloaded from the canonical path; no process runs from the old path. The
project virtual environment was rebuilt from `uv.lock` because its console script
shebangs still resolved through the symlink. Keep the compatibility link until
remaining task paths migrate.

Speck cleanup evidence formerly in SlideDev is now in
`output/speck-restore-cleanup-20260923/`. SlideChat and dental-demo integrations
remain in SlideDev with their owning repositories. Migration inventory and
verification are in ignored `output/project-relocation-20260923/`: all 175,707
pre-existing filesystem entries, 23 checkout states, refs, remotes and cleanup
evidence hashes matched after relocation. No production changes, pushes or
commits were made as part of the move.

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

## Fleet UI polish rollout — September 23, 2026

At the user's request, static runtime `8cd12c7` deployed at 13:02 UTC with the
latest main `7a51f07` included and the live unified-Fleet baseline verified.
Public index `0253cdc4…` and JS/CSS assets match the local build. Real Chromium
1440px and WebKit 390px checks passed flyout alignment, drag ordering, save/reload,
width controls and footer layout. Original preferences were restored afterward;
test sessions were logged out. No backend restart or agent/provider operation.
Service/environment and protected identity/account/provider hashes were preserved.

Rollback: `/var/lib/speck-rollback/20260923T130226Z-fleet-ui-polish-8cd12c7/web`.
Private evidence: `worktrees/fleet-ui-polish/output/fleet-ui-polish/`. Source is
local, not pushed or merged. The concurrent client-display task acknowledged the
single deployment owner and was sent the verified runtime/index to preserve in its
next release. See [release details](docs/operations/unified-fleet.md#september-23-static-ui-refinement).

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

## Client membership/backup production rollout — September 23, 2026

User-authorized server/web runtime `7141ea0` is live, preserving `8cd12c7`'s flyout
spacing and column editor. Live desktop Chromium and phone WebKit verify all five
reported originals' clients and immediate backup requests without name entry;
backup POSTs were intercepted during acceptance. Source/asset hashes, health and
protected state checks pass. No real backup or endpoint upgrade was performed.

The pre-release audit found no production application edits missing from Git;
all deployed changes and both release records are captured in local branch
`codex/slide-client-backup-fix`. Private rollback:
`/var/lib/speck-rollback/20260923T131146Z-slide-client-backup-fix-7141ea0`.
See current state and journal for exact validation and evidence locations.

## Fleet toolbar and saved coverage — September 23, 2026

Runtime `1158014` is live from `worktrees/fleet-toolbar-headers`, preserving all
previously deployed local fixes. Search and the saved Speck agents only switch
stay visible; Filters and View contain secondary controls. Table headers support
click sorting, drag ordering and keyboard movement. Coverage, sorting and column
order persist per user. The [gallery](docs/screenshots/fleet-toolbar/README.md)
uses synthetic inventory.

Ruff/build, 157 backend tests, 28 web units and 141 browser checks pass (one existing
platform-specific skip). Live desktop Chromium and phone WebKit verified saved
coverage across reload, navigation and new sign-in; original preferences were
restored. All five earlier client assignments and protected runtime state remain
verified. Rollback: `/var/lib/speck-rollback/20260923T133704Z-fleet-toolbar-headers-1158014`.
Source and release records are local; no GitHub push. See current state and journal
for audit and deployment evidence. Future releases must preserve this runtime.


## Proxmox machine experience — September 23, 2026 (local)

`worktrees/proxmox-machine-experience`, branch `codex/proxmox-machine-experience`,
adds a shared VM/container workspace in Fleet and Infrastructure: structured
inventory, guest OS/IP/filesystems, hardware/network, charts, snapshots and tasks.
Running VMs gain ephemeral read-only screen previews, PNG downloads and direct
screen control. API-token connections now use Proxmox VNC tickets/WebSockets;
existing host connectors need no update. Per-section failures and guest-agent
requirements remain explicit. Provider credentials stay server-side; redirects
are rejected and preview/control sessions are isolated and cleaned up.

Implementation `0e0e143` preserves the separately deployed Fleet/Slide changes
through merge `f1df14d` (runtime `1158014`, release record `6faaf5c`). Consolidated
core checks passed (162 backend, agent race tests/builds, 31 web units, 153 browser
checks, one existing skip). The final security regressions bring the backend to
164 passing; affected browser recheck: 41 passing, one existing skip. Build and
lint pass. The full core gate completed in 144 seconds.

No push, deployment, production guest action, connector update or provider-setting
change occurred. Live Proxmox acceptance is still pending an authorized server/web
release. See [behavior, limits and release checklist](docs/operations/proxmox-machine-experience.md)
and [synthetic review images](docs/screenshots/proxmox-machine/README.md).


## Compact alerts and AI — September 23, 2026 (live)

Deployed runtime `65f668d` on `codex/alerts-ai` preserves Fleet `1158014` /
record `6faaf5c`. Compact rows explain job outcomes, expand evidence and separate
acknowledging/reviewing from recovery. AI diagnose/fix uses selected alert/machine
context, optional job evidence and an explicit command review/run; cautions and
verification survive terminal handoff.

Ruff, TypeScript/Vite, 166 backend, 28 web units and 159 browser scenarios pass
with one existing WebKit CDP skip. Live Chromium/WebKit layouts, evidence, AI setup
and a real metadata-only diagnosis/terminal handoff passed. No endpoint commands
were executed. Source/assets, service/database health and protected state were
verified; matching rollback is retained. [Release/rollback](docs/operations/alerts-ai.md),
[journal](docs/progress/JOURNAL.md), [synthetic gallery](docs/screenshots/alerts-ai/README.md).
No GitHub push or main merge occurred. Preserve this release before publishing
other in-flight work.


## Proxmox production release and GitHub publication — September 23, 2026

User-authorized server/web runtime `84eb09e` is live. Combined integration
`7227267` preserves previously deployed Fleet/Slide and Alerts/AI changes and
publishes them with the richer Proxmox workspace in
[PR #19](https://github.com/amcchord/speck/pull/19). This supersedes the earlier
local-only Proxmox and unpushed Fleet/Alerts status notes.

Live graphical VMs on both Proxmox clusters passed read-only screen capture,
PNG download, guest OS/network/filesystems, all tabs and explicit keyboard/mouse
console transport in Chromium and WebKit. Serial-only VMs now explain unavailable
graphical access while keeping their inventory. Endpoint/host agents and provider
configuration were preserved. Direct-token transport has automated coverage; live
acceptance is still unverified because both clusters use outbound host connectors.

Combined local core: 173 backend, race tests/builds, 31 web units, 171 browser
cases and one existing skip. The display follow-up passes 176 backend tests.
Hosted backend/build and browser checks passed on the display-capability runtime. Protected
state, database integrity, served bytes and service health pass; matching rollback
and private evidence are retained. See
[release record](docs/operations/proxmox-machine-experience.md) and current state.

## Fleet Refresh and removed Slide VMs — September 23, 2026

Web `141b126` is deployed from `worktrees/slide-cleanup-refresh`. Explicit Fleet
Refresh now checks Slide restore cleanup before fetching fresh inventory, using
the existing five-minute confirmation window and policy. Scheduled checks remain
unchanged. Source preserves main and the deployed Chat topology update. All 20
lifecycle tests, 31 web units and 53 browser cases passed; live Chromium/WebKit
confirmed request ordering. The original five stale copies were automatically
archived by the worker. See the current-state entry for hashes, rollback and
private evidence. Source is committed locally and has not been pushed.


## AustinLand integration — September 23, 2026 (live)

`worktrees/austinland-integration`, branch `claude/austinland-integration` (merged to main by PR #22, `b5473ca`).
Everything AustinLand managed is native in Speck: vault/key arbiter, provider credentials,
GoDaddy DNS, UniFi public IPs via the Site Manager cloud connector, reachability map, SSH keys,
handoffs, scoped API tokens, MCP server and agent documents, and VM launching via the existing
AustinLand bridge. AustinLand data was migrated through the API with a revoked host token; Speck's
own deployment and signing secrets stayed in AustinLand. Releases `9b69a9d` and `0c6c35e` passed
the local core gate and live read-only acceptance, including a real Claude Code MCP session.
See [operations and acceptance](docs/operations/austinland-integration.md), the
[synthetic gallery](docs/screenshots/austinland/README.md) and the journal. The Proxmox connector
allowlist was not widened, so provisioning still needs the Mac bridge worker. Private release
scripts, logs and live screenshots are in ignored `output/austinland-release/`.

## UI/UX audit — September 23, 2026 (live)

`worktrees/ui-audit`, branch `claude/ui-audit` (merged by PR #23, `09bcba3`). [Audit and implementation record](docs/ui-ux-audit.md):
every page was reviewed at 1920 × 1080 with production data. The result: grouped navigation,
one header pattern (summary, icon refresh, page actions), full-height tables, muted
placeholders, readable events and receipts, compact dense views with paging, and inactive
items behind toggles. Live release `20260924T014550Z-ui-audit-233a434`. Rollback trees are
under `/var/lib/speck-rollback/<release>`. Private captures (before and after) and release
scripts are in ignored `output/ui-audit/` and `output/ui-audit-release/`; the
[synthetic gallery](docs/screenshots/ui-audit/README.md) is committed.

## Phone and tablet redesign — September 24, 2026 (live)

`worktrees/ui-audit-mobile`, branch `claude/ui-audit-mobile`.
[Audit and implementation record](docs/ui-ux-audit-mobile.md): every page was reviewed in
WebKit on iPhone 15 (393 × 659), iPad Pro 11" portrait (834 × 1194) and landscape
(1194 × 834) with production data.
- Phones: bottom tab bar and More sheet, compact header with a "More actions" sheet, list
  rows for every table, folding filters, bottom-sheet dialogs, and a one-line machine summary.
- Tablets: an 84 px labelled rail.

`web/src/responsive.ts` and `responsive.css` hold the shared behaviour, and
`web/test/ui/responsive.spec.mjs` covers it. The preview server now has synthetic provider
data (`scripts/preview_fixtures.py`). Live release `20260924T033857Z-ui-mobile-b1cddc6`.
Private captures and release scripts are in ignored `output/ui-audit-mobile/` and
`output/ui-audit-mobile-release/`; the
[synthetic gallery](docs/screenshots/ui-audit-mobile/README.md) is committed.


## Connected Home and expanded palette — September 27, 2026 (live)

`codex/connected-workspace` starts from current main `7ad0d63`. Home becomes the
default signed-in destination, with machine/host/IP/DNS search, Cmd/Ctrl+K,
relationships between UniFi evidence, Proxmox hosts and Speck agents, alerts and
upcoming schedules. AI drafting starts in Home and feeds the existing platform /
endpoint context review; templates and schedules retain their existing review
flows. Existing Fleet and assistant deep links continue to work.

The console uses slate navigation, neutral surfaces, blue network, copper
infrastructure, green agents and violet automation. Phone and tablet layouts
retain the bottom bar / labeled rail. Identity conflicts, stale sources, empty
inventory, partial failures and viewer restrictions remain explicit. Network
drill-down carries the exact machine ID; no name or IP identity joins are added.

Local validation: TypeScript/Vite, 41 web unit tests and the full Chromium/WebKit
suite (243 passed, one existing WebKit CDP touch skip). The final selection-scroll
refinement also passed all 22 Home browser checks. Screenshots at 320/390/834/1440
were reviewed. Python preview compilation and synthetic fixture checks pass. The
first iterations exposed navigation-selector and short-sidebar regressions; both
were corrected before the passing full run. No GitHub CI run was requested.

A loopback-only connected preview runs with `scripts/preview.py --connected`; it
uses synthetic endpoints and documentation IP ranges. [Behavior and limits](docs/operations/connected-workspace.md),
[gallery](docs/screenshots/connected-workspace/README.md). Local logs are in ignored
`output/connected-workspace/`.

User-authorized static release `20260927T133224Z-connected-workspace-db61a96` is
live at https://speckrmm.com, source `db61a962fda4fed1fc9eb729d44c030c2dfd73e4`.
Fetched main `7ad0d63` before the production build and publishing; ancestry and
the previously deployed mobile source `b1cddc6` are preserved. This task was the
sole active deployment owner and publication held the shared release lock. The
live index matched the inspected baseline immediately before its atomic swap.
All 26 public files match the build. The backend's 41 Python files, dependency
manifest, environment, PID and seven configuration/identity groups are unchanged.
Rollback web tree: `/var/lib/speck-rollback/20260927T133224Z-connected-workspace-db61a96/web`.

The release build, 41 units and full Chromium/WebKit suite (243 passed, one
existing skip) passed again. Authenticated production acceptance passed at 1440
pixels in Chromium and 834/390 pixels in WebKit: all Home sources loaded, search,
relationship cards, machine/Proxmox-host/network drill-down, Fleet links, command
shortcut, AI review handoff and the schedule editor worked, with no overflow,
script errors or HTTP errors. AI generation and operational submissions were not
invoked. Test login sessions were signed out. Private deployment manifests, logs,
and live screenshots remain in ignored `output/connected-workspace-release/`.
No backend restart, agent change, provider operation, recovery action, GitHub push
or merge occurred. Windows/Linux operational qualification remains unchanged.

## Resource flyouts and faster repeat navigation — September 27, 2026

The shared resource flyout replaces infrastructure modals and inline Slide JSON,
and also covers DNS, public IPs, LAN clients and UniFi consoles. Cloud instances
lead with compute, capacity, network and backup protection. Proxmox hosts show
storage, networks and explicitly scoped guest relationships, including in Fleet.
Slide shows schedules, retention, verification and recovery configuration;
appliances link to their protected systems. Technical fields remain available in
a collapsed, recursively formatted section. Actions retain their existing review
and confirmation behavior. Desktop, tablet and phone layouts share the same
structure, with focus restoration and protection against late responses.

Reusable inventory reads now share a bounded memory-only session cache. Return
visits show saved data immediately, with background refresh and explicit freshness,
failure and Show latest controls. Mutations invalidate reads; logout clears data
and open inspectors. Fresh mutation preflights, secrets and live operation reads
are excluded. Fleet telemetry polling still reads current server data, while
navigation no longer forces provider refreshes. Cold loads still depend on the
provider. Slide status and inventory load concurrently; histories have search
and bounded rendering.

Implementation and limits: [resource details](docs/operations/resource-details.md).
Reviewed synthetic captures: [gallery](docs/screenshots/resource-details/README.md).
Private test and release evidence: ignored `output/resource-details-release/`.

Local release validation passes: TypeScript/Vite, 51 web unit tests and the full
Chromium/WebKit suite (261 passed, one existing CDP touch skip). The first full
run exposed a WebKit test race that checked phone filters before the responsive
enhancement frame; the test now waits for the visible phone control. Earlier
focused runs caught and corrected stale Fleet polling, Safari focus restoration
and session cleanup before the final passing run. Backend, native and agent
sources are unchanged; their qualification limits remain unchanged. No hosted CI
run was requested for this local static release.

User-authorized static release `20260927T151514Z-resource-details-8a7e266` is live
at https://speckrmm.com, source `8a7e26604200929391d1b68a2793f39fb60181b7`.
Main `7ad0d63` was fetched and confirmed as an ancestor before the production
build and publication; deployed Home source `db61a96` is preserved. This task
was the sole active deployment owner. The shared release lock covered baseline
verification, backup and publication; the index matched the inspected baseline
immediately before the atomic swap. All 26 public files match the release.
The service remains active with PID 72151; the backend's 41 source files,
dependency manifest, environment and seven identity/configuration fingerprints
remained unchanged through live acceptance.

Authenticated production acceptance passed in Chromium at 1440 pixels and
WebKit at 834/390 pixels. Cloud capacity/network/backups, Proxmox host facts and
guest relationships, Slide schedules/appliances/protected systems/snapshots,
network inspectors and DNS records loaded without script or HTTP errors or
overflow. Resource reopening measured 32/50/45 ms. No provider actions, backup
requests, remote sessions or endpoint commands were submitted. All temporary
login sessions were signed out; live screenshots remain private.

One paired production navigation measurement reduced repeat visits from
1293 to 19 ms for Infrastructure, 179 to 5 ms for Slide and 789 to 34 ms for
Network. Infrastructure inventory requests across the two visits fell from two
to one. These are local browser observations, not latency guarantees; cold loads
still depend on provider response time.

Index SHA-256: `85fc1f272670ece8cac40358297321aa6674756600795f9a3653c910d7f77e59`.
Rollback web tree: `/var/lib/speck-rollback/20260927T151514Z-resource-details-8a7e266/web`.
No backend restart, agent/native update, provider configuration change, recovery
action, GitHub push or merge occurred. Preserve `8a7e266` in future deployments
until it reaches main. Windows/Linux operational qualification is unchanged.

## 2026-09-27 — infrastructure, network and terminal overhaul

Prepared on `codex/connected-workspace`, preserving deployed `8a7e266` and the
connected workspace/Home release. Infrastructure now has connection inspectors,
clickable operation receipts and provider-native history; Network opens on
UniFi site health with an OpenStreetMap basemap and richer, site-scoped LAN
observations. Terminal embeds a live shell, and agent 0.3.2 adds Windows ConPTY.
Details and qualification: [observability](docs/operations/observability.md).
Local core passed (214 backend, Linux race checks, platform builds, 51 web units,
273 browser checks; one existing skip), plus 18 final focused browser checks.
Real Windows ConPTY passed without changing enrollment. Release owner is the
current connected-workspace task; deployment and acceptance follow below.

Deployed source `3a282ac` as `20260927T173225Z-observability-3a282ac` under the
shared release lock. The full live baseline and immediate pre-publish index
matched; current origin/main and the newer deployed commits are ancestors. All
27 public web hashes matched. Backend restarted with no active jobs/recovery.
The signed agent 0.3.2 release was published after real Windows/Linux shell
canaries passed state, Unicode, resize, Ctrl+C and clean reconnect.

Live provider telemetry and UniFi observations passed; 17 Network sites have
reported locations. Environment, identities, account/provider/connector/recovery
configuration, SQLite integrity and service health were preserved. No schema
change. Remaining eligible endpoint updates follow the existing idle-only policy.
Rollback: `/var/lib/speck-rollback/20260927T173225Z-observability-3a282ac`.
Private evidence: `output/operations-overhaul/`. Preserve this release in future
deployments until it reaches main. No GitHub push/merge or hosted CI run occurred.

During 0.3.2 automatic rollout, one Windows helper replacement failed and rolled
back cleanly. Windows offers were temporarily held, leaving Linux offers active.
Agent 0.3.3 hardens executable replacement against transient Windows image locks,
waits for helper process exit, and runs the verified candidate as the updater.
Windows file-lock, transaction/rollback and ConPTY tests passed on the lab host;
Linux agent/connector race tests passed again. No failed update bypasses approval
or changes endpoint identity; final release validation follows below.

Final agent source is `e6fbfd2`, signed as 0.3.3. All ten approved endpoints
(six Windows, four Linux) are online on 0.3.3, advertise interactive shells and
have current update state; zero failed, installing or rollback-failed updates.
Three legacy Windows updaters required a signed operator repair; installed
hashes, retained backups and unchanged identities were verified. Six unapproved
recovery candidates were untouched. Live 0.3.3 Windows/Linux sessions passed
state, Unicode, resize, Ctrl+C, teardown and clean reconnect again. All platform
offers are enabled; automatic-update policy is unchanged. The frontend/backend
remain `3a282ac`, with no active validation shell and final database/configuration
invariants intact. Preserve both release commits until they reach main.

## Keys workspace — September 27, 2026

The Keys page now shares the resource flyout used elsewhere. Vault entries show
exact creation/update/reveal timestamps, actors, recent audited activity, related
source credentials and recorded system associations. Providers, SSH identities
and sealed handoffs have searchable views and detail inspectors. Local metadata
search combines terms across names, projects, fields and linked system labels;
vault rendering is bounded to 80 rows at a time. Inventory reads use the existing
session-only stale-while-refresh cache. Secret values and handoff documents remain
outside that cache.

New metadata routes enforce existing vault scopes and name-prefix restrictions.
Activity projects only timestamp/actor/action, never arbitrary audit payloads.
System linking is an audited administrator-session action validated against local
endpoint/provider inventory. Links describe recorded configuration, not verified
runtime use. VM provisioning records administrator-credential and SSH-key
associations for future creates; imported credentials are not matched by name.
Reads outside Speck are not observed. SSH registration is now an explicit read
instead of a dependency of loading Keys. Handoffs require an explicit reveal;
handoff and SSH private-key displays expire after 90 seconds. Closing a vault
flyout discards a late reveal response.

Local validation: 217 backend tests, Ruff, 52 web unit tests, TypeScript/Vite,
289 browser tests (one existing touch-only skip), plus 16 focused Chromium/WebKit
checks after final refinements. These include 1440/768/390px layouts, a 500-entry
vault, repeat navigation without refetching lists, metadata-only inspection,
system links, access scopes and secret expiry/cancellation. No agent or native
code changed; no new platform build or hosted CI claim is made. Synthetic visual
review is in `docs/screenshots/keys/`.

This task is the single deployment owner; the active-task inventory showed no
other active Speck deployment. The inspected live release was the observability
release from `3a282ac`, with agent 0.3.3 from `e6fbfd2`, and both remain ancestors.
The baseline also hashes every vault entry/provider credential, SSH key and
handoff so deployment can verify they remain unchanged. Production publication
will use the shared deployment lock, a rollback snapshot and an immediate live
index comparison. Final deployment acceptance is recorded below after release.

### Production acceptance — Keys workspace

Deployed `2b4cb275dfe9745d1b85888f17c4e01050f80b96` as
`20260927T182901Z-keys-2b4cb27`. Before the production build and again before
publication, origin/main was fetched and verified as an ancestor; all newer
observability/agent work was preserved. Publication held the shared deployment
lock and compared the live index to the inspected baseline immediately before
its atomic replacement. A consistent database backup, server, web, downloads and
configuration rollback snapshot was retained in the private operator record.

All 27 public web assets match the build manifest. Service health is active.
Authenticated metadata-only checks passed for all 43 vault entries, six
providers, 13 SSH identities and six handoffs, with 280 locally known system
targets. Inventory round trips measured 11–24 ms from this operator Mac; median
individual detail reads were about 10 ms. These are observed API timings, not a
guarantee for every network or browser. Repeat navigation and local search were
separately verified in the browser suite.

The database hashes of vault entries (including reveal counters), provider
credentials, SSH keys and handoffs are unchanged after deployment and acceptance.
Account/device identities, connections, recovery configuration, environment and
requirements also match the baseline. No production credential was revealed,
rotated, provisioned, revoked or linked for testing. Agent downloads are byte-for-byte
unchanged and the automatic update version remains 0.3.3. GitHub CI was not run.
Private manifests, backups and validation logs are under ignored
`output/keys-workspace/` and the deployment record. The public index SHA-256 is
`6db069fb15f54d4e2acd2b885d06fce5d076050f9cd90a1466586a1235e619f5`.

## 2026-09-27 — Integration depth and network operations

Production exploration stayed read-only and confirmed exact UniFi site/device
identities, physical port and PoE data, live device statistics, topology/client
observations, Linode attachments and Slide history. The implementation plan and
capability boundaries are recorded in `docs/operations/integration-depth.md`.

Added a shared equipment flyout with a physical port map, upstream/downstream
navigation, connected clients, device health, radio and firmware detail. Machine
uplinks use unique MAC evidence from the managed gateway; shared IPs never create
these links. Admin PoE/restart controls require a fresh, expiring impact review,
typed confirmation and an unchanged device/connection fingerprint. A durable
claim prevents duplicate submission, including ambiguous results. No generic
port-reset capability is claimed; the official API exposes POWER_CYCLE/RESTART.
No production equipment was disrupted for testing.

Linode disks, boot profiles, volumes and firewalls now have independent detail
sections. Proxmox host storage, bridge and task entries are inspectable. Slide
backup/snapshot history is scoped to the original connection and paginated.
Equipment/provider detail uses bounded session-memory browser caching; secret
reads and operation preflights remain excluded.

Local validation: 231 backend tests, 52 web unit tests, 307 browser tests passed
with one pre-existing touch-only skip. Eleven focused backend tests also passed
after adapting textual PoE wattage observed in production. Final browser
refinements and deployment acceptance are recorded below. Agent binaries and
native apps are unchanged; agent/platform and iOS checks were not rerun. GitHub
CI was not run. This task is the sole active deployment owner; live baseline
matches release `2b4cb27`. Release will retain the shared lock, ancestry check,
rollback snapshot and immediate pre-publication index comparison.

### Production acceptance — Integration depth

Deployed `a7f604aba5a7c5fd4e03ac5ced81e0ace2432c9c` as `20260927T192151Z-depth-a7f604a`. The production build and
publication each fetched origin/main and verified ancestry, preserving the prior
Keys, observability and agent releases. Publication held the shared lock, matched
the inspected baseline and compared the live index immediately before its atomic
replacement. A consistent database and complete server/web/download/config
rollback snapshot is retained in the private release record.

All 27 public web assets match the manifest and service health is active.
Final Chromium/WebKit checks pass 36 tests on the release build. Production
read-only acceptance discovered 17 network sites and 115 devices on the managed
site, opened a 26-port switch with real statistics/topology, and verified
46 machine-to-uplink relationships. Linode attachments and Slide's paginated
backup/snapshot history passed authenticated API checks. A live Chromium session
verified equipment navigation and cloud-disk details with zero page errors and
zero mutations. Cold device detail took 4403 ms and a repeated read 19 ms from
the operator Mac; these are observations, not a latency guarantee.

Credentials (including reveal counters), recorded key-system links, identities,
approvals, connections, recovery configuration, environment and requirements
match the baseline. Agent downloads are byte-for-byte unchanged at 0.3.3.
PoE cycling and restart were validated with mock providers; no disruptive
production action was performed. Agent/native builds and GitHub CI were not run.
Private logs, production screenshots, manifests and acceptance records remain
in ignored `output/integration-depth/` and the private deployment record.
Index SHA-256: `c73c658bd57b02eabecd7df6bd829a4e7b7610e87a05f2a8349d6f376a45a6de`.
