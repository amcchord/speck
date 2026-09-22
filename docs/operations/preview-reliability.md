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
and benefit from durable checkpoints, but need agent 0.2.1 for capture isolation
and detailed status reports. The operator desktop app is a separate package.
