import {workspaceTab,setWorkspaceTab} from "./resource-navigation";
import { rememberResource, registerResource, resourceHref } from "./resource-navigation";
import "./network.css";
import "./keys.css";
import { icon } from "./icons";
import { relative } from "./network-model";
import { cardify } from "./table-cards";
import { detailDate, detailFacts, detailHero, detailSection } from "./resource-story";
import { dotenv, groupEntries, parseDotenv, validSecretName, searchKeys } from "./vault-model";

type Item = Record<string, any>;
const REVEAL_SECONDS = 90;

export function createKeys(ui: Item) {
  const { api, esc, notify, content, loading } = ui;
  const fresh = ui.freshApi || api;
  const dialog: (title: string, html: string, options?: Item) => HTMLDialogElement = ui.dialog;
  const admin = () => ui.role() === "admin";
  let tab = "vault";
  let query = "",
    serviceFilter = "",
    kindFilter = "";
  let entries: Item[] = [],
    services: Item[] = [],
    sshKeys: Item[] = [],
    handoffs: Item[] = [];
  let pane: HTMLDialogElement | null = null;
  let limit = 80, projectFilter = "", usageFilter = "";
  const queries: Record<string, string> = {};

  const chip = (text: string, tone = "") => `<span class="net-chip ${tone}">${esc(text)}</span>`;
  const kindChip = (kind: string) =>
    chip(kind === "minted" ? "Minted" : kind === "shared" ? "Shared" : "Stored", kind === "minted" ? "good" : kind === "shared" ? "machine" : "");
  const loadingState = (label: string) => (ui.loadingState ? ui.loadingState(label) : esc(label));

  const safely = (action: () => Promise<unknown>) => async () => {
    try { await action(); } catch (error) {
      if ((error as Error).name !== 'AbortError') notify((error as Error).message, true);
    }
  };

  async function copy(text: string, label = "Copied") {
    await navigator.clipboard.writeText(text);
    notify(label);
  }

  async function render() {
    tab=workspaceTab(tab,["vault","providers","ssh","handoffs"]);
    loading("Loading keys…");
    if (!admin()) {
      content('<div class="empty"><h2>Administrators only</h2><p>The credential vault, provider credentials and handoff files are available to administrators.</p></div>');
      return;
    }
    [entries, services, sshKeys, handoffs] = await Promise.all([
      api("/keys"),
      api("/keys/services"),
      api("/ssh/keys?registration=false"),
      api("/context/files"),
    ]);
    const tabs = [
      ["vault", `Vault (${entries.length})`],
      ["providers", "Providers"],
      ["ssh", `SSH keys (${sshKeys.length})`],
      ["handoffs", `Handoffs (${handoffs.length})`],
    ];
    const minted = entries.filter((e) => e.kind === "minted").length;
    const projects = new Set(entries.map((e) => e.project).filter(Boolean)).size;
    const configured = services.filter((s) => s.configured).length;
    ui.summary?.(`<span><b>${entries.length}</b> vault entries</span><span><b>${projects}</b> projects</span><span><b>${minted}</b> revocable keys</span><span><b>${configured}/${services.length}</b> providers</span>`);
    content(
      `<div class="infra-tabs" role="tablist" aria-label="Key views">${tabs
        .map(
          ([id, label]) =>
            `<button role="tab" data-tab="${id}" id="keys-tab-${id}" aria-selected="${tab === id}" class="${tab === id ? "active" : ""}">${esc(label)}</button>`,
        )
        .join("")}</div><div id="keys-body"></div>`,
    );
    document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((b) =>
      b.addEventListener("click", () => {
        closePane();
        tab = b.dataset.tab!; setWorkspaceTab(tab);
        document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((x) => {
          x.classList.toggle("active", x === b);
          x.setAttribute("aria-selected", String(x === b));
        });
        renderTab();
      }),
    );
    renderTab();
  }

  function renderTab() {
    const body = document.getElementById("keys-body");
    if (!body) return;
    if (tab === "vault") return vaultTab(body);
    if (tab === "providers") return providersTab(body);
    if (tab === "ssh") return sshTab(body);
    return handoffsTab(body);
  }

  // ---------------- vault ----------------

  function vaultTab(body: HTMLElement) {
    const serviceNames = [...new Set(entries.map((e) => e.service))].sort();
    body.innerHTML = `<div class="keys-overview"><div><span class="keys-eyebrow">Credential workspace</span><h2>Credentials & access</h2><p>Find a credential, see what it connects to and follow its history.</p></div><div class="keys-overview-stats"><span><b data-key-linked-count>${entries.filter(e => e.system_count > 0).length}</b>linked to systems</span><span><b data-key-access-count>${entries.filter(e => e.revealed).length}</b>accessed through Speck</span></div></div><div class="infra-toolbar net-toolbar"><label class="infra-search">Search<input id="keys-q" type="search" placeholder="Search names, projects, services or variables…" value="${esc(query)}"></label><label>Service<select id="keys-service"><option value="">All services</option>${serviceNames
      .map((s) => `<option ${serviceFilter === s ? "selected" : ""}>${esc(s)}</option>`)
      .join("")}</select></label><label>Kind<select id="keys-kind"><option value="">All kinds</option>${[
      ["minted", "Minted"],
      ["shared", "Shared"],
      ["static", "Stored"],
    ]
      .map(([v, l]) => `<option value="${v}" ${kindFilter === v ? "selected" : ""}>${l}</option>`)
      .join("")}</select></label><div class="keys-actions"><button class="primary" id="keys-provision">${icon("plus")}<span>Provision key</span></button><button class="secondary" id="keys-store">Store credential</button></div></div><div class="keys-filter-line"><label>Project<select id="keys-project"><option value="">All projects</option>${[...new Set(entries.map(e => e.project).filter(Boolean))].sort().map(p => `<option ${p === projectFilter ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label><label>Usage<select id="keys-usage"><option value="">All credentials</option><option value="linked" ${usageFilter === 'linked' ? 'selected' : ''}>Linked to systems</option><option value="unlinked" ${usageFilter === 'unlinked' ? 'selected' : ''}>No recorded systems</option><option value="accessed" ${usageFilter === 'accessed' ? 'selected' : ''}>Accessed through Speck</option></select></label><span class="muted">Search metadata and linked systems. Values stay sealed.</span></div><div id="keys-rows"></div>`;
    body.querySelector<HTMLInputElement>("#keys-q")!.addEventListener("input", (e) => {
      query = (e.target as HTMLInputElement).value.trim().toLowerCase();
      limit = 80; rows();
    });
    body.querySelector<HTMLSelectElement>("#keys-service")!.addEventListener("change", (e) => {
      serviceFilter = (e.target as HTMLSelectElement).value;
      limit = 80; rows();
    });
    body.querySelector<HTMLSelectElement>("#keys-kind")!.addEventListener("change", (e) => {
      kindFilter = (e.target as HTMLSelectElement).value;
      limit = 80; rows();
    });
    body.querySelector("#keys-provision")!.addEventListener("click", provisionDialog);
    body.querySelector("#keys-store")!.addEventListener("click", () => storeDialog());
    body.querySelector<HTMLSelectElement>("#keys-project")!.addEventListener("change", e => { projectFilter = (e.target as HTMLSelectElement).value; limit = 80; rows(); });
    body.querySelector<HTMLSelectElement>("#keys-usage")!.addEventListener("change", e => { usageFilter = (e.target as HTMLSelectElement).value; limit = 80; rows(); });
    rows();
  }

  function rows() {
    const el = document.getElementById("keys-rows");
    if (!el) return;
    const linked = document.querySelector('[data-key-linked-count]'), accessed = document.querySelector('[data-key-access-count]');
    if (linked) linked.textContent = String(entries.filter(e => e.system_count > 0).length);
    if (accessed) accessed.textContent = String(entries.filter(e => e.revealed).length);
    const matches = searchKeys(entries, query).filter(e => (!serviceFilter || e.service === serviceFilter) && (!kindFilter || e.kind === kindFilter) && (!projectFilter || e.project === projectFilter) && (!usageFilter || (usageFilter === 'linked' ? e.system_count > 0 : usageFilter === 'unlinked' ? !e.system_count : e.revealed)));
    const visible = matches.slice(0, limit);
    if (!visible.length) {
      el.innerHTML = `<div class="empty"><h2>${entries.length ? "No matching entries" : "The vault is empty"}</h2><p>${entries.length ? "Change the search or filters." : "Provision a key for a project or store a credential."}</p></div>`;
      return;
    }
    el.innerHTML = `<p class="keys-result" role="status">${matches.length} ${matches.length === 1 ? "credential" : "credentials"}${matches.length !== entries.length ? ` of ${entries.length}` : ""}</p><div class="infra-table-wrap"><table class="net-table net-compact keys-table"><thead><tr><th>Name</th><th>Service</th><th>Kind</th><th>Systems / variables</th><th>Updated</th><th>Last access</th></tr></thead><tbody>${groupEntries(visible)
      .map(
        ([group, items]) =>
          `<tr class="keys-group-row"><th colspan="6">${esc(group)} <small>${items.length}</small></th></tr>${items
            .map(
              (e) =>
                `<tr class="keys-click-row"><td><button class="text-link net-name" data-entry="${esc(e.name)}">${esc(e.name)}</button></td><td>${esc(e.service)}</td><td>${kindChip(e.kind)}</td><td>${e.system_count ? `<span class="keys-system-count">${e.system_count} system${e.system_count === 1 ? "" : "s"}${e.system_labels?.length ? " · " + esc(e.system_labels.slice(0, 2).join(", ")) : ""}</span>` : ""}${(e.secret_names as string[])
                  .slice(0, 3)
                  .map((n) => `<span class="keys-var">${esc(n)}</span>`)
                  .join("")}${e.secret_names.length > 3 ? `<small class="keys-more">+${e.secret_names.length - 3}</small>` : ""}</td><td>${esc(relative(e.updated))}</td><td>${e.revealed ? esc(relative(e.revealed)) : '<span class="placeholder">Not recorded</span>'}</td></tr>`,
            )
            .join("")}`,
      )
      .join("")}</tbody></table></div>`;
    if (matches.length > limit) {
      el.insertAdjacentHTML('beforeend', `<button class="secondary keys-load-more">Show next ${Math.min(80, matches.length-limit)}</button>`);
      el.querySelector('.keys-load-more')!.addEventListener('click', () => { limit += 80; rows(); });
    }
    cardify(el);
    el.querySelectorAll<HTMLTableRowElement>('tr.keys-click-row').forEach(row => row.addEventListener('click', event => {
      if (!(event.target as Element).closest('button')) row.querySelector<HTMLButtonElement>('button')?.click();
    }));
    el.querySelectorAll<HTMLButtonElement>("[data-entry]").forEach((b) =>
      b.addEventListener("click", () => openEntry(entries.find((e) => e.name === b.dataset.entry)!)),
    );
  }

  function closePane() {
    pane?.close();
    pane = null;
  }

  function sidePane(title: string, html: string) {
    closePane();
    const panel = ui.flyout(title, html, { tone: "protection", className: "keys-flyout" });
    pane = panel;
    return panel as HTMLDialogElement;
  }

  const when = (value: any) => value ? detailDate(value) : "Not recorded";
  const activity = (data: Item) => detailSection("Access & activity", `${detailFacts([["Last access through Speck", when(data.last_access?.at)], ["Accessed by", data.last_access?.actor || "Not recorded"]])}<p class="resource-note">${esc(data.coverage || "Activity records access through Speck. Use outside Speck is not observed.")}</p><ol class="keys-timeline">${(data.events || []).map((event: Item) => `<li><span class="keys-event-dot"></span><div><b>${esc(event.action.replace(/^(vault|ssh|context)\./, '').replaceAll('.', ' ').replaceAll('_', ' '))}</b><span>${esc(event.actor)} · <time>${esc(when(event.at))}</time></span></div></li>`).join('') || '<li class="resource-note">No activity recorded in Speck yet.</li>'}</ol>`);

  function metadata(panel: HTMLDialogElement, kind: string, name: string, base: string, onEntry?: (entry: Item) => void) {
    const slot = panel.querySelector<HTMLElement>('[data-key-metadata]')!;
    const load = async () => {
      try {
        const data = await fresh(base + '/details');
        if (!panel.open || pane !== panel) return;
        if (data.entry) onEntry?.(data.entry);
        const systems = data.systems || [];
        slot.innerHTML = (kind !== 'handoff' ? detailSection('Used by systems', `<div class="keys-section-heading"><p class="resource-note">Recorded associations. Removing a link does not change access on the system.</p><button class="secondary" data-link-system>Link system</button></div><div class="resource-related">${systems.map((link: Item, i: number) => `<div><span>${link.target ? `<button class="text-link" data-key-system="${i}">${esc(link.target.label)}</button>` : `<b>${esc(link.label)}</b>`}<small>${esc(link.source)} · ${esc(link.created_by)} · ${esc(when(link.created))}</small>${link.note ? `<small>${esc(link.note)}</small>` : ''}${!link.target ? '<small>Not in the current local inventory</small>' : ''}</span><button class="text-link" data-unlink-system="${i}" aria-label="Remove link to ${esc(link.label)}">Unlink</button></div>`).join('') || '<p class="resource-note">No systems have been linked yet. Add known usage to keep this credential’s context with it.</p>'}</div>`) : '') + ((data.related || []).length ? detailSection('Related credentials', `<div class="resource-related">${data.related.map((r: Item) => `<button data-related-key="${esc(r.name)}"><span><b>${esc(r.name)}</b><small>${esc(r.relationship)} · ${esc(r.service)}</small></span><span>→</span></button>`).join('')}</div>`) : '') + activity(data);
        if(kind==='vault'||kind==='ssh'){
          const plan=data.rotation_plan || {};
          slot.insertAdjacentHTML('afterbegin',detailSection('Ownership & rotation plan',detailFacts([['Owner',plan.owner],['Purpose',plan.purpose],['Next review',plan.next_review],['Plan updated',when(plan.updated)],['Updated by',plan.actor]])+`<p class="resource-note">${esc(plan.procedure || 'No rotation procedure recorded. Review known system associations and provider access before changing a credential.')}</p><button class="secondary" data-key-plan>Edit rotation plan</button><p class="resource-note">A planning record only. Saving does not rotate, reveal or revoke credentials, and does not schedule an automatic action.</p>`));
          slot.querySelector('[data-key-plan]')!.addEventListener('click',()=>{
            const edit=dialog('Plan credential rotation',`<form><label>Owner<input name="owner" maxlength="160" value="${esc(plan.owner || '')}"></label><label>Purpose<textarea name="purpose" maxlength="1000">${esc(plan.purpose || '')}</textarea></label><label>Next review<input name="next_review" type="date" value="${esc(plan.next_review || '')}"></label><label>Procedure<textarea name="procedure" maxlength="2000">${esc(plan.procedure || '')}</textarea></label><p class="resource-note">Document steps and owners; keep secret values out of these notes.</p><button class="primary">Save plan</button><p role="status"></p></form>`);
            edit.querySelector('form')!.onsubmit=async event=>{event.preventDefault();try{await api(base+'/rotation-plan','PUT',Object.fromEntries(new FormData(edit.querySelector('form')!)));edit.close();void load();}catch(error){edit.querySelector('[role=status]')!.textContent=(error as Error).message;}};
          });
        }
        slot.querySelectorAll<HTMLButtonElement>('[data-related-key]').forEach(button => button.addEventListener('click', async () => {
          const next = entries.find(e => e.name === button.dataset.relatedKey);
          if (next) openEntry(next);
        }));
        slot.querySelector('[data-link-system]')?.addEventListener('click', () => linkDialog(base, load));
        slot.querySelectorAll<HTMLButtonElement>('[data-key-system]').forEach(button => button.addEventListener('click', () => ui.openKeySystem(systems[+button.dataset.keySystem!].target)));
        slot.querySelectorAll<HTMLButtonElement>('[data-unlink-system]').forEach(button => button.addEventListener('click', async () => {
          await api(base + '/systems?target_id=' + encodeURIComponent(systems[+button.dataset.unlinkSystem!].target_id), 'DELETE');
          await load();
          entries = await api('/keys'); rows();
        }));
      } catch (error) {
        if (!panel.open) return;
        slot.innerHTML = '<p class="resource-notice">Activity and system links could not be loaded.</p><button class="secondary" data-retry-metadata>Try again</button>';
        slot.querySelector('[data-retry-metadata]')!.addEventListener('click', load);
      }
    };
    void load();
    return load;
  }

  async function linkDialog(base: string, reload: () => Promise<void>) {
    const d = dialog('Link a system', '<div class="net-form"><p class="resource-note">Record where this credential is configured. This does not install or reveal it.</p><label>Search systems<input type="search" id="key-target-search" placeholder="Name, provider or host"></label><div id="key-targets" class="resource-related">Loading local inventory…</div><label>Usage note<input id="key-link-note" maxlength="500" placeholder="For example: database login used by the backup service"></label></div>');
    try {
      const targets: Item[] = await api('/keys/system-targets');
      if (!d.open) return;
      const draw = () => {
        const visible = searchKeys(targets, d.querySelector<HTMLInputElement>('#key-target-search')!.value).slice(0, 60);
        d.querySelector('#key-targets')!.innerHTML = visible.map((t, i) => `<button data-key-target="${i}"><span><b>${esc(t.label)}</b><small>${esc(t.description)}</small></span><span>Link →</span></button>`).join('') || '<p class="resource-note">No matching systems. Refresh Fleet to discover provider resources.</p>';
        d.querySelectorAll<HTMLButtonElement>('[data-key-target]').forEach(button => button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            await api(base + '/systems', 'POST', {target_id: visible[+button.dataset.keyTarget!].id, note: d.querySelector<HTMLInputElement>('#key-link-note')!.value});
            d.close(); await reload(); entries = await api('/keys'); rows();
          } catch (error) { notify((error as Error).message, true); button.disabled = false; }
        }));
      };
      d.querySelector('#key-target-search')!.addEventListener('input', draw); draw();
    } catch (error) { d.querySelector('#key-targets')!.textContent = (error as Error).message; }
  }

  function tabSearch(body: HTMLElement, placeholder: string) {
    body.insertAdjacentHTML('afterbegin', `<label class="keys-tab-search">Search<input type="search" value="${esc(queries[tab] || '')}" placeholder="${esc(placeholder)}" data-key-tab-search></label>`);
    const input = body.querySelector<HTMLInputElement>('[data-key-tab-search]')!;
    input.addEventListener('input', () => {
      queries[tab] = input.value;
      const source = tab === 'providers' ? services : tab === 'ssh' ? sshKeys : handoffs;
      const visible = new Set(searchKeys(source, input.value));
      body.querySelectorAll<HTMLElement>('[data-search-index]').forEach(el => el.hidden = !visible.has(source[+el.dataset.searchIndex!]));
      const status = body.querySelector<HTMLElement>('[data-key-results]');
      if (status) status.textContent = `${visible.size} results${visible.size ? '' : ' · Try another name, project or fingerprint.'}`;
    });
    body.insertAdjacentHTML('beforeend', '<p class="keys-result" data-key-results role="status"></p>');
    input.dispatchEvent(new Event('input'));
  }

  function openEntry(entry: Item) {
    rememberResource({kind:"key",id:String(entry.name)}, () => openEntry(entry));
    let revealed: Record<string, string> | null = null;
    let timer = 0;
    const shown = new Set<string>();
    const panel = sidePane(entry.name, `<div class="net-pane" id="keys-pane"></div><div data-key-metadata><p class="resource-note">Loading activity and system links…</p></div>`);
    const forget = () => {
      revealed = null;
      shown.clear();
      window.clearTimeout(timer);
    };
    panel.addEventListener("close", forget);
    async function load() {
      if (revealed) return revealed;
      const full = await fresh("/keys/" + encodeURIComponent(entry.name));
      if (!panel.open || pane !== panel) throw new DOMException("This credential has been closed", "AbortError");
      revealed = full.secrets;
      entry.revealed = Date.now() / 1000;
      entry.reveals = (entry.reveals || 0) + 1;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        forget();
        draw();
        notify("Revealed values were cleared from this page");
      }, REVEAL_SECONDS * 1000);
      void reloadMetadata();
      return revealed!;
    }
    function draw() {
      const el = panel.querySelector("#keys-pane");
      if (!el) return;
      const minted = entry.kind === "minted";
      el.innerHTML = detailHero(entry.service + ' · ' + (minted ? 'Minted key' : entry.kind === 'shared' ? 'Shared credential' : 'Stored credential'), '', entry.notes || 'A sealed credential with its history and system relationships.', [['Project', entry.project || 'Unassigned'], ['Variables', entry.secret_names.length], ['Reveals', entry.reveals || 0]]) + detailSection('Lifecycle', detailFacts([['Created', when(entry.created)], ['Last updated', when(entry.updated)], ['Created by', entry.created_by], ['Last revealed', when(entry.revealed)], ['Origin', entry.origin === 'austinland' ? 'AustinLand import' : 'Speck'], ['Service', entry.service]])) + `<div class="net-pane-actions"><button class="primary" id="keys-reveal-all">${icon("eye")}<span>${revealed ? "Hide values" : "Reveal values"}</span></button><button class="secondary" id="keys-copy-env">${icon("copy")}<span>Copy as .env</span></button><button class="secondary" id="keys-edit">Edit</button><button class="secondary" id="keys-delete">Delete</button></div><div class="keys-secrets">${(entry.secret_names as string[])
        .map((name) => {
          const visible = revealed && shown.has(name);
          const value = visible ? revealed![name] : entry.hints?.[name] || "••••";
          const multiline = visible && value.includes("\n");
          return `<div class="keys-secret"><div class="keys-secret-name">${esc(name)}</div>${
            multiline ? `<pre class="keys-value">${esc(value)}</pre>` : `<div class="keys-value ${visible ? "" : "masked"}">${esc(value)}</div>`
          }<div class="keys-secret-actions"><button class="secondary" data-show="${esc(name)}" aria-label="${visible ? "Hide" : "Show"} ${esc(name)}">${visible ? "Hide" : "Show"}</button><button class="secondary" data-copy="${esc(name)}" aria-label="Copy ${esc(name)}">${icon("copy")}</button></div></div>`;
        })
        .join("")}</div><p class="muted keys-footnote">Values stay in this page for ${REVEAL_SECONDS} seconds after they are fetched, and are cleared when you close it. Copying places a value on your clipboard.</p>`;
      el.querySelector("#keys-reveal-all")!.addEventListener("click", safely(async () => {
        if (revealed) forget();
        else {
          await load();
          entry.secret_names.forEach((n: string) => shown.add(n));
        }
        draw();
        rows();
      }));
      el.querySelector("#keys-copy-env")!.addEventListener("click", safely(async () => copy(dotenv(await load()), "Copied .env lines")));
      el.querySelector("#keys-edit")!.addEventListener("click", () => editDialog(entry));
      el.querySelector("#keys-delete")!.addEventListener("click", () => deleteEntry(entry));
      el.querySelectorAll<HTMLButtonElement>("[data-show]").forEach((b) =>
        b.addEventListener("click", safely(async () => {
          const name = b.dataset.show!;
          if (shown.has(name)) shown.delete(name);
          else {
            await load();
            shown.add(name);
          }
          draw();
        })),
      );
      el.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((b) =>
        b.addEventListener("click", safely(async () => copy((await load())[b.dataset.copy!], "Copied " + b.dataset.copy))),
      );
    }
    const reloadMetadata = metadata(panel, 'vault', entry.name, '/keys/' + encodeURIComponent(entry.name), latest => { Object.assign(entry, latest); draw(); rows(); });
    draw();
  }

  function secretRows(names: string[] = [], existing = false) {
    return `<div class="keys-editor" id="keys-editor">${names.map((n) => secretRow(n, existing)).join("")}</div><button type="button" class="text-link" id="keys-add-row">+ Add a variable</button><details class="keys-paste"><summary>Paste .env lines</summary><textarea id="keys-dotenv" rows="4" spellcheck="false" placeholder="OPENAI_API_KEY=sk-..."></textarea><button type="button" class="secondary" id="keys-parse">Add these variables</button></details>`;
  }

  function secretRow(name = "", existing = false) {
    return `<div class="keys-editor-row" data-existing="${existing ? "1" : ""}"><input class="keys-editor-name" aria-label="Variable name" placeholder="ENV_NAME" value="${esc(name)}" ${existing ? "readonly" : ""} spellcheck="false" autocomplete="off"><input class="keys-editor-value" aria-label="Value for ${esc(name || "new variable")}" type="password" placeholder="${existing ? "Unchanged" : "Value"}" autocomplete="new-password" spellcheck="false">${
      existing ? `<label class="check keys-remove"><input type="checkbox" class="keys-editor-remove"> Remove</label>` : `<button type="button" class="close keys-editor-drop" aria-label="Remove row">×</button>`
    }</div>`;
  }

  function bindEditor(root: HTMLElement) {
    const editor = root.querySelector<HTMLElement>("#keys-editor")!;
    const add = (name = "", value = "") => {
      editor.insertAdjacentHTML("beforeend", secretRow(name));
      const row = editor.lastElementChild!;
      (row.querySelector(".keys-editor-value") as HTMLInputElement).value = value;
      row.querySelector(".keys-editor-drop")?.addEventListener("click", () => row.remove());
      return row;
    };
    root.querySelector("#keys-add-row")!.addEventListener("click", () => (add().querySelector(".keys-editor-name") as HTMLInputElement).focus());
    root.querySelector("#keys-parse")!.addEventListener("click", () => {
      const area = root.querySelector<HTMLTextAreaElement>("#keys-dotenv")!;
      const { values, invalid } = parseDotenv(area.value);
      // Replace the untouched starter row once real variables arrive.
      for (const row of editor.querySelectorAll<HTMLElement>(".keys-editor-row:not([data-existing='1'])")) {
        const name = (row.querySelector(".keys-editor-name") as HTMLInputElement).value;
        if (Object.keys(values).length && name === "VALUE" && !(row.querySelector(".keys-editor-value") as HTMLInputElement).value) row.remove();
      }
      for (const [k, v] of Object.entries(values)) {
        const existing = [...editor.querySelectorAll<HTMLElement>(".keys-editor-row")].find(
          (r) => (r.querySelector(".keys-editor-name") as HTMLInputElement).value === k,
        );
        if (existing) (existing.querySelector(".keys-editor-value") as HTMLInputElement).value = v;
        else add(k, v);
      }
      area.value = "";
      const count = Object.keys(values).length;
      notify(`Added ${count} variable${count === 1 ? "" : "s"}${invalid.length ? `; skipped ${invalid.length} invalid line${invalid.length === 1 ? "" : "s"}` : ""}`, invalid.length > 0);
    });
    editor.querySelectorAll(".keys-editor-drop").forEach((b) => b.addEventListener("click", () => b.closest(".keys-editor-row")!.remove()));
    return () => {
      const secrets: Record<string, string | null> = {};
      for (const row of editor.querySelectorAll<HTMLElement>(".keys-editor-row")) {
        const name = (row.querySelector(".keys-editor-name") as HTMLInputElement).value.trim();
        const value = (row.querySelector(".keys-editor-value") as HTMLInputElement).value;
        const remove = (row.querySelector(".keys-editor-remove") as HTMLInputElement | null)?.checked;
        if (!name && !value) continue;
        if (!validSecretName(name)) throw new Error(`“${name}” is not a valid variable name`);
        if (remove) secrets[name] = null;
        else if (value) secrets[name] = value;
      }
      return secrets;
    };
  }

  function storeDialog(prefill: Item = {}) {
    const d = dialog(
      "Store a credential",
      `<form class="net-form keys-form"><div class="net-form-row"><label>Name<input id="keys-new-name" required maxlength="120" pattern="[A-Za-z0-9._-]+" spellcheck="false" placeholder="myproject-database" value="${esc(prefill.name || "")}"></label><label>Service<input id="keys-new-service" maxlength="60" spellcheck="false" placeholder="postgres" value="${esc(prefill.service || "")}"></label></div><div class="net-form-row"><label>Project<input id="keys-new-project" maxlength="100" list="keys-projects" spellcheck="false" placeholder="Repository name"></label><label>Notes<input id="keys-new-notes" maxlength="4000" placeholder="What it unlocks and where it is used"></label></div><datalist id="keys-projects">${[...new Set(entries.map((e) => e.project).filter(Boolean))]
        .map((p) => `<option value="${esc(p)}">`)
        .join("")}</datalist><h3 class="keys-form-head">Variables</h3>${secretRows(["VALUE"])}<div class="dialog-footer"><button type="button" class="secondary" id="keys-new-cancel">Cancel</button><button class="primary">Store</button></div></form>`, { className: "wide" });
    const collect = bindEditor(d);
    d.querySelector(".keys-editor-name")?.removeAttribute("readonly");
    d.querySelector("#keys-new-cancel")!.addEventListener("click", () => d.close());
    d.querySelector("form")!.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const secrets = Object.fromEntries(Object.entries(collect()).filter(([, v]) => v !== null)) as Record<string, string>;
        if (!Object.keys(secrets).length) throw new Error("Enter at least one value");
        const result = await api("/keys/static", "POST", {
          name: (d.querySelector("#keys-new-name") as HTMLInputElement).value.trim(),
          service: (d.querySelector("#keys-new-service") as HTMLInputElement).value.trim(),
          project: (d.querySelector("#keys-new-project") as HTMLInputElement).value.trim(),
          notes: (d.querySelector("#keys-new-notes") as HTMLInputElement).value.trim(),
          secrets,
        });
        d.close();
        await refreshVault(result.entry.name);
        notify("Stored " + result.entry.name);
      } catch (err) {
        notify((err as Error).message, true);
      }
    });
  }

  function editDialog(entry: Item) {
    const d = dialog(
      "Edit " + entry.name,
      `<form class="net-form keys-form"><div class="net-form-row"><label>Service<input id="keys-edit-service" value="${esc(entry.service)}" maxlength="60" spellcheck="false"></label><label>Project<input id="keys-edit-project" value="${esc(entry.project || "")}" maxlength="100" spellcheck="false"></label></div><label>Notes<textarea id="keys-edit-notes" rows="3" maxlength="4000">${esc(entry.notes || "")}</textarea></label><h3 class="keys-form-head">Variables</h3><p class="muted">Leave a value blank to keep it. New values replace the stored ones.</p>${secretRows(entry.secret_names, true)}<div class="dialog-footer"><button type="button" class="secondary" id="keys-edit-cancel">Cancel</button><button class="primary">Save changes</button></div></form>`, { className: "wide" });
    const collect = bindEditor(d);
    d.querySelector("#keys-edit-cancel")!.addEventListener("click", () => d.close());
    d.querySelector("form")!.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await api("/keys/" + encodeURIComponent(entry.name), "PUT", {
          service: (d.querySelector("#keys-edit-service") as HTMLInputElement).value.trim() || null,
          project: (d.querySelector("#keys-edit-project") as HTMLInputElement).value.trim(),
          notes: (d.querySelector("#keys-edit-notes") as HTMLTextAreaElement).value,
          secrets: collect(),
        });
        d.close();
        await refreshVault(entry.name);
        notify("Saved " + entry.name);
      } catch (err) {
        notify((err as Error).message, true);
      }
    });
  }

  function deleteEntry(entry: Item) {
    const minted = entry.kind === "minted";
    const d = dialog(
      "Delete " + entry.name,
      `<form class="net-confirm"><p>Remove <b>${esc(entry.name)}</b> and its ${entry.secret_names.length} values from the vault.</p>${
        minted
          ? `<label class="check"><input type="checkbox" id="keys-revoke" checked> Revoke the ${esc(entry.service)} key upstream first (recommended)</label>`
          : entry.kind === "shared"
            ? "<p class=\"muted\">This is a shared key: deleting the record does not revoke it for other projects.</p>"
            : ""
      }<label>Type <b>${esc(entry.name)}</b> to confirm<input id="keys-delete-confirm" autocomplete="off" spellcheck="false"></label><div class="dialog-footer"><button type="button" class="secondary" id="keys-delete-cancel">Cancel</button><button class="primary" id="keys-delete-ok" disabled>Delete</button></div></form>`,
    );
    const ok = d.querySelector<HTMLButtonElement>("#keys-delete-ok")!;
    d.querySelector<HTMLInputElement>("#keys-delete-confirm")!.addEventListener("input", (e) => {
      ok.disabled = (e.target as HTMLInputElement).value !== entry.name;
    });
    d.querySelector("#keys-delete-cancel")!.addEventListener("click", () => d.close());
    d.querySelector("form")!.addEventListener("submit", async (e) => {
      e.preventDefault();
      ok.disabled = true;
      try {
        const revoke = (d.querySelector("#keys-revoke") as HTMLInputElement | null)?.checked ?? false;
        const result = await api(`/keys/${encodeURIComponent(entry.name)}?revoke=${revoke}`, "DELETE");
        d.close();
        closePane();
        notify(result.revoked?.length ? "Deleted and revoked: " + result.revoked.join(", ") : "Deleted " + entry.name);
        await refreshVault();
      } catch (err) {
        ok.disabled = false;
        notify((err as Error).message, true);
      }
    });
  }

  function provisionDialog() {
    const arbiter = services.filter((s) => s.arbiter);
    const d = dialog(
      "Provision a key for a project",
      `<form class="net-form keys-form"><p>Speck mints a dedicated, revocable key where the provider allows it, and otherwise shares the configured key and records the project. Asking again returns the same entry.</p><fieldset class="keys-services">${arbiter
        .map(
          (s, i) =>
            `<label class="keys-service ${s.configured ? "" : "disabled"}"><input type="radio" name="keys-service" value="${esc(s.service)}" ${s.configured ? "" : "disabled"} ${i === 0 && s.configured ? "checked" : ""}><span><b>${esc(s.label)}</b>${chip(s.mode === "mint" ? "Mints a project key" : "Shares one key", s.mode === "mint" ? "good" : "machine")}<small>${esc(s.configured ? s.description : s.configuration_error || "Not configured — add it under Providers")}</small></span></label>`,
        )
        .join("")}</fieldset><label>Project<input id="keys-prov-project" required maxlength="100" list="keys-prov-projects" spellcheck="false" placeholder="Repository name, e.g. Lucea-iOS"></label><datalist id="keys-prov-projects">${[...new Set(entries.map((e) => e.project).filter(Boolean))]
        .map((p) => `<option value="${esc(p)}">`)
        .join("")}</datalist><div class="dialog-footer"><button type="button" class="secondary" id="keys-prov-cancel">Cancel</button><button class="primary" id="keys-prov-ok">Provision</button></div></form>`, { className: "wide" });
    d.querySelector("#keys-prov-cancel")!.addEventListener("click", () => d.close());
    d.querySelector("form")!.addEventListener("submit", async (e) => {
      e.preventDefault();
      const service = (d.querySelector("input[name=keys-service]:checked") as HTMLInputElement | null)?.value;
      const project = (d.querySelector("#keys-prov-project") as HTMLInputElement).value.trim();
      if (!service) return notify("Choose a configured provider", true);
      const button = d.querySelector<HTMLButtonElement>("#keys-prov-ok")!;
      button.disabled = true;
      try {
        const result = await api("/keys/provision", "POST", { service, project });
        d.close();
        showSecretsOnce(result.entry, result.created);
        await refreshVault();
      } catch (err) {
        button.disabled = false;
        notify((err as Error).message, true);
      }
    });
  }

  function showSecretsOnce(entry: Item, created: boolean) {
    const d = dialog(
      created ? "Key ready" : "Existing key returned",
      `<div class="net-confirm keys-result"><p><b>${esc(entry.name)}</b> · ${kindChip(entry.kind)}</p><p class="muted">${esc(entry.notes || "")}</p><pre class="keys-value" id="keys-result-env">${esc(dotenv(entry.secrets))}</pre><div class="dialog-footer"><button class="secondary" id="keys-result-close">Done</button><button class="primary" id="keys-result-copy">${icon("copy")}<span>Copy as .env</span></button></div></div>`, { className: "wide" });
    d.querySelector("#keys-result-close")!.addEventListener("click", () => d.close());
    d.querySelector("#keys-result-copy")!.addEventListener("click", () => copy(dotenv(entry.secrets), "Copied .env lines"));
    d.addEventListener("close", () => d.querySelector("#keys-result-env")?.remove());
  }

  async function refreshVault(open?: string) {
    const current = pane;
    entries = await api("/keys");
    const label = document.getElementById("keys-tab-vault");
    if (label) label.textContent = `Vault (${entries.length})`;
    if (tab === "vault") rows();
    const entry = open && entries.find((e) => e.name === open);
    // A newly stored entry opens; an edited one refreshes only if its pane is still open.
    if (entry && (!current || (current.open && pane === current))) openEntry(entry);
  }

  // ---------------- providers ----------------

  function providersTab(body: HTMLElement) {
    body.innerHTML = `<p class="muted net-note">Master credentials Speck uses on your behalf. Values are write-only here: Speck shows masked hints and never returns them. <b>Check</b> makes one read-only request to prove a credential works.</p><div class="keys-providers">${services
      .map((s, i) => {
        const check = s.last_check;
        return `<article class="card keys-provider" data-search-index="${i}" id="provider-${esc(s.service)}"><div class="infra-card-heading"><h3><button class="text-link" data-provider-details="${i}">${esc(s.label)}</button></h3>${
          s.configured ? chip("Configured", "good") : chip(s.configuration_error ? "Needs attention" : "Not configured", "warn")
        }</div><p>${chip(s.mode === "mint" ? "Mints project keys" : s.mode === "shared" ? "Shares one key" : "Used by Speck", s.mode === "mint" ? "good" : "")}</p><p class="keys-provider-desc">${esc(s.description)}</p>${
          `<p class="keys-provider-scope">${entries.filter(e => e.service === s.service).length} project credentials</p>`
        }${s.configuration_error ? `<p class="infra-error">${esc(s.configuration_error)}</p>` : ""}<p class="keys-check" id="check-${esc(s.service)}">${
          check ? `${check.ok ? chip("Last check passed", "good") : chip("Failed", "bad")} ${esc(check.detail)} <small>${esc(relative(check.checked_at))}${Number.isFinite(check.latency_ms) ? " · "+check.latency_ms+" ms" : ""}</small>` : ""
        }</p><div class="infra-actions"><button class="secondary" data-check="${esc(s.service)}" ${s.configured ? "" : "disabled"}>Check</button>${
          s.master_entry
            ? `<button class="secondary" data-open-entry="${esc(s.master_entry)}">Open vault entry</button>`
            : `<button class="secondary" data-configure="${esc(s.service)}">${s.configured ? "Replace credentials" : "Add credentials"}</button>`
        }</div>${s.updated ? `<small class="muted">Updated ${esc(relative(s.updated))}${s.updated_by ? " by " + esc(s.updated_by) : ""}</small>` : ""}</article>`;
      })
      .join("")}</div>`;
    tabSearch(body, 'Search providers and capabilities…');
    body.querySelectorAll<HTMLButtonElement>('[data-provider-details]').forEach(b => b.addEventListener('click', () => openProvider(services[+b.dataset.providerDetails!])));
    body.querySelectorAll<HTMLButtonElement>("[data-check]").forEach((b) =>
      b.addEventListener("click", async () => {
        b.disabled = true;
        const target = document.getElementById("check-" + b.dataset.check)!;
        target.innerHTML = '<span class="muted">Checking…</span>';
        try {
          const result = await api(`/keys/services/${b.dataset.check}/check`, "POST");
          const s = services.find((x) => x.service === b.dataset.check);
          if (s) s.last_check = result;
          target.innerHTML = `${result.ok ? chip("Last check passed", "good") : chip("Failed", "bad")} ${esc(result.detail)} <small>${Number.isFinite(result.latency_ms) ? result.latency_ms+" ms" : "Duration not reported"}</small>`;
        } finally {
          b.disabled = false;
        }
      }),
    );
    body.querySelectorAll<HTMLButtonElement>("[data-configure]").forEach((b) =>
      b.addEventListener("click", () => providerDialog(services.find((s) => s.service === b.dataset.configure)!)),
    );
    body.querySelectorAll<HTMLButtonElement>("[data-open-entry]").forEach((b) =>
      b.addEventListener("click", () => {
        const entry = entries.find((e) => e.name === b.dataset.openEntry);
        if (entry) openEntry(entry);
        else storeDialog({ name: b.dataset.openEntry, service: "app-store-connect" });
      }),
    );
  }

  function openProvider(s: Item) {
    rememberResource({kind:"provider",id:String(s.service)}, () => openProvider(s));
    const related = entries.filter(e => e.service === s.service);
    const panel = sidePane(s.label, detailHero('Provider credentials', s.configured ? 'Configured' : 'Needs setup', s.description, [['Project entries', related.length], ['Mode', s.mode === 'mint' ? 'Minted' : s.mode === 'shared' ? 'Shared' : 'Service'], ['Last check', s.last_check ? s.last_check.ok ? s.last_check.historical ? 'Previously passed' : 'Working' : 'Failed' : 'Not checked']]) + detailSection('Configuration', detailFacts([['Updated', when(s.updated)], ['Updated by', s.updated_by], ['Last checked', when(s.last_check?.checked_at)], ['Result', s.last_check?.detail || 'No check recorded']])) + detailSection('Stored fields', detailFacts(Object.entries({...s.hints, ...s.settings}).map(([key, value]) => [key, value]))) + detailSection('Related credentials', `<div class="resource-related">${related.map((e,i) => `<button data-provider-entry="${i}"><span><b>${esc(e.name)}</b><small>${esc(e.project || 'No project')} · ${esc(e.kind)}</small></span><span>→</span></button>`).join('') || '<p class="resource-note">No project credentials recorded for this service.</p>'}</div>`) + activity({...s, coverage: 'Provider checks and configuration changes are recorded here. Project credential access appears in each credential’s history.'}));
    const integrations=document.createElement('section');integrations.className='resource-section';integrations.innerHTML='<h3>Integration use</h3><p class="resource-note">Loading configuration references…</p>';panel.querySelector('.resource-body')!.append(integrations);
    void api('/infrastructure/connections').then((connections:Item[])=>{if(!panel.open)return;const related=connections.filter(c=>c.provider===s.service);integrations.innerHTML='<h3>Integration use</h3>'+(s.service==='unifi'?'<a href="#network">Sites, consoles, equipment and public address management →</a><p class="resource-note">These UniFi reads use this configured provider credential.</p>':s.service==='godaddy'?'<a href="#network">DNS zones and configured reachability →</a><p class="resource-note">GoDaddy DNS reads and reviewed changes use this configured provider credential.</p>':'<p class="resource-note">Infrastructure connections keep their own credentials. Same-provider connections below are related configuration, not proof that they use this provider key.</p>')+related.map(c=>`<p><a href="${resourceHref(location.hash.slice(1),{kind:'connection',id:c.id})}">${esc(c.name)} · inspect connection →</a></p>`).join('');}).catch(()=>{integrations.textContent='Integration references unavailable.';});
    panel.querySelectorAll<HTMLButtonElement>('[data-provider-entry]').forEach(b => b.addEventListener('click', () => openEntry(related[+b.dataset.providerEntry!])));
  }

  function providerDialog(s: Item) {
    const d = dialog(
      (s.configured ? "Replace " : "Add ") + s.label,
      `<form class="net-form"><p>${esc(s.description)}</p>${(s.secret_fields as string[])
        .map(
          (f) =>
            `<label>${esc(f)}<input type="password" data-secret="${esc(f)}" autocomplete="new-password" spellcheck="false" placeholder="${s.hints?.[f] ? "Leave blank to keep " + esc(s.hints[f]) : "Required"}"></label>`,
        )
        .join("")}${(s.setting_fields as string[])
        .map((f) => `<label>${esc(f)}<input data-setting="${esc(f)}" spellcheck="false" value="${esc(s.settings?.[f] || "")}"></label>`)
        .join("")}<div class="dialog-footer"><button type="button" class="secondary" id="keys-provider-cancel">Cancel</button><button class="primary">Save</button></div></form>`,
    );
    d.querySelector("#keys-provider-cancel")!.addEventListener("click", () => d.close());
    d.querySelector("form")!.addEventListener("submit", async (e) => {
      e.preventDefault();
      const secrets: Record<string, string> = {};
      const settings: Record<string, string> = {};
      d.querySelectorAll<HTMLInputElement>("[data-secret]").forEach((i) => {
        if (i.value.trim()) secrets[i.dataset.secret!] = i.value.trim();
      });
      d.querySelectorAll<HTMLInputElement>("[data-setting]").forEach((i) => (settings[i.dataset.setting!] = i.value.trim()));
      try {
        await api("/keys/services/" + s.service, "PUT", { secrets, settings });
        d.close();
        notify(s.label + " saved");
        services = await api("/keys/services");
        closePane(); renderTab();
      } catch (err) {
        notify((err as Error).message, true);
      }
    });
  }

  // ---------------- SSH keys ----------------

  function sshTab(body: HTMLElement) {
    body.innerHTML = `<div class="keys-section-heading"><p class="resource-note">SSH identities, fingerprints and recorded system access. Inspect a key to see its history and manage it.</p><button class="primary" id="ssh-generate">${icon('plus')}<span>Generate key</span></button></div><div class="infra-table-wrap"><table class="net-table keys-table"><thead><tr><th>Identity</th><th>Purpose</th><th>Key material</th><th>Created</th></tr></thead><tbody>${sshKeys.map((k,i) => `<tr data-search-index="${i}"><td><button class="text-link net-name" data-ssh-open="${i}">${esc(k.name)}</button><small class="keys-fingerprint">${esc(k.fingerprint)}</small></td><td>${esc(k.purpose || 'No purpose recorded')}</td><td>${k.has_private ? chip('Held in Speck', 'good') : chip('Public only')}<small>${esc(k.type)}</small></td><td>${esc(relative(k.created))}</td></tr>`).join('')}</tbody></table></div>`;
    cardify(body); tabSearch(body, 'Search names, purposes or fingerprints…');
    body.querySelector('#ssh-generate')!.addEventListener('click', generateDialog);
    body.querySelectorAll<HTMLButtonElement>('[data-ssh-open]').forEach(b => b.addEventListener('click', () => openSSH(sshKeys[+b.dataset.sshOpen!])));
  }

  function openSSH(k: Item) {
    rememberResource({kind:"ssh-key",id:String(k.name)}, () => openSSH(k));
    const i = sshKeys.indexOf(k);
    const body = sidePane(k.name, detailHero('SSH identity', k.has_private ? 'Private key sealed' : 'Public only', k.purpose || 'No purpose recorded', [['Algorithm', k.type.replace('ssh-', '')], ['Origin', k.origin === 'austinland' ? 'Imported' : 'Speck'], ['Created', relative(k.created)]]) + detailSection('Identity', detailFacts([['Fingerprint', k.fingerprint], ['Comment', k.comment], ['Created', when(k.created)], ['Created by', k.created_by], ['Last updated', 'Keys are immutable; created date applies'], ['Linode registration', k.registration_checked === false ? 'Not checked on this visit' : k.registered_as || 'Not registered']])) + `<div class="resource-action-buttons keys-detail-actions"><button class="secondary" data-ssh-copy="${i}">${icon('copy')}<span>Copy public key</span></button>${k.has_private ? `<button class="secondary" data-ssh-private="${i}">Reveal private key</button>` : ''}${k.registration_checked === false ? `<button class="secondary" data-ssh-check>Check Linode registration</button>` : ''}${!k.registered_as ? `<button class="secondary" data-ssh-register="${i}">Add to Linode</button>` : ''}<button class="secondary" data-ssh-delete="${i}">Delete</button></div><details class="resource-technical"><summary>Public key</summary><pre class="keys-value">${esc(k.public_key)}</pre></details><div data-key-metadata><p class="resource-note">Loading activity and system links…</p></div>`);
    const reloadSSH = metadata(body, 'ssh', k.name, '/ssh/keys/' + encodeURIComponent(k.name));
    body.querySelector<HTMLButtonElement>('[data-ssh-check]')?.addEventListener('click', async event => {
      const button = event.currentTarget as HTMLButtonElement; button.disabled = true;
      try {
        const current = (await fresh('/ssh/keys')).find((row: Item) => row.name === k.name);
        if (current && body.open && pane === body) { Object.assign(k, current); openSSH(k); }
      } catch (error) { notify((error as Error).message, true); button.disabled = false; }
    });
    body.querySelectorAll<HTMLButtonElement>("[data-ssh-copy]").forEach((b) =>
      b.addEventListener("click", () => copy(sshKeys[+b.dataset.sshCopy!].public_key, "Copied public key")),
    );
    body.querySelectorAll<HTMLButtonElement>("[data-ssh-private]").forEach((b) =>
      b.addEventListener("click", async () => {
        const k = sshKeys[+b.dataset.sshPrivate!];
        const result = await fresh(`/ssh/keys/${encodeURIComponent(k.name)}/private`);
        if (!body.open || pane !== body) { result.private_key = ""; return; }
        const d = dialog(
          "Private key · " + k.name,
          `<div class="net-confirm"><p class="muted">Recorded in Activity. Save it with mode 600 and never commit it.</p><pre class="keys-value">${esc(result.private_key)}</pre><div class="dialog-footer"><button class="secondary" id="ssh-private-close">Done</button><button class="primary" id="ssh-private-copy">${icon("copy")}<span>Copy</span></button></div></div>`, { className: "wide" });
        const expiry = window.setTimeout(() => d.close(), REVEAL_SECONDS * 1000);
        d.addEventListener('close', () => { window.clearTimeout(expiry); result.private_key = ''; void reloadSSH(); });
        d.querySelector("#ssh-private-close")!.addEventListener("click", () => d.close());
        d.querySelector("#ssh-private-copy")!.addEventListener("click", () => copy(result.private_key, "Copied private key"));
      }),
    );
    body.querySelectorAll<HTMLButtonElement>("[data-ssh-register]").forEach((b) =>
      b.addEventListener("click", async () => {
        const k = sshKeys[+b.dataset.sshRegister!];
        await api("/ssh/register", "POST", { name: k.name, label: k.name });
        notify(k.name + " added to Linode");
        sshKeys = await api("/ssh/keys?registration=false");
        closePane(); renderTab();
      }),
    );
    body.querySelectorAll<HTMLButtonElement>("[data-ssh-delete]").forEach((b) =>
      b.addEventListener("click", async () => {
        const k = sshKeys[+b.dataset.sshDelete!];
        const d = dialog(
          "Delete " + k.name,
          `<form class="net-confirm"><p>Remove this key from Speck. Machines and Linode keep any copies already installed.</p><label>Type <b>${esc(k.name)}</b> to confirm<input id="ssh-delete-confirm" autocomplete="off"></label><div class="dialog-footer"><button type="button" class="secondary" id="ssh-delete-cancel">Cancel</button><button class="primary" id="ssh-delete-ok" disabled>Delete</button></div></form>`,
        );
        const ok = d.querySelector<HTMLButtonElement>("#ssh-delete-ok")!;
        d.querySelector<HTMLInputElement>("#ssh-delete-confirm")!.addEventListener("input", (e) => (ok.disabled = (e.target as HTMLInputElement).value !== k.name));
        d.querySelector("#ssh-delete-cancel")!.addEventListener("click", () => d.close());
        d.querySelector("form")!.addEventListener("submit", async (e) => {
          e.preventDefault();
          await api("/ssh/keys/" + encodeURIComponent(k.name), "DELETE");
          d.close();
          sshKeys = await api("/ssh/keys?registration=false");
          closePane(); renderTab();
        });
      }),
    );
  }

  function generateDialog() {
    const d = dialog(
      "Generate an SSH key",
      `<form class="net-form"><label>Name<input id="ssh-new-name" required pattern="[A-Za-z0-9._-]+" maxlength="80" spellcheck="false" placeholder="myproject-deploy"></label><label>Comment<input id="ssh-new-comment" maxlength="120" spellcheck="false" placeholder="myproject deploy key"></label><label>Purpose<input id="ssh-new-purpose" maxlength="200" placeholder="Where this key is installed"></label><div class="dialog-footer"><button type="button" class="secondary" id="ssh-new-cancel">Cancel</button><button class="primary">Generate Ed25519 key</button></div></form>`,
    );
    d.querySelector("#ssh-new-cancel")!.addEventListener("click", () => d.close());
    d.querySelector("form")!.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const result = await api("/ssh/generate", "POST", {
          name: (d.querySelector("#ssh-new-name") as HTMLInputElement).value.trim(),
          comment: (d.querySelector("#ssh-new-comment") as HTMLInputElement).value.trim(),
          purpose: (d.querySelector("#ssh-new-purpose") as HTMLInputElement).value.trim(),
        });
        d.close();
        await copy(result.public_key, "Generated " + result.name + "; public key copied");
        sshKeys = await api("/ssh/keys?registration=false");
        renderTab();
      } catch (err) {
        notify((err as Error).message, true);
      }
    });
  }

  // ---------------- handoffs ----------------

  function handoffsTab(body: HTMLElement) {
    body.innerHTML = `<p class="muted net-note">Markdown handoffs give another agent SSH access, DNS wiring and a system snapshot for one machine. Reveal a document to access its instructions and embedded private key. Every reveal is recorded in Activity.</p>${
      handoffs.length
        ? `<div class="infra-table-wrap"><table class="net-table"><thead><tr><th>Machine</th><th>Domain</th><th>Created</th><th>Size</th><th></th></tr></thead><tbody>${handoffs
            .map(
              (h, i) =>
                `<tr data-search-index="${i}"><td><button class="text-link net-name" data-handoff="${i}">${esc(h.machine)}</button><small class="mono">${esc(h.filename)}</small></td><td>${esc(h.domain || "—")}</td><td>${esc(relative(h.created))}${h.origin === "austinland" ? "<small>Imported from AustinLand</small>" : ""}</td><td>${(h.size / 1024).toFixed(1)} KB</td><td class="net-row-actions"><button class="secondary" data-handoff-delete="${i}">Delete</button></td></tr>`,
            )
            .join("")}</tbody></table></div>`
        : '<div class="empty"><h2>No handoff files</h2><p>Handoffs imported from AustinLand or generated for a machine appear here.</p></div>'
    }`;
    cardify(body);
    tabSearch(body, "Search machines, domains or filenames…");
    body.querySelectorAll<HTMLButtonElement>("[data-handoff]").forEach((b) => b.addEventListener("click", () => openHandoff(handoffs[+b.dataset.handoff!])));
    body.querySelectorAll<HTMLButtonElement>("[data-handoff-delete]").forEach((b) =>
      b.addEventListener("click", async () => {
        const h = handoffs[+b.dataset.handoffDelete!];
        const d = dialog(
          "Delete handoff",
          `<form class="net-confirm"><p>Delete <span class="mono">${esc(h.filename)}</span>. The SSH key it describes stays installed on the machine.</p><label>Type <b>${esc(h.machine)}</b> to confirm<input id="handoff-delete-confirm" autocomplete="off"></label><div class="dialog-footer"><button type="button" class="secondary" id="handoff-cancel">Cancel</button><button class="primary" id="handoff-ok" disabled>Delete</button></div></form>`,
        );
        const ok = d.querySelector<HTMLButtonElement>("#handoff-ok")!;
        d.querySelector<HTMLInputElement>("#handoff-delete-confirm")!.addEventListener("input", (e) => (ok.disabled = (e.target as HTMLInputElement).value !== h.machine));
        d.querySelector("#handoff-cancel")!.addEventListener("click", () => d.close());
        d.querySelector("form")!.addEventListener("submit", async (e) => {
          e.preventDefault();
          await api("/context/files/" + encodeURIComponent(h.filename), "DELETE");
          d.close();
          handoffs = await api("/context/files");
          renderTab();
        });
      }),
    );
  }

  function openHandoff(h: Item) {
    rememberResource({kind:"handoff",id:String(h.filename)}, () => openHandoff(h));
    const panel = sidePane(h.machine + (h.domain ? " · " + h.domain : ""), detailHero('Machine handoff', 'Sealed document', 'Connection instructions and a system snapshot for another operator or agent.', [['Machine', h.machine], ['Domain', h.domain || 'Not recorded'], ['Size', (h.size / 1024).toFixed(1) + ' KB']]) + detailSection('Document', detailFacts([['Filename', h.filename], ['Stored', when(h.created)], ['Created by', h.created_by], ['Origin', h.origin], ['Provider', h.provider], ['Target', h.target]])) + `<div id="handoff-pane"></div><div data-key-metadata><p class="resource-note">Loading access history…</p></div>`);
    let markdown: string | null = null, timer = 0;
    const forget = () => { markdown = null; window.clearTimeout(timer); };
    panel.addEventListener('close', forget);
    const reloadMetadata = metadata(panel, 'handoff', h.filename, '/context/files/' + encodeURIComponent(h.filename));
    const draw = () => {
      panel.querySelector('#handoff-pane')!.innerHTML = `<p class="resource-note">${markdown ? 'This document contains credentials. Values clear after 90 seconds or when you close it.' : 'The document stays sealed until you reveal it. Reading or copying it is recorded in Activity.'}</p><div class="resource-action-buttons keys-detail-actions"><button class="primary" id="handoff-toggle">${markdown ? 'Hide handoff' : 'Reveal handoff'}</button>${markdown ? `<button class="secondary" id="handoff-copy">Copy Markdown</button><button class="secondary" id="handoff-download">Download</button>` : ''}</div>${markdown ? `<pre class="keys-markdown">${esc(markdown)}</pre>` : ''}`;
      panel.querySelector<HTMLButtonElement>('#handoff-toggle')!.addEventListener('click', async (event) => {
        if (markdown) { forget(); draw(); return; }
        (event.currentTarget as HTMLButtonElement).disabled = true;
        try {
          const file = await fresh('/context/files/' + encodeURIComponent(h.filename));
          if (!panel.open || pane !== panel) return;
          markdown = file.markdown;
          timer = window.setTimeout(() => { forget(); draw(); }, REVEAL_SECONDS * 1000);
          draw(); void reloadMetadata();
        } catch (error) { notify((error as Error).message, true); draw(); }
      });
      panel.querySelector('#handoff-copy')?.addEventListener('click', () => copy(markdown!, 'Copied handoff'));
      panel.querySelector('#handoff-download')?.addEventListener('click', () => {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(new Blob([markdown!], {type:'text/markdown'})); link.download = h.filename; link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      });
    };
    draw();
  }

  registerResource("key", async ref => { const result=await api('/keys'); const row=(Array.isArray(result)?result:result.entries || []).find((r:Item)=>r.name===ref.id); if(!row) throw new Error('Credential metadata is unavailable'); openEntry(row); });
  registerResource("provider", async ref => { const result=await api('/keys/services'); const row=(Array.isArray(result)?result:result.services || []).find((r:Item)=>r.service===ref.id); if(!row) throw new Error('Provider metadata is unavailable'); openProvider(row); });
  registerResource("ssh-key", async ref => { const result=await api('/ssh/keys?registration=false'); const row=(Array.isArray(result)?result:result.keys || []).find((r:Item)=>r.name===ref.id); if(!row) throw new Error('SSH key metadata is unavailable'); openSSH(row); });
  registerResource("handoff", async ref => { const result=await api('/context/files'); const row=result.find((r:Item)=>r.filename===ref.id); if(!row) throw new Error('Handoff metadata is unavailable'); openHandoff(row); });
  return { render, closePane };
}
