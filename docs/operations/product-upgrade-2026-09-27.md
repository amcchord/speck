# Product upgrade implementation and production record

The [22-area product review](product-review-2026-09-27.md) has been implemented across the web console and control plane. Provider-dependent features expose available evidence and its limits. They do not manufacture historical data or imply that an accepted operation completed.

Production: **20260927T220455Z-product-final-ab5b26e**, application source **ab5b26e**, at https://speckrmm.com. Initial rollout `20260927T215312Z-product-894f9db` was followed by the final navigation and Slide pagination corrections. This task was the sole active deployment owner and held the server deployment lock while publishing.

## Delivered scope

| Review | Delivered |
|---|---|
| 01 · Evidence-based summaries | Backup summaries derive from returned successful jobs/snapshots. Recovery separates historical proof from current archived/offline inventory. Provider checks retain their historical timestamp and provenance. |
| 02 · Responsiveness | Home renders the command field, alerts, inventory and relationships independently. Metadata reads deduplicate and reuse an in-memory snapshot while refreshing. Action preflights, credentials, terminal content and secret reveals are excluded. |
| 03 · Resource navigation | Addressable flyouts, Copy link, Back/Forward and contextual cross-resource links. Machine tabs, Proxmox tabs and equipment tab/port selections survive copied links and reloads. Missing resources explain the unavailable relationship. |
| 04 · Operation results | Shared job/batch inspectors with initiator, timing, per-target outcomes, exact stdout/stderr, related machines and refresh/cancel controls. Infrastructure receipts preserve acceptance-versus-completion semantics. |
| 05 · Patch posture | Fresh/stale/never-scanned/ineligible distinctions; search and severity, platform and location filters; affected-machine/update details; reviewed target sets for scans and existing install workflows. |
| 06 · Recovery readiness | Plan readiness, source → snapshot → restored identity → proof links, retained phase timeline, measured timestamps when recorded, readable proof comparisons, current archive state and cleanup context. |
| 07 · Integration context | Connection inspectors show resources, collectors, versions, credentials' configuration source, capabilities and collection errors. Settings/Keys/Network link to the relevant connection or explicitly distinguish independent credentials. |
| 08 · Alert investigation | Timeline, trigger/recovery context, deterministic first checks, linked job evidence, grouping without hiding individual machines, filters and reviewed maintenance controls. |
| 09 · Schedule lifecycle | Linked targets and pinned template revisions, timezone and next-run preview, paginated execution history, duplicate/edit with fresh review and revision-conflict detection. Existing busy-target and missed-run skip behavior is displayed. |
| 10 · Templates and software | Searchable/filterable library, template inspectors, encrypted custom revision history, related schedules/results, and installed-software/version coverage from reviewed endpoint collection. |
| 11 · Endpoint inspection | Windows/Linux processes, disk/volume reports and installed software; clickable existing storage telemetry; service startup/process/dependency context and reviewed platform-specific diagnostic logs. |
| 12 · Machine networking | Structured interfaces, routes, resolvers, counters and process connections with links into physical network evidence. Cumulative counters are labeled separately from rates. |
| 13 · Equipment history | Encrypted seven-day port/counter/power/link observations, gap-aware derived rates, device power budget, busiest/error port tables, observed client attachment changes, and opt-in five-minute collection. Existing reviewed PoE controls and scoped equipment topology remain available. |
| 14 · DNS investigation | Record flyouts with type/TTL/cache context, bounded CNAME traversal, address/mapping/machine relationships, recorded changes, and an explicit server-side resolution check. |
| 15 · Provider performance | Shared Proxmox/Linode chart interactions, units, timestamps, ranges and keyboard/touch inspection. Existing storage, disks, boot profiles, volumes, interfaces and firewall inspectors retain provider relationships. |
| 16 · Backup coverage | Protection evidence precedes cleanup; searchable cross-system overview, observed recovery points/verification/failures, bounded backup calendar, and links into protected-system and snapshot details. |
| 17 · Identity and coverage | Separate approved endpoints, host connectors and recovery candidates; counts open their matching Fleet subsets; identity inspectors expose matching evidence and conflicts. |
| 18 · Global command palette | In-place Ctrl/Cmd-K search for machines, sites, observed equipment, DNS/IPs, templates, schedules, jobs and credential metadata. Navigation retains the current workspace; AI planning retains the reviewed execution path. |
| 19 · Keys | Known usage/provisioning links and credential-source context remain distinct from observed authentication. Added encrypted owner, purpose, next-review date and rotation-procedure metadata. |
| 20 · Access and agents | Token/operator/session metadata and audit context, effective scope explanations, and per-device update eligibility/version/pending/failure information. Session identifiers expose no authentication material. |
| 21 · Remote workbench | Real agent-backed directory browsing, breadcrumbs, metadata, filtering/pagination and transfer receipts/progress. The existing real interactive terminal now explains its account, session lifetime, reconnect behavior and content privacy. |
| 22 · Shared conventions | Shared search, filters, density, result counts, pagination, in-session view state and flyout navigation. Desktop, tablet and phone checks include long names and large inventories. |

## Capability and data boundaries

- Endpoint inspection is explicit and read-only, using the installed agents' existing command and directory-listing capabilities. Only each machine's latest successful software/process/disk report is indexed; failures retain the previous report and their separate job receipt. Windows software covers machine-wide uninstall registries, excluding per-user and Store apps. Linux supports dpkg/RPM. Process CPU units follow the platform: Windows lifetime seconds versus Linux observed percentage. Service logs are bounded diagnostic reads, not continuous log retention.
- Equipment history begins with real observations after this release. Viewing records a sample at most once per minute; continuous five-minute collection is off by default and limited to 20 explicitly enabled devices. Samples and client attachment observations expire after seven days, including while collection is paused. Gaps/counter resets are not interpolated. Observed attachment transitions are not a complete roaming log. Radio metrics and controls appear only when the provider reports/supports them; a generic UniFi port reset remains unsupported.
- Backup coverage reads two provider-supported pages of 50 jobs and 50 snapshots, at most 100 of each. It labels partial/unavailable evidence; omitted history does not establish a missing backup. Protected-system history is separately paginated. Historical verification and current protection are different facts. Old recovery runs without retained phase timestamps cannot acquire retrospective timing evidence.
- Scheduling retains the existing supported execution model: busy targets skip, and occurrences missed by more than five minutes skip. No new automatic patch-install execution, configurable maintenance-window engine, or unattended credential rotation is implied. Rotation metadata is a planning record.
- Provider allocation is not guest memory usage; DNS resolution from the server is not proof of endpoint/application reachability. Credential associations describe recorded configuration/provisioning, not unobserved external use. List preferences are in-session; they clear at sign-out.

## Validation

- 248 backend tests; Ruff; TypeScript/Vite production build; 54 web unit tests.
- 323 browser checks passed across Chromium and WebKit, covering widths down to 320px. One existing WebKit touch-drag check is skipped; it is not counted as passing.
- Linux agent and Proxmox connector race tests passed in the project's Go 1.24 container. Agent source/binaries were unchanged in this release.
- Live Windows acceptance: process inventory (162 rows), disks (2), installed software (18), directory listing (19 entries). Live Linux acceptance: processes (93), disks (2), packages (427), directory listing (9 entries). Exact scripts matched the committed preview, and every read-only job completed with a successful receipt.
- Production desktop/390px exploration covered all 17 main pages and 17 deeper views, with no JavaScript errors, page overflow or blocked mutation attempts. Visual inspection caught the provider page-size error; it was corrected and retested against real Slide responses. Final production acceptance confirmed 100 backup jobs and 100 snapshots with no provider error, a populated calendar, and restored machine/equipment tab and port selections from copied links.
- The sampled first Home shell/command content appeared in 140 ms while slower inventory/relationships continued loading. This is a single-session first-useful-content observation, not a claim that every data source completed then or a general latency benchmark.
- No destructive controls, new recovery runs, source-machine identity changes, credential rotation/reveals, unattended history enrollment, or transfers of file contents were used for production acceptance. Real command/inspection and directory-list jobs were audited normally. Private data/screenshots/receipts remain in ignored `output/product-upgrade/`.

## Release preservation

Before release builds, fetched `origin/main` and verified ancestry plus inclusion of the previously deployed work. Before each publication, compared backend/web/configuration against its inspected baseline and rechecked the live index immediately before replacing it. Preflight verified no active jobs, running recovery or unended remote sessions. Retained server/web/download/configuration and consistent SQLite rollback snapshots.

The public build manifest, authenticated API health and protected configuration hashes were verified after deployment. Credentials, account policy, machine/install identities, recovery plans, provider connections, collector enrollments, preview policies and agent downloads were preserved. Agent release remains 0.3.3; older unapproved recovery candidates retain their existing state.
