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
