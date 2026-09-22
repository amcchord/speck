# Current state — September 22, 2026

Speck is live at https://speckrmm.com with management MVP, native iPhone/iPad,
remote-session startup fixes and **passkey sign-in**. Enroll in Settings → Account
& access, or Account → Passkeys on iOS. Password/authenticator login remains
available. See [passkeys](../passkeys.md) for recovery and self-hosted setup.

- **Preview and desktop presence**: previews recover from timeouts and retain one
  encrypted checkpoint every five minutes. All five original agents run 0.2.2.
  The open pane refreshes user/desktop/app details; disconnected users and the last
  app stay explicit. Fleet displays taskbar/window titles for current and last apps,
  with executable fallback, and searches both names (web runtime `6420df3`).
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
- **Desktop 0.2.2**: published Mac, Windows and Linux downloads. Mac builds include
  their required provisioning profile, Developer ID signature, notarization and
  staples. Apple silicon launch, retained login, browser handoff and cancellation
  passed. Windows remains unsigned; Linux desktop and Intel Mac runtime checks,
  and physical passkey provider ceremonies, remain open.
- **iPhone/iPad 0.1.2 (5)**: VALID and IN_BETA_TESTING for the existing Speck testing
  group. Twenty-five native unit tests pass. Associated domains and server/RP
  binding are verified. Physical Face ID/Touch ID/provider sync, audio and older
  iOS qualification remain device acceptance work. Build 3 is withdrawn/expired.
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
Endpoint agents now run 0.2.2 and retain their unattended service credentials.

Existing management/recovery capabilities and qualification limits are documented
in [MVP review](../MVP-REVIEW.md), [management rollout](../operations/management-rollout.md),
[desktop quality](../desktop-quality.md), [iOS quality](../ios-quality.md), and
[session startup](../operations/session-startup.md). Windows selected-patch/MSI
acceptance, remaining native media/platform tests and broader recovery qualification
are still open. This passkey work did not launch new recoveries, install patches,
deploy endpoint software or clean up existing recovery resources.

## Authorized rollout: headless web shell and automatic updates

`codex/headless-webshell` in `worktrees/headless-webshell` adds automatic Linux
web-shell routing and signed Windows/Linux agent updates in 0.3.1. Based on main
`b6dfb32`. User authorized deployment. Source and local protocol/rollback/browser
checks are complete; a live remote session defers the server restart. Next: take
a matching runtime/database backup, deploy server/web/downloads, then canary
Linux/Windows before bootstrapping the fleet. No endpoint identities will change.
See [web shell](../operations/web-shell.md) and
[agent update operations](../operations/agent-updates.md).
