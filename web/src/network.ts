import "./network.css";
import { mountSiteMap, mappedSites } from "./site-map";
import { metricValue } from "./performance";
import { capacity, detailDate } from "./resource-story";
import { icon } from "./icons";
import { expiresWithin, fqdn, parseRecordValues, relative } from "./network-model";
import { cardify } from "./table-cards";
import { detailHero, detailFacts, detailSection, technicalDetail } from "./resource-story";

type Item = Record<string, any>;
export function createNetwork(ui: Item) {
  const { api, esc, notify, content, loading, badge } = ui;
  const dialog: (title: string, html: string, options?: Item) => HTMLDialogElement = ui.dialog;
  const admin = () => ui.role() === "admin";
  let tab = "sites";
  let sites: Item[] | null = null, siteError = "", clientScope = "", clientView = "recent", clientLink = "all", clientSort = "activity", clientGeneration = 0;
  const siteKey = (s: Item) => s.console_id+"|"+s.id;
  let domainQuery = "",
    domainFilter = "all",
    clientQuery = "",
    reachQuery = "",
    reachMachine = "",
    reachFilter = "public";
  let status: Item = {},
    domains: Item[] = [],
    pool: Item = { pool: [] },
    unifiStatus: Item = {},
    clients: Item[] | null = null,
    consoles: Item[] | null = null;
  let map: Item = { machines: [], ips: {} };
  let mapReady = false;
  let pane: HTMLDialogElement | null = null;
  let scanTimer = 0;
  const PAGE = 100;
  let domainLimit = PAGE,
    clientLimit = PAGE;

  const chip = (text: string, tone = "") => `<span class="net-chip ${tone}">${esc(text)}</span>`;
  const owners = (ip: string) => (map.ips[ip]?.machines || []) as Item[];
  const ownerChips = (ip: string) =>
    owners(ip)
      .map((m) => chip(m.label, "machine"))
      .join("");
  const expiresSoon = (d: Item) => expiresWithin(d.expires, 60);
  const none = '<span class="placeholder">—</span>';

  async function render() {
    loading("Loading network…");
    window.clearTimeout(scanTimer);
    // The header refresh reloads every tab; UniFi clients come from a 30-second server cache.
    clients = consoles = sites = null;
    const mapRequest = api("/network/map").catch(() => null);
    const metadata = Promise.all([
      api("/dns/status").catch(() => ({})),
      api("/dns/domains").then((r: Item) => r.domains).catch(() => []),
      api("/unifi/pool").catch((e: Error) => ({ pool: [], error: e.message })),
      api("/unifi/status").catch(() => ({})),
    ]);
    // Sites can render without waiting for DNS zones or the managed gateway.
    frame();
    const body=document.getElementById('net-body');
    mapRequest.then((m: Item | null) => {
      if (!m || body !== document.getElementById("net-body")) return;
      map = m; mapReady = true; summary();
      if(tab!=='sites'&&tab!=='consoles')renderTab();
    });
    const values=await metadata;
    if(body!==document.getElementById('net-body'))return;
    [status, domains, pool, unifiStatus]=values;
    document.getElementById('net-notices')!.innerHTML=notices();
    document.getElementById('net-tab-domains')!.textContent=`Domains (${domains.length})`;
    document.getElementById('net-tab-ips')!.textContent=`Public IPs (${pool.pool.length})`;
    summary();
    if(tab!=='sites'&&tab!=='consoles')renderTab();
  }
  function notices(){
    return (status.configured===false?`<div class="callout">GoDaddy is not configured. ${admin() ? 'Add it under <a href="#keys">Keys → Providers</a>.' : "Ask an administrator to add it."}</div>`:'')+
      (unifiStatus.configured===false?`<div class="callout">UniFi is not configured. ${admin() ? 'Add the Site Manager key under <a href="#keys">Keys → Providers</a>.' : ""}</div>`:unifiStatus.error?`<div class="callout">UniFi gateway unavailable: ${esc(unifiStatus.error)}</div>`:'');
  }

  function frame() {
    const tabs = [
      ["sites", "Sites & health"],
      ["domains", `Domains (${domains.length})`],
      ["ips", `Public IPs (${pool.pool.length})`],
      ["reach", "Reachability"],
      ["clients", "LAN clients"],
      ["consoles", "UniFi consoles"],
    ];
    content(
      `<div id="net-notices">${notices()}</div><div class="infra-tabs" role="tablist" aria-label="Network views">${tabs
        .map(
          ([id, label]) =>
            `<button role="tab" data-tab="${id}" id="net-tab-${id}" aria-selected="${tab === id}" class="${tab === id ? "active" : ""}">${esc(label)}</button>`,
        )
        .join("")}</div><div id="net-body"></div>`,
    );
    document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((b) =>
      b.addEventListener("click", () => {
        tab = b.dataset.tab!;
        document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((x) => {
          x.classList.toggle("active", x === b);
          x.setAttribute("aria-selected", String(x === b));
        });
        renderTab();
      }),
    );
    summary();
    renderTab();
  }

  function summary() {
    const count = (s: string) => pool.pool.filter((p: Item) => p.status === s).length;
    const linked = mapReady ? map.machines.filter((m: Item) => m.dns.length).length : null;
    ui.summary?.(`<span><b>${domains.length}</b> domains</span><span><b>${count("free")}</b> free public IPs</span><span><b>${count("assigned")}</b> mappings</span><span><b>${linked ?? "…"}</b> machines reachable by name</span>`);
  }

  function renderTab() {
    const body = document.getElementById("net-body");
    if (!body) return;
    if (tab === "sites") return sitesTab(body);
    if (tab === "domains") return domainsTab(body);
    if (tab === "ips") return ipsTab(body);
    if (tab === "reach") return reachTab(body);
    if (tab === "clients") return clientsTab(body);
    return consolesTab(body);
  }

  // ---------------- domains ----------------

  function scanLine() {
    const scan = status.scan || {};
    if (scan.running)
      return `<div class="net-scan" role="status"><progress max="${scan.total || 1}" value="${scan.done || 0}"></progress><span>Refreshing zones: ${scan.done} of ${scan.total}${scan.errors ? ` · ${scan.errors} errors` : ""}</span>${admin() ? '<button class="text-link" id="net-scan-stop">Stop</button>' : ""}</div>`;
    return `<div class="net-scan"><span>${status.zones_cached || 0} of ${domains.length} zones cached · oldest ${esc(relative(status.oldest_zone_at))} · list ${esc(relative(status.domains_fetched_at))}</span>${admin() && status.configured ? '<button class="secondary" id="net-scan">' + icon("refresh") + "<span>Refresh stale zones</span></button>" : ""}</div>`;
  }

  function filteredDomains() {
    const q = domainQuery.toLowerCase();
    return domains.filter((d) => {
      if (q && !d.domain.includes(q) && !(d.apex || []).some((ip: string) => ip.includes(q) || owners(ip).some((m) => m.label.toLowerCase().includes(q))))
        return false;
      if (domainFilter === "linked") return (d.apex || []).some((ip: string) => owners(ip).length);
      if (domainFilter === "expiring") return expiresSoon(d);
      if (domainFilter === "manual") return !d.renewAuto;
      if (domainFilter === "unlocked") return !d.locked;
      if (domainFilter === "uncached") return !d.zone_cached_at;
      return true;
    });
  }

  function domainsTab(body: HTMLElement) {
    body.innerHTML = `<div class="infra-toolbar net-toolbar"><label class="infra-search">Search<input id="net-domain-q" type="search" placeholder="Domain, apex IP or machine" value="${esc(domainQuery)}"></label><label>Show<select id="net-domain-filter">${[
      ["all", "All domains"],
      ["linked", "Pointing at a known machine"],
      ["expiring", "Expiring within 60 days"],
      ["manual", "Auto-renew off"],
      ["unlocked", "Transfer lock off"],
      ["uncached", "Zone not cached"],
    ]
      .map(([v, l]) => `<option value="${v}" ${domainFilter === v ? "selected" : ""}>${l}</option>`)
      .join("")}</select></label></div>${scanLine()}<div id="net-domain-rows"></div><div id="net-record-hits"></div>`;
    const input = body.querySelector<HTMLInputElement>("#net-domain-q")!;
    let timer = 0;
    input.addEventListener("input", () => {
      domainQuery = input.value.trim();
      domainLimit = PAGE;
      domainRows();
      window.clearTimeout(timer);
      if (domainQuery.length < 3) recordHits();
      else timer = window.setTimeout(recordHits, 350);
    });
    body.querySelector<HTMLSelectElement>("#net-domain-filter")!.addEventListener("change", (e) => {
      domainFilter = (e.target as HTMLSelectElement).value;
      domainLimit = PAGE;
      domainRows();
    });
    body.querySelector("#net-scan")?.addEventListener("click", startScan);
    body.querySelector("#net-scan-stop")?.addEventListener("click", async () => {
      status.scan = await api("/dns/scan", "DELETE");
      renderTab();
    });
    domainRows();
    recordHits();
    if (status.scan?.running) pollScan();
  }

  function domainRows() {
    const el = document.getElementById("net-domain-rows");
    if (!el) return;
    const rows = filteredDomains();
    const flags = (d: Item) =>
      [!d.renewAuto && chip("manual renew", "warn"), !d.locked && chip("unlocked", "warn"), !d.privacy && chip("no privacy"), expiresSoon(d) && chip("expires soon", "warn")]
        .filter(Boolean)
        .join("");
    el.innerHTML = rows.length
      ? `<div class="infra-table-wrap"><table class="net-table net-compact"><thead><tr><th>Domain</th><th>Apex points to</th><th>Records</th><th>Expires</th><th>Attention</th></tr></thead><tbody>${rows
          .slice(0, domainLimit)
          .map(
            (d, i) =>
              `<tr><td><button class="text-link net-name" data-domain="${i}">${esc(d.domain)}</button></td><td>${
                (d.apex || []).length
                  ? (d.apex as string[]).map((ip) => (ip === "Parked" ? '<span class="placeholder">GoDaddy parking</span>' : `<span class="mono">${esc(ip)}</span>${ownerChips(ip)}`)).join(" ")
                  : `<span class="placeholder">${d.zone_cached_at ? "No apex record" : "Not cached"}</span>`
              }</td><td>${d.record_count ?? '<span class="placeholder">—</span>'}</td><td>${esc(d.expires ? new Date(d.expires).toLocaleDateString() : "—")}</td><td class="net-flags">${flags(d) || '<span class="placeholder">—</span>'}</td></tr>`,
          )
          .join("")}</tbody></table></div>${rows.length > domainLimit ? `<button class="secondary net-more" id="net-domains-more">Show ${Math.min(PAGE, rows.length - domainLimit)} more of ${rows.length - domainLimit} remaining</button>` : ""}`
      : `<div class="empty"><h2>No matching domains</h2><p>${domains.length ? "Change the search or filter." : "Connect GoDaddy to list domains."}</p></div>`;
    el.querySelector("#net-domains-more")?.addEventListener("click", () => {
      domainLimit += PAGE;
      domainRows();
    });
    el.querySelectorAll<HTMLButtonElement>("[data-domain]").forEach((b) =>
      b.addEventListener("click", () => openDomain(rows[+b.dataset.domain!])),
    );
    cardify(el);
  }

  async function recordHits() {
    const el = document.getElementById("net-record-hits");
    if (!el) return;
    if (domainQuery.length < 3) {
      el.innerHTML = "";
      return;
    }
    const query = domainQuery;
    const result = await api("/dns/search?q=" + encodeURIComponent(query) + "&limit=60").catch(() => null);
    if (!result || query !== domainQuery || !document.getElementById("net-record-hits")) return;
    el.innerHTML = result.results.length
      ? `<h3 class="net-subhead">Records matching “${esc(query)}”</h3><div class="infra-table-wrap"><table class="net-table"><thead><tr><th>Name</th><th>Type</th><th>Value</th><th>Reaches</th></tr></thead><tbody>${result.results
          .map(
            (r: Item) =>
              `<tr><td><button class="text-link" data-hit="${esc(r.domain)}">${esc(r.fqdn)}</button></td><td>${esc(r.type)}</td><td class="mono">${esc(r.data)}</td><td>${ownerChips(r.data)}</td></tr>`,
          )
          .join("")}</tbody></table></div>${result.truncated ? '<p class="muted">More records match; refine the search.</p>' : ""}`
      : "";
    cardify(el);
    el.querySelectorAll<HTMLButtonElement>("[data-hit]").forEach((b) =>
      b.addEventListener("click", () => {
        const d = domains.find((x) => x.domain === b.dataset.hit);
        if (d) openDomain(d);
      }),
    );
  }

  async function startScan() {
    status.scan = await api("/dns/scan", "POST", { stale_hours: 24 });
    notify(status.scan.total ? `Refreshing ${status.scan.total} zones older than a day` : "All zones were refreshed within the last day");
    renderTab();
  }

  function pollScan() {
    window.clearTimeout(scanTimer);
    scanTimer = window.setTimeout(async () => {
      if (tab !== "domains" || !document.getElementById("net-body")) return;
      status = await api("/dns/status").catch(() => status);
      const el = document.querySelector(".net-scan");
      if (el) el.outerHTML = scanLine();
      document.getElementById("net-scan-stop")?.addEventListener("click", async () => {
        status.scan = await api("/dns/scan", "DELETE");
        renderTab();
      });
      if (status.scan?.running) pollScan();
      else {
        domains = (await api("/dns/domains")).domains;
        summary();
        renderTab();
      }
    }, 3000);
  }

  function closePane() {
    pane?.close();
    pane = null;
  }

  function recordGroups(records: Item[]) {
    const order = ["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV", "CAA", "SOA"];
    const groups = new Map<string, Item[]>();
    for (const r of records) {
      const key = r.type + "\u0000" + r.name;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }
    return [...groups.values()].sort(
      (a, b) =>
        (order.indexOf(a[0].type) + 1 || 99) - (order.indexOf(b[0].type) + 1 || 99) ||
        (a[0].name === "@" ? -1 : b[0].name === "@" ? 1 : a[0].name.localeCompare(b[0].name)),
    );
  }

  async function openDomain(d: Item, fresh = false) {
    // Reuse an open pane for the same domain so refreshes keep scroll position and feedback.
    let panel = pane?.open && pane.dataset.domain === d.domain ? pane : null;
    if (!panel) {
      closePane();
      panel = ui.flyout(d.domain, `<div class="net-pane" id="net-pane">${ui.loadingState ? ui.loadingState("Loading records…") : "Loading…"}</div>`, {
        className: "net-drawer", tone: "network", subtitle: "DNS domain · GoDaddy",
      });
      panel!.dataset.domain = d.domain;
      pane = panel;
    }
    let zone: Item;
    try {
      zone = await (fresh ? ui.freshApi : api)(`/dns/domains/${encodeURIComponent(d.domain)}/records${fresh ? "" : "?cached=true"}`);
    } catch (err) {
      if (!panel?.open) return;
      panel.querySelector("#net-pane")!.innerHTML = `<div class="empty" role="alert"><h2>Unable to load records</h2><p>${esc((err as Error).message)}</p></div>`;
      return;
    }
    if (pane !== panel || !panel?.open) return;
    const groups = recordGroups(zone.records);
    const reach = [...new Set(zone.records.filter((r: Item) => ["A", "AAAA"].includes(r.type)).flatMap((r: Item) => owners(r.data).map((m) => m.label)))];
    panel.querySelector("#net-pane")!.innerHTML = `<div class="net-facts"><div><span>Expires</span><b>${esc(d.expires ? new Date(d.expires).toLocaleDateString() : "—")}</b></div><div><span>Renewal</span><b>${d.renewAuto ? "Automatic" : "Manual"}</b></div><div><span>Transfer lock</span><b>${d.locked ? "On" : "Off"}</b></div><div><span>Privacy</span><b>${d.privacy ? "On" : "Off"}</b></div><div><span>Records</span><b>${zone.records.length}</b></div><div><span>${zone.cached ? "Cached" : "Fetched"}</span><b>${esc(relative(zone.fetched_at))}</b></div></div>${
      reach.length ? `<p class="net-reach">Reaches ${reach.map((l) => chip(l as string, "machine")).join("")}</p>` : ""
    }<div class="net-pane-actions"><button class="secondary" id="net-refresh-zone">${icon("refresh")}<span>Fetch from GoDaddy</span></button>${
      admin() ? `<button class="primary" id="net-point">Point a name</button><button class="secondary" id="net-add-record">${icon("plus")}<span>Add record</span></button>` : ""
    }</div><div class="infra-table-wrap"><table class="net-table net-records"><thead><tr><th>Type</th><th>Name</th><th>Value</th><th>TTL</th>${admin() ? "<th></th>" : ""}</tr></thead><tbody>${groups
      .map(
        (g, i) =>
          `<tr><td><b>${esc(g[0].type)}</b></td><td class="mono">${esc(g[0].name)}</td><td>${g
            .map(
              (r: Item) =>
                `<div class="net-value"><span class="mono">${r.priority !== undefined && ["MX", "SRV"].includes(r.type) ? esc(r.priority) + " " : ""}${esc(r.data)}</span>${["A", "AAAA"].includes(r.type) ? ownerChips(r.data) : ""}</div>`,
            )
            .join("")}</td><td>${esc(g[0].ttl)}</td>${
            admin()
              ? `<td class="net-row-actions">${["SOA", "NS"].includes(g[0].type) && g[0].name === "@" ? "" : `<button class="secondary" data-edit="${i}">Edit</button><button class="secondary" data-delete="${i}">Delete</button>`}</td>`
              : ""
          }</tr>`,
      )
      .join("")}</tbody></table></div>`;
    cardify(panel);
    panel.querySelector("#net-refresh-zone")?.addEventListener("click", () => openDomain(d, true));
    panel.querySelector("#net-point")?.addEventListener("click", () => pointDialog(d));
    panel.querySelector("#net-add-record")?.addEventListener("click", () => recordDialog(d));
    panel.querySelectorAll<HTMLButtonElement>("[data-edit]").forEach((b) =>
      b.addEventListener("click", () => recordDialog(d, groups[+b.dataset.edit!])),
    );
    panel.querySelectorAll<HTMLButtonElement>("[data-delete]").forEach((b) =>
      b.addEventListener("click", () => deleteSet(d, groups[+b.dataset.delete!])),
    );
  }

  function confirmChange(title: string, html: string, action: string, typed = ""): Promise<boolean> {
    return new Promise((resolve) => {
      let done = false;
      const d = dialog(
        title,
        `<div class="net-confirm">${html}${typed ? `<label>Type <b>${esc(typed)}</b> to confirm<input id="net-confirm-typed" autocomplete="off" spellcheck="false"></label>` : ""}<div class="dialog-footer"><button class="secondary" id="net-confirm-cancel">Cancel</button><button class="primary" id="net-confirm-ok" ${typed ? "disabled" : ""}>${esc(action)}</button></div></div>`,
      );
      const ok = d.querySelector<HTMLButtonElement>("#net-confirm-ok")!;
      d.querySelector<HTMLInputElement>("#net-confirm-typed")?.addEventListener("input", (e) => {
        ok.disabled = (e.target as HTMLInputElement).value.trim() !== typed;
      });
      d.querySelector("#net-confirm-cancel")!.addEventListener("click", () => d.close());
      ok.addEventListener("click", () => {
        done = true;
        d.close();
      });
      d.addEventListener("close", () => resolve(done));
    });
  }

  function knownPublicIps() {
    const ips = new Map<string, string>();
    for (const p of pool.pool as Item[]) if (p.status !== "gateway") ips.set(p.ip, p.assigned_to || p.status);
    for (const m of map.machines as Item[]) for (const p of m.public) ips.set(p.ip, m.label);
    return [...ips.entries()].sort();
  }

  function pointDialog(d: Item) {
    const d2 = dialog(
      "Point a name at an IP",
      `<form class="net-form" id="net-point-form"><p>Creates or replaces the A record so the name resolves to one IPv4 address.</p><label>Name<input id="net-point-name" value="@" required spellcheck="false" aria-describedby="net-point-help"></label><small class="net-help" id="net-point-help">@ for ${esc(d.domain)}, or a subdomain label such as <span class="mono">www</span></small><label>IPv4 address<input id="net-point-ip" list="net-known-ips" required inputmode="decimal" spellcheck="false" placeholder="160.72.186.114"></label><datalist id="net-known-ips">${knownPublicIps()
        .map(([ip, label]) => `<option value="${esc(ip)}">${esc(label)}</option>`)
        .join("")}</datalist><label>TTL (seconds)<input id="net-point-ttl" type="number" min="600" value="600"></label><div class="dialog-footer"><button type="button" class="secondary" id="net-point-cancel">Cancel</button><button class="primary">Review change</button></div></form>`, { className: "wide" });
    d2.querySelector("#net-point-cancel")!.addEventListener("click", () => d2.close());
    d2.querySelector("form")!.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = (d2.querySelector("#net-point-name") as HTMLInputElement).value.trim() || "@";
      const ip = (d2.querySelector("#net-point-ip") as HTMLInputElement).value.trim();
      const ttl = +(d2.querySelector("#net-point-ttl") as HTMLInputElement).value || 600;
      const target = fqdn(d.domain, name);
      const current = (await api(`/dns/domains/${encodeURIComponent(d.domain)}/records?cached=true`)).records.filter(
        (r: Item) => r.type === "A" && r.name === name,
      );
      d2.close();
      const ok = await confirmChange(
        "Update DNS",
        `<p><b>${esc(target)}</b> will resolve to <span class="mono">${esc(ip)}</span>${ownerChips(ip)}.</p>${
          current.length ? `<p>Replaces ${current.map((r: Item) => `<span class="mono">${esc(r.data)}</span>`).join(", ")}.</p>` : "<p>This creates a new A record.</p>"
        }<p class="muted">DNS changes can take up to the TTL to reach resolvers.</p>`,
        "Update DNS",
      );
      if (!ok) return;
      await api(`/dns/domains/${encodeURIComponent(d.domain)}/point`, "POST", { name, ip, ttl });
      notify(`${target} now points to ${ip}`);
      await afterDnsWrite(d);
    });
  }

  function recordDialog(d: Item, group?: Item[]) {
    const first = group?.[0];
    const d2 = dialog(
      group ? `Edit ${first!.type} ${first!.name}` : "Add DNS record",
      `<form class="net-form"><div class="net-form-row"><label>Type<select id="net-rec-type" ${group ? "disabled" : ""}>${["A", "AAAA", "CNAME", "TXT", "MX", "NS", "SRV", "CAA"]
        .map((t) => `<option ${first?.type === t ? "selected" : ""}>${t}</option>`)
        .join("")}</select></label><label>Name<input id="net-rec-name" value="${esc(first?.name || "")}" ${group ? "disabled" : ""} placeholder="@ or www" required spellcheck="false"></label></div><label>${group ? "Values (one per line)" : "Value"}<textarea id="net-rec-values" rows="${group ? Math.min(8, group.length + 1) : 2}" spellcheck="false" required aria-describedby="net-rec-help">${esc((group || []).map((r) => r.data).join("\n"))}</textarea></label><small class="net-help" id="net-rec-help">${group ? "Saving replaces every value in this set." : "Adding keeps existing records with the same type and name."}</small><div class="net-form-row"><label>TTL (seconds)<input id="net-rec-ttl" type="number" min="600" value="${esc(first?.ttl || 600)}"></label><label>Priority (MX/SRV)<input id="net-rec-priority" type="number" min="0" value="${esc(first?.priority ?? "")}"></label></div><div class="dialog-footer"><button type="button" class="secondary" id="net-rec-cancel">Cancel</button><button class="primary">Review change</button></div></form>`, { className: "wide" });
    d2.querySelector("#net-rec-cancel")!.addEventListener("click", () => d2.close());
    d2.querySelector("form")!.addEventListener("submit", async (e) => {
      e.preventDefault();
      const type = (d2.querySelector("#net-rec-type") as HTMLSelectElement).value;
      const name = (d2.querySelector("#net-rec-name") as HTMLInputElement).value.trim();
      const values = parseRecordValues((d2.querySelector("#net-rec-values") as HTMLTextAreaElement).value);
      const ttl = +(d2.querySelector("#net-rec-ttl") as HTMLInputElement).value || 600;
      const priorityText = (d2.querySelector("#net-rec-priority") as HTMLInputElement).value;
      const priority = priorityText === "" ? undefined : +priorityText;
      if (!values.length) return notify("Enter a value", true);
      d2.close();
      const target = fqdn(d.domain, name);
      const ok = await confirmChange(
        group ? "Replace record set" : "Add record",
        `<p>${group ? "Replace" : "Add"} <b>${esc(type)}</b> on <b>${esc(target)}</b>:</p><ul class="net-change">${values.map((v) => `<li class="mono">${esc(v)}</li>`).join("")}</ul>${
          group ? `<p class="muted">Current: ${group.map((r) => esc(r.data)).join(", ")}</p>` : ""
        }`,
        group ? "Replace set" : "Add record",
      );
      if (!ok) return;
      const records = values.map((data) => ({ type, name, data, ttl, ...(priority === undefined ? {} : { priority }) }));
      if (group) await api(`/dns/domains/${encodeURIComponent(d.domain)}/records/${type}/${encodeURIComponent(name)}`, "PUT", { records });
      else await api(`/dns/domains/${encodeURIComponent(d.domain)}/records`, "POST", records[0]);
      notify(group ? "Record set replaced" : "Record added");
      await afterDnsWrite(d);
    });
  }

  async function deleteSet(d: Item, group: Item[]) {
    const r = group[0];
    const target = fqdn(d.domain, r.name);
    const ok = await confirmChange(
      "Delete record set",
      `<p>Delete every <b>${esc(r.type)}</b> record on <b>${esc(target)}</b>:</p><ul class="net-change">${group.map((x) => `<li class="mono">${esc(x.data)}</li>`).join("")}</ul>`,
      "Delete",
      target,
    );
    if (!ok) return;
    await api(`/dns/domains/${encodeURIComponent(d.domain)}/records/${r.type}/${encodeURIComponent(r.name)}`, "DELETE");
    notify("Record set deleted");
    await afterDnsWrite(d);
  }

  async function afterDnsWrite(d: Item) {
    const open = pane;
    domains = (await api("/dns/domains")).domains;
    const updated = domains.find((x) => x.domain === d.domain) || d;
    if (tab === "domains") domainRows();
    // Refresh the records pane only if it is still open; never resurrect one the user closed.
    if (open?.open && pane === open) await openDomain(updated);
  }

  // ---------------- public IPs ----------------

  function ipsTab(body: HTMLElement) {
    if (pool.error) {
      body.innerHTML = `<div class="empty" role="alert"><h2>Public IPs unavailable</h2><p>${esc(pool.error)}</p></div>`;
      return;
    }
    const tone: Item = { free: "good", assigned: "machine", in_use: "warn", gateway: "" };
    const label: Item = { free: "Free", assigned: "Speck-managed", in_use: "Other rule", gateway: "Gateway" };
    body.innerHTML = `<p class="muted net-note">${esc(pool.gateway_name || "Gateway")} · all TCP/UDP ports except 500 and 4500 forward to the mapped host, and its outbound traffic uses the same address. The host's own firewall is its only guard.</p><div class="infra-table-wrap"><table class="net-table"><thead><tr><th>Public IP</th><th>Status</th><th>Mapping</th><th>LAN host</th><th>DNS names</th>${admin() ? "<th></th>" : ""}</tr></thead><tbody>${(pool.pool as Item[])
      .map((p, i) => {
        const info = map.ips[p.ip] || {};
        const names: string[] = info.dns || [];
        const lan = p.lan_ip || info.mapping?.lan_ip;
        return `<tr class="net-ip-${p.status}"><td class="mono ip"><button class="text-link" data-ip-detail="${i}" aria-haspopup="dialog">${esc(p.ip)}</button></td><td>${chip(label[p.status] || p.status, tone[p.status])}</td><td>${p.assigned_to ? esc(p.assigned_to) : none}</td><td>${
          lan ? `<span class="mono">${esc(lan)}</span>${ownerChips(lan)}${info.lan_client && !owners(lan).length ? chip(info.lan_client) : ""}` : none
        }</td><td>${names.slice(0, 3).map((n) => chip(n)).join("")}${names.length > 3 ? `<small>+${names.length - 3} more</small>` : ""}</td>${
          admin()
            ? `<td class="net-row-actions">${p.status === "free" ? `<button class="secondary" data-map="${i}">Map to host</button>` : p.status === "assigned" ? `<button class="secondary" data-unmap="${i}">Remove</button>` : ""}</td>`
            : ""
        }</tr>`;
      })
      .join("")}</tbody></table></div>`;
    cardify(body);
    body.querySelectorAll<HTMLButtonElement>('[data-ip-detail]').forEach(b=>b.onclick=()=>openIp(pool.pool[Number(b.dataset.ipDetail)]));
    body.querySelectorAll<HTMLButtonElement>("[data-map]").forEach((b) => b.addEventListener("click", () => mapDialog(pool.pool[+b.dataset.map!])));
    body.querySelectorAll<HTMLButtonElement>("[data-unmap]").forEach((b) => b.addEventListener("click", () => unmap(pool.pool[+b.dataset.unmap!])));
  }

  function lanTargets() {
    const out: Item[] = [];
    for (const m of map.machines as Item[]) for (const l of m.lan) out.push({ ip: l.ip, label: m.label, detail: m.provider });
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }

  function mapDialog(p: Item) {
    const targets = lanTargets();
    const d = dialog(
      "Map " + p.ip,
      `<form class="net-form"><p>Forward all ports on <span class="mono">${esc(p.ip)}</span> to a LAN host and send its outbound traffic from this address.</p><label>Machine<select id="net-map-target"><option value="">Enter a LAN IP instead…</option>${targets
        .map((t, i) => `<option value="${i}">${esc(t.label)} · ${esc(t.ip)}</option>`)
        .join("")}</select></label><label>LAN IP<input id="net-map-lan" required inputmode="decimal" spellcheck="false" placeholder="192.168.110.20"></label><label>Mapping name<input id="net-map-name" required maxlength="60" pattern="[A-Za-z0-9][A-Za-z0-9 ._-]*" spellcheck="false"></label><div class="dialog-footer"><button type="button" class="secondary" id="net-map-cancel">Cancel</button><button class="primary">Review change</button></div></form>`, { className: "wide" });
    const select = d.querySelector<HTMLSelectElement>("#net-map-target")!;
    select.addEventListener("change", () => {
      const t = targets[+select.value];
      if (!t) return;
      (d.querySelector("#net-map-lan") as HTMLInputElement).value = t.ip;
      (d.querySelector("#net-map-name") as HTMLInputElement).value = t.label.replace(/[^A-Za-z0-9 ._-]/g, "-").slice(0, 60);
    });
    d.querySelector("#net-map-cancel")!.addEventListener("click", () => d.close());
    d.querySelector("form")!.addEventListener("submit", async (e) => {
      e.preventDefault();
      const lan_ip = (d.querySelector("#net-map-lan") as HTMLInputElement).value.trim();
      const name = (d.querySelector("#net-map-name") as HTMLInputElement).value.trim();
      d.close();
      const ok = await confirmChange(
        "Expose a host on a public IP",
        `<p><span class="mono">${esc(p.ip)}</span> → <span class="mono">${esc(lan_ip)}</span>${ownerChips(lan_ip)}</p><p>Every port except 500 and 4500 becomes reachable from the Internet. Confirm the host's firewall first.</p>`,
        "Create mapping",
        p.ip,
      );
      if (!ok) return;
      await api("/unifi/expose", "POST", { public_ip: p.ip, lan_ip, name });
      notify(`${p.ip} now forwards to ${lan_ip}`);
      await refreshIps();
    });
  }

  async function unmap(p: Item) {
    const names: string[] = map.ips[p.ip]?.dns || [];
    const ok = await confirmChange(
      "Remove public IP mapping",
      `<p>Stop forwarding <span class="mono">${esc(p.ip)}</span> to <span class="mono">${esc(p.lan_ip || "")}</span> (${esc(p.assigned_to || "")}) and remove its outbound rule.</p>${
        names.length ? `<div class="callout">${names.length} DNS name${names.length === 1 ? "" : "s"} still point here: ${names.slice(0, 6).map((n) => esc(n)).join(", ")}${names.length > 6 ? "…" : ""}</div>` : ""
      }`,
      "Remove mapping",
      p.ip,
    );
    if (!ok) return;
    await api("/unifi/unexpose", "POST", { public_ip: p.ip });
    notify(`Removed the mapping for ${p.ip}`);
    await refreshIps();
  }

  async function refreshIps() {
    [pool, map] = await Promise.all([api("/unifi/pool"), api("/network/map")]);
    mapReady = true;
    summary();
    renderTab();
  }

  // ---------------- reachability ----------------

  function reachTab(body: HTMLElement) {
    if (!mapReady) {
      body.innerHTML = ui.loadingState ? ui.loadingState("Tracing addresses…") : "Loading…";
      return;
    }
    body.innerHTML = `<p class="muted net-note">How each machine is reached: LAN addresses (from agents or exact UniFi MAC matches), public addresses (provider or NAT mapping) and DNS names pointing at them. ${
      map.client_error ? "LAN clients unavailable: " + esc(map.client_error) : ""
    }</p><div class="infra-toolbar net-toolbar"><label class="infra-search">Search<input id="net-reach-q" type="search" placeholder="Machine, IP or hostname" value="${esc(reachQuery)}"></label><label>Show<select id="net-reach-filter"><option value="public" ${reachFilter === "public" ? "selected" : ""}>Public machines</option><option value="dns" ${reachFilter === "dns" ? "selected" : ""}>Reachable by name</option><option value="all" ${reachFilter === "all" ? "selected" : ""}>All machines with addresses</option></select></label></div><div id="net-reach-rows"></div>`;
    const draw = () => {
      const q = reachQuery.toLowerCase();
      const rows = (map.machines as Item[]).filter(
        (m) =>
          (!reachMachine || m.id === reachMachine) &&
          (reachFilter === "all" || (reachFilter === "dns" ? m.dns.length : m.public.length)) &&
          (reachMachine || !q ||
            m.label.toLowerCase().includes(q) ||
            [...m.lan, ...m.public].some((a: Item) => a.ip.includes(q)) ||
            m.dns.some((n: Item) => n.fqdn.includes(q))),
      );
      document.getElementById("net-reach-rows")!.innerHTML = rows.length
        ? `<div class="infra-table-wrap"><table class="net-table"><thead><tr><th>Machine</th><th>LAN</th><th>Public</th><th>DNS names</th></tr></thead><tbody>${rows
            .map(
              (m) =>
                `<tr><td><b>${esc(m.label)}</b><small>${esc([m.provider, m.state].filter(Boolean).join(" · "))}</small></td><td class="ip">${m.lan.map((l: Item) => `<div class="mono">${esc(l.ip)}</div>`).join("") || none}</td><td class="ip">${
                  m.public
                    .map((p: Item) => `<div><span class="mono">${esc(p.ip)}</span><small>${p.via === "unifi_nat" ? "NAT · " + esc(p.mapping) : esc(p.via)}</small></div>`)
                    .join("") || none
                }</td><td>${m.dns
                  .slice(0, 6)
                  .map((n: Item) => chip(n.fqdn))
                  .join("")}${m.dns.length > 6 ? `<small>+${m.dns.length - 6} more</small>` : ""}</td></tr>`,
            )
            .join("")}</tbody></table></div>`
        : '<div class="empty"><h2>No matching machines</h2><p>Change the search or filter.</p></div>';
      cardify(document.getElementById("net-reach-rows"));
    };
    body.querySelector<HTMLInputElement>("#net-reach-q")!.addEventListener("input", (e) => {
      reachMachine = "";
      reachQuery = (e.target as HTMLInputElement).value.trim();
      draw();
    });
    body.querySelector<HTMLSelectElement>("#net-reach-filter")!.addEventListener("change", (e) => {
      reachFilter = (e.target as HTMLSelectElement).value;
      draw();
    });
    draw();
  }

  // ---------------- LAN clients and consoles ----------------

  async function loadSites() {
    if(sites)return;
    try { const response=await api('/unifi/sites');sites=Array.isArray(response.sites)?response.sites:[];siteError=''; }
    catch { sites=[];siteError='Site health could not be loaded. Check UniFi permissions and connectivity.'; }
  }
  function setTab(next:string){
    tab=next;
    document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b=>{if(!b.dataset.tab)return;b.classList.toggle('active',b.dataset.tab===next);b.setAttribute('aria-selected',String(b.dataset.tab===next));});
    renderTab();
  }
  async function sitesTab(body:HTMLElement){
    if(!sites){body.innerHTML=ui.loadingState('Loading sites and network health…');await loadSites();if(!body.isConnected||tab!=='sites')return;}
    const rows=sites || [],connected=rows.filter(s=>s.state==='connected'),clientsCount=rows.reduce((n,s)=>n+(s.counts?.wifiClient || 0)+(s.counts?.wiredClient || 0),0);
    body.innerHTML=`<div class="net-insights"><div><b>${rows.length}</b><span>Network sites</span></div><div><b>${connected.length}</b><span>Connected consoles</span></div><div><b>${clientsCount.toLocaleString()}</b><span>Reported clients</span></div><div><b>${rows.reduce((n,s)=>n+(s.counts?.offlineDevice || 0),0)}</b><span>Offline network devices</span></div></div>${siteError?'<p class="resource-notice">'+esc(siteError)+'</p>':''}<div data-site-map></div><div class="section-head"><div><h2>Explore your sites</h2><p>WAN health, devices and clients from each Network application.</p></div></div><div class="net-site-grid">${rows.map((site,i)=>`<button class="net-site-card" data-site-detail="${i}" aria-haspopup="dialog"><div><span class="site-card-title">${site.location?'<span class="site-number">'+(mappedSites(rows).indexOf(site)+1)+'</span>':''}${esc(site.name)}</span>${badge(site.state,site.state==='connected')}</div><small>${esc(site.location?.label || site.timezone || 'Location not reported')}</small><small>${esc(site.isp || 'ISP not reported')}${site.is_managed_gateway?' · Public IP management':''}</small><div class="site-card-stats"><span><b>${(site.counts?.wiredClient || 0)+(site.counts?.wifiClient || 0)}</b>Clients</span><span><b>${site.counts?.totalDevice ?? '—'}</b>Devices</span><span><b>${site.percentages?.wanUptime!==undefined?site.percentages.wanUptime+'%':'—'}</b>WAN uptime</span></div></button>`).join('')}</div>${!rows.length&&!siteError?'<div class="empty"><h3>No Network sites reported</h3><p>Connect UniFi in Keys to explore sites, health and client relationships.</p></div>':''}`;
    mountSiteMap(body.querySelector<HTMLElement>('[data-site-map]')!,rows,openSite);
    body.querySelectorAll<HTMLButtonElement>('[data-site-detail]').forEach(b=>b.onclick=()=>openSite(rows[Number(b.dataset.siteDetail)]));
  }
  function openSite(site:Item){
    const counts=site.counts || {},health=site.percentages || {};
    const d=ui.flyout(site.name,detailHero('UniFi · Site',site.state,site.location?.label || 'Location is not reported by this console.',[['Wired clients',counts.wiredClient],['Wi-Fi clients',counts.wifiClient],['Devices',counts.totalDevice]])+detailSection('WAN & connectivity',detailFacts([['ISP',site.isp],['Public address',site.ip],['WAN uptime',health.wanUptime!==undefined?health.wanUptime+'%':null],['Wi-Fi retries',health.txRetry!==undefined?health.txRetry.toFixed(1)+'%':null]]))+detailSection('WAN interfaces',`<div class="resource-related">${(site.wans||[]).map((w:Item)=>`<div><span><b>${esc(w.name)}</b><small>${esc([w.ip,w.isp].filter(Boolean).join(' · ') || 'No address reported')}${w.issues?' · '+w.issues+' reported issues':''}</small></span>${badge(w.up===true?'Link up':w.up===false?'Link down':'Not reported',w.up===true)}</div>`).join('') || '<p class="resource-note">No WAN interface detail reported.</p>'}</div>`)+detailSection('Network health',detailFacts([['Offline devices',counts.offlineDevice],['Offline gateways',counts.offlineGatewayDevice],['Offline access points',counts.offlineWifiDevice],['Updates available',counts.pendingUpdateDevice],['Critical notifications',counts.criticalNotification]]))+detailSection('Console & location',detailFacts([['Model',site.model],['Software',site.version],['Time zone',site.timezone],['Coordinates',site.location?site.location.latitude.toFixed(4)+', '+site.location.longitude.toFixed(4):null],['Location source',site.location?.source],['Public IP management',site.is_managed_gateway?'Configured gateway':'Read-only site discovery']]))+'<section class="resource-actions"><button class="primary" data-site-clients>Explore LAN clients</button></section>',{tone:'network',subtitle:'Network · '+(site.site_name || 'Site')});
    d.querySelector('[data-site-clients]')!.addEventListener('click',()=>{d.close();clientScope=siteKey(site);clients=null;clientQuery='';clientLimit=PAGE;setTab('clients');});
  }
  async function clientsTab(body: HTMLElement) {
    const generation=++clientGeneration,scope=clientScope;
    if (!clients) {
      body.innerHTML = ui.loadingState("Loading site clients and connection evidence…");
      try {
        await loadSites();
        const selected=(sites || []).find(s=>siteKey(s)===scope);
        const response=await api(selected?'/unifi/sites/'+encodeURIComponent(selected.console_id)+'/'+encodeURIComponent(selected.id)+'/clients':'/unifi/clients');
        if(generation!==clientGeneration||scope!==clientScope||!body.isConnected||tab!=='clients')return;
        clients=Array.isArray(response)?response:response.clients || [];
      } catch (err) {
        if(body.isConnected&&tab==='clients'&&generation===clientGeneration)body.innerHTML = `<div class="empty" role="alert"><h2>LAN clients unavailable</h2><p>${esc((err as Error).message)}</p><button class="secondary" id="client-reset-scope">Return to managed gateway</button></div>`;
        body.querySelector('#client-reset-scope')?.addEventListener('click',()=>{clientScope='';clients=null;void clientsTab(body);});
        return;
      }
    }
    const selected=(sites||[]).find(s=>siteKey(s)===clientScope),observed=clients!.some(c=>c.observation_available),recent=clients!.filter(c=>c.state==='online');
    body.innerHTML = `<div class="net-client-scope"><div><h2>${esc(selected?.name || pool.gateway_name || 'Managed gateway')}</h2><p>${observed?'Switch ports, wireless experience and traffic from the Network application.':'Basic inventory is available. Detailed observations are not reported by this connection.'}</p></div><label>Site<select id="net-client-site"><option value="">Managed gateway</option>${(sites||[]).map(s=>`<option value="${esc(siteKey(s))}" ${siteKey(s)===clientScope?'selected':''}>${esc(s.name)}</option>`).join('')}</select></label></div><div class="net-insights"><div><b>${recent.length}</b><span>Seen in the last 3 minutes</span></div><div><b>${clients!.filter(c=>c.type==='WIRELESS').length}</b><span>Wi-Fi clients</span></div><div><b>${clients!.filter(c=>c.type==='WIRED').length}</b><span>Wired clients</span></div><div><b>${recent.filter(c=>typeof c.experience==='number'&&c.experience<60).length}</b><span>Low experience scores</span></div></div><div class="infra-toolbar net-toolbar"><label class="infra-search">Search<input id="net-client-q" type="search" placeholder="Name, IP, MAC, network, vendor or uplink" value="${esc(clientQuery)}"></label><label>Presence<select id="net-client-view"><option value="recent" ${clientView==='recent'?'selected':''}>Recently seen</option><option value="all" ${clientView==='all'?'selected':''}>All reported</option><option value="attention" ${clientView==='attention'?'selected':''}>Low experience</option></select></label><label>Connection<select id="net-client-link"><option value="all">All links</option><option value="WIRED" ${clientLink==='WIRED'?'selected':''}>Wired</option><option value="WIRELESS" ${clientLink==='WIRELESS'?'selected':''}>Wi-Fi</option></select></label><label>Sort<select id="net-client-sort"><option value="activity" ${clientSort==='activity'?'selected':''}>Last seen</option><option value="traffic" ${clientSort==='traffic'?'selected':''}>Traffic rate</option><option value="name" ${clientSort==='name'?'selected':''}>Name</option></select></label></div><div id="net-client-rows"></div>`;
    const draw = () => {
      const q = clientQuery.toLowerCase();
      const rows = clients!.filter(c=>(!q||[c.name,c.ip,c.mac,c.network_name,c.uplink_name,c.ssid,c.vendor].filter(Boolean).join(' ').toLowerCase().includes(q))&&(clientLink==='all'||c.type===clientLink)&&(clientView==='all'||clientView==='recent'&&(!observed||c.state==='online')||clientView==='attention'&&typeof c.experience==='number'&&c.experience<60&&c.state==='online')).sort((a,b)=>clientSort==='traffic'?((b.receive_rate||0)+(b.send_rate||0))-((a.receive_rate||0)+(a.send_rate||0)):clientSort==='name'?a.name.localeCompare(b.name):(b.last_seen||0)-(a.last_seen||0)||a.name.localeCompare(b.name));
      document.getElementById("net-client-rows")!.innerHTML = `<p class="muted net-count">${rows.length} of ${clients!.length} clients · Presence uses the last reported observation.</p>${rows.length?`<div class="infra-table-wrap"><table class="net-table net-compact"><thead><tr><th>Client</th><th>Address</th><th>Network / uplink</th><th>Connection quality</th><th>Traffic / last seen</th><th>Speck evidence</th></tr></thead><tbody>${rows.slice(0,clientLimit).map((c,i)=>`<tr><td class="client-name"><button class="text-link" data-client-detail="${i}" aria-haspopup="dialog"><i class="client-presence ${c.state==='online'?'online':''}"></i>${esc(c.name || c.ip || c.mac || 'Unnamed client')}</button><small>${esc(c.vendor || c.mac)}</small></td><td class="mono ip">${esc(c.ip || '—')}<small>${esc(c.mac)}</small></td><td>${esc(c.network_name || c.ssid || 'Not reported')}<small>${esc(c.uplink_name || 'Uplink not reported')}${c.port?' · Port '+esc(c.port):''}</small></td><td>${esc(c.type==='WIRELESS'?'Wi-Fi':c.type==='WIRED'?'Wired':c.type)}${typeof c.experience==='number'?chip(c.experience+'% experience',c.experience<60?'warn':'good'):''}<small>${typeof c.signal_dbm==='number'?esc(c.signal_dbm)+' dBm':c.link_mbps?esc(c.link_mbps)+' Mbps link':'No quality reading'}</small></td><td>${typeof c.receive_rate==='number'?esc(metricValue((c.receive_rate||0)+(c.send_rate||0),'bytes/s')):'—'}<small>${c.last_seen?esc(relative(c.last_seen)):'Last seen not reported'}</small></td><td>${c.is_managed_gateway!==false&&c.ip?ownerChips(c.ip):'<span class="placeholder">Site-scoped</span>'}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty"><h3>No matching clients</h3><p>Choose All reported or adjust the site and filters.</p></div>'}${rows.length>clientLimit?'<button class="secondary net-more" id="net-clients-more">Show '+Math.min(PAGE,rows.length-clientLimit)+' more</button>':''}`;
      cardify(document.getElementById("net-client-rows"));
      body.querySelectorAll<HTMLElement>('[data-client-detail]').forEach(b=>b.onclick=()=>openClient(rows[Number(b.dataset.clientDetail)]));
      body.querySelector('#net-clients-more')?.addEventListener('click',()=>{clientLimit+=PAGE;draw();});
    };
    body.querySelector<HTMLInputElement>("#net-client-q")!.oninput=e=>{clientQuery=(e.target as HTMLInputElement).value.trim();clientLimit=PAGE;draw();};
    for(const [id,set] of [['view',(v:string)=>clientView=v],['link',(v:string)=>clientLink=v],['sort',(v:string)=>clientSort=v]] as const)body.querySelector<HTMLSelectElement>('#net-client-'+id)!.onchange=e=>{set((e.target as HTMLSelectElement).value);clientLimit=PAGE;draw();};
    body.querySelector<HTMLSelectElement>('#net-client-site')!.onchange=e=>{clientScope=(e.target as HTMLSelectElement).value;clients=null;clientLimit=PAGE;void clientsTab(body);};
    draw();
  }

  async function consolesTab(body: HTMLElement) {
    if (!consoles) {
      body.innerHTML = ui.loadingState ? ui.loadingState("Loading consoles…") : "Loading…";
      try {
        consoles = await api("/unifi/consoles");
      } catch (err) {
        body.innerHTML = `<div class="empty" role="alert"><h2>Consoles unavailable</h2><p>${esc((err as Error).message)}</p></div>`;
        return;
      }
      if (tab !== "consoles") return;
    }
    body.innerHTML = `<p class="muted net-note">Every UniFi console on the Site Manager account. Speck manages public IPs on the highlighted gateway.</p><div class="net-consoles">${consoles!
      .map(
        (c, i) =>
          `<article class="card net-console ${c.is_managed_gateway ? "managed" : ""}"><div class="infra-card-heading"><h3><button class="text-link" data-console-detail="${i}" aria-haspopup="dialog">${esc(c.name)}</button></h3>${badge(c.state || "unknown", c.state === "connected")}</div><p>${esc(c.model || "UniFi console")}${c.version ? " · " + esc(c.version) : ""}</p><p class="mono">${esc(c.ip || "")}</p>${c.is_managed_gateway ? chip("Managed gateway", "good") : ""}</article>`,
      )
      .join("")}</div>`;
    body.querySelectorAll<HTMLElement>('[data-console-detail]').forEach(b=>b.onclick=()=>openConsole(consoles![Number(b.dataset.consoleDetail)]));
  }

  function machineLinks(ip: string) {
    return detailSection('Machines reporting this address', owners(ip).length ? `<div class="resource-related">${owners(ip).map(m=>`<button data-network-machine="${esc(m.id)}"><span><b>${esc(m.label)}</b><small>Inspect identity and network evidence</small></span><span aria-hidden="true">→</span></button>`).join('')}</div>` : '<p class="resource-note">No machine in the loaded network map reports this address.</p>');
  }
  function bindMachineLinks(p: HTMLDialogElement) {
    p.querySelectorAll<HTMLElement>('[data-network-machine]').forEach(b=>b.onclick=()=> { p.close(); void ui.openMachine(b.dataset.networkMachine); });
  }
  function openIp(p: Item) {
    const info = map.ips[p.ip] || {}, lan = p.lan_ip || info.mapping?.lan_ip;
    const labels: Item = {free:'Available',assigned:'Speck-managed mapping',in_use:'Other gateway rule',gateway:'Gateway address'};
    const d = ui.flyout(p.ip, detailHero('UniFi · Public address',labels[p.status] || p.status,p.status==='assigned' ? 'This address forwards inbound traffic to its mapped LAN host and supplies that host’s outbound address.' : 'Address allocation and gateway evidence from the connected UniFi network.') + detailSection('Routing',detailFacts([['Gateway',pool.gateway_name],['Public address',p.ip],['Mapped LAN host',lan],['Mapping name',p.assigned_to],['Source',p.status==='assigned' ? 'Speck-managed UniFi NAT mapping' : 'UniFi gateway inventory']])) + detailSection('DNS names',detailFacts([['Names pointing here',info.dns?.length ? info.dns : 'No cached DNS names']])) + machineLinks(lan || p.ip) + `${admin() && ['free','assigned'].includes(p.status) ? '<section class="resource-actions"><h3>Mapping</h3><button class="secondary" data-ip-action>'+(p.status==='free' ? 'Map to host' : 'Remove mapping')+'</button></section>' : ''}` + technicalDetail(p),{tone:'network',subtitle:'Network · Public IP'});
    bindMachineLinks(d);
    d.querySelector('[data-ip-action]')?.addEventListener('click',()=> p.status==='free' ? mapDialog(p) : void unmap(p));
  }
  function openClient(c: Item) {
    const signal=typeof c.signal_dbm==='number'?c.signal_dbm+' dBm':null;
    const d = ui.flyout(c.name || c.ip || 'LAN client',detailHero('UniFi · LAN client',c.state==='online'?'Recently seen':c.state==='last_seen'?'Previously seen':null,'Connection, experience and traffic observed by this site’s Network application.',[['Experience',typeof c.experience==='number'?c.experience+'%':'Not reported'],['Signal / link',signal || (c.link_mbps?c.link_mbps+' Mbps':'Not reported')],['Traffic',typeof c.receive_rate==='number'?metricValue((c.receive_rate||0)+(c.send_rate||0),'bytes/s'):'Not reported']])+detailSection('Connection',detailFacts([['IP address',c.ip],['MAC address',c.mac],['Vendor',c.vendor],['Link',c.type==='WIRELESS'?'Wi-Fi':c.type==='WIRED'?'Wired':c.type],['Network',c.network_name],['VLAN',c.vlan],['Access point / switch',c.uplink_name],['Uplink model',c.uplink_model],['Switch port',c.port],['Connected since',c.connected_at?new Date(c.connected_at).toLocaleString():null],['Last seen',detailDate(c.last_seen)]]))+(c.type==='WIRELESS'?detailSection('Wireless experience',detailFacts([['SSID',c.ssid],['Signal',signal],['Radio',c.radio],['Channel',c.channel],['Experience score',typeof c.experience==='number'?c.experience+'%':null]])):'')+detailSection('Traffic observed by the network',detailFacts([['Received from client',capacity(c.received_bytes)],['Sent to client',capacity(c.sent_bytes)],['Current receive rate',typeof c.receive_rate==='number'?metricValue(c.receive_rate,'bytes/s'):null],['Current send rate',typeof c.send_rate==='number'?metricValue(c.send_rate,'bytes/s'):null]]))+'<p class="resource-note">Counters reflect the provider’s observation window. A connection start time does not establish current presence.</p>'+(c.is_managed_gateway!==false?machineLinks(c.ip):'<p class="resource-note">Machine matching is limited to the configured gateway. Private IP addresses can repeat across sites.</p>')+technicalDetail(c),{tone:'network',subtitle:'Network · LAN client'});
    bindMachineLinks(d);
  }
  function openConsole(c: Item) {
    ui.flyout(c.name || 'UniFi console',detailHero('UniFi · Console',c.state,c.is_managed_gateway ? 'This gateway manages the public address pool and NAT mappings shown in Speck.' : 'A console discovered through the connected UniFi Site Manager account.') + detailSection('Console',detailFacts([['Model',c.model],['Software version',c.version],['Address',c.ip],['Gateway management',c.is_managed_gateway ? 'Managed by Speck' : 'Discovery only']])) + technicalDetail(c),{tone:'network',subtitle:'Network · UniFi console'});
  }

  /** Map a free public IP to a LAN host chosen elsewhere (for example a new VM). */
  async function exposeHost(lanIp: string, name: string) {
    pool = await api("/unifi/pool");
    const free = (pool.pool as Item[]).filter((p) => p.status === "free");
    if (!free.length) return notify("No free public IPs remain on the gateway", true);
    const d = dialog(
      "Map a public IP to " + name,
      `<form class="net-form"><p>Forward all ports on a free public IP to <span class="mono">${esc(lanIp)}</span> and send its outbound traffic from that address.</p><label>Public IP<select id="net-expose-ip">${free
        .map((p) => `<option>${esc(p.ip)}</option>`)
        .join("")}</select></label><label>Mapping name<input id="net-expose-name" required maxlength="60" pattern="[A-Za-z0-9][A-Za-z0-9 ._-]*" value="${esc(name.replace(/[^A-Za-z0-9 ._-]/g, "-").slice(0, 60))}"></label><div class="dialog-footer"><button type="button" class="secondary" id="net-expose-cancel">Cancel</button><button class="primary">Review change</button></div></form>`,
      { className: "wide" },
    );
    d.querySelector("#net-expose-cancel")!.addEventListener("click", () => d.close());
    d.querySelector("form")!.addEventListener("submit", async (e) => {
      e.preventDefault();
      const ip = (d.querySelector("#net-expose-ip") as HTMLSelectElement).value;
      const label = (d.querySelector("#net-expose-name") as HTMLInputElement).value.trim();
      d.close();
      const ok = await confirmChange(
        "Expose a host on a public IP",
        `<p><span class="mono">${esc(ip)}</span> → <span class="mono">${esc(lanIp)}</span> (${esc(name)})</p><p>Every port except 500 and 4500 becomes reachable from the Internet. Confirm the host's firewall first.</p>`,
        "Create mapping",
        ip,
      );
      if (!ok) return;
      await api("/unifi/expose", "POST", { public_ip: ip, lan_ip: lanIp, name: label });
      notify(`${ip} now forwards to ${lanIp}. Point a domain at it from Network & DNS.`);
    });
  }

  function showMachine(machine: Item) {
    tab = "reach";
    reachMachine = machine.id;
    reachQuery = machine.label;
    reachFilter = "all";
    location.hash = "network";
  }
  function reset() {
    window.clearTimeout(scanTimer); closePane(); clients = consoles = sites = null;
    clientScope="";clientGeneration++;siteError="";
    domains = []; status = {}; pool = {pool:[]}; unifiStatus = {};
    map = {machines:[],ips:{}}; mapReady = false; reachMachine = "";
  }
  return { render, closePane, exposeHost, showMachine, reset };
}
