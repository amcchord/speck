# Fleet toolbar and headers — September 23, 2026

Original WebKit captures from synthetic local fixtures; no customer inventory.
Digests and fixture provenance are in [manifest.json](manifest.json).

- [Desktop toolbar](toolbar-desktop.png)
- [Filters and active chips](filters-desktop.png)
- [Phone toolbar](toolbar-phone.png)
- [Phone View options](view-phone.png)
- [320px layout](toolbar-320.png)

Search and the saved Speck agents only switch remain visible. Filters groups
status, operating system and other agent coverage choices; View groups columns,
highlighting, previews and sorting. Active advanced filters have removable chips.
Desktop table headers sort on click and reorder on drag or Alt+Left/Right.

All five layouts were inspected. Local TypeScript/Vite, Ruff, 157 backend tests,
28 web units and 141 Chromium/WebKit scenarios pass. One existing Chromium-only
touch-input test has its WebKit copy skipped. Physical-device touch is unverified.
Reproduce with `npm run build --prefix web` and `npm run test:ui --prefix web`.
