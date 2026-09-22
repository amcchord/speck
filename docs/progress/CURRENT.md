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

The separate MVP review task is implementing alerts, schedules, endpoint lifecycle,
roles/TOTP and audit improvements in `worktrees/mvp-review` on `codex/mvp-review`.
It has not deployed a backend update. Coordinate before any shared live restart.
