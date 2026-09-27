# Connected workspace

The console now opens at **Home** after sign-in unless the operator followed an
existing page or remote-session link. Fleet remains the detailed inventory view. AI drafting now starts from Home rather
than occupying a separate sidebar destination; existing assistant links still work.
This web change is live at https://speckrmm.com from `codex/connected-workspace`,
source `db61a96`, including main `7ad0d63` and the previous mobile release.

## Starting from the work

The Home command bar searches the loaded machine inventory, provider aliases,
hosts, IPs and cached DNS relationships. Multiple words narrow the results. A
Cmd/Ctrl+K shortcut returns to the command bar from console pages; it does not
intercept keyboard input in remote sessions or open dialogs.

**Plan with AI** accepts a task, then asks for an enrolled Windows/Linux endpoint
or a reusable platform-specific script. It carries the request into the existing
AI review dialog, including its explicit health-context control and disclosure.
No AI request or endpoint operation is submitted from Home. The existing result
can be reviewed in a terminal or saved as a template. Schedule creation opens the
existing target, operation, timing and final-review flow. Home also shows the next
three active schedules and recent failed/skipped outcomes where present.

This does not add a general autonomous agent or a cross-provider workflow engine.
AI continues to draft scripts with the existing backend capabilities. Home does
not submit provider power operations, backups, recovery actions or patch installs.

## Following a machine

One selected system anchors three relationship cards:

- **Network:** recorded UniFi MAC evidence and NAT mappings, plus LAN/public
  addresses and cached DNS names. A reported address alone is not called a UniFi
  identity match. Inspect network opens Reachability for the machine's exact ID;
  changing or clearing its search field returns to normal search.
- **Infrastructure:** provider resources and the explicit Proxmox host reference.
  Host links are scoped to the connection, so identical host names in different
  clusters stay separate. Hosts absent from inventory are shown without an open link.
- **Agent:** endpoint or host-connector presence and recorded identity evidence.
  Only the existing server's identity matches count as connected identities.
  Conflicts are excluded, and stale provider data remains labeled.

The six-row browser can show connected machines, machines without an endpoint
agent, and links needing review. It includes provider-only machines. Search, pages
and selection keep the selected relationship visible without adding a graph
canvas that the operator must pan around.

Home reads `/fleet`, `/alerts`, `/network/map`, `/schedules` and `/ai/settings`.
Reads are bounded to 15 seconds, and partial failures remain explicit; unavailable
counts use a dash. Late results cannot replace a newly selected page. Viewers read
only inventory and alerts, and do not request network, schedules or AI endpoints.
No new permissions or backend APIs are introduced.

## Color and responsive behavior

Slate navigation and neutral working surfaces separate the Speck brand from work
categories. Blue represents networks, copper represents infrastructure, green
represents agents and violet represents automation. Status still has text; color
alone never asserts health. Canonical values are in `brand/identity.json` and the
brand guide. Windows/Linux installers retain their existing identity and wording.

On phones, Home joins Fleet, Alerts and Infrastructure in the bottom navigation;
the other destinations remain in More. Relationships stack into a readable tree.
Tablets retain the labeled rail and use a single main column.

## Local review

Build the console, then run:

```sh
.venv/bin/python scripts/preview.py --connected --port 8743
```

Open `http://127.0.0.1:8743` and use any nonempty demo sign-in values. The optional
scene contains synthetic joined Windows/Linux machines, a Proxmox host, an
unmanaged VM and UniFi evidence. It reads no database, keys, agents or providers.
The preview rejects operational writes. It must remain bound to loopback.

Browser coverage includes default routing, existing Fleet links, search by DNS,
identity evidence, machine/host navigation, network drill-down, AI context handoff,
reviewed scheduling, viewer restrictions, partial failures and stale responses.
Layout checks cover 320, 390, 834 and 1440 pixels in Chromium and WebKit. Pure model
tests cover connection scoping, identity conflicts, reported-address ambiguity and
search. [Synthetic screenshots](../screenshots/connected-workspace/README.md)
show the current console. Exact verification totals are in WORKBOOK.md.

## Production release — September 27, 2026

Release `20260927T133224Z-connected-workspace-db61a96` published static assets only.
Main was fetched and confirmed as an ancestor before the build and release. The
live backend matched the release source, and the previous mobile release was
already included. The sole deployment owner held the shared release lock and
compared the live index with its baseline immediately before the atomic swap.
Old hashed assets were retained for open browser sessions.

All 26 files served over HTTPS match the build. Current index SHA-256:
`261199c2a10d3da0fa5adcdb4711638433bd6573b1f2418daa8d1fcb417a00ae`.
Backend PID, source files, dependency manifest, environment and fingerprints of
endpoint identities, installations, accounts, recovery plans, preview policies,
provider connections and connector enrollments remained unchanged.

Authenticated live acceptance passed in Chromium at 1440 pixels and WebKit at
834/390 pixels. Home loaded all five sources, searched real inventory, displayed
the three relationship cards, and opened the reviewed schedule editor without
submitting it. Desktop acceptance additionally checked machine and Proxmox host
details, exact-ID network drill-down, Fleet deep links, the command shortcut and
the Linux AI review handoff. No overflow, script errors, HTTP errors or operational
writes occurred. Login sessions were signed out. Live captures were visually
reviewed and remain private in ignored `output/connected-workspace-release/`.

Rollback tree:
`/var/lib/speck-rollback/20260927T133224Z-connected-workspace-db61a96/web`.
For rollback, coordinate one owner, hold the shared release lock and compare the
current index with the release hash above before restoring the prior static
assets and atomically replacing the index. Retain later hashed assets; no backend
restart or database/configuration restore is needed for this web-only release.

The release re-ran TypeScript/Vite, 41 web units and the full Chromium/WebKit suite:
243 passed and one existing WebKit CDP touch case skipped. GitHub CI was not run.
Real AI generation and Windows/Linux endpoint operations were not exercised by
this UI rollout. Existing platform qualification limits remain. Source and the
release record are committed locally; no GitHub push or merge occurred. A future
release must preserve this deployed source until it reaches main.
