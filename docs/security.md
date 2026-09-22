# Security model

Speck is a single-administrator control plane with privileged endpoint agents.
An administrator can execute commands with the agent service's privileges,
read/write endpoint files, and access configured remote sessions. It is intended
for a controlled lab or small trusted deployment, not as a multi-tenant MSP
security boundary. MFA, per-device RBAC, SSO, approval queues, signed automatic
agent updates and an external security review are not implemented yet.

- Passwords are hashed with Argon2id. Bootstrap only creates the first account.
- Browser sessions use random opaque tokens, stored hashed in SQLite, with a
  12-hour lifetime and HttpOnly/Secure/SameSite=Strict cookies under HTTPS.
- State-changing browser requests require the configured Origin and CSRF token.
  Browser WebSocket sessions require the same Origin, cookie and session owner.
- Login attempts are rate limited. Run behind a reverse proxy on loopback and
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
- Remote sessions are bound to one administrator and one device, single-use at
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
