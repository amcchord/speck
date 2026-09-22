# Security model

Speck is a single-organization control plane with privileged endpoint agents.
Administrators and operators can execute commands with the agent service's privileges,
read/write endpoint files, and access configured remote sessions. It is intended
for a controlled lab or small trusted deployment, not as a multi-tenant MSP
security boundary. Admin/operator/viewer roles and optional authenticator MFA are
implemented; roles apply across the organization. Per-device RBAC, SSO, mandatory
MFA, general approval queues, signed automatic agent updates and an external
security review remain follow-ups. See [account controls](management.md).

- Passwords are hashed with Argon2id. Bootstrap only creates the first account.
- Browser sessions use random opaque tokens, stored hashed in SQLite, with a
  12-hour lifetime and HttpOnly/Secure/SameSite=Strict cookies under HTTPS.
- State-changing browser requests require the configured Origin and CSRF token.
  Browser WebSocket sessions require the same Origin, cookie and session owner.
- Login attempts are rate limited per IP and account. Run behind a reverse proxy on loopback and
  trust proxy headers only from that proxy.
- Enrollment tokens expire in 15 minutes and can be used once. Agent tokens are
  random and stored hashed on the server. Endpoint configuration is restricted
  to Administrators/SYSTEM or root. The session observer cannot read credentials.
- Remote credentials, Slide tokens, job payloads and recovery plan commands are
  encrypted with Fernet using a key derived from `SPECK_ENCRYPTION_KEY`.
  Telemetry, results and audit entries are not encrypted inside SQLite. Protect
  the server, its backups, and the encryption key accordingly.
- Each job belongs to one device and uses a separate lease secret. The agent
  persists a marker before executing it. Unknown outcomes are not replayed.
- A copied installation token plus a changed hardware ID creates an unapproved
  recovery candidate. Hardware identity is a collision-avoidance measure, not
  cryptographic attestation. An attacker controlling an enrolled machine can
  imitate that installation's hardware identifiers.
- Remote sessions are bound to one authorized operator account and one device, single-use at
  the browser side, and capped at two hours. Logging out closes that user's
  active sessions. Clipboard text is transferred only within the session.
- The native RDP file contains no password. It connects directly and therefore
  needs network access outside Speck's outbound relay.
- Transfer objects are private to authenticated operators and the target agent.
  Files are hash checked; endpoint uploads preserve existing files by default.
  Transfer objects remain on the server until an operator removes them. Monitor
  disk usage; this release does not implement retention or per-user quotas.

Keep `guacd`, SQLite and the HTTP application private to the server. Expose only
HTTPS, optional HTTP for certificate issuance, and administrator SSH. Never
expose port 4822. Do not put credentials in repository files or command arguments.

A compromised RMM server has administrative reach to its enrolled fleet. Keep
its operating system and dependencies patched, limit operator access, and back
up its state and encryption key separately.

## Fleet operations and native client

Bulk operations validate all targets before enqueueing; idempotency keys bind the
exact request body. Template values are shell quoted, scripts are encrypted, and
per-device jobs retain the existing lease/journal rules. Failed or uncertain
operations do not automatically replay. Updates never request a reboot.

Live previews are opt-in per device, require an approved identity, and are kept
only in server memory for 45 seconds. Disabling a preview purges it immediately.
Interactive helpers honor a 30-second permission lease and never receive agent
credentials. User-session telemetry is not cryptographically attested.

AI drafts cannot enqueue jobs. Screen assistance requires explicit invocation,
review and application. Server code bounds actions and honors pending provider
safety checks. Screens and telemetry remain untrusted input. Review proposed
commands and UI actions; model instructions are not a security boundary.

Speck Desktop disables Node integration, enables renderer sandboxing and context
isolation, pins navigation to the exact Speck HTTPS origin, and validates native
IPC against the top frame, remote route and window focus. Its exposed native
surface is bounded plain-text clipboard access and key-macro events, not shell or
filesystem access. Shared clipboard is off until enabled in each session. The
application has no password-bearing deep links and never skips TLS validation.
See [operations](operations.md) for preview-build and platform verification limits.

## Management authorization and rollback

Viewer accounts can read inventory, alerts and audit, and manage their own account.
They cannot access remote sessions, previews, files, scripts or command output.
Only admins manage accounts and provider credentials. Disabling an account or
changing its role revokes its sessions and closes remote connections.

TOTP secrets are encrypted with the server key; recovery codes are hashed, single
use and never audited in plaintext. MFA is opt-in; deployments must decide their
operator enrollment and account-recovery policy. Accepted TOTP steps cannot replay.

Archive stops management while retaining device/clone identities and history.
Installation revocation requires confirmation of every shared original/restored
instance. Schedules pin reviewed targets and template revisions, skip missed or
unavailable targets, and never automatically replay uncertain work.

Rollback to pre-role code requires its matching database snapshot: old code does
not enforce these roles. Preserve data, transfers and encryption keys together,
and account for any jobs/provider changes since the snapshot before restoration.
