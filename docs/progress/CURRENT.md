# Unified Fleet — live September 23, 2026

PR #17 is merged as `531ee39`; server/web release `7148553` is deployed. Fleet
unifies provider discoveries and Speck endpoints, with exact identity joins,
Slide client membership, agent coverage filters/highlighting, and per-user column
visibility, order, widths and sorting. Provider controls remain available from
one machine pane. Existing endpoint/host agent binaries and enrollments are preserved.

The full local core gate passed (154 backend, agent/connector race tests, platform
builds, 28 web units, 110 browser cases); final focused checks and hosted checks
also passed. Live Chromium/WebKit verification showed all ten Proxmox endpoint
matches, healthy provider sources and eight connected infrastructure workers.
Preferences persisted and were restored after testing. Database/configuration,
identities, recovery records and Sites passed preservation checks. A short restart
was coordinated after the dental task closed its remote session.
[Behavior, validation and rollback](../operations/unified-fleet.md).

# Infrastructure — live September 23, 2026

PR #14 is merged; web `45d02df` and backend/connector `848bbc5` are deployed. Seven outbound Proxmox
host agents cover both clusters; Infrastructure distinguishes host connectors,
matched endpoint agents and provider-only guests. Slide and Linode connections
and the outbound AustinLand worker are configured. Live Proxmox consoles on both
clusters, a Slide VM console and QEMU guest-agent commands passed. Local core and
hosted checks passed. Connector 0.1.2 reports its running version after upgrades
without changing enrollment. [Capabilities, validation and rollback](../operations/infrastructure.md).

# Current state — September 22, 2026

## Fleet UI polish — live September 23

`worktrees/fleet-ui-polish`, branch `codex/fleet-ui-polish`, starts from current
main `7a51f07`. Machine identity/provider details now share the pane's 20px desktop
and 16px mobile gutters. Columns use a compact scrollable selector with drag
handles, keyboard ordering, optional widths and a persistent Save/Cancel footer.
Existing saved preferences remain compatible; reset preserves sorting/highlighting.

Build, 28 web units and 119 Chromium/WebKit scenarios pass. One WebKit touch test
is intentionally skipped; Chromium touch gestures pass. Five synthetic captures
are in the [gallery](../screenshots/fleet-ui-polish/README.md).

User-authorized static runtime `8cd12c7` deployed at 13:02 UTC. Live index
`0253cdc4…` and all web JS/CSS bytes match the tested build. Chromium desktop and
WebKit phone checks verified flyout alignment, drag/save/reload, optional widths
and footer visibility; the original preferences were restored and test sessions
closed. Backend process, environment, device/enrollment/account/provider state
are unchanged. Rollback:
`/var/lib/speck-rollback/20260923T130226Z-fleet-ui-polish-8cd12c7/web`.
Source and release records remain local on `codex/fleet-ui-polish`; no GitHub
push/merge was requested. The concurrent client-display task was notified to
preserve this release before its next web publication. Reload the console to use
the new bundle. Private evidence: this worktree's `output/fleet-ui-polish/`.

## Deployed baseline

Speck is live at https://speckrmm.com with management MVP, native iPhone/iPad,
remote-session startup fixes and **passkey sign-in**. Enroll in Settings → Account
& access, or Account → Passkeys on iOS. Password/authenticator login remains
available. See [passkeys](../passkeys.md) for recovery and self-hosted setup.

- **Preview and desktop presence**: previews recover from timeouts and retain one
  encrypted checkpoint every five minutes. All five original agents now run 0.3.1.
  The open pane refreshes user/desktop/app details; disconnected users and the last
  app stay explicit. Fleet displays taskbar/window titles for current and last apps,
  with executable fallback, and searches both names (combined web runtime `8ba0f74`).
  Live Windows capture, five-minute saving, saved fallback and
  in-place presence changes passed. [Details](../operations/preview-reliability.md).
- **Slide restore cleanup**: runtime `e5d37c6` tracks separate restored endpoints
  through Slide VM IDs and interface MACs. Repeated confirmed deletion, an
  offline endpoint and a five-minute grace period trigger reversible archiving.
  Stopped VMs, originals, credentials and retained history are preserved. The
  Slide page has status, **Check now** and an admin policy toggle.
  The scheduled worker archived five confirmed removed copies in the live
  acceptance test; all originals remained online and manageable.
  [Behavior and limits](../recovery.md#automatic-fleet-cleanup).
- **Machine overview**: the deployed cleanup release retains `37105be`'s name/status/IP and report
  details at the top, health beside a 16:9 preview, and compact system/organization
  details. Build, 24 web unit tests, 62 browser scenarios and live Chromium/WebKit
  desktop/mobile checks pass. Backend/environment and 18 device identities are
  preserved in that static rollout. Source is included in the cleanup branch for
  GitHub integration. [Details](../operations/machine-overview.md),
  [screenshots](../screenshots/machine-overview/README.md).
- **Shared UI**: `2c22311` is live with uniform controls, distinct navigation icons,
  restrained decoration and responsive layouts. Native 0.1.2 (5) fixes full-width
  sign-in and aligns compact light/dark styles. Forty browser scenarios pass;
  live Mac Fleet/Settings and iPhone/iPad simulator views were inspected.
  [Audit](../ui-review.md#shared-ui-and-native-audit--september-22-2026),
  [gallery](../screenshots/visual-audit/README.md),
  [release and rollback](../operations/visual-audit.md).
- **Fleet**: compact header and single-line desktop rows, OS/action icons, and
  immediate cached return with filters, selection and scroll preserved. Static
  layout and cached navigation remain in place. The pane release adds row-wide
  activation, a non-modal pane with 180 ms entrance, and persistent row context
  without blur. Desktop/mobile UI and live CPU-cell activation passed; backend
  process/environment were preserved. [Pane details](../operations/fleet-row-pane.md).
  Prior Safari, responsive layouts and slow/error refresh remain verified. [Details](../operations/compact-fleet.md) and
  [screenshots](../screenshots/compact-fleet/README.md).
- **Desktop 0.2.3**: all seven Windows, Mac and Linux packages are published with
  automatic update feeds. Checks run after launch/every six hours; downloads
  install on quit. Help offers a manual check/restart. Existing 0.2.2 clients
  require one installer upgrade. Both Mac architectures are signed, provisioned,
  notarized and stapled. A real isolated Mac upgrade/relaunch passed. Windows is
  unsigned; full Windows/Linux updater installation and Intel execution remain
  unverified. [Update operations](../operations/desktop-updates.md).
- **iPhone/iPad 0.1.3 (6)**: VALID and IN_BETA_TESTING for the existing Speck testing
  group, including current main's headless Linux web-shell routing. Twenty-five
  native units and iPad portrait/landscape sign-in pass locally. Physical
  biometric/provider sync, audio and older OS qualification remain open.
- **Server/web**: 77 Python and 24 web tests pass for the cleanup release, plus
  server Ruff and TypeScript/Vite. The previous 14 desktop checks remain recorded.
  Live disposable
  credential acceptance verified signatures, replay rejection, role restrictions,
  revocation, one-time desktop handoff and password fallback. Responsive UI was
  reviewed and the [passkey gallery](../screenshots/passkeys/README.md) records it.

The passkey backend rollout from `8ae506b` retained matching database, environment,
code and Python-environment backups. Subsequent UI releases were static-only;
the restore-cleanup release also updated and restarted the backend after a
consistent database/runtime/configuration backup. Existing login, agents, installation tokens,
original/restore identities, Slide bindings, provider secrets and recovery records
were verified preserved. Private evidence and rollback records: `output/passkeys/`.
Endpoint agents now run 0.3.1 and retain their unattended service credentials.

Existing management/recovery capabilities and qualification limits are documented
in [MVP review](../MVP-REVIEW.md), [management rollout](../operations/management-rollout.md),
[desktop quality](../desktop-quality.md), [iOS quality](../ios-quality.md), and
[session startup](../operations/session-startup.md). Windows selected-patch/MSI
acceptance, remaining native media/platform tests and broader recovery qualification
are still open. This passkey work did not launch new recoveries, install patches,
deploy endpoint software or clean up existing recovery resources.

## Headless web shell and automatic agent updates — live

Server/agent source `0a09f6b` and combined web source `8ba0f74` are deployed. The
web integrates `5d1e39d` with main's app-title fix. Both headless Linux
screen actions open the PTY web shell; Windows retains RDP. Live Unicode, resize,
Ctrl+C, reconnect and Windows desktop rendering pass. Screen-reader mode is
optional to preserve normal insert-text/emoji input.

Signed automatic updates are enabled; admins can pause them in Settings. All five
originals bootstrapped the updater and then upgraded themselves to 0.3.1. Services,
Windows helpers, signed binary hashes, retained backups and unchanged enrollment
files were verified. Original/clone IDs, accounts, credentials, provider settings,
recovery records and environment remain unchanged.

113 backend, 28 web unit and 84 browser checks, Linux race/PTY/transaction tests,
all platform builds and the iOS simulator build pass. ARM64 runtime and physical
iOS/graphical Linux acceptance remain open. Matching full rollback:
`/var/lib/speck-rollback/20260922T232347Z-agent-updates-0a09f6b`.
See [web shell](../operations/web-shell.md),
[agent update operations](../operations/agent-updates.md) and ignored
`output/agent-updates/` in the headless-webshell worktree for exact evidence.
GitHub integration is coordinated by `codex/app-name-release-sync`; future signed
agent releases use the documented publisher.

The later shell deployment temporarily replaced the app-title fix with its older
executable-first code. Combined web `8ba0f74` restored it, retaining the shell and
updater. Safari Fleet visibly shows the three Windows titles and Linux web-shell
actions after reload. Build, 28 web checks and 22 focused Chrome/Safari browser
checks pass; served hashes, backend process/environment and identities match.
Static rollback: `/var/lib/speck-rollback/20260922T233949Z-app-name-release-sync-8ba0f74/web`.
Private evidence: `worktrees/app-name-release-sync/output/app-name-release-sync/`.

Release validation now prefers local checks at the user's request:
`./scripts/check-local.sh core` (112s: 113 backend, agent race tests/builds, 28 web
units, 84 browser cases) and `./scripts/check-local.sh ios` (36s: 25 iPhone units
and the iPad portrait/landscape sign-in test), both passed on this combined source.
Hosted CI remains enabled as a secondary check. Its iPad simulator launch timeout
occurred before assertions; local Xcode 27/iOS 27 passed the same test target.
No required GitHub branch check was bypassed. See [local checks](../deployment.md#local-release-checks).

Desktop Downloads now serves 0.2.3 from static source `2b01150`; its live index is
`383ed5a0…`. Served hashes, desktop/phone layout, service process and environment
were checked. The preceding static tree is retained under
`/var/lib/speck-rollback/20260923T004907Z-client-updates-2b01150/web`.


## Slide Chat integration — live September 23

Runtime `682fc0d` adds Settings → Slide Chat and an expiring, revocable, hashed
read-only token limited to one named Site. Connect it in Chat → Connections →
Speck RMM and explicitly select the matching Slide client. Inventory/health,
volumes, services, open alerts and existing patch reports are available; commands,
remote sessions and recovery writes are not. Site changes/archive, expiry,
revocation and creator-account restrictions are enforced by Speck on every read.

120 backend, 28 web unit and 90 Chromium/WebKit scenarios, Ruff and the web build
pass. Both public applications passed temporary end-to-end connector/companion
reads and isolation/revocation acceptance. All QA access was cleaned up. Existing
fleet assignments, identities, accounts, credentials, provider settings, updater
policy and recovery resources were preserved. Rollback and detailed checks are in
[Chat integration operations](../operations/chat-integration.md).
