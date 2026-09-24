import "./network.css";
import { icon } from "./icons";
import { expiresWithin, fqdn, parseRecordValues, relative } from "./network-model";
import { cardify } from "./table-cards";

type Item = Record<string, any>;
export function createNetwork(ui: Item) {
  const { api, esc, notify, content, loading, badge } = ui;
  const dialog: (title: string, html: string, options?: Item) => HTMLDialogElement = ui.dialog;
  const admin = () => ui.role() === "admin";
  let tab = "domains";
  let domainQuery = "",
    domainFilter = "all",
    clientQuery = "",
    reachQuery = "",
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

  async function render() {
    loading("Loading network…");
    window.clearTimeout(scanTimer);
    const mapRequest = api("/network/map").catch(() => null);
    [status, domains, pool, unifiStatus] = await Promise.all([
      api("/dns/status"),
      api("/dns/domains").then((r: Item) => r.domains).catch(() => []),
      api("/unifi/pool").catch((e: Error) => ({ pool: [], error: e.message })),
      api("/unifi/status").catch(() => ({})),
    ]);
    frame();
    mapRequest.then((m: Item | null) => {
      if (!m || !document.getElementById("net-body")) return;
      map = m;
      mapReady = true;
      summary();
      renderTab();
    });
  }

  function frame() {
    const tabs = [
      ["domains", `Domains (${domains.length})`],
      ["ips", `Public IPs (${pool.pool.length})`],
      ["reach", "Reachability"],
      ["clients", "LAN clients"],
      ["consoles", "UniFi consoles"],
    ];
    content(
      `${
        !status.configured
          ? `<div class="callout">GoDaddy is not configured. ${admin() ? 'Add it under <a href="#keys">Keys → Providers</a>.' : "Ask an administrator to add it."}</div>`
          : ""
      }${
        !unifiStatus.configured
          ? `<div class="callout">UniFi is not configured. ${admin() ? 'Add the Site Manager key under <a href="#keys">Keys → Providers</a>.' : ""}</div>`
          : unifiStatus.error
            ? `<div class="callout">UniFi gateway unavailable: ${esc(unifiStatus.error)}</div>`
            : ""
      }<div class="infra-tabs" role="tablist" aria-label="Network views">${tabs
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
      panel = dialog(d.domain, `<div class="net-pane" id="net-pane">${ui.loadingState ? ui.loadingState("Loading records…") : "Loading…"}</div>`, {
        className: "device-drawer net-drawer",
        modal: false,
      });
      panel.dataset.domain = d.domain;
      pane = panel;
      const opened = panel;
      const escape = (e: KeyboardEvent) => {
        if (e.key === "Escape" && opened.open && !document.querySelector("dialog:modal")) opened.close();
      };
      document.addEventListener("keydown", escape);
      opened.addEventListener("close", () => document.removeEventListener("keydown", escape));
    }
    let zone: Item;
    try {
      zone = await api(`/dns/domains/${encodeURIComponent(d.domain)}/records${fresh ? "" : "?cached=true"}`);
    } catch (err) {
      panel.querySelector("#net-pane")!.innerHTML = `<div class="empty" role="alert"><h2>Unable to load records</h2><p>${esc((err as Error).message)}</p></div>`;
      return;
    }
    if (pane !== panel || !panel) return;
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
        return `<tr class="net-ip-${p.status}"><td class="mono ip">${esc(p.ip)}</td><td>${chip(label[p.status] || p.status, tone[p.status])}</td><td>${esc(p.assigned_to || "—")}</td><td>${
          lan ? `<span class="mono">${esc(lan)}</span>${ownerChips(lan)}${info.lan_client && !owners(lan).length ? chip(info.lan_client) : ""}` : "—"
        }</td><td>${names.slice(0, 3).map((n) => chip(n)).join("")}${names.length > 3 ? `<small>+${names.length - 3} more</small>` : ""}</td>${
          admin()
            ? `<td class="net-row-actions">${p.status === "free" ? `<button class="secondary" data-map="${i}">Map to host</button>` : p.status === "assigned" ? `<button class="secondary" data-unmap="${i}">Remove</button>` : ""}</td>`
            : ""
        }</tr>`;
      })
      .join("")}</tbody></table></div>`;
    cardify(body);
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
          (reachFilter === "all" || (reachFilter === "dns" ? m.dns.length : m.public.length)) &&
          (!q ||
            m.label.toLowerCase().includes(q) ||
            [...m.lan, ...m.public].some((a: Item) => a.ip.includes(q)) ||
            m.dns.some((n: Item) => n.fqdn.includes(q))),
      );
      document.getElementById("net-reach-rows")!.innerHTML = rows.length
        ? `<div class="infra-table-wrap"><table class="net-table"><thead><tr><th>Machine</th><th>LAN</th><th>Public</th><th>DNS names</th></tr></thead><tbody>${rows
            .map(
              (m) =>
                `<tr><td><b>${esc(m.label)}</b><small>${esc([m.provider, m.state].filter(Boolean).join(" · "))}</small></td><td class="ip">${m.lan.map((l: Item) => `<div class="mono">${esc(l.ip)}</div>`).join("") || "—"}</td><td class="ip">${
                  m.public
                    .map((p: Item) => `<div><span class="mono">${esc(p.ip)}</span><small>${p.via === "unifi_nat" ? "NAT · " + esc(p.mapping) : esc(p.via)}</small></div>`)
                    .join("") || "—"
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

  async function clientsTab(body: HTMLElement) {
    if (!clients) {
      body.innerHTML = ui.loadingState ? ui.loadingState("Loading LAN clients…") : "Loading…";
      try {
        clients = await api("/unifi/clients");
      } catch (err) {
        body.innerHTML = `<div class="empty" role="alert"><h2>LAN clients unavailable</h2><p>${esc((err as Error).message)}</p></div>`;
        return;
      }
      if (tab !== "clients") return;
    }
    body.innerHTML = `<div class="infra-toolbar net-toolbar"><label class="infra-search">Search<input id="net-client-q" type="search" placeholder="Name, IP or MAC" value="${esc(clientQuery)}"></label><button class="secondary" id="net-client-refresh">${icon("refresh")}<span>Refresh</span></button></div><div id="net-client-rows"></div>`;
    const draw = () => {
      const q = clientQuery.toLowerCase();
      const rows = clients!.filter((c) => !q || c.name.toLowerCase().includes(q) || c.ip.includes(q) || c.mac.includes(q));
      document.getElementById("net-client-rows")!.innerHTML = `<p class="muted">${rows.length} of ${clients!.length} clients</p><div class="infra-table-wrap"><table class="net-table net-compact"><thead><tr><th>Name</th><th>IP</th><th>MAC</th><th>Link</th><th>Connected</th><th>Speck machine</th></tr></thead><tbody>${rows
        .slice(0, clientLimit)
        .map(
          (c) =>
            `<tr><td>${esc(c.name || "Unnamed")}</td><td class="mono ip">${esc(c.ip || "—")}</td><td class="mono ip">${esc(c.mac)}</td><td>${esc(c.type === "WIRELESS" ? "Wi-Fi" : c.type === "WIRED" ? "Wired" : c.type)}</td><td>${esc(c.connected_at ? relative(Date.parse(c.connected_at) / 1000) : "—")}</td><td>${c.ip ? ownerChips(c.ip) : ""}</td></tr>`,
        )
        .join("")}</tbody></table></div>${rows.length > clientLimit ? `<button class="secondary net-more" id="net-clients-more">Show ${Math.min(PAGE, rows.length - clientLimit)} more of ${rows.length - clientLimit} remaining</button>` : ""}`;
      cardify(document.getElementById("net-client-rows"));
      document.getElementById("net-clients-more")?.addEventListener("click", () => {
        clientLimit += PAGE;
        draw();
      });
    };
    body.querySelector<HTMLInputElement>("#net-client-q")!.addEventListener("input", (e) => {
      clientQuery = (e.target as HTMLInputElement).value.trim();
      clientLimit = PAGE;
      draw();
    });
    body.querySelector("#net-client-refresh")!.addEventListener("click", async () => {
      clients = await api("/unifi/clients?refresh=true");
      draw();
    });
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
        (c) =>
          `<article class="card net-console ${c.is_managed_gateway ? "managed" : ""}"><div class="infra-card-heading"><h3>${esc(c.name)}</h3>${badge(c.state || "unknown", c.state === "connected")}</div><p>${esc(c.model || "UniFi console")}${c.version ? " · " + esc(c.version) : ""}</p><p class="mono">${esc(c.ip || "")}</p>${c.is_managed_gateway ? chip("Managed gateway", "good") : ""}</article>`,
      )
      .join("")}</div>`;
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

  return { render, closePane, exposeHost };
}
