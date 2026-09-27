# Connected workspace

The console now opens at **Home** after sign-in unless the operator followed an
existing page or remote-session link. Fleet remains the detailed inventory view. AI drafting now starts from Home rather
than occupying a separate sidebar destination; existing assistant links still work.
This is a local web change on `codex/connected-workspace`, based on main `7ad0d63`;
it has not been published to production.

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

Production acceptance, real AI calls and live Windows/Linux agent operations were
not exercised by this UI change. Existing platform qualification limits remain.
Before publication, follow the current-main, live-baseline and deployment-owner
checks in AGENTS.md and retain any newer deployed work.
