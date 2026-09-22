# Compact machine overview

Branch `codex/machine-overview`, based on main `290ed31`, changes the hosted
console's individual machine pane. Runtime source `37105be` is deployed at
https://speckrmm.com. No server, native package or endpoint-agent change was
required for this layout. Source and release records remain on the local branch;
GitHub main has not yet incorporated this change.

The generic “Machine details” heading is replaced with the machine name and
explicit Online/Offline state. The compact summary shows copyable IP, operating
system/version, uptime and last report, followed by existing connection and edit
actions. Review and archive labels remain separate from connectivity. IPv4 is
preferred, with IPv6 fallback; loopback/unspecified addresses are excluded and
usable addresses are preferred over link-local addresses.

The preview has a fixed 16:9 area in off, loading, waiting, image and failure
states. Images are contained without cropping or stretching. Preview help is
available in a disclosure. Failure stays within the preview and does not remove
machine telemetry. Existing policy/role checks remain; detached policy controls
cannot reset a newer pane's checkbox.

On desktop, CPU, memory, storage, foreground app and user sit beside the preview.
Mobile puts those values before the preview. Hostname, kernel, agent version,
Slide protection and organization controls follow compactly. Offline telemetry
is labeled as last-reported and absent values are not presented as zero usage.

## Measured comparison

Chromium, 1440 × 960 viewport, identical synthetic front-desk fixture. Coordinates
are CSS pixels from the top of the viewport. Baseline is main `290ed31`.

| Information | Before | After | Moved up |
| --- | ---: | ---: | ---: |
| CPU and memory | 612 | 249 | 363 |
| First storage disk | 948 | 414 | 534 |
| Foreground app | 776 | 470 | 306 |
| System details | 1013 | 603 | 410 |

The 431 × 242.5 preview maintains 16:9. The complete desktop overview, including
organization controls, fits within the 960-pixel viewport. Measurements vary with
content, viewport, font rendering and number of disks.

## Validation

- TypeScript and Vite production build passed.
- 24 existing web unit tests passed.
- 62 Chromium/WebKit UI scenarios passed, including 22 machine-specific checks.
- Reviewed original desktop/mobile/Linux/offline captures in the
  [gallery](../screenshots/machine-overview/README.md).
- Checked 320, 390, 760, 834 and 1440-pixel widths, portrait image containment,
  preview failure/policy-off states, IPv6-only/missing telemetry, zero readings,
  long names, direct machine switching, tab actions, nested Edit dismissal,
  Escape/focus return and viewer/archive/review restrictions.

The browser clipboard check verifies the requested address through a stub;
physical clipboard behavior and live endpoint/preview delivery were not part of
this local layout change. No device command, policy change or remote connection
was sent to a live system. Preview policy tests intercept writes locally.

Machine layout lives in `web/src/machine.css`; shared control geometry remains in
`web/src/ui.css`. Pane entrance/context behavior remains in `web/src/fleet.css`.
The static rollout is complete. GitHub source integration remains separate from
the deployed runtime.

## Deployment — September 22, 2026

User-authorized static release `37105be84200e099f34dafa3407d96b5876a1bd2`
was published at 20:58 UTC. The rebuilt index matched the tested release exactly.
The preflight verified the preceding shared-UI index, service health and a clean
source checkout; the index was checked again immediately before publication.
Assets were staged and copied before atomic index replacement.

- JavaScript: `index-CvaCQ4-a.js`
- Stylesheet: `index-vOubizgs.css`
- Index SHA-256: `cbf404f7f71b255179790fbb28c17ed922b11dea786b2fe9306794ea1ff70501`
- Rollback web tree: `/var/lib/speck-rollback/20260922T205843Z-machine-overview-37105be/web`

The served index and referenced assets match the built bytes. HTTPS health
passed; backend PID/start timestamp and environment remained unchanged. All 18
device identities and their Slide links were preserved. Previous hashed assets
remain available to existing clients. No endpoint command, preview-policy write,
remote session, agent update or recovery operation was triggered.

Live Chromium and WebKit checks opened BYD-EXAM01, matched its status/IP to
inventory, verified desktop/mobile 16:9 geometry and no horizontal overflow,
and navigated Network/Overview with no runtime errors. Both verification logins
were signed out. Private screenshots and machine-readable evidence are retained
in `output/machine-overview/`.

For rollback, copy the backup's `index.html` to a temporary file inside
`/opt/speck/web/`, set mode 644, then rename it over `/opt/speck/web/index.html`.
Its referenced assets remain installed; no backend restart is needed.
