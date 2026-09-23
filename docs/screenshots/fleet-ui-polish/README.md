# Fleet UI polish — September 23, 2026

Original WebKit screenshots of the built console using synthetic local fixtures.
No production data or remote endpoint actions. Digests and fixture provenance are
in [manifest.json](manifest.json).

- [Column selector, desktop](columns-desktop.png)
- [Optional width controls](columns-widths.png)
- [Column selector, phone](columns-mobile.png)
- [Width controls at 320px](columns-320-widths.png)
- [Machine flyout padding](machine-flyout.png)

The selector keeps its heading and Save/Cancel footer visible while the list
scrolls. Handles support mouse, touch and keyboard reordering; Escape cancels an
active drag. Widths are optional, visibility is explicit, and changes remain a
draft until saved. Reset restores column defaults without changing Fleet sorting
or agent highlighting.

Validation: TypeScript/Vite build, 28 web unit tests, 119 Chromium/WebKit browser
tests. The additional Chromium touch-input test passes; its WebKit copy is skipped
because that input protocol is Chromium-only. Physical iOS touch is unverified.
Desktop, phone and 320px screenshots were visually inspected.

Reproduce with `npm run build --prefix web` and `npm run test:ui --prefix web`.
The focused UI files are `unified-fleet.spec.mjs` and `machine-overview.spec.mjs`.
