# Current state

Speck 0.2 remains live at https://speckrmm.com. Desktop 0.2.1 fixes native
clipboard, shortcuts, fullscreen, browser handoff and microphone lifecycle bugs.
See [desktop qualification](../desktop-quality.md) for the platform matrix.

macOS Apple silicon and Windows 11 clients were tested interactively. Both Mac
architectures are Developer ID signed, notarized and stapled. Linux packages pass
CI, but native Linux desktop/Intel Mac runtime tests and physical microphone
qualification remain open. Windows packages are still unsigned.

Desktop 0.2.1 static remote UI changes preceded the management rollout. Original
agents remain 0.2.0; Slide links, original/clone identities, retained restores and
backups are preserved. Private QA and release evidence: `output/desktop-quality/`.

The management MVP is now deployed from `92831ae` (September 22): alerts/policies,
scheduled scans/templates, endpoint lifecycle, roles/TOTP and filtered audit.
Existing login and all original/restored identities and Slide bindings survived.
Scheduled native scans passed on Windows and Linux; disposable live identities
verified role/MFA/session, alert/recovery and lifecycle controls. No QA schedule
is active; QA accounts are disabled and installation credentials revoked.

Safari selects now use consistent control styling with native menus and keyboard
navigation. Fixed the malformed Ctrl + Alt + Del option. Native Safari fleet and
connected remote-toolbar visual checks passed. Local checks: 35 Python, 7 microphone,
10 desktop tests, Ruff and TypeScript/Vite; GitHub checks passed.

See [review](../MVP-REVIEW.md), [management guide](../management.md),
[rollout](../operations/management-rollout.md) and the
[synthetic gallery](../screenshots/mvp-review/README.md). Private rollout evidence:
`output/mvp-review/`. Coordinated desktop-download and iOS tasks continue separately.

Next: finish Windows selected-patch/MSI acceptance and the remaining recovery and
native platform qualification matrix before claiming broader production readiness.

Desktop client downloads are live at https://speckrmm.com/#downloads, available
from the sidebar, sign-in, Settings and desktop handoff. The page links the
published 0.2.1 Windows, macOS and Linux packages. See the
[download gallery](../screenshots/downloads/README.md). This was a static-only
rollout after the MVP release, preserving its authentication and Safari fixes.

The September 22 static update from `8b83c7f` is live: shared loading states,
stale-response protection, Safari/WebKit decoding and first-screen recovery.
Native Safari Windows 11/Server 2025/restored front-desk connections, reconnect,
fullscreen and key macros passed; Chromium RDP and Linux SSH still work. Forced
image-decode failure and delayed/error API checks passed. No backend restart or
agent/configuration change. See [startup notes](../operations/session-startup.md)
and [loading screenshots](../screenshots/loading/README.md). Private release and
rollback evidence: `output/windows-session-start/`.

Native iOS work adds the universal iPhone/iPad operator client and mobile remote
keyboard. The screenshot-driven UI review and live Windows/Linux acceptance are
recorded in [iOS qualification](../ios-quality.md), with a
[28-image native gallery](../screenshots/ios/README.md). App Store Connect is set up;
consult that report for the current TestFlight build/distribution state. Physical
mobile audio, older iOS versions and long-running background checks remain open.
