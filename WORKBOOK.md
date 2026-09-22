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
- A real three-machine Slide recovery test passed on a local appliance: Windows
  server, Windows front desk, and Linux PBX. Fresh restored instances matched
  their provider hardware identities and were approved separately.
- Application evidence matched the originals: 240 synthetic charts, 660
  appointments, 105 imaging studies and 210 image files; database integrity,
  complete row/file hashes, front-desk API calls, and PBX service/configuration.
- Restored Windows startup and static networking were tested. A sample address
  script includes automatic DHCP rollback if its health check fails.
- Browser mouse and keyboard operated the live Windows imaging application.
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
