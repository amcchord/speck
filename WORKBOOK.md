# Speck working record

Branch: `codex/initial-speck`. Independent Windows/Linux RMM repository.

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
- A real multi-machine application recovery run is in progress. Do not describe
  it as passed until its application report is complete.

Private deployment state, lab identifiers and operator scripts are in ignored
`output/`. Credentials live in the local operator vault and deployed secret
stores, never in source. Read `docs/security.md` for the initial release's limits.

## Next action

Complete the live recovery drill, inspect the resulting machines and application
proof, then finalize the public repository and deployment record.
