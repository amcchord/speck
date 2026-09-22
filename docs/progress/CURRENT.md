# Current state

Speck 0.2 remains live at https://speckrmm.com. Desktop 0.2.1 fixes native
clipboard, shortcuts, fullscreen, browser handoff and microphone lifecycle bugs.
See [desktop qualification](../desktop-quality.md) for the platform matrix.

macOS Apple silicon and Windows 11 clients were tested interactively. Both Mac
architectures are Developer ID signed, notarized and stapled. Linux packages pass
CI, but native Linux desktop/Intel Mac runtime tests and physical microphone
qualification remain open. Windows packages are still unsigned.

Static remote UI changes were deployed without restarting the backend. Original
agents remain 0.2.0; Slide links, original/clone identities, retained restores and
backups are preserved. Private QA and release evidence: `output/desktop-quality/`.

The MVP review is implemented in `worktrees/mvp-review` on `codex/mvp-review`:
alerts/policies, scheduled scans/templates, endpoint lifecycle, roles/TOTP and
filtered audit. Parent main `2a4068a` is integrated. Local combined checks passed
35 Python, 7 microphone and 10 desktop tests plus Ruff and TypeScript/Vite.
See [review](../MVP-REVIEW.md), [management guide](../management.md) and the
[synthetic gallery](../screenshots/mvp-review/README.md).

The management backend is not deployed. Next: review the focused PR and its CI,
then coordinate a backed-up deployment and disposable Windows/Linux acceptance.
Original lab agents and Slide resources remain unchanged by this review.
