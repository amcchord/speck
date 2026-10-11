# UI and UX polish — October 11, 2026

This review uses the actual console with synthetic fixtures and private,
read-only production inspection. Three agents review separate product areas;
the parent chat is the sole deployment owner. The release preserves main
`db2f55b` and the newer deployed UX and entity-navigation work through `6d42e93`
and its record `df79045`. Backend, endpoint agents and native apps are unchanged.

## Changes

| Area | Problem | Result |
| --- | --- | --- |
| Phone headers | Freshness and workspace-search controls could squeeze titles into one character per line | Explicit title/control and full-width freshness rows; useful content starts sooner |
| Machine panes | Back/Copy link crowded identities; sticky tabs overlapped wrapped headers | Navigation gets its own phone row; measured header height positions sticky tabs |
| Fleet | Recovery-copy names clipped, placeholder contrast was weak, app sorting differed from displayed names | Readable wrapped identities, native search clearing, consistent app sorting |
| Endpoint inspection | Inventory reads and preparation had weak loading/error states and could return after closing | Retryable failures, preparation progress, category retention and late-response cancellation |
| Platform evidence | Native Windows/Linux route and counter field shapes could appear empty | Compatible field normalization, visible zero values and bracketed IPv6 sockets |
| Restricted machines | Collection actions were misleading for offline/revoked/unapproved endpoints or viewers | Explicit eligibility explanation and role-aware inspector actions |
| Infrastructure | Optional connector failures hid inventory; Activity could replace a newer tab | Independent failures, loading/retry and generation guards |
| Provider navigation | Browse resources could restore Connections, filter chips drifted, empty scopes trapped users | Exact resource destination, synchronized/revealed scope and clear-filter controls |
| Network | Failed site/console reads were trapped, late responses replaced tabs, equipment Back lost search | Recoverable errors, explicit empty states, response guards and retained equipment search |
| Physical ports | Dense phone targets and repeated keyboard tabs impeded use | Larger touch targets, arrow/Home/End selection and a port-detail shortcut |
| Provider history | Loaded backup and resource records were difficult to locate | Search and counts within the loaded, bounded history |
| Home | Source refresh interrupted editing and retry controls were cramped | Preserved input caret, shorter placeholder and separate retry actions |
| Customers | Missing workspaces silently became global, returning to all was unclear, unrelated resources could be pinned | Explicit unavailable scope, All workspaces, association/pin rules and persistent review footer |
| Maintenance | One failed history source hid every routine; prerequisites and target compatibility were unclear | Independent evidence sections, validation, platform filtering and actionable prerequisites |
| Bulk patch scans | No selection totals; empty selection still offered actions | Counts, visible-only select-all, hidden-selection notice and disabled empty actions |
| Shared lists | No-op density and pagination controls consumed space | Density only for tables, paging only when useful and compact expandable filters |
| Settings | Optional failures could erase working sections; section navigation appeared below cards | Independent recovery, preserved remote preferences, navigation first and clear selected section |
| AI settings | Retrying could lose its live panel or re-enable an operator's admin control | Stable panel lifecycle and permission checks on every render |
| Backup/recovery | Empty calendars lacked context; a running recovery with no report crashed; invalid exports submitted | Truthful empty evidence, optional-report support and validated cancellable export |
| Tablet headers | Action buttons squeezed status into narrow overlapping columns | Separate full-width summary, description and freshness rows |
| 320 px Fleet | Two adjacent action buttons forced ordinary hostnames to split awkwardly | Stacked action targets free room for names |
| API explorer | Search during schema loading claimed failure; schema errors had no retry; late reads opened unrelated dialogs | Accurate loading, HTTP/shape validation, retry, clear search, request feedback and stale-response guards |

## Review and release gates

The review covers all 21 pages at 1440, 834, 390 and 320 pixels, with additional
machine, equipment, provider, filter and action-form states in Chromium and
WebKit. Public captures use synthetic resources and documentation address ranges;
production captures and account/provider details remain in ignored `output/`.

Release decisions use TypeScript/Vite, all web units and the complete local
Chromium/WebKit suite, plus read-only live acceptance after publication. Each
production build fetches main and checks ancestry. Publication holds the shared
release lock, verifies the inspected baseline, retains a rollback web tree and
checks the live index again immediately before replacing it atomically. Served
hashes, health, service process, backend/dependency/environment fingerprints,
12 protected configuration groups and agent downloads must remain unchanged.

## Limits

This is web-console polish. It does not qualify new Windows/Linux agent behavior,
native desktop or iOS runtime behavior, physical audio, recovery correctness or
disruptive network/provider operations. Existing platform qualification remains
in WORKBOOK.md and the capability matrices. Production inspection uses an existing
operator account; administrator-only forms and failure/permission states are
validated with isolated fixtures. Provider response latency, bounded histories
and missing observations remain explicit; no inventory-only page invents success
or creates an endpoint operation.

The connected screenshot preview omits some software and backup evidence and
retains older recovery fixture shapes. Those broad captures correctly show
unavailable or unestablished evidence. Focused tests supply explicit valid and
missing data for these states. Exact release results and rollback follow in the
working record.

Provider gaps remain: Linode attachment reads are bounded to the first upstream
page; nested attachment inspectors retain local Back but do not yet have specific
shareable attachment links. UniFi notification detail and generic port reset
remain unavailable where the upstream integration supplies no such operation.

## First publication

Published `c807a0a3734cf9e0fc45c0b70801143bfd3e4064` as
`20261011T202052Z-ui-ux-polish-c807a0a`. TypeScript/Vite, 60 web units and 441
Chromium/WebKit checks passed, with one existing WebKit touch-drag skip. The final
synthetic sweep captured all 21 pages at four widths without page errors or
overflow; the private live sweep captured all 21 pages at desktop/phone widths
with zero errors, unexpected writes or overflow.

Read-only live acceptance passed machine → hypervisor, customer → machine,
IP/network evidence and exact physical port navigation in Chromium 1440 px and
WebKit 390 px, including Back/reload. All 27 public assets match the build.
Service PID 151449 remained active without restart. Backend, dependencies,
environment, 12 protected configuration groups and agent downloads are unchanged.
Index: `caf3ace3caa4d0cc738b2be7b5887b920f115a91993c61accf59efc341bad441`.
Rollback: `/var/lib/speck-rollback/20261011T202052Z-ui-ux-polish-c807a0a/web`.

[PR #28](https://github.com/amcchord/speck/pull/28) is stacked on entity-navigation
PR #27. GitHub checks were pending at publication; local validation was the gate.
No branch check was bypassed. The final screenshot review led to the tablet,
narrow Fleet and API follow-up described above; its release record follows.
