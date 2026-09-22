# Compact Fleet and navigation cache

Fleet combines its title, totals and actions in one header, followed by a compact
filter bar. Desktop rows use OS icons, one-line names, separate CPU/RAM columns
and icon-only remote actions with accessible names and tooltips. The device
drawer retains detailed telemetry. Names truncate visually but retain their full
accessible name; unavailable utilization is shown as a dash.

At a 1280-pixel viewport, the table begins at 124 pixels instead of 257, and
standard rows are 46 pixels instead of 80.75. Optional screen previews use taller
rows. Tablet layouts omit the active-app column; mobile uses compact cards and
44-pixel remote targets. Existing Safari select styling is retained.

## Navigation state

Returning to Fleet renders the last successful inventory immediately and fetches
fresh data in the background. Search, status/OS filters, sort, page, selection,
preview toggle and vertical/horizontal scroll stay in memory. The refresh icon
indicates pending work. A failed refresh retains the table with a retry notice.
First visits still use the shared orbit loader. Reloading or signing out clears
the cache; no inventory is persisted in browser storage. Old asynchronous
responses are rejected by the existing view-scope guard. Selection is pruned when
a machine leaves inventory, and authorization remains enforced by the server.

## Verification

- TypeScript/Vite build, 24 web tests and 14 desktop tests pass.
- Chromium layout reviewed at 320, 390, 1024 and 1280 pixels, without page overflow;
  empty results and optional preview columns checked. Native Safari filters and
  single-line rows visually reviewed. Search and selection survived its Downloads
  round trip.
- With three seconds of API latency in Chromium, returning from Downloads showed
  17 filtered rows immediately while Refresh was busy. Search, Windows filter,
  memory sort, one selection and scroll position 371 remained unchanged after
  refresh completed. Failed refresh kept the cached rows. Local sign-out/sign-in
  showed a cold loader, default controls and newly fetched inventory.
- Windows PowerShell and Linux shell icons opened the correct command drawers;
  no command or remote session was launched by this layout qualification.

The [public gallery](../screenshots/compact-fleet/README.md) uses a local synthetic
fixture. Private QA and release evidence is in `output/compact-fleet/`.
