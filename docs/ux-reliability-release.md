# UX reliability implementation review

This release implements the September 27 production UX review in the hosted web console and its backend. Endpoint binaries remain at 0.3.3. The source baseline includes the previously deployed product work and the current main branch.

| Audit | Delivered behavior | Review surface |
|---|---|---|
| 01 | Loading, failure, known empty and retained evidence are distinct; Home has source-specific retry; delayed reads cannot replace another page or account. | Home, freshness header, backup coverage |
| 02 | Clickable inventory scope totals, filtered/total counts and a persistent recovery-copy badge. | Fleet |
| 03 | Compact Fleet responses omit heavy detail telemetry; opening an endpoint retrieves its detail. Fleet and Infrastructure share provider snapshots and concurrent reads. | Fleet, Infrastructure |
| 04 | Home explicitly filters connected machines; Enter opens the same seeded global search used by the header. | Home, global search |
| 05 | A prioritized queue separates current incidents, old uncertain operations, network observations, automation exceptions and evidence gaps. | Home, Customers & sites |
| 06 | Patch coverage distinguishes fresh, stale, never scanned and ineligible systems; missing evidence is unknown. | Patches |
| 07 | Attention precedes relationship exploration on phones; dense optional copy yields to operational information. | Home at 320–390 px |
| 08 | An attention item opens its exact alert, including condition, timestamps and first checks. | Home → alert |
| 09 | Job receipts include machine name, platform/site and separate process outcome from independently verified effect. | Activity, operation inspectors |
| 10 | Windows startup values use readable labels; service searches show matching counts and state-appropriate controls. | Machine → Services |
| 11 | Missing check durations are omitted; historic credential checks are labelled as previous observations. | Keys → Providers |
| 12 | Workspace tabs, account scope, equipment filters and selected resources survive URLs/reloads; details have a consistent Back/Close path. | Network, Keys, Infrastructure, Slide |
| 13 | Search ranks exact/title matches, names pending/failed sources, retains keyboard selection, and offers recent resources for an empty query. | Global search |
| 14 | Site offline/access-point/update counts open corresponding equipment filters; unknown device state stays distinct from offline. Historical uptime is qualified. | Network site → equipment |
| 15 | Network history explains insufficient, missing and reset samples instead of implying a broken chart or zero traffic. | Network history |
| 16 | Network relationships are labelled recorded paths, with source observations and explicit limitations on live reachability. | Network → Recorded paths |
| 17 | One protected-system coverage list retains usable inventory through evidence failures; connection scope is explicit for independent Slide accounts. | Slide |
| 18 | Software coverage has reporting/freshness counts, platform/site filters and reviewed bulk collection. | Software → Installed software |
| 19 | Schedule targets are searchable by machine/site/platform. Operators choose strict all-target execution or independent eligible-target execution with recorded exclusions. | Schedules |
| 20 | Read-only inspection can gather software/process/disk reports in one reviewed bundle. Evidence retains platform semantics, freshness and job receipts. | Machine → Inventory |
| 21 | File directory and selected file are distinct; download requires a selection; breadcrumbs and progress/error receipts clarify state. | Machine → Files |
| 22 | Opening a terminal tab does not start a process. Connect terminal is explicit; terminal, script and screen entry points describe their actual behavior. | Machine → Terminal/Scripts |
| 23 | Shared list search/filter/count/pagination behavior and distinct empty states; Alerts uses one filter disclosure. | Lists and Alerts |
| 24 | Navigation controls have accessible names, tabs accept arrow keys, and the expanded sidebar scrolls independently of the account. | Navigation and inspectors |
| 25 | Enrollment explains installation, privilege, token lifetime and expected Fleet milestones before creating a token; errors allow retry. | Fleet → Add device |
| 26 | An integration directory identifies configuration source and credential ownership; Settings separates access, integrations and agent policy. | Settings |
| 27 | Persistent, explicitly reviewed customer associations, pinned resources, scoped operational evidence and recent endpoint operations; context survives navigation. | Customers & sites |
| 28 | Four editable routine starters and persisted three-stage runbooks. Each stage is separately previewed/confirmed; unsuccessful or uncertain receipts block progress. | Maintenance |
| 29 | Private HTML recovery evidence export, printable to PDF, with source/restore identity, timestamps, observed checks, cleanup and chosen retest objective. | Recovery run inspector |
| 30 | Seven-day aggregate latency histograms and endpoint outcome counts. Instrumentation distinguishes useful content, enrichment, search, alerts and first remote output. | UX reliability |

## Practical limits

- Customer workspaces organize reviewed associations and restrict workspace visibility to its owner, members and administrators. They do not create tenant isolation or grant access to otherwise restricted resources. Global inventories explicitly retain their global scope.
- UniFi summary counts cannot expose notification events or uplink topology that the provider inventory does not return. Equipment/port inspectors remain the investigation path. No reachability conclusion is inferred from a recorded DNS path or historic WAN percentage.
- Recovery export contains allowlisted evidence and no raw command output, credentials or remote screens. Rehearsal timing and snapshot age are not contractual RTO/RPO. Retest intervals are operator objectives, not automatic restore schedules.
- Runbooks pin reviewed template revisions. Create a revised runbook after changing its target set or template. No automatic patch installation or credential rotation is introduced.
- Latency quantiles are histogram upper bounds, with mixed production cache/network conditions. The proposed 100 ms feedback, 200 ms cached-list and one-second ordinary-read targets remain targets, not blanket guarantees. Sign-in-to-Fleet includes any time the user spends on Home before opening Fleet; ordinary first-content timings are reported separately.
- Native desktop/iOS code and endpoint binaries are unchanged. Browser tests exercise Windows and Linux session semantics with isolated fixtures; they do not certify every real endpoint, provider, screen reader or network condition.

## Release validation

The release record in WORKBOOK.md contains the exact source commit, production index, local check results, observed performance and rollback location. Local backend/unit/browser tests cover failure and delay handling, explicit reviews, private exports, workspace association validation, partial bundle output, schedule exclusions, and runbook stage gates. Production acceptance uses read-only inventory and configuration checks; it does not initiate restoration or modify endpoint policy.

Deployed source `1cdb07e` is live at [speckrmm.com](https://speckrmm.com). The complete local core suite passed 261 backend, 56 web unit and 337 browser tests (one existing WebKit skip), plus Linux race tests and Windows/Linux builds. The final UI refinement passed a fresh build and 80 relevant browser checks. GitHub backend and browser checks passed for that source. Twelve authenticated production API checks and manual review of Home, Fleet, Customers & sites, Maintenance and UX reliability passed.

The compact Fleet payload is 42.9% smaller than full Fleet in the same-release sample (595,280 versus 1,043,091 bytes). Its three-read median was 285.9 ms. Cold network enrichment still reached 6.1 seconds; repeat reads were 258 and 219 ms. These are API observations with mixed cache and load conditions, not rendering benchmarks or latency guarantees. The scorecard now separates first useful content from complete enrichment so this remaining cost is visible.
