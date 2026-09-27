import { icon } from "./icons";
import { matchingRelationships, networkEvidence, relationships, type Relationship } from "./home-model";
import { machineState } from "./fleet-model";
import "./home.css";

type Item = Record<string, any>;
const PAGE_SIZE = 6;

export function createHome(ui: Item) {
  const { api, esc, content, on, date } = ui;
  let rows: Relationship[] = [], selected = "", query = "", filter = "all", offset = 0;
  let ai: Item | null = null;
  let fleetAvailable = false, networkAvailable = false;
  const read = async (path: string) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try { return await api(path, "GET", undefined, controller.signal); }
    finally { clearTimeout(timer); }
  };
  const canOperate = () => ui.role() !== "viewer";
  const chip = (label: string, tone = "") => `<span class="home-chip ${tone}">${esc(label)}</span>`;
  const endpoint = (r: Relationship) => (r.machine.has_endpoint_agent ?? true) && r.machine.approved && !r.machine.revoked;
  const open = (id: string) => ui.openMachine(rows.find(r => r.machine.id === id)?.machine);

  async function render() {
    ui.loading("Connecting your workspace…");
    const current = ui.checkpoint();
    query = ""; filter = "all"; offset = 0;
    const results = await Promise.allSettled([
      read("/fleet"), read("/alerts?state=active&limit=5"),
      ...(canOperate() ? [read("/network/map"), read("/schedules"), read("/ai/settings")] : []),
    ]);
    current();
    const data = (i: number) => results[i]?.status === "fulfilled" ? (results[i] as PromiseFulfilledResult<any>).value : null;
    const fleet = data(0), alerts = data(1), network = data(2), schedules: Item[] | null = data(3);
    ai = data(4);
    fleetAvailable = Boolean(fleet); networkAvailable = Boolean(network);
    rows = relationships(fleet?.machines || [], network?.machines || []);
    selected = rows.find(r => r.machine.id === selected)?.machine.id || rows.find(r => r.linked)?.machine.id || rows[0]?.machine.id || "";
    const failures = [!fleet && "Machine inventory", !alerts && "Alerts", canOperate() && !network && "Network relationships", canOperate() && !schedules && "Schedules"].filter(Boolean);
    const staleSources = (fleet?.connections || []).filter((c: Item) => c.stale || c.status === "unavailable");
    const active = schedules?.filter(s => s.enabled) || [];
    const upcoming = [...active].sort((a, b) => (a.next_run || Infinity) - (b.next_run || Infinity)).slice(0, 3);
    const coverage = rows.filter(endpoint).length;
    content(`<div class="home-workspace">
      <section class="home-hero" aria-labelledby="home-heading">
        <div class="home-intro"><span class="eyebrow">YOUR WORKSPACE</span><h2 id="home-heading">What needs your attention?</h2><p>Find a system, follow its connections, or turn a task into a plan.</p></div>
        <form id="home-command" role="search" class="home-command"><div class="home-command-input">${icon("search")}<label class="sr-only" for="home-query">Find a machine, IP, domain, or describe a task</label><input id="home-query" type="search" autocomplete="off" placeholder="Find a machine, IP, domain, or describe a task…" aria-controls="home-results"><kbd>⌘ / Ctrl K</kbd></div>${canOperate() ? `<button type="button" id="home-ask" class="primary home-ai-button">${icon("spark")}<span>Plan with AI</span></button>` : '<button type="submit" class="primary">Find</button>'}</form>
        <div class="home-shortcuts"><span>Jump to</span><a href="#fleet">${icon("fleet")}Fleet</a><a href="#alerts">${icon("alerts")}Alerts</a>${canOperate() ? '<a href="#network">'+icon("globe")+'Network & DNS</a><button id="home-schedule-shortcut">'+icon("calendar")+'Create a schedule</button>' : '<a href="#activity">'+icon("history")+'Activity</a>'}</div>
        ${canOperate() && !ai?.configured ? `<p class="home-ai-status">${ai ? 'Connect OpenAI in Settings to draft plans with AI.' : 'AI availability could not be checked.'} <a href="#assistant">Open AI assistant →</a></p>` : ""}
      </section>
      ${failures.length ? `<div class="home-notice" role="status">Could not load: ${esc(failures.join(", "))}. Available sources are shown below. Use Refresh to retry.</div>` : ""}
      ${staleSources.length || network?.client_error ? `<div class="home-notice" role="status">Some relationships may be out of date. ${esc(staleSources.map((c: Item) => c.name).join(", "))}${network?.client_error ? ' · UniFi client inventory unavailable' : ''}. Open a system to inspect its evidence.</div>` : ""}
      <div class="home-stats" aria-label="Environment summary">
        <a href="#fleet" class="home-stat agents"><span>Machines</span><strong>${fleet ? rows.length : '—'}</strong><small>${fleet ? coverage + ' with an approved endpoint agent' : 'Inventory unavailable'}</small></a>
        <button id="home-linked" class="home-stat compute"><span>Connected identities</span><strong>${fleet ? rows.filter(r => r.linked).length : '—'}</strong><small>Agents matched to provider resources</small></button>
        <a href="#alerts" class="home-stat attention"><span>Needs attention</span><strong>${alerts ? alerts.counts?.unacknowledged ?? 0 : '—'}</strong><small>${alerts ? (alerts.counts?.active ?? 0) + ' open alerts' : 'Alerts unavailable'}</small></a>
        ${canOperate() ? `<a href="#schedules" class="home-stat automation"><span>Active automations</span><strong>${schedules ? active.length : '—'}</strong><small>${schedules ? 'Reviewed schedules' : 'Schedules unavailable'}</small></a>` : `<a href="#activity" class="home-stat automation"><span>Activity</span><strong>${icon("history")}</strong><small>Changes and their evidence</small></a>`}
      </div>
      <div class="home-layout">
        <section class="home-panel home-environment" aria-labelledby="home-environment-title">
          <div class="home-panel-heading"><div><h2 id="home-environment-title">Connected systems</h2><p>One machine. Every connection.</p></div><a class="text-link" href="#fleet">Open fleet ${icon("arrow")}</a></div>
          <div class="home-legend" aria-label="Relationship colors"><span class="network">${icon("globe")}UniFi & network</span><span class="compute">${icon("network")}Proxmox & cloud</span><span class="agents">${icon("monitor")}Speck agents</span></div>
          <div class="home-filters" role="group" aria-label="Filter connected systems">${[["all","All systems"],["linked","Connected"],["missing","Without endpoint agent"],["review","Review links"]].map(([id,label]) => `<button data-home-filter="${id}" aria-pressed="${id === filter}">${label}</button>`).join("")}</div>
          <div id="home-relationship"></div><div id="home-results" aria-live="polite"></div>
        </section>
        <div class="home-side">
          <section class="home-panel" aria-labelledby="home-attention-title"><div class="home-panel-heading"><h2 id="home-attention-title">Attention</h2><a href="#alerts" class="text-link">View all</a></div>
            ${alerts ? alerts.items?.length ? `<div class="home-attention-list">${alerts.items.slice(0, 3).map((a: Item) => `<a class="home-alert" href="#alerts"><span class="home-alert-dot ${a.severity === 'critical' ? 'critical' : ''}"></span><span><b>${esc(a.title)}</b><small>${esc(a.label || "Machine")} · ${a.acknowledged ? 'Acknowledged' : 'Needs review'}</small></span>${icon("arrow")}</a>`).join("")}</div>` : '<div class="home-empty"><b>No open alerts</b><p>Monitoring will surface changes here.</p></div>' : '<p class="home-empty">Alerts unavailable. Use Refresh to retry.</p>'}
          </section>
          ${canOperate() ? `<section class="home-panel home-automation" aria-labelledby="home-automation-title"><div class="home-panel-heading"><h2 id="home-automation-title">Keep work moving</h2><span class="home-feature-icon">${icon("spark")}</span></div><p class="home-section-copy">Build once. Review. Run on a schedule.</p>
            <button id="home-new-schedule" class="home-action"><span class="home-action-icon">${icon("calendar")}</span><span><b>Schedule routine checks</b><small>Patch scans and reusable scripts</small></span>${icon("arrow")}</button>
            <button id="home-draft" class="home-action"><span class="home-action-icon">${icon("code")}</span><span><b>Draft a reusable script</b><small>Start with a task in your own words</small></span>${icon("arrow")}</button>
            <a href="#software" class="home-action"><span class="home-action-icon">${icon("package")}</span><span><b>Template library</b><small>Windows and Linux operations</small></span>${icon("arrow")}</a>
            <div class="home-upcoming"><span class="eyebrow">UP NEXT</span>${schedules ? upcoming.length ? upcoming.map(s => `<a href="#schedules"><b>${esc(s.name)}</b><small>${s.next_run ? date(s.next_run) : 'No next run'} · ${s.operation?.device_ids?.length || 0} machines</small>${chip(s.runs?.[0]?.status === 'failed' ? 'Last run failed' : s.runs?.[0]?.status === 'skipped' ? 'Last run skipped' : 'Scheduled', s.runs?.[0]?.status === 'failed' ? 'attention' : 'automation')}</a>`).join("") : '<p>No active schedules yet. Start with a reviewed patch inventory.</p>' : '<p>Schedules unavailable. Use Refresh to retry.</p>'}</div>
          </section>` : ''}
        </div>
      </div>
      <p class="home-footnote">Relationships use recorded identity and network evidence.${fleet?.checked_at ? ' Inventory checked ' + date(fleet.checked_at) + '.' : ''} Select a machine to inspect the links.</p>
    </div>`);
    drawResults();
    document.getElementById("home-query")!.addEventListener("input", () => { query = (document.getElementById("home-query") as HTMLInputElement).value; offset = 0; drawResults(); });
    on("home-command", (event: Event) => { event.preventDefault(); document.querySelector<HTMLButtonElement>("[data-home-machine]")?.focus(); }, "submit");
    on("home-ask", () => plan(query));
    on("home-draft", () => plan(query || "Draft a reusable health check that reports disk space and failed services."));
    on("home-new-schedule", () => ui.newSchedule());
    on("home-schedule-shortcut", () => ui.newSchedule());
    on("home-linked", () => setFilter("linked"));
    document.querySelectorAll<HTMLButtonElement>("[data-home-filter]").forEach(b => b.onclick = () => setFilter(b.dataset.homeFilter!));
  }

  function setFilter(next: string) {
    filter = next; offset = 0;
    document.querySelectorAll<HTMLButtonElement>("[data-home-filter]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.homeFilter === filter)));
    drawResults();
  }

  function drawResults() {
    const matching = matchingRelationships(rows, query, filter);
    const visible = matching.slice(offset, offset + PAGE_SIZE);
    if (!visible.some(r => r.machine.id === selected)) selected = visible[0]?.machine.id || "";
    const target = document.getElementById("home-results")!;
    target.innerHTML = `${visible.length ? `<div class="home-system-columns" aria-hidden="true"><span>Machine / location</span><span>Connections</span><span>Status</span></div><div class="home-systems">${visible.map(r => `<button class="home-system" data-home-machine="${esc(r.machine.id)}" aria-pressed="${r.machine.id === selected}" aria-controls="home-relationship"><span class="home-system-name"><b>${esc(r.machine.label)}</b><small>${esc(r.hosts[0] ? r.hosts[0].connection + ' / ' + r.hosts[0].name : r.machine.site || r.machine.client_name || r.machine.platform || 'Unassigned')}</small></span><span class="home-system-links">${chip(!canOperate() ? 'Network restricted' : !networkAvailable ? 'Network unavailable' : networkEvidence(r) === 'No UniFi link' ? 'Network unlinked' : 'UniFi', networkEvidence(r) === 'No UniFi link' ? '' : 'network')}${r.resources.length ? chip(r.resources.some(s => s.provider === 'proxmox') ? 'Proxmox' : r.resources[0].provider, 'compute') : ''}${chip(r.machine.has_endpoint_agent === false ? 'No agent' : 'Speck', r.machine.has_endpoint_agent === false ? '' : 'agents')}</span><span class="home-system-state">${esc(r.conflict ? 'Identity conflict' : r.stale ? 'Stale data' : machineState(r.machine))}${icon("chevron")}</span></button>`).join("")}</div>` : `<div class="home-empty"><h3>${!fleetAvailable ? 'Inventory unavailable' : query ? 'No matching systems' : filter === 'all' ? 'Connect your first systems' : 'No systems in this view'}</h3><p>${!fleetAvailable ? 'Use Refresh to try again.' : query ? 'Try a machine name, host, IP address, or domain. To draft a task, choose Plan with AI.' : 'Your agents and provider resources will appear together here.'}</p>${!rows.length && fleetAvailable ? '<a class="secondary" href="#fleet">Open fleet</a>' : ''}</div>`}
      <div class="home-pagination"><span>${matching.length ? offset + 1 + '–' + Math.min(offset + PAGE_SIZE, matching.length) + ' of ' : ''}${matching.length} systems</span><div><button class="secondary" id="home-prev" ${offset === 0 ? 'disabled' : ''}>Previous</button><button class="secondary" id="home-next" ${offset + PAGE_SIZE >= matching.length ? 'disabled' : ''}>Next</button></div></div>`;
    document.querySelectorAll<HTMLButtonElement>("[data-home-machine]").forEach(b => b.onclick = () => {
      selected = b.dataset.homeMachine!;
      document.querySelectorAll<HTMLButtonElement>("[data-home-machine]").forEach(other => other.setAttribute("aria-pressed", String(other === b)));
      drawRelationship();
      document.getElementById("home-relationship")?.scrollIntoView({ block: "nearest" });
    });
    on("home-prev", () => { offset -= PAGE_SIZE; drawResults(); document.getElementById("home-prev")?.focus(); });
    on("home-next", () => { offset += PAGE_SIZE; drawResults(); document.getElementById("home-next")?.focus(); });
    drawRelationship();
  }

  function drawRelationship() {
    const target = document.getElementById("home-relationship")!;
    const row = rows.find(r => r.machine.id === selected);
    if (!row) { target.innerHTML = ""; return; }
    const m = row.machine, net = row.network;
    const evidence = networkEvidence(row);
    const lan: Item[] = net?.lan || [], addresses = [...lan.map(n => n.ip), ...(net?.public || []).map((n: Item) => n.ip)];
    target.innerHTML = `<section class="home-detail" aria-label="Connections for ${esc(m.label)}">
      <div class="home-detail-heading"><div><span class="eyebrow">SELECTED SYSTEM</span><h3>${esc(m.label)}</h3></div><button id="home-open-machine" class="secondary">Open machine ${icon("arrow")}</button></div>
      <div class="home-connection-grid">
        <article class="home-connection network"><span class="home-connection-icon">${icon("globe")}</span><small>NETWORK EVIDENCE</small><h4>${!canOperate() ? 'Operator access required' : !networkAvailable ? 'Network unavailable' : evidence === 'No UniFi link' ? 'No UniFi link recorded' : 'UniFi'}</h4><p>${esc(addresses.slice(0, 3).join(' · ') || 'No recorded addresses')}</p>${canOperate() && networkAvailable ? chip(evidence, evidence === 'No UniFi link' ? '' : 'network') : ''}${net?.dns?.length ? `<p class="home-dns">${net.dns.slice(0, 3).map((n: Item) => esc(n.fqdn)).join('<br>')}</p>` : ''}${canOperate() ? '<button id="home-open-network" class="text-link">Inspect network →</button>' : ''}</article>
        <article class="home-connection compute"><span class="home-connection-icon">${icon("network")}</span><small>${row.hosts.length ? 'RUNS ON' : 'INFRASTRUCTURE'}</small><h4>${esc(row.hosts[0]?.name || row.resources[0]?.connection_name || 'No provider link')}</h4><p>${esc(row.hosts[0]?.connection || row.resources.map(r => r.provider).filter((v, i, a) => a.indexOf(v) === i).join(' · ') || 'Agent-only machine')}</p>${row.hosts.map((h, i) => h.machineId ? `<button class="text-link" data-home-host="${i}">Open ${esc(h.name)} →</button>` : '').join('')}${row.resources.length ? chip(row.resources.length + ' provider resource' + (row.resources.length === 1 ? '' : 's'), 'compute') : ''}</article>
        <article class="home-connection agents"><span class="home-connection-icon">${icon("monitor")}</span><small>MANAGED BY</small><h4>${m.has_endpoint_agent === false ? m.has_speck_agent ? 'Speck host connector' : 'No endpoint agent' : 'Speck agent'}</h4><p>${esc(m.agent_status || (m.online ? 'Endpoint agent online' : 'Endpoint agent offline'))}</p>${chip(row.conflict ? 'Identity conflict' : row.linked ? 'Identity matched' : m.has_endpoint_agent === false ? 'Provider access' : 'Endpoint identity', row.conflict ? 'attention' : 'agents')}${canOperate() && endpoint(row) ? '<button id="home-machine-ai" class="text-link">Draft a diagnostic →</button>' : ''}</article>
      </div>
      <div class="home-evidence">${row.stale ? chip('Stale provider inventory', 'attention') : ''}${row.conflict ? `<span class="home-conflict">${esc(m.identity_issues.join(' · '))}</span>` : `<span>${esc(m.identity_evidence?.length ? 'Identity evidence: ' + m.identity_evidence.join(' · ') : 'No cross-provider identity match recorded.')}</span>`}<span>UniFi MAC matches and NAT mappings describe network links.</span></div>
    </section>`;
    on("home-open-machine", () => open(m.id));
    on("home-open-network", () => ui.openNetwork(m));
    on("home-machine-ai", () => plan("Diagnose the health of " + m.label + " and propose read-only checks.", m.id));
    target.querySelectorAll<HTMLButtonElement>("[data-home-host]").forEach(b => b.onclick = () => open(row.hosts[Number(b.dataset.homeHost)].machineId!));
  }

  async function plan(prompt: string, deviceId = "") {
    if (!canOperate()) return;
    if (!ai?.configured) { location.hash = "assistant"; return; }
    const devices = rows.filter(endpoint).filter(r => ['windows', 'linux'].includes(r.machine.platform));
    const modal = ui.dialog("Plan with AI", `<p>Choose a machine for context, or draft a reusable Windows or Linux script.</p><label>Task<textarea id="home-plan-task" rows="3" required></textarea></label><label>Context<select id="home-plan-context"><option value="platform:windows">Reusable script · Windows PowerShell</option><option value="platform:linux">Reusable script · Linux shell</option>${devices.map((r, i) => `<option value="device:${i}">${esc(r.machine.label)} · ${esc(r.machine.platform)}${r.machine.online ? '' : ' · Offline'}</option>`).join('')}</select></label><p class="muted">You’ll review the request and included machine health before sending it to OpenAI. Generated scripts can become reusable templates; schedules have a separate review.</p><div class="dialog-footer"><button id="home-plan-continue" class="primary">Review AI request ${icon("arrow")}</button></div>`);
    (modal.querySelector('#home-plan-task') as HTMLTextAreaElement).value = prompt;
    const index = devices.findIndex(r => r.machine.id === deviceId);
    if (index >= 0) (modal.querySelector('#home-plan-context') as HTMLSelectElement).value = 'device:' + index;
    on("home-plan-continue", async () => {
      const input = modal.querySelector('#home-plan-task') as HTMLTextAreaElement;
      if (!input.reportValidity()) return;
      const task = input.value.trim();
      if (!task) { input.focus(); return; }
      const choice = (modal.querySelector('#home-plan-context') as HTMLSelectElement).value;
      const device = choice.startsWith('device:') ? devices[Number(choice.slice(7))].machine : { platform: choice.slice(9) };
      modal.close();
      await ui.assist(device, task);
    });
  }
  return { render };
}
