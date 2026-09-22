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
