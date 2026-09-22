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
