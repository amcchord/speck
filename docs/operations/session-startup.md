# Loading and first-screen readiness

## Behavior

The shared brand loader appears before authentication completes and during Fleet,
Alerts, Schedules, Patches, Software & scripts, AI, Recovery, Slide, Activity,
Settings, Account and Job history requests. Machine details, patch inventory,
file transfers, live previews and operation progress use the same component.
It announces status to assistive technology and respects reduced motion.
Failed page requests show an error; Refresh retries. Navigation invalidates older
responses so they cannot repaint a newer page. Detached machine tabs ignore
late patch/transfer responses.

Remote startup shows progress until a frame has actually rendered. Desktop
readiness requires visible pixels, excluding the separate pointer layer; SSH
accepts a flushed terminal frame. A connected but blank desktop receives one
button-free pointer movement after two foreground seconds. After twelve
foreground seconds it reconnects once, provided the operator has not sent input.
A second stall shows explicit Reconnect / Show current screen controls. A toolbar
Reconnect button is also available. Background time does not consume this budget;
leaving the view cancels it. A deliberately black desktop can be shown manually.

Safari and iOS WebKit use Guacamole's Image/DataURI decoder. The bundled
ImageBitmap path does not handle a rejected decode promise, which can block all
later frames. The Image path unblocks on both load and error. This adapter is
scoped to each display; Chromium/native Electron retain their existing decoder.
No dependency internals, Windows power settings, credentials, agent binaries,
RDP resolution negotiation or server settings are changed.

## Verification

- 18 web tests (including first-frame timeout, bounded retry, background,
  operator-input and cancellation cases); 10 desktop tests; 35 Python tests;
  Ruff and TypeScript/Vite pass.
- Native Safari: intentionally corrupt image followed by valid image rendered
  successfully while ImageBitmap was forced to reject. Fixture retained at
  `web/test/fixtures/decoder.html`; run the Vite dev server and open
  `/test/fixtures/decoder.html` in Safari to repeat. It is excluded from production.
- Three-second synthetic API latency: desktop/mobile loaders, failures, refresh,
  page navigation and machine-tab switching checked. Prior delayed responses did
  not replace newer content. [Screenshots](../screenshots/loading/README.md).
- The user's intermittent live black screen was not reproduced consistently in
  foreground Safari before this change. The decoder failure is independently
  demonstrated; do not treat it as proof of every black-screen cause.

Deployment and live acceptance are recorded in the progress journal. The static
rollout retains the preceding web tree for rollback and does not restart services.
