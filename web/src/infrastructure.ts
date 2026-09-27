import {mountProviderExplorer} from "./provider-explorer";
import {detailDate} from "./resource-story";
import "./infrastructure.css";
import { mountPerformance } from "./performance";
import { openProviderConsole } from "./provider-console";
import { mountProxmoxMachine } from "./proxmox-machine";
import { icon } from "./icons";
import { infrastructureStory, relatedResources, technicalDetail, detailHero, detailSection, detailFacts } from "./resource-story";
type Item = Record<string, any>;
export function createInfrastructure(ui: Item) {
  const { api, esc, on, value, notify, content, loading, badge, bytes, date } =
    ui;
  const dialog: (title: string, html: string) => HTMLDialogElement = ui.dialog;
  const admin = () => ui.role() === "admin";
  const labels: Item = {
    proxmox: "Proxmox",
    linode: "Linode",
    slide: "Slide",
    austinland: "AustinLand",
  };
  const kinds: Item = {
    node: "Host",
    qemu: "VM",
    lxc: "Container",
    box: "Slide box",
    protected: "Protected machine",
    virt: "Slide VM",
    instance: "Linode",
  };
  let section = "resources",
    query = "",
    provider = "",
    connection = "",
    coverage = "";
  // Long inventories render 100 resources at a time; any filter change starts again from the top.
  const PAGE = 100;
  let limit = PAGE;
  let inventory: Item = { connections: [] },
    agents: Item[] = [];
  const button = (id: string, label: string) =>
    `<button class="secondary" id="${id}">${esc(label)}</button>`;
  const summary = (v: any): string =>
    typeof v === "object" ? JSON.stringify(v) : String(v ?? "—");
  function dataView(data: any): string {
    if (Array.isArray(data)) {
      if (!data.length) return '<p class="muted">No items reported.</p>';
      if (!data.every((x) => x && typeof x === "object" && !Array.isArray(x)))
        return `<pre>${esc(JSON.stringify(data, null, 2))}</pre>`;
      const keys = [...new Set(data.flatMap((x) => Object.keys(x)))]
        .filter(
          (k) =>
            !["password", "token", "private_key", "secret"].some((s) =>
              k.includes(s),
            ),
        )
        .slice(0, 12);
      return `<div class="infra-table-wrap"><table><thead><tr>${keys.map((k) => `<th>${esc(k.replaceAll("_", " "))}</th>`).join("")}</tr></thead><tbody>${data.map((row) => `<tr>${keys.map((k) => `<td>${esc(summary(row[k]))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    }
    if (data && typeof data === "object")
      return `<dl class="infra-facts">${Object.entries(data)
        .map(
          ([k, v]) =>
            `<dt>${esc(k.replaceAll("_", " "))}</dt><dd>${esc(summary(v))}</dd>`,
        )
        .join("")}</dl>`;
    return `<p>${esc(summary(data))}</p>`;
  }
  async function render() {
    loading("Loading infrastructure…");
    [inventory, agents] = await Promise.all([
      api("/infrastructure/inventory"),
      api("/infrastructure/connectors"),
    ]);
    const rows = inventory.connections.flatMap((c: Item) => c.resources);
    ui.summary?.(`<span><b>${rows.filter((r: Item)=>['running','online'].includes(r.status)).length}</b> running</span><span><b>${inventory.connections.length}</b> connections</span><span><b>${rows.filter((r: Item)=>r.agent).length}</b> linked agents</span>`);
    content(
      `${admin() && ui.newVm && inventory.connections.some((c: Item) => c.provider === "austinland") ? `<button class="primary" id="infra-new-vm" data-page-action>${icon("plus")}<span>New VM</span></button>` : ""}${admin() ? '<button class="secondary" id="infra-add" data-page-action>Add connection</button>' : ""}<div class="infra-tabs" role="tablist" aria-label="Infrastructure views">${[
        ["resources", `Resources (${rows.length})`],
        ["connections", "Connections"],
        ["history", "Activity"],
      ]
        .map(
          ([id, label]) =>
            `<button id="infra-tab-${id}" role="tab" aria-selected="${section === id}" class="${section === id ? "active" : ""}">${label}</button>`,
        )
        .join("")}</div><div id="infra-body"></div>`,
    );
    on("infra-add", () => editConnection());
    on("infra-new-vm", () => ui.newVm());
    ["resources", "connections", "history"].forEach((s) =>
      on("infra-tab-" + s, async () => {
        section = s;
        await renderSection();
        document.querySelectorAll("[role=tab]").forEach((el) => {
          const active = el.id === "infra-tab-" + s;
          el.setAttribute("aria-selected", String(active));
          el.classList.toggle("active", active);
        });
      }),
    );
    await renderSection();
  }
  async function renderSection() {
    const body = document.getElementById("infra-body")!;
    if (section === "resources") {
      const all = inventory.connections.flatMap((c: Item)=>c.resources || []);
      const running = all.filter((r: Item)=>['running','online'].includes(r.status));
      body.innerHTML = `<section class="infra-landscape"><div class="infra-landscape-title"><span class="resource-eyebrow">Connected infrastructure</span><h2>Your estate, in context</h2><p>Explore a connection, follow a host to its guests, or inspect a machine’s performance.</p></div><div class="infra-totals"><div><strong>${running.length}</strong><span>Running / online</span></div><div><strong>${all.filter((r: Item)=>r.provider==='proxmox'&&r.kind==='node').length}</strong><span>Hypervisors</span></div><div><strong>${all.filter((r: Item)=>r.provider==='linode').length}</strong><span>Cloud instances</span></div><div><strong>${all.filter((r: Item)=>r.agent).length}</strong><span>Linked endpoints</span></div></div></section><div class="infra-scope-list" aria-label="Browse connections"><button class="infra-scope ${!connection?'selected':''}" data-infra-scope=""><b>All connections</b><span>${all.length} resources</span></button>${inventory.connections.filter((c:Item)=>c.resources?.length).map((c:Item)=>`<button class="infra-scope ${connection===c.id?'selected':''}" data-infra-scope="${esc(c.id)}"><b>${esc(c.name)}</b><span>${esc(labels[c.provider])} · ${c.resources.length} resources</span></button>`).join('')}</div>${inventory.connections
        .filter((c: Item) => c.status !== "connected")
        .map(
          (c: Item) =>
            `<div class="infra-error" role="status"><strong>${esc(c.name)} is unavailable.</strong> ${esc(c.error)}</div>`,
        )
        .join(
          "",
        )}<div class="infra-toolbar"><label class="infra-search">Search<input id="infra-search" type="search" placeholder="Name, host, IP or ID" value="${esc(query)}"></label><label>Provider<select id="infra-provider"><option value="">All providers</option>${["proxmox", "linode", "slide"].map((p) => `<option value="${p}" ${provider === p ? "selected" : ""}>${labels[p]}</option>`).join("")}</select></label><label>Connection<select id="infra-connection"><option value="">All connections</option>${inventory.connections
        .filter((c: Item) => c.provider !== "austinland")
        .map(
          (c: Item) =>
            `<option value="${c.id}" ${connection === c.id ? "selected" : ""}>${esc(c.name)}</option>`,
        )
        .join(
          "",
        )}</select></label><label class="infra-coverage">Management<select id="infra-coverage"><option value="">All resources</option><option value="speck_agent" ${coverage === "speck_agent" ? "selected" : ""}>Speck endpoint agent</option><option value="provider_only" ${coverage === "provider_only" ? "selected" : ""}>Provider only</option><option value="host_agent" ${coverage === "host_agent" ? "selected" : ""}>Proxmox host agent</option><option value="ambiguous" ${coverage === "ambiguous" ? "selected" : ""}>Identity needs review</option></select></label></div><div id="infra-resources"></div>`;
      on(
        "infra-search",
        () => {
          query = value("infra-search");
          limit = PAGE;
          renderRows();
        },
        "input",
      );
      on(
        "infra-provider",
        () => {
          provider = value("infra-provider");
          limit = PAGE;
          renderRows();
        },
        "change",
      );
      on(
        "infra-connection",
        () => {
          connection = value("infra-connection");
          limit = PAGE;
          renderRows();
        },
        "change",
      );
      on(
        "infra-coverage",
        () => {
          coverage = value("infra-coverage");
          limit = PAGE;
          renderRows();
        },
        "change",
      );
      body.querySelectorAll<HTMLButtonElement>('[data-infra-scope]').forEach(b=>b.onclick=()=>{
        connection=b.dataset.infraScope!;provider='';query='';limit=PAGE;void renderSection();
      });
      renderRows();
    } else if (section === "connections") {
      body.innerHTML = `<div class="infra-connections">${inventory.connections
        .map(
          (c: Item, i: number) =>
            `<article class="card infra-connection-card" data-provider="${esc(c.provider)}"><div class="infra-card-heading"><span class="infra-provider-label">${esc(labels[c.provider])}</span>${badge(c.status, c.status === "connected")}</div><h2><button class="text-link" data-connection-detail="${i}">${esc(c.name)}</button></h2><p>${c.connector ? "Outbound connector" : esc(c.url)}</p><div class="infra-connection-counts"><span><b>${c.resources?.length || 0}</b> resources</span><span><b>${(c.resources || []).filter((r:Item)=>['running','online'].includes(r.status)).length}</b> running</span><span><b>${(c.resources || []).filter((r:Item)=>r.agent).length}</b> agent links</span></div>${c.error ? `<p class="infra-error">${esc(c.error)}</p>` : ""}<div class="infra-actions">${button("infra-tools-" + i, "Manage")}${admin() ? c.managed_in_settings ? '<a class="secondary" href="#settings">Manage in Settings</a>' : button("infra-edit-" + i, "Edit") + button("infra-remove-" + i, "Disconnect") : ""}${admin() && c.connector ? button("infra-enroll-" + i, "Enroll host") : ""}</div>${agents
              .filter((a) => a.connection_id === c.id)
              .map(
                (a, j) =>
                  `<div class="infra-agent"><span>${esc(a.hostname)} ${badge(a.revoked ? "revoked" : a.online ? "online" : "offline", a.online)}<small>Agent ${esc(a.version)} · ${date(a.last_seen)}</small></span>${admin() && !a.revoked ? button(`infra-revoke-${i}-${j}`, "Revoke") : ""}</div>`,
              )
              .join("")}</article>`,
        )
        .join(
          "",
        )}</div>${!inventory.connections.length ? '<div class="empty"><h2>Connect your infrastructure</h2><p>Add a Proxmox cluster, Linode account, Slide account or AustinLand bridge.</p></div>' : ""}`;
      body.querySelectorAll<HTMLElement>('[data-connection-detail]').forEach(b=>b.onclick=()=>connectionDetail(inventory.connections[Number(b.dataset.connectionDetail)]));
      inventory.connections.forEach((c: Item, i: number) => {
        on("infra-tools-" + i, () => connectionTools(c));
        on("infra-edit-" + i, () => editConnection(c));
        on("infra-enroll-" + i, () => enroll(c));
        on("infra-remove-" + i, () =>
          confirmLocal(`Disconnect ${c.name}`, c.name, async () => {
            await api("/infrastructure/connections/" + c.id, "DELETE");
            await render();
          }),
        );
        agents
          .filter((a) => a.connection_id === c.id)
          .forEach((a, j) =>
            on(`infra-revoke-${i}-${j}`, () =>
              confirmLocal(`Revoke ${a.hostname}`, a.hostname, async () => {
                await api("/infrastructure/connectors/" + a.id, "DELETE");
                await render();
              }),
            ),
          );
      });
    } else {
      const rows = await api("/infrastructure/operations");
      body.innerHTML = `<p class="muted">Submitted means the provider accepted the request; inspect the resource for completion. Unknown outcomes need inspection before a new attempt.</p>${
        rows.length
          ? `<div class="infra-table-wrap"><table class="infra-activity"><thead><tr><th>When</th><th>Operation</th><th>Target</th><th>By</th><th>Status</th><th>Result</th></tr></thead><tbody>${rows
              .map(
                (r: Item) =>
                  `<tr><td>${date(r.created)}</td><td><button class="text-link" data-receipt="${esc(r.id)}" aria-haspopup="dialog">${esc(r.operation.replaceAll("-", " "))} ↗</button></td><td>${esc(r.target)}</td><td>${esc(r.actor)}</td><td>${badge(r.status, r.status === "submitted")}</td><td>${esc(receiptSummary(r.result))}</td></tr>`,
              )
              .join("")}</tbody></table></div>`
          : '<div class="empty"><h2>No infrastructure changes yet</h2><p>Power, configuration and provisioning requests appear here with their receipts.</p></div>'
      }`;
      body.querySelectorAll<HTMLButtonElement>('[data-receipt]').forEach(b=>b.onclick=()=>operationDetail(rows.find((r:Item)=>r.id===b.dataset.receipt)));
    }
  }
  function connectionDetail(c: Item) {
    const members=c.resources || [];
    const d=ui.flyout(c.name,detailHero(labels[c.provider]+' · Connection',c.status,'Provider access, resource coverage and connector health in one place.',[['Resources',members.length],['Running',members.filter((r:Item)=>['running','online'].includes(r.status)).length],['Linked agents',members.filter((r:Item)=>r.agent).length]])+detailSection('Connection',detailFacts([['Provider',labels[c.provider]],['Transport',c.connector?'Outbound connector':'Provider API'],['Origin',c.url],['Inventory checked',date(inventory.checked_at)]]))+detailSection('Host connectors',agents.filter(a=>a.connection_id===c.id).map(a=>`<div class="infra-agent"><span><b>${esc(a.hostname)}</b><small>Agent ${esc(a.version)} · ${date(a.last_seen)}</small></span>${badge(a.online?'online':'offline',a.online)}</div>`).join('')||'<p class="resource-note">This connection uses its provider API.</p>')+'<div class="resource-actions"><button class="primary" data-browse-connection>Browse resources</button><button class="secondary" data-manage-connection>Management tools</button></div>',{tone:c.provider==='slide'?'protection':'compute',subtitle:labels[c.provider]});
    d.querySelector('[data-browse-connection]')!.addEventListener('click',()=>{d.close();connection=c.id;provider='';query='';section='resources';void render();});
    d.querySelector('[data-manage-connection]')!.addEventListener('click',()=>void connectionTools(c));
  }
  function operationDetail(r: Item) {
    if(!r)return;
    const c=inventory.connections.find((c:Item)=>c.id===r.connection_id);
    const matches=(c?.resources || []).filter((x:Item)=>r.resource_id&&String(x.id)===String(r.resource_id)&&(!r.kind||x.kind===r.kind));
    const d=ui.flyout(r.operation.replaceAll('-',' '),detailHero('Infrastructure · Activity',r.status,r.status==='submitted'?'The provider accepted this request. Check the target to confirm its outcome.':r.status==='unknown'?'The outcome is unknown. Inspect the provider before attempting this operation again.':'The recorded outcome of this request.')+detailSection('Request',detailFacts([['Target',r.target],['Connection',c?.name || r.connection_id],['Requested by',r.actor],['Submitted',date(r.created)],['Updated',date(r.updated)],['Request ID',r.id]]))+detailSection('Provider receipt',`<p>${esc(receiptSummary(r.result))}</p>`+technicalDetail(r.result))+(matches.length===1?'<button class="primary" data-receipt-target>Inspect target</button>':'<p class="resource-note">An exact target link is not available in the current inventory.</p>'),{tone:'automation',subtitle:'Activity · '+r.target});
    d.querySelector('[data-receipt-target]')?.addEventListener('click',()=>void resourceDetail(matches[0]));
  }
  // One readable line for a provider receipt; the full JSON stays behind Details.
  function receiptSummary(result: any): string {
    if (result == null) return "—";
    if (typeof result !== "object") return String(result).startsWith("UPID:") ? "Proxmox task started" : String(result).slice(0, 120);
    if (result.message) return String(result.message);
    const facts = [
      ["vmid", "VM"], ["pid", "process"], ["state", "state"], ["status", "status"], ["vnc_enabled", "console"], ["backup_id", "backup"], ["id", "id"],
    ]
      .filter(([k]) => result[k] !== undefined && result[k] !== null && result[k] !== "")
      .map(([k, label]) => `${label} ${k === "vnc_enabled" ? (result[k] ? "enabled" : "disabled") : result[k]}`);
    return facts.slice(0, 3).join(" · ") || "Accepted";
  }
  function managementLabel(r: Item): string {
    if (r.management === "host_agent")
      return badge(
        r.connector_online ? "Host agent online" : "Host agent offline",
        r.connector_online,
      );
    if (r.management === "speck_agent")
      return `${badge(r.agent?.online ? "Speck agent online" : "Speck agent offline", r.agent?.online)}${!r.agent?.approved ? "<small>Approval needed</small>" : r.agent?.revoked ? "<small>Enrollment revoked</small>" : ""}`;
    if (r.management === "ambiguous")
      return `${badge("Identity needs review")}<small>Duplicate hardware identity</small>`;
    return `<span class="placeholder" title="No matched Speck endpoint agent">${r.provider === "proxmox" ? "Proxmox only" : "Provider only"}</span>`;
  }
  function renderRows() {
    const rows = inventory.connections
      .flatMap((c: Item) => c.resources)
      .filter(
        (r: Item) =>
          (!provider || r.provider === provider) &&
          (!connection || r.connection_id === connection) &&
          (!coverage || r.management === coverage) &&
          (!query ||
            JSON.stringify(r).toLowerCase().includes(query.toLowerCase())),
      )
      .sort(
        (a: Item, b: Item) =>
          a.connection_name.localeCompare(b.connection_name) ||
          a.node.localeCompare(b.node) ||
          (a.kind === "node"
            ? -1
            : b.kind === "node"
              ? 1
              : a.name.localeCompare(b.name)),
      );
    let group = "";
    const html = rows
      .slice(0, limit)
      .map((r: Item, i: number) => {
        const key = r.connection_id + "/" + r.node;
        const heading =
          key !== group
            ? `<tr class="infra-group"><th colspan="8">${esc(r.connection_name)} <span>›</span> ${esc(r.node || labels[r.provider])}</th></tr>`
            : "";
        group = key;
        return `${heading}<tr class="${r.kind === "node" ? "infra-host-row" : ""}"><td><button class="text-link" id="infra-resource-${i}">${r.kind !== "node" && r.provider === "proxmox" ? '<span class="infra-branch" aria-hidden="true">↳</span>' : ""}${esc(r.name)}</button>${r.template ? "<small>Template</small>" : ""}</td><td>${esc(kinds[r.kind])}</td><td>${badge(r.status)}</td><td>${managementLabel(r)}</td><td>${typeof r.cpu==='number'?`<span class="infra-load">${Math.round(r.cpu*100)}%<i style="--load:${Math.min(100,Math.max(0,r.cpu*100))}%"></i></span>`:r.provider==='linode'?'<span class="placeholder">In details</span>':'—'}</td><td>${r.max_memory ? `${r.memory ? bytes(r.memory) + " / " : ""}${bytes(r.max_memory)}` : "—"}<small>${r.max_disk ? bytes(r.max_disk) + " disk" : ""}</small></td><td>${esc(r.addresses?.join(", ") || r.id)}<small>${esc(r.pool || "")}</small></td><td>${r.agent ? button("infra-endpoint-" + i, "Open agent") : ""}</td></tr>`;
      })
      .join("");
    document.getElementById("infra-resources")!.innerHTML = rows.length
      ? `<div class="infra-table-wrap"><table class="infra-resource-table"><thead><tr><th>Host / guest</th><th>Type</th><th>State</th><th>Management</th><th>CPU</th><th>Memory / capacity</th><th>Address / ID</th><th>Agent</th></tr></thead><tbody>${html}</tbody></table></div>${rows.length > limit ? `<button class="secondary net-more" id="infra-more">Show ${Math.min(PAGE, rows.length - limit)} more of ${rows.length - limit} remaining</button>` : ""}<p class="muted">${rows.length} resources · Cluster › host › guest · Checked ${date(inventory.checked_at)}</p>`
      : '<div class="empty"><h2>No matching resources</h2><p>Adjust the filters or add a provider connection.</p></div>';
    rows.slice(0, limit).forEach((r: Item, i: number) => {
      on("infra-resource-" + i, () => resourceDetail(r));
      on("infra-endpoint-" + i, () => ui.openDevice(r.agent.id));
    });
    document.getElementById("infra-more")?.addEventListener("click", () => {
      limit += PAGE;
      renderRows();
    });
  }
  function machinePanel(r: Item, root: HTMLElement) {
    return mountProxmoxMachine({...ui,openResource:resourceDetail}, r, root, (id, spec, current) => operationForm(
      {id: current.connection_id, name: current.connection_name, provider: current.provider}, id, spec, current));
  }
  async function resourceDetail(r: Item) {
    const d = ui.flyout(r.name, '<div class="infra-detail-root"></div>', {
      className: "infra-dialog", tone: r.provider === "slide" ? "protection" : "compute",
      subtitle: [labels[r.provider], r.connection_name, r.node !== r.name ? r.node : ""].filter(Boolean).join(" · "),
    });
    const root = d.querySelector(".infra-detail-root") as HTMLElement;
    if (r.provider === "proxmox" && ["qemu", "lxc"].includes(r.kind)) {
      root.classList.add("pve-root");
      machinePanel(r, root);
    } else void resourcePanel(r, root);
  }
  async function resourcePanel(initial: Item, root: HTMLElement) {
    let resource = initial, detail: Item | null = null, catalog: Item = {}, busy = true, errors: string[] = [];
    let version = 0;
    const path = `/infrastructure/connections/${initial.connection_id}/resources/${initial.kind}/${encodeURIComponent(initial.id)}`;
    const catalogPath = `/infrastructure/connections/${initial.connection_id}/catalog?kind=${initial.kind}`;
    const allResources = () => {
      const known = [...inventory.connections.flatMap((c: Item) => c.resources || []), ...(ui.resourceInventory?.() || [])];
      return [...new Map(known.map((r: Item) => [r.connection_id+"/"+r.kind+"/"+r.id,r])).values()] as Item[];
    };
    function paint() {
      if (!root.isConnected) return;
      const siblings = allResources(), guests = relatedResources(resource, siblings);
      const allowed = Object.entries(catalog).filter(([id, s]: [string, any]) => (admin() || s.method === "GET") && (!resource.template || id === "clone" || s.method === "GET"));
      const secondary = ([id]: [string, any]) => /delete|remove|destroy|rename|migrate|clone/.test(id);
      const action = ([id, s]: [string, any]) => `<button class="secondary ${/delete|remove|destroy/.test(id) ? 'is-destructive' : ''}" data-infra-action="${esc(id)}">${esc(s.label)}</button>`;
      const actions = `<section class="resource-actions"><h3>Management</h3><p class="resource-note">${resource.agent ? 'Linked to a Speck endpoint agent.' : resource.management === 'host_agent' ? 'Managed through an outbound Speck host connector.' : 'Managed through the provider. Endpoint commands and patching require a Speck agent.'}</p><div class="resource-action-buttons">${resource.agent ? '<button class="secondary" data-resource-agent>Open Speck agent</button>' : ''}${resource.kind === 'virt' ? '<button class="secondary" data-resource-console>Open provider console</button>' : ''}${allowed.filter(a=>!secondary(a)).map(action).join('')}</div>${allowed.some(secondary) ? '<details class="resource-more"><summary>More actions</summary><div class="resource-action-buttons">'+allowed.filter(secondary).map(action).join('')+'</div></details>' : ''}</section>`;
      root.innerHTML = `<div class="resource-refresh"><span role="status">${busy ? 'Reading provider details…' : 'Provider details loaded'}</span><button class="text-link" data-resource-refresh ${busy ? 'disabled' : ''}>Refresh details</button></div>${errors.length ? '<p class="resource-notice">'+esc(errors.join(' '))+'</p>' : ''}${infrastructureStory(resource, detail, siblings, actions+(detail && ['linode','proxmox'].includes(resource.provider) ? '<section class="resource-performance"></section>' : ''))}${!busy && (resource.provider==='linode'||resource.kind==='protected') ? '<div data-provider-explorer></div>' : ''}${detail ? technicalDetail(detail) : ''}`;
      const explorer=root.querySelector<HTMLElement>('[data-provider-explorer]');
      if(explorer)mountProviderExplorer({...ui,openResource:resourceDetail},resource,explorer);
      root.querySelectorAll<HTMLElement>('[data-host-detail]').forEach(b=>b.onclick=()=>{
        const kind=b.dataset.hostDetail!,row=detail![kind][Number(b.dataset.hostIndex)];
        const title=kind==='storage'?row.storage:kind==='network'?row.iface:row.type || 'Provider task';
        const facts=kind==='storage'?[['Type',row.type],['Used',bytes(row.used)],['Capacity',bytes(row.total)],['Content',row.content],['Shared',row.shared==null?null:row.shared===1],['Enabled',row.enabled==null?null:row.enabled===1],['Active',row.active==null?null:row.active===1]]:kind==='network'?[['Interface',row.iface],['Type',row.type],['Address',row.cidr || row.address],['Gateway',row.gateway],['Bridge ports',row.bridge_ports],['VLAN aware',row.bridge_vlan_aware],['Autostart',row.autostart==null?null:row.autostart===1],['Active',row.active==null?null:row.active===1]]:[['Operation',row.type],['Resource ID',row.id],['User',row.user],['Result',row.status || 'Running'],['Started',detailDate(row.starttime)],['Finished',detailDate(row.endtime)],['Task ID',row.upid]];
        const p=ui.flyout(title,detailHero('Proxmox · '+kind.replaceAll('_',' '),null,resource.node || resource.name)+detailFacts(facts as [string,any][])+technicalDetail(row),{tone:'compute',subtitle:resource.connection_name});
        const back=document.createElement('button');back.className='text-link';back.textContent='← Back to host';back.onclick=()=>void resourceDetail(resource);p.querySelector('.resource-body')!.prepend(back);
      });
      const performanceRoot=root.querySelector<HTMLElement>('.resource-performance');
      if(performanceRoot) mountPerformance(ui,resource,performanceRoot);
      root.querySelector('[data-resource-refresh]')?.addEventListener('click',()=>void load(true));
      root.querySelector('[data-resource-agent]')?.addEventListener('click',()=> { root.closest('dialog')?.close(); void ui.openDevice(resource.agent.id); });
      root.querySelector('[data-resource-console]')?.addEventListener('click',()=>void openProviderConsole(ui,resource));
      root.querySelectorAll<HTMLElement>('[data-related-resource]').forEach(b=>b.onclick=()=>void resourceDetail(guests[Number(b.dataset.relatedResource)]));
      root.querySelectorAll<HTMLElement>('[data-infra-action]').forEach(b=>b.onclick=()=> {
        const id = b.dataset.infraAction!;
        void operationForm({id:resource.connection_id,name:resource.connection_name,provider:resource.provider},id,catalog[id],resource);
      });
    }
    async function load(fresh = false) {
      const current = ++version;
      busy = true; errors = []; paint();
      const read = fresh ? ui.freshApi : api;
      const results = await Promise.allSettled([read(path),read(catalogPath)]);
      if (!root.isConnected || current !== version) return;
      if (results[0].status === 'fulfilled') {
        detail = results[0].value;
        resource = {...initial,...detail!.resource};
      } else errors.push('Provider details could not be refreshed. Inventory information remains visible.');
      if (results[1].status === 'fulfilled') catalog = results[1].value;
      else errors.push('Management actions are unavailable.');
      busy = false; paint();
    }
    await load();
  }
  function input(f: Item): string {
    if (f.options)
      return `<select name="${esc(f.name)}">${f.options.map((o: any) => `<option value="${esc(typeof o === "string" ? o : o.value)}">${esc(typeof o === "string" ? o : o.label)}</option>`).join("")}</select>`;
    if (["textarea", "lines"].includes(f.type))
      return `<textarea name="${esc(f.name)}" rows="3" ${f.required ? "required" : ""}>${esc(f.default ?? "")}</textarea>`;
    return `<input name="${esc(f.name)}" type="${f.type === "number" ? "number" : f.type === "password" ? "password" : "text"}" value="${esc(f.default ?? "")}" ${f.required ? "required" : ""} ${f.minimum != null ? `min="${f.minimum}"` : ""} ${f.maximum != null ? `max="${f.maximum}"` : ""} autocomplete="off">`;
  }
  async function operationForm(c: Item, id: string, spec: Item, r?: Item) {
    const read = spec.method === "GET";
    const confirmation = !read && spec.requires_confirmation !== false;
    const immediate = !read && !confirmation && !spec.fields.length;
    const name = r?.name || c.name;
    const d = dialog(
      spec.label,
      `<form class="infra-form"><p>${esc(c.name)}${r ? " · " + esc(r.name) : ""}</p>${spec.danger ? '<p class="infra-error">This changes a live resource and may interrupt service or permanently delete data.</p>' : ""}${spec.fields.map((f: Item) => `<label>${esc(f.label)}${!f.required ? " (optional)" : ""}${input(f)}</label>`).join("")}${confirmation ? `<label>Type ${esc(name)} to confirm<input name="confirmation" autocomplete="off" required></label>` : ""}<button class="primary" type="submit">${read ? "Load" : esc(spec.label)}</button><div class="infra-operation-result" role="status"></div></form>`,
    );
    d.classList.add("infra-dialog");
    const form = d.querySelector("form")!;
    let requestID = crypto.randomUUID();
    let submittedArgs = "";
    form.onsubmit = async (e) => {
      e.preventDefault();
      const submit = form.querySelector(
        "button[type=submit]",
      ) as HTMLButtonElement;
      submit.disabled = true;
      const result = form.querySelector(".infra-operation-result")!;
      result.textContent = read ? "Loading…" : "Submitting request…";
      try {
        const fd = new FormData(form);
        const args: Item = {};
        for (const f of spec.fields) {
          const raw = String(fd.get(f.name) || "");
          if (raw !== "")
            args[f.name] =
              f.type === "number"
                ? Number(raw)
                : f.type === "lines"
                  ? raw
                      .split("\n")
                      .map((s) => s.trim())
                      .filter(Boolean)
                  : raw;
        }
        const currentArgs = JSON.stringify(args);
        if (submittedArgs && submittedArgs !== currentArgs)
          requestID = crypto.randomUUID();
        submittedArgs = currentArgs;
        const response = read
          ? await api(
              `/infrastructure/connections/${c.id}/read/${id}?args=${encodeURIComponent(currentArgs)}&kind=${r?.kind || "connection"}&resource_id=${encodeURIComponent(r?.id || "")}`,
            )
          : await api(`/infrastructure/connections/${c.id}/actions`, "POST", {
              request_id: requestID,
              kind: r?.kind || "connection",
              resource_id: r?.id || "",
              operation: id,
              args,
              confirmation: String(fd.get("confirmation") || ""),
            });
        result.innerHTML = read
          ? dataView(response)
          : `<h3>${esc(response.status)}</h3>${dataView(response.result)}<p>Inspect the resource and provider tasks for completion.</p>`;
        if (!read) {
          submit.hidden = true;
          form
            .querySelectorAll("input,textarea,select")
            .forEach((el) => ((el as HTMLInputElement).disabled = true));
        }
      } catch (error) {
        result.textContent = (error as Error).message;
      } finally {
        submit.disabled = false;
      }
    };
    if (immediate) form.requestSubmit();
  }
  async function connectionTools(c: Item) {
    const catalog = await api(`/infrastructure/connections/${c.id}/catalog`);
    if (!Object.keys(catalog).length) {
      section = "resources";
      connection = c.id;
      await render();
      return;
    }
    const d = dialog(
      c.name,
      `<div class="infra-tool-grid">${Object.entries(catalog)
        .filter(([, s]: [string, any]) => admin() || s.method === "GET")
        .map(([id, s]: [string, any]) => button("infra-tool-" + id, s.label))
        .join("")}</div>`,
    );
    Object.entries(catalog).forEach(([id, spec]) =>
      on("infra-tool-" + id, async () => {
        d.close();
        let fields = (spec as Item).fields;
        if (c.provider === "linode" && id === "create") {
          const meta = await api(
            `/infrastructure/connections/${c.id}/read/meta`,
          );
          fields = fields.map((f: Item) => ({
            ...f,
            options:
              meta[
                ({ type: "types", region: "regions", image: "images" } as Item)[
                  f.name
                ] || ""
              ]?.map((o: Item) => ({ value: o.id, label: o.label || o.id })) ||
              f.options,
          }));
        }
        await operationForm(c, id, { ...(spec as Item), fields });
      }),
    );
  }
  function confirmLocal(
    title: string,
    name: string,
    action: () => Promise<void>,
  ) {
    const d = dialog(
      title,
      `<form class="infra-form"><p>Type ${esc(name)} to confirm.</p><label>Name<input name="confirmation" required autocomplete="off"></label><button class="primary">Confirm</button><p role="status"></p></form>`,
    );
    const f = d.querySelector("form")!;
    f.onsubmit = async (e) => {
      e.preventDefault();
      const out = f.querySelector("[role=status]")!;
      if (new FormData(f).get("confirmation") !== name) {
        out.textContent = "The name does not match.";
        return;
      }
      try {
        await action();
        d.close();
      } catch (e) {
        out.textContent = (e as Error).message;
      }
    };
  }
  async function enroll(c: Item) {
    const issued = await api("/infrastructure/connectors/enrollments", "POST", {
      connection_id: c.id,
    });
    dialog(
      c.provider === "proxmox" ? "Enroll a Proxmox host" : "Enroll AustinLand",
      `<p>${c.provider === "austinland" ? "On the AustinLand host, run python -m speck.infrastructure_bridge --enroll --config /path/to/private/agent.json with this JSON on standard input. Then run it with --run under your service manager." : 'On a Proxmox host, install the <a href="/downloads/install-proxmox.sh" download>Proxmox installer</a> as root with SPECK_SERVER set to this server. Supply this JSON on standard input.'} The enrollment expires in 15 minutes and works once.</p><label>Enrollment JSON<textarea readonly rows="5">${esc(JSON.stringify({ server: location.origin, token: issued.token }, null, 2))}</textarea></label><p>One host agent can manage its cluster. Enroll additional hosts for availability. Credentials stay on the host and requests use outbound HTTPS.</p>`,
    );
  }
  function editConnection(c?: Item) {
    const d = dialog(
      c ? "Edit connection" : "Add infrastructure connection",
      `<form class="infra-form"><label>Name<input name="name" required value="${esc(c?.name || "")}"></label><label>Provider<select name="provider" ${c ? "disabled" : ""}>${Object.entries(
        labels,
      )
        .map(
          ([key, label]) =>
            `<option value="${key}" ${c?.provider === key ? "selected" : ""}>${label}</option>`,
        )
        .join(
          "",
        )}</select></label><label class="check"><input name="connector" type="checkbox" ${!c || c.connector ? "checked" : ""}> Use outbound agent</label><label data-direct>API origin<input name="url" type="url" value="${esc(c?.url || "")}"></label><label data-direct>API token / bridge credential<input type="password" name="token" autocomplete="new-password" ${c ? 'placeholder="Leave blank to keep existing credential"' : ""}></label><label data-pve>Proxmox token ID<input name="token_id" placeholder="speck@pve!management"></label><label data-pve class="check"><input name="verify_tls" type="checkbox" ${!c || c.verify_tls ? "checked" : ""}> Verify TLS certificate</label><p class="muted">Credentials are encrypted on the server and never returned to your browser. A host agent uses the host’s local Proxmox identity.</p><button type="submit" class="primary">Save connection</button><p role="status"></p></form>`,
    );
    const f = d.querySelector("form")!;
    const select = f.elements.namedItem("provider") as HTMLSelectElement;
    const check = f.elements.namedItem("connector") as HTMLInputElement;
    const update = () => {
      const p = select.value;
      check.parentElement!.hidden = !["proxmox", "austinland"].includes(p);
      const use = ["proxmox", "austinland"].includes(p) && check.checked;
      f.querySelectorAll<HTMLElement>("[data-direct]").forEach(
        (el) => (el.hidden = use),
      );
      f.querySelectorAll<HTMLElement>("[data-pve]").forEach(
        (el) => (el.hidden = p !== "proxmox" || use),
      );
      if (!c)
        (f.elements.namedItem("url") as HTMLInputElement).value =
          {
            linode: "https://api.linode.com",
            slide: "https://api.slide.tech",
            austinland: "http://127.0.0.1:8473",
          }[p] || "";
    };
    select.onchange = update;
    check.onchange = update;
    update();
    f.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(f),
        submit = f.querySelector("button")!;
      submit.disabled = true;
      try {
        const saved = await api(
          "/infrastructure/connections" + (c ? "/" + c.id : ""),
          c ? "PUT" : "POST",
          {
            name: fd.get("name"),
            provider: select.value,
            url: fd.get("url"),
            token: fd.get("token"),
            token_id: fd.get("token_id"),
            verify_tls: fd.has("verify_tls"),
            connector:
              ["proxmox", "austinland"].includes(select.value) && check.checked,
          },
        );
        d.close();
        await render();
        if (saved.connector && !c) await enroll(saved);
      } catch (e) {
        f.querySelector("[role=status]")!.textContent = (e as Error).message;
      } finally {
        submit.disabled = false;
      }
    };
  }
  return { render, resourceDetail, machinePanel, resourcePanel, reset: () => { inventory = {connections:[]}; agents = []; } };
}
