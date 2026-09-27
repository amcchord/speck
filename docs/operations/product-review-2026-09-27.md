# Speck product review — September 27, 2026

The biggest opportunity is to make every useful observation lead somewhere: to its source, related systems, history, or a clearly explained action. The newer equipment and credential flyouts establish a good pattern. Automation results, recovery, machine services, and several cross-product relationships have not caught up.

This is a proposed backlog for review, not an implementation or deployment record.

## What I explored

Read-only production exploration of all 17 main pages, plus more than 20 detail/tab flows. Examined desktop and 390px phone layouts, representative schedule and software results, alert evidence, infrastructure connections and receipts, DNS zones, public addresses, reachability, LAN clients, consoles, Slide protection, credential/provider/SSH metadata, and machine services/network/scripts. Cross-checked relevant frontend and agent code. Reviewed the existing terminal/file implementations without starting a remote session or transferring files.

Production was release `6a70fc8`; its index still matched `23fb80017807254494ae9a44da02dbe7feff907d74309b1fecebc3ad37e64986` at the end of the review. No operational changes, credential reveals, AI requests, scans, power actions, or deployments were performed. Sign-in/out used the normal authenticated flow. Private screenshots and inspection logs are retained under ignored `output/product-review/`; customer identifiers and screenshots are intentionally absent from this document.

**Evidence labels:** **Live** means observed in production. **Code** means confirmed in the implementation. **Proposal** describes a desired capability, not something the current provider necessarily exposes. S/M/L are rough relative scope, not delivery estimates. New telemetry and controls require a provider/platform capability check.

## Start here

| Rank | Area | Why it deserves attention | Scope |
|---|---|---|---|
| 1 | Conflicting summaries | Backup, recovery, and provider summaries can disagree with their own evidence. Fixing this improves trust immediately. | S–M |
| 2 | First-load responsiveness | One first Home visit took 6.8 seconds; the slow network relationship read held up the useful page. | M |
| 3 | Relationships and navigation | Job IDs, console/site relationships, targets, and other useful references still terminate in plain text or lose context. | M |
| 4 | Operation results | Schedule results, deployments, job history, and infrastructure receipts tell the same story using different interfaces. | M–L |
| 5 | Patch posture | Old scan results look current; ineligible recovery candidates mingle with actionable machines. | M |
| 6 | Recovery readiness | Evidence exists, but it is difficult to judge current recoverability or follow original → backup → restored copy → proof. | M–L |
| 7 | Integration management | Settings, Keys, Infrastructure, and Network split the configuration and health of the same connection. | M–L |
| 8 | Alert triage | Repeated alerts and old uncertain outcomes need investigation context, grouping, and useful next steps. | M |

## Detailed review list

### 01 · Reconcile summaries with their evidence — first

**Live:** A passed recovery run showed “Created · awaiting check” for its restored machines. A protected-system flyout showed “Last backup: Not reported” while its own backup history listed successful jobs. A provider flyout showed “Last check: Not checked” while its activity included a provider check.

**Build:** Derive summary states from the same evidence used in history. Distinguish missing current inventory, archived copies, historical success, and unknown present health. Label imported/legacy evidence explicitly when it cannot establish a current state.

**Done when:** A summary explains the best known state and its timestamp; it never contradicts the evidence immediately below it. Historical success does not imply a machine is currently running or recoverable.

### 02 · Make useful content appear before slow integrations finish — first

**Live + Code:** The first Home visit took about 6.8 seconds; `/api/network/map` took about 6.6 seconds. Home waits for its grouped data reads before drawing its main content. A later fresh browser visit took about 0.6 seconds with server data already warm, and a repeat in-session Home visit took 38 ms. Repeat Fleet, Keys, and Infrastructure visits measured 22, 14, and 25 ms respectively. A sampled Keys search took 18 ms.

**Build:** Render the command field, available inventory, and attention items independently. Add relationships as they arrive. Preserve useful data on section-level failures and show source-specific age/refresh state. Extend caching to safe metadata reads where useful; keep secrets and action preflights out of it.

**Done when:** One slow integration cannot block the rest of Home. Repeat navigation retains content immediately. Measure cold and warm states separately. These observations are single-session measurements, not a production latency benchmark.

### 03 · Make relationships navigable and addressable — first

**Live + Code:** Schedule targets and operation-result machine names are plain text. An Activity job event exposes a job ID but only offers “Open machine.” The UniFi console flyout stops at model/version/address although richer site/equipment views exist elsewhere. Most detail navigation retains only the page hash, such as `#network`.

**Build:** A common resource reference that opens the correct flyout, preserves origin/filter/scroll, and supports browser Back/Forward and copyable detail URLs. Connect console → site → equipment; event → job → machine; schedule → run → template. Display why a related item is unavailable instead of silently ending the path.

**Done when:** Following three related objects and returning restores the original context. A copied link reopens the same resource/tab without including secrets.

### 04 · One operation result experience — first

**Live:** Schedule results open a centered modal containing nested JSON, including JSON embedded inside stdout. Software deployment results use a different centered table. Job history expands raw results inline. Infrastructure operations use a newer flyout with a receipt.

**Build:** One run flyout: purpose, initiator, targets, elapsed time, per-target status, concise result, exact output, and related event/resource links. Keep raw output available as evidence. Distinguish provider acceptance from confirmed completion; offer verification for uncertain outcomes rather than a blind retry.

**Done when:** The same run is understandable from Schedules, Software, Activity, Alerts, or a machine. Opening another result preserves the list underneath.

### 05 · Turn Patches into a posture and remediation workspace — first

**Live:** Production reports several days old still present an unqualified green “0 available.” Unapproved recovery candidates appear beside actionable endpoints with disabled checkboxes. There is no page search, severity filter, client/site grouping, or stale-scan view.

**Build:** Separate current, stale, never scanned, ineligible, and unsupported states. Add search, severity/OS/site filters, “Needs a scan,” reboot context, and a readable patch-detail flyout with affected systems and references. Build reviewed scan/install schedules from the filtered target set.

**Done when:** “Up to date” requires sufficiently fresh evidence. The operator can explain why a machine is excluded and see exactly which updates and machines an action will affect.

### 06 · Make Recovery lab answer “Can we recover?” — first

**Live + Code:** Plan details and detailed evidence are JSON disclosures. Source/restored machine names are not navigable. Passed runs can outlive the current machine inventory and produce misleading fallback labels.

**Build:** A readiness summary per plan, a phase timeline, source/backup/restore/proof relationships, measured recovery time and data age, readable baseline-versus-restored proof, and explicit cleanup state. Present historical verification separately from current readiness. Move run/plan inspection to flyouts.

**Done when:** An operator can identify the latest verified result, what was verified, which isolated resources remain, and what needs attention without reading JSON. Original machines and restored identities stay clearly distinct.

### 07 · Bring integration configuration and health together — first

**Live:** Slide configuration lives in Settings; connection management lives in Infrastructure; provider credentials live in Keys. UniFi has both Sites & health and a much thinner Consoles view. These entry points reveal different parts of the same relationship.

**Build:** A single integration detail with credential reference, connection health, last successful collection, available capabilities, linked sites/resources, collector/connector version, and errors. Keep contextual entry points, all opening the same connection identity. Avoid duplicating credential forms.

**Done when:** “Why is this data missing?” can be answered from the resource without searching Settings and Keys separately.

### 08 · Improve alert investigation and reduce repetition — first

**Live:** Repeated remote-completion warnings appear as independent items several days old. Evidence expands inline, while prominent actions are “AI diagnose” and “AI fix.” Status and machine are the main filters.

**Build:** Alert flyouts with a clear timeline, exact trigger, observed recovery, related changes/jobs, and deterministic first checks. Add severity/site/type/age filtering, grouping of related symptoms, and reviewed maintenance/suppression controls. Explain unknown outcomes and preserve individual evidence within groups.

**Done when:** The operator understands what changed and what to inspect before deciding whether AI or an operation is needed. Grouping never hides distinct affected machines.

### 09 · Make schedules manageable throughout their lifetime

**Live + Code:** Cards show next run, owner, target disclosures, and a few recent runs; the primary lifecycle controls are Pause and Resume. There is no schedule detail workspace, search, or full execution timeline.

**Build:** Inspectable schedules with linked target sets and template revision, timezone and next-run preview, execution history, skipped/failed reasons, edit/duplicate, and controlled catch-up behavior. Add maintenance windows and concurrency limits as the scheduler supports them.

**Done when:** A changed schedule clearly previews its next targets and run times. Missed runs do not execute unexpectedly. **Scope: M–L.**

### 10 · Separate template discovery from deployment management

**Live:** Software & scripts is a small card library with Deploy/Customize buttons. Template names do not open an inspection view; search and platform/category filters are absent. Recent deployments are separate cards.

**Build:** Searchable library; template flyout with purpose, parameters, revision history, schedules using it, affected systems, and recent results. Follow with installed-software inventory and version coverage once endpoint collection supports it—this is additional agent work, not just a new table.

**Done when:** A user can inspect a template before starting deployment and understand the impact of publishing a new revision. **Scope: M for library; L for installed inventory.**

### 11 · Give services, processes, and disks the same depth as ports

**Live + Code:** Machine Services exposes name, state, and a start/stop/restart selector. The sampled Linux machine had roughly 120 services. Windows telemetry already carries startup type, but the shared table does not display it. Agent disk usage is collected; a rich disk/process investigation flow is not present.

**Build:** Clickable service detail with startup behavior, process identity, recent failures, dependencies, resource usage, and relevant logs where supported. Add disk/volume detail and a process view with useful relationships. Explain the service and affected dependents before disruptive controls.

**Done when:** Windows and Linux show truthful, platform-specific detail; missing collection is distinguished from an empty result. **Scope: M–L; additional collection for logs/process history.**

### 12 · Explain a machine’s network rather than dumping it

**Live:** Interfaces show useful addresses, but Routes and DNS and Traffic counters still open JSON. Connections show process/PID and endpoints without deeper inspection.

**Build:** Interface flyouts with rates/errors, route and resolver tables, clickable destination/process references, and a path to VLAN/switch/port when supported by evidence. Present diagnostic results as structured timelines with copyable raw output.

**Done when:** “Which interface and path carries this connection?” is answerable without interpreting raw objects. **Scope: M–L.**

### 13 · Extend network equipment from a snapshot into a diagnostic workspace

**Live + Code:** Port wattage, link colors, clients, topology hops, and current device health now work. LAN client details can expose cumulative traffic while current rates are unreported. The console view remains disconnected from these richer views.

**Build:** Port utilization/error history, negotiated-speed changes, link flaps, PoE usage versus budget, and clear collection gaps. Add switch-wide views for busiest ports, errors, and power. For access points, add radio/channel utilization and client roaming history only where supported. Offer a scoped, expandable topology for a site rather than one giant graph.

**Done when:** Users can distinguish cumulative counters, current readings, and history, follow affected clients, and understand action impact. Unsupported controls remain absent or explicitly explained. **Scope: L; provider capability and retention work.**

### 14 · Make DNS and reachability a connected path

**Live:** Zones have useful inventory and edit controls, but records primarily remain table values. Reachability collects LAN/public/DNS relationships; some related machines are chips rather than actionable references.

**Build:** A DNS-record flyout with type-aware explanation, TTL/cache age, target chain, matching public mapping, gateway, provider instance and agent. Include change history and clearly scoped resolution checks. Show cached configuration separately from verified live reachability.

**Done when:** A user can follow hostname → record → public address/NAT → machine and identify where the evidence stops. **Scope: M–L.**

### 15 · Standardize performance and resource inspection across providers

**Code, with infrastructure navigation inspected live:** Proxmox guests have dedicated tabs and an hour-based performance view; the general provider charts use a separate component and different ranges. Linode disks, boot profiles, volumes and firewalls now have detail sections.

**Build:** Shared chart interaction, comparable units, keyboard/touch inspection, range labels and freshness. Make host storage, VM disk, attached volume, network interface and firewall references lead to their parents/consumers. Add capacity trends and shared time selection where supported.

**Done when:** A user can compare agent and provider observations without mistaking allocation for actual guest usage, or comparing incompatible time windows. **Scope: M–L.**

### 16 · Make backup coverage visible before opening a resource

**Live:** Slide begins with a cleanup panel and inventory list. Successful backup jobs and snapshots become long lists inside the protected-system flyout; current protection status is not summarized from that evidence.

**Build:** Latest successful and latest verified recovery points, age against policy, failures/missed windows, retention/capacity, and a navigable backup calendar. Link protected system → appliance → snapshot → isolated recovery plan. Keep management cleanup available with less prominence than protection health.

**Done when:** Operators can identify overdue/unverified protection across sites without opening every system. **Scope: M–L.**

### 17 · Clarify identity, coverage, and lifecycle across the app

**Live + Code:** Home counts approved endpoint agents; Fleet’s agent count includes a broader set of identities, including host connectors and recovery candidates. These are different concepts behind similar labels. Recovery candidates are interleaved with everyday systems.

**Build:** Consistent definitions for discovered resources, approved endpoints, host connectors, and unapproved/recovery copies. Make every coverage count open its exact subset. Give identity matches/conflicts a review view with evidence and provenance.

**Done when:** Counts reconcile across Home, Fleet, and Infrastructure, and a user can tell why two records were joined or kept separate. **Scope: M.**

### 18 · Make the command bar work throughout the app

**Live + Code:** Ctrl-K sends the user to Home. The current command field searches machine/network relationships and offers AI planning, but is not a cross-object command surface.

**Build:** An in-place command palette for machines, sites, equipment, IPs, domains, credentials by metadata, templates, schedules, jobs and navigation. Preserve the current workspace; make “find an object,” “inspect a relationship,” and “draft an action” distinct results. AI should start with explicit resource context and the same reviewed execution path.

**Done when:** Users can jump from anywhere to the exact object or draft while retaining a route back. **Scope: M–L.**

### 19 · Grow Keys from recorded associations into dependable usage context

**Live:** Credential and SSH flyouts now expose lifecycle/access history and manual system links. The sampled records had no recorded system associations. Their disclosure that outside-Speck use is not observed is appropriate.

**Build:** Record associations automatically when Speck itself provisions a resource or configures a supported integration, with source and timestamp. Suggest existing relationships for review only when evidence supports them. Add owner/purpose/rotation planning and links to affected integrations. Preserve the distinction between configuration references and observed authentication use.

**Done when:** A user reviewing a rotation can see known affected systems and the limits of that knowledge. Never infer real usage from matching names. **Scope: M–L.**

### 20 · Add useful detail to access and agent administration

**Live:** API tokens show scopes and last use but names do not open details. Account access shows session counts rather than an inspectable session inventory. Agent update Settings shows a published version and aggregate counts, without a device-level rollout view.

**Build:** Token/operator/session flyouts with effective scope, timestamps and linked audit events; endpoint update status with installed/target version, eligibility, pending reason, failures and rollback evidence. Consolidate integration-token configuration with the integration it grants access to.

**Done when:** Operators can answer “what can this identity access?” and “why has this device not updated?” from one detail view. **Scope: M–L.**

### 21 · Finish the remote workbench around the real terminal

**Code:** Interactive shells already use a real terminal, resize, scrollback search, shortcuts, reconnect and explicit platform handling. Files remains a path-based upload/download form with a recent-transfer list. Reconnect explicitly starts a new shell session.

**Build:** A file browser with breadcrumbs, metadata, transfer progress and inspectable transfer receipts, backed by real agent directory-listing support. Add a clear remote-session overview and explain when leaving/reconnecting closes or replaces a shell. Reuse session metadata in Activity without retaining private terminal content by default.

**Done when:** The operator knows which machine/account/session is active and can navigate files without knowing the exact path in advance. Verify Windows and Linux independently. **Scope: L; agent/protocol work.**

### 22 · Apply one set of list and detail conventions everywhere

**Live:** The reviewed pages and sampled detail views fit a 390px viewport, but large inventories still become very long pages. Search, filtering, density, selection, tabs, action placement, and detail presentation vary between sections. Downloads is comparatively clear and is not a high-priority redesign.

**Build:** Shared list controls, meaningful empty states, consistent keyboard behavior, saved filters/views, density options, explicit result counts, and stable scroll/selection. Standardize flyout sections around overview, relationships, history and actions; keep technical/raw data optional. Use color for consistent resource families and state, alongside text/icons.

**Done when:** Familiar interactions transfer between modules; filtered lists and active details survive a round trip. Validate high-volume and long-name data, not only small fixtures. **Scope: M, delivered incrementally.**

## Suggested sequence for review

1. **Trust and continuity:** 01, 02, 03, 17. Fix contradictions and first-load blocking; establish resource links and consistent identity definitions.
2. **Daily operations:** 04, 05, 08, 09, 10. Make runs, alerts, patch posture and schedules coherent. Apply the shared list/detail conventions as these ship.
3. **Integration depth:** 06, 07, 11–16, 19–21. Prioritize by operational value and verified data/control availability; record new telemetry only with an explicit retention plan.
4. **Cross-app command experience:** 18, built on the resource navigation and action model above. Expand automation to richer multi-step workflows after outcomes and dependencies are reliable.

My recommendation is to begin with the first eight ranked areas, with the summary inconsistencies and resource-navigation model as the first concrete deliverable. That makes subsequent integration work feel like one product rather than a collection of separate tools.

## Verification notes

No JavaScript page errors were observed in the browser passes; the read-only browser guard recorded no attempted API mutations. Two initial detail checks used overly broad selectors and were repeated successfully with corrected selectors; those were inspection-script issues, not product failures. No app source was changed and no release was built for this review.

The list is a product review, not exhaustive API coverage, an access-control audit, or validation of unexercised destructive actions. Additional provider history, logs, diagnostics, or controls must be validated against the integration’s actual capabilities before implementation. Relevant implementation areas are `home.ts`, `main.ts`, `management.ts`, `operations.ts`, `network.ts`, `network-equipment.ts`, `infrastructure.ts`, `provider-explorer.ts`, `proxmox-machine.ts`, `performance.ts`, `keys.ts`, `api-access.ts`, `web-shell.ts`, and the Windows/Linux agent collectors.
