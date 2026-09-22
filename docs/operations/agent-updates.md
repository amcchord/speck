# Automatic agent updates

Agent 0.3.1 adds automatic updates for Linux amd64/arm64 (systemd) and Windows
amd64, including the Windows desktop helper. It also includes the
[headless web shell](web-shell.md). Operator desktop applications and iOS follow
their existing release process; OS patches remain separately reviewed operations.

## What operators see

Updates are enabled by default. Admins can pause future installs in Settings →
Automatic updates; a claimed installation already in progress finishes. Agents
check after 30–90 seconds at startup and every 10–15 minutes thereafter. Active
jobs and remote sessions defer installation. New remote connections during an
update receive a short retry message; queued commands wait for the update lease.

A separate privileged helper backs up both executables on Windows (the agent on
Linux), stops only Speck services/helpers, installs verified bytes and restarts
the service. A successful authenticated, approved check-in must arrive within
90 seconds. Otherwise it attempts to restore the previous binaries and start the
old service. No reboot, reenrollment or configuration rewrite is performed.
Windows observers restart in existing interactive sessions with limited tokens;
Linux observers use the new binary at their next sign-in.

A failed version is not retried automatically; a later release can be installed.
Audit records and `/api/agent-updates` expose installation/current/failure states.
Binary recovery errors are recorded separately as `rollback_failed`; any failed
update warrants checking the service and its retained backup. A killed updater
cannot reserve job polling indefinitely: server/local update holds expire after
five minutes. Power loss during replacement may still need operator recovery.

## Publishing a release

1. Change `agent.Version`, run validation, and commit the intended release.
   Windows resource versions are generated from that value.
2. Run `GOWORK=off ./scripts/build.sh` from the committed tree.
3. On the signing workstation run:
   ```sh
   .venv/bin/python scripts/sign_agent_release.py --version 0.3.1 --key-file /protected/release-seed-base64
   ```
   The optional `--vault` reads the dedicated local `speck-agent-release-signing`
   AustinLand key in memory. Never send the private seed to the RMM server.
4. Publish the immutable `output/downloads/agent-releases/<version>/` directory
   first, then atomically replace `agent-releases/current.json` under the server's
   `SPECK_DOWNLOAD_DIR`. Preserve older version directories for in-flight downloads.
   Also publish the regular installers, binary names and `SHA256SUMS` for new
   installations. Verify checksums and HTTPS health after publication.
5. Bootstrap older agents with the current installer once. Preserve their config
   and machine identity. Canary one machine per platform before a fleet rollout.

The signer refuses to replace a version's binaries with different bytes. Release
manifests expire after 30 days; rerun the signer for the same immutable assets to
renew availability for machines that were offline, or publish the next version.
Agents reject older/equal versions, signatures from other keys, unsupported
platforms, unexpected files, expired manifests, oversized data and incorrect
hashes. Downloads stay on the configured server origin and never follow redirects.

Self-hosters generate their own Ed25519 seed and configure its base64 raw public
key as `SPECK_AGENT_UPDATE_PUBLIC_KEY`. New enrollments pin that public key. For
already enrolled agents, deploy the same public key in the protected agent JSON's
`update_public_key` field through an existing trusted administration channel.
Changing the server key alone cannot rotate existing agents' trust. The private
key and bootstrap transport remain the operator's responsibility.

## Recovery and rollback

Protected `.speck-update-*` directories beside the installed agent retain the
plan and `.previous` binaries. `update-state.json` beside `agent.json` records the
release and staging path; it contains no enrollment token. Retain the latest
known-good backup and remove older stages only after verifying fleet health.
Storage retention is manual in this release.

Pause automatic updates before manually restoring a failed agent. Stop
`SpeckAgent`, restore the `.previous` executables (or rerun a verified installer),
restore normal executable permissions, then start the service. Preserve
`agent.json`; do not reenroll. Inspect the state and service before clearing a
failed marker. Never restore a config copied from a different machine.

Backend rollback uses the matching database, server/web, downloads and environment
snapshot retained during release. The migration adds only the update-state table;
existing installations, encrypted settings, jobs and device identities are retained.

## Validation

Signature/target/version/expiry/size/hash rejection tests and real temporary-file
transactions cover successful commit, missing/wrong check-in, failed service start,
failed helper stop and partial replacement rollback. Backend tests cover CSRF and
admin boundaries, clone/revocation rejection, pause, busy jobs/sessions, atomic
update/job leases, confirmed completion and suppression of a failed release.
Chromium/WebKit exercise pause/resume and persistence at desktop/mobile sizes.

## September 22 rollout

Server and agent source `0a09f6b` is deployed; final console source is `5d1e39d`.
The release followed a consistent runtime/configuration/database backup:
`/var/lib/speck-rollback/20260922T232347Z-agent-updates-0a09f6b`. The prior web tree
for the final static correction is retained at
`/var/lib/speck-rollback/20260922T233544Z-shell-controls-5d1e39d/web`.

One Linux and one Windows original were canaries. All five originals (two Linux
amd64 and three Windows amd64) then received the updater bootstrap built from
the same source with version 0.3.0. Each fetched the signed 0.3.1 release, claimed
an idle lease, replaced its own binaries and confirmed a new authenticated check-in.
The audit contains five `agent_update.started` and five `agent_update.current`
events. No failure was recorded. The temporary bootstrap downloads were removed.

On every endpoint, final binary hashes match the signed release, the service runs,
the previous binary remains available and the enrollment file hash is unchanged.
Windows helpers run in user sessions and retain ordinary-user executable access.
Both Linux screen actions and Windows RDP passed live browser acceptance.
The pause/resume settings flow passed Chromium/WebKit desktop/mobile checks.

113 backend tests, 28 web unit tests, 84 browser scenarios, Linux race/real-PTY
and staged-transaction tests, all agent/helper cross-builds and the earlier iOS
simulator build pass. Linux arm64 is build-tested, not tested on a live ARM host.
Automatic rollback failures were exercised in isolated tests, not by publishing
a deliberately broken production release. Existing identity/account/provider/
recovery/environment hashes and SQLite integrity match the pre-release snapshot.
Private proof lives in `output/agent-updates/` in the task worktree.
