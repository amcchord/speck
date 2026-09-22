# Reliable desktop previews

Preview capture now runs in a disposable unprivileged child process, killed after
eight seconds if its display API stalls. Foreground reporting continues separately.
Windows checks that its session is connected and its input desktop is unlocked
before entering GDI capture. A disconnected RDP desktop cannot supply new frames.
Helpers report bounded status codes, and Windows installer upgrades restart the
observer for users already signed in without requesting their passwords.

The first accepted frame is encrypted and stored immediately. Subsequent frames
replace this one checkpoint at most every 300 seconds. The live frame expires at
45 seconds; the checkpoint survives server restarts and remains available offline
with its capture timestamp. The capture and upload loops run independently of any
browser. There is no screenshot history. Old/out-of-order uploads cannot replace a
newer frame. A machine without a supported, previously active desktop has no image.

The UI shows Live or Last saved and the original time, explains unavailable
sessions/helpers and retries network failures. Requests time out after eight
seconds and are cancelled. The loading logo is excluded when checking for a real
preview image. Policy-off immediately hides images and discards pending responses.
Saved images are removed when disabling previews, archiving a device or revoking
an installation, including automatic restore cleanup. New clone identities remain
off by default and viewer accounts still cannot read images.

## Verification and release

Automated backend coverage includes checkpoint cadence/encryption, simulated
restart/offline fallback, out-of-order uploads, capture reporting, role checks,
policy removal, archive/revoke removal and a retirement/upload race. The integrated
backend suite includes the previously deployed restore-cleanup tests.

Windows and Linux process tests exercise a deliberately hung child, forced
termination and a subsequent successful child, plus expired/disabled leases.
Chromium/WebKit checks cover saved images, failed refresh preservation, initial
request timeout/recovery, disabling during a request, desktop recovery guidance
and responsive layout. Live release evidence and rollback paths are recorded in
the deployment entry below and in ignored `output/preview-reliability/`.

Linux headless/Wayland environments cannot provide a desktop preview; Linux X11
capture needs a signed-in helper. Automated capture-process tests on Linux do not
claim graphical X11 acceptance. Old endpoint agents can still upload previews
and benefit from durable checkpoints, but need agent 0.2.2 for capture isolation
and detailed status reports. The operator desktop app is a separate package.

## Desktop presence and last app

Agent 0.2.2 refreshes desktop metadata on each 15-second heartbeat rather than
waiting for the slower inventory collection. Windows signed-in users come from
Terminal Services session enumeration, independently of foreground-window capture;
disconnected users remain signed in. Linux uses logind sessions with login records as a fallback. The helper
reports desktop availability independently and atomically writes app observations.
A disconnected/locked or stale helper cannot label an old app current. The last
observed app remains available with its original timestamp. Session telemetry is
still local, unprivileged observation, not cryptographic attestation.

The open machine pane no longer suspends Fleet polling. Health, user, desktop,
app and report time refresh in place every 15 seconds; the image and preview toggle
are preserved. The Fleet app column prefixes historical values with “Last:”.
A missing foreground window does not imply there is no signed-in user or desktop.
An unavailable connected desktop is labeled “locked or unavailable”, since session
connection alone cannot distinguish every lock/display/helper condition.

## Production rollout — September 22, 2026

The server/checkpoint rollout used `adc694d`, with database, configuration, code,
web and download backups at
`/var/lib/speck-rollback/20260922T220446Z-preview-adc694d`.
Preflight found no active jobs, recovery runs or remote sessions. Database
integrity, device/installation identities, accounts, provider settings, recovery
records, preview policies and environment fingerprints matched afterward.

The user/desktop/app follow-up deployed static runtime `4089388` and agent 0.2.2;
Linux session discovery follows `c175646`. The second web/download rollback is
`/var/lib/speck-rollback/20260922T222329Z-presence-4089388`.
This follow-up preserved the backend process and environment. All 33 published
web/agent files matched their built bytes; Linux binaries/manifests were then
updated for logind discovery. All five original agents are online on 0.2.2 and
retain their enrollment identities. Endpoint rollback binaries remain in their
private `preview-20260922` rollback directories.

Live WebKit acceptance verified capture on all three Windows originals, signed-in
users independent of foreground reporting, the current app, and a transition to
disconnected users and a timestamped last app in the still-open pane. The exam
machine passed a full five-minute checkpoint advance and saved fallback after
disconnect. All three saved JPEGs could also be decrypted/read in an independent
server process with empty live memory. Linux originals report no signed-in
sessions instead of treating an absent utmp file as unknown. Linux graphical
capture remains unverified on these headless hosts.

Final checks: 82 backend tests, Ruff, 28 web unit tests, 72 Chromium/WebKit UI
scenarios, seven Linux Go tests and four Windows Go tests, Windows/Linux builds
and GitHub checks. One verification tunnel interrupted by an early agent upgrade
was explicitly recorded as unknown after confirming no live remote session;
no user session was terminated. Verification remote sessions were closed and
verification logins signed out. Private evidence is in the task worktree's
`output/preview-reliability/`; public screenshots use synthetic fixtures only.

For rollback, restore the backed-up web/download tree and prior endpoint binaries.
Rolling back the backend additionally requires its matching database/configuration
snapshot and a maintenance preflight. Preserve the encryption key: saved previews
use the same protected server key as existing private settings.
