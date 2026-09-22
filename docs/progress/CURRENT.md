# Current state — September 22, 2026

Speck is live at https://speckrmm.com with management MVP, native iPhone/iPad,
remote-session startup fixes and **passkey sign-in**. Enroll in Settings → Account
& access, or Account → Passkeys on iOS. Password/authenticator login remains
available. See [passkeys](../passkeys.md) for recovery and self-hosted setup.

- **Desktop 0.2.2**: published Mac, Windows and Linux downloads. Mac builds include
  their required provisioning profile, Developer ID signature, notarization and
  staples. Apple silicon launch, retained login, browser handoff and cancellation
  passed. Windows remains unsigned; Linux desktop and Intel Mac runtime checks,
  and physical passkey provider ceremonies, remain open.
- **iPhone/iPad 0.1.1 (4)**: VALID and IN_BETA_TESTING for the existing Speck testing
  group. Twenty-five native unit tests pass. Associated domains and server/RP
  binding are verified. Physical Face ID/Touch ID/provider sync, audio and older
  iOS qualification remain device acceptance work. Build 3 is withdrawn/expired.
- **Server/web**: 57 Python, 24 web and 14 desktop tests pass. Live disposable
  credential acceptance verified signatures, replay rejection, role restrictions,
  revocation, one-time desktop handoff and password fallback. Responsive UI was
  reviewed and the [passkey gallery](../screenshots/passkeys/README.md) records it.

The passkey backend rollout from `8ae506b` retained matching database, environment,
code and Python-environment backups. Subsequent web releases are static-only and
preserve the running backend process. Existing login, agents, installation tokens,
original/restore identities, Slide bindings, provider secrets and recovery records
were verified preserved. Private evidence and rollback records: `output/passkeys/`.
Endpoint agents remain 0.2.0 and use unattended service credentials.

Existing management/recovery capabilities and qualification limits are documented
in [MVP review](../MVP-REVIEW.md), [management rollout](../operations/management-rollout.md),
[desktop quality](../desktop-quality.md), [iOS quality](../ios-quality.md), and
[session startup](../operations/session-startup.md). Windows selected-patch/MSI
acceptance, remaining native media/platform tests and broader recovery qualification
are still open. This passkey work did not launch new recoveries, install patches,
deploy endpoint software or clean up existing recovery resources.
