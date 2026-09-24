import "./network.css";
import "./keys.css";
import { icon } from "./icons";
import { relative } from "./network-model";
import { cardify } from "./table-cards";
import { dotenv, groupEntries, parseDotenv, validSecretName } from "./vault-model";

type Item = Record<string, any>;
const REVEAL_SECONDS = 90;

export function createKeys(ui: Item) {
  const { api, esc, notify, content, loading } = ui;
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

  const chip = (text: string, tone = "") => `<span class="net-chip ${tone}">${esc(text)}</span>`;
  const kindChip = (kind: string) =>
    chip(kind === "minted" ? "Minted" : kind === "shared" ? "Shared" : "Stored", kind === "minted" ? "good" : kind === "shared" ? "machine" : "");
  const loadingState = (label: string) => (ui.loadingState ? ui.loadingState(label) : esc(label));

  async function copy(text: string, label = "Copied") {
    await navigator.clipboard.writeText(text);
    notify(label);
  }

  async function render() {
    loading("Loading keys…");
    if (!admin()) {
      content('<div class="empty"><h2>Administrators only</h2><p>The credential vault, provider credentials and handoff files are available to administrators.</p></div>');
      return;
    }
    [entries, services, sshKeys, handoffs] = await Promise.all([
      api("/keys"),
      api("/keys/services"),
      api("/ssh/keys").catch(() => []),
      api("/context/files").catch(() => []),
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
        tab = b.dataset.tab!;
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
    body.innerHTML = `<div class="infra-toolbar net-toolbar"><label class="infra-search">Search<input id="keys-q" type="search" placeholder="Name, project, service or variable" value="${esc(query)}"></label><label>Service<select id="keys-service"><option value="">All services</option>${serviceNames
      .map((s) => `<option ${serviceFilter === s ? "selected" : ""}>${esc(s)}</option>`)
      .join("")}</select></label><label>Kind<select id="keys-kind"><option value="">All kinds</option>${[
      ["minted", "Minted"],
      ["shared", "Shared"],
      ["static", "Stored"],
    ]
      .map(([v, l]) => `<option value="${v}" ${kindFilter === v ? "selected" : ""}>${l}</option>`)
      .join("")}</select></label><div class="keys-actions"><button class="primary" id="keys-provision">${icon("plus")}<span>Provision key</span></button><button class="secondary" id="keys-store">Store credential</button></div></div><div id="keys-rows"></div>`;
    body.querySelector<HTMLInputElement>("#keys-q")!.addEventListener("input", (e) => {
      query = (e.target as HTMLInputElement).value.trim().toLowerCase();
      rows();
    });
    body.querySelector<HTMLSelectElement>("#keys-service")!.addEventListener("change", (e) => {
      serviceFilter = (e.target as HTMLSelectElement).value;
      rows();
    });
    body.querySelector<HTMLSelectElement>("#keys-kind")!.addEventListener("change", (e) => {
      kindFilter = (e.target as HTMLSelectElement).value;
      rows();
    });
    body.querySelector("#keys-provision")!.addEventListener("click", provisionDialog);
    body.querySelector("#keys-store")!.addEventListener("click", () => storeDialog());
    rows();
  }

  function rows() {
    const el = document.getElementById("keys-rows");
    if (!el) return;
    const visible = entries.filter(
      (e) =>
        (!serviceFilter || e.service === serviceFilter) &&
        (!kindFilter || e.kind === kindFilter) &&
        (!query ||
          [e.name, e.service, e.project || "", e.notes || "", ...(e.secret_names || [])].some((v: string) => v.toLowerCase().includes(query))),
    );
    if (!visible.length) {
      el.innerHTML = `<div class="empty"><h2>${entries.length ? "No matching entries" : "The vault is empty"}</h2><p>${entries.length ? "Change the search or filters." : "Provision a key for a project or store a credential."}</p></div>`;
      return;
    }
    el.innerHTML = `<div class="infra-table-wrap"><table class="net-table net-compact keys-table"><thead><tr><th>Name</th><th>Service</th><th>Kind</th><th>Secrets</th><th>Updated</th><th>Last revealed</th></tr></thead><tbody>${groupEntries(visible)
      .map(
        ([group, items]) =>
          `<tr class="keys-group-row"><th colspan="6">${esc(group)} <small>${items.length}</small></th></tr>${items
            .map(
              (e) =>
                `<tr><td><button class="text-link net-name" data-entry="${esc(e.name)}">${esc(e.name)}</button></td><td>${esc(e.service)}</td><td>${kindChip(e.kind)}</td><td>${(e.secret_names as string[])
                  .slice(0, 3)
                  .map((n) => `<span class="keys-var">${esc(n)}</span>`)
                  .join("")}${e.secret_names.length > 3 ? `<small class="keys-more">+${e.secret_names.length - 3}</small>` : ""}</td><td>${esc(relative(e.updated))}</td><td>${e.revealed ? esc(relative(e.revealed)) : '<span class="placeholder">never</span>'}</td></tr>`,
            )
            .join("")}`,
      )
      .join("")}</tbody></table></div>`;
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
    const panel = dialog(title, html, { className: "device-drawer net-drawer", modal: false });
    pane = panel;
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && panel.open && !document.querySelector("dialog:modal")) panel.close();
    };
    document.addEventListener("keydown", escape);
    panel.addEventListener("close", () => document.removeEventListener("keydown", escape));
    return panel;
  }

  function openEntry(entry: Item) {
    let revealed: Record<string, string> | null = null;
    let timer = 0;
    const shown = new Set<string>();
    const panel = sidePane(entry.name, `<div class="net-pane" id="keys-pane"></div>`);
    const forget = () => {
      revealed = null;
      shown.clear();
      window.clearTimeout(timer);
    };
    panel.addEventListener("close", forget);
    async function load() {
      if (revealed) return revealed;
      const full = await api("/keys/" + encodeURIComponent(entry.name));
      revealed = full.secrets;
      entry.revealed = Date.now() / 1000;
      entry.reveals = (entry.reveals || 0) + 1;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        forget();
        draw();
        notify("Revealed values were cleared from this page");
      }, REVEAL_SECONDS * 1000);
      return revealed!;
    }
    function draw() {
      const el = panel.querySelector("#keys-pane");
      if (!el) return;
      const minted = entry.kind === "minted";
      el.innerHTML = `<div class="net-facts"><div><span>Service</span><b>${esc(entry.service)}</b></div><div><span>Kind</span><b>${esc(minted ? "Minted" : entry.kind === "shared" ? "Shared" : "Stored")}</b></div><div><span>Project</span><b>${esc(entry.project || "—")}</b></div><div><span>Created</span><b>${esc(relative(entry.created))}</b></div><div><span>Reveals</span><b>${entry.reveals || 0}</b></div><div><span>Origin</span><b>${entry.origin === "austinland" ? "AustinLand import" : "Speck"}</b></div></div>${
        entry.notes ? `<p class="keys-notes">${esc(entry.notes)}</p>` : ""
      }${minted ? `<p class="muted keys-meta">${Object.entries(entry.meta || {}).map(([k, v]) => `${esc(k.replaceAll("_", " "))}: <span class="mono">${esc(v)}</span>`).join(" · ")}</p>` : ""}<div class="net-pane-actions"><button class="primary" id="keys-reveal-all">${icon("eye")}<span>${revealed ? "Hide values" : "Reveal values"}</span></button><button class="secondary" id="keys-copy-env">${icon("copy")}<span>Copy as .env</span></button><button class="secondary" id="keys-edit">Edit</button><button class="secondary" id="keys-delete">Delete</button></div><div class="keys-secrets">${(entry.secret_names as string[])
        .map((name) => {
          const visible = revealed && shown.has(name);
          const value = visible ? revealed![name] : entry.hints?.[name] || "••••";
          const multiline = visible && value.includes("\n");
          return `<div class="keys-secret"><div class="keys-secret-name">${esc(name)}</div>${
            multiline ? `<pre class="keys-value">${esc(value)}</pre>` : `<div class="keys-value ${visible ? "" : "masked"}">${esc(value)}</div>`
          }<div class="keys-secret-actions"><button class="secondary" data-show="${esc(name)}" aria-label="${visible ? "Hide" : "Show"} ${esc(name)}">${visible ? "Hide" : "Show"}</button><button class="secondary" data-copy="${esc(name)}" aria-label="Copy ${esc(name)}">${icon("copy")}</button></div></div>`;
        })
        .join("")}</div><p class="muted keys-footnote">Values stay in this page for ${REVEAL_SECONDS} seconds after they are fetched, and are cleared when you close it. Copying places a value on your clipboard.</p>`;
      el.querySelector("#keys-reveal-all")!.addEventListener("click", async () => {
        if (revealed) forget();
        else {
          await load();
          entry.secret_names.forEach((n: string) => shown.add(n));
        }
        draw();
        rows();
      });
      el.querySelector("#keys-copy-env")!.addEventListener("click", async () => copy(dotenv(await load()), "Copied .env lines"));
      el.querySelector("#keys-edit")!.addEventListener("click", () => editDialog(entry));
      el.querySelector("#keys-delete")!.addEventListener("click", () => deleteEntry(entry));
      el.querySelectorAll<HTMLButtonElement>("[data-show]").forEach((b) =>
        b.addEventListener("click", async () => {
          const name = b.dataset.show!;
          if (shown.has(name)) shown.delete(name);
          else {
            await load();
            shown.add(name);
          }
          draw();
        }),
      );
      el.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((b) =>
        b.addEventListener("click", async () => copy((await load())[b.dataset.copy!], "Copied " + b.dataset.copy)),
      );
    }
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
      .map((s) => {
        const check = s.last_check;
        return `<article class="card keys-provider" id="provider-${esc(s.service)}"><div class="infra-card-heading"><h3>${esc(s.label)}</h3>${
          s.configured ? chip("Configured", "good") : chip(s.configuration_error ? "Needs attention" : "Not configured", "warn")
        }</div><p>${chip(s.mode === "mint" ? "Mints project keys" : s.mode === "shared" ? "Shares one key" : "Used by Speck", s.mode === "mint" ? "good" : "")}</p><p class="keys-provider-desc">${esc(s.description)}</p>${
          Object.keys(s.hints || {}).length
            ? `<dl class="keys-hints">${Object.entries(s.hints)
                .map(([k, v]) => `<dt>${esc(k)}</dt><dd class="mono">${esc(v)}</dd>`)
                .join("")}${Object.entries(s.settings || {})
                .map(([k, v]) => `<dt>${esc(k)}</dt><dd class="mono">${esc(v)}</dd>`)
                .join("")}</dl>`
            : ""
        }${s.configuration_error ? `<p class="infra-error">${esc(s.configuration_error)}</p>` : ""}<p class="keys-check" id="check-${esc(s.service)}">${
          check ? `${check.ok ? chip("Working", "good") : chip("Failed", "bad")} ${esc(check.detail)} <small>${esc(relative(check.checked_at))} · ${check.latency_ms} ms</small>` : ""
        }</p><div class="infra-actions"><button class="secondary" data-check="${esc(s.service)}" ${s.configured ? "" : "disabled"}>Check</button>${
          s.master_entry
            ? `<button class="secondary" data-open-entry="${esc(s.master_entry)}">Open vault entry</button>`
            : `<button class="secondary" data-configure="${esc(s.service)}">${s.configured ? "Replace credentials" : "Add credentials"}</button>`
        }</div>${s.updated ? `<small class="muted">Updated ${esc(relative(s.updated))}${s.updated_by ? " by " + esc(s.updated_by) : ""}</small>` : ""}</article>`;
      })
      .join("")}</div>`;
    body.querySelectorAll<HTMLButtonElement>("[data-check]").forEach((b) =>
      b.addEventListener("click", async () => {
        b.disabled = true;
        const target = document.getElementById("check-" + b.dataset.check)!;
        target.innerHTML = '<span class="muted">Checking…</span>';
        try {
          const result = await api(`/keys/services/${b.dataset.check}/check`, "POST");
          const s = services.find((x) => x.service === b.dataset.check);
          if (s) s.last_check = result;
          target.innerHTML = `${result.ok ? chip("Working", "good") : chip("Failed", "bad")} ${esc(result.detail)} <small>${result.latency_ms} ms</small>`;
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
        renderTab();
      } catch (err) {
        notify((err as Error).message, true);
      }
    });
  }

  // ---------------- SSH keys ----------------

  function sshTab(body: HTMLElement) {
    body.innerHTML = `<div class="infra-toolbar net-toolbar"><p class="muted net-note">Public keys for <span class="mono">authorized_keys</span> and Linode. Keys generated here keep their private half sealed in Speck; imported workstation keys are public only.</p><div class="keys-actions"><button class="primary" id="ssh-generate">${icon("plus")}<span>Generate key</span></button></div></div><div class="infra-table-wrap"><table class="net-table"><thead><tr><th>Name</th><th>Fingerprint</th><th>Purpose</th><th>Private key</th><th>Linode</th><th></th></tr></thead><tbody>${sshKeys
      .map(
        (k, i) =>
          `<tr><td><b>${esc(k.name)}</b><small>${esc(k.type)}${k.comment && k.comment !== k.name ? " · " + esc(k.comment) : ""}</small></td><td class="mono">${esc(k.fingerprint)}</td><td>${esc(k.purpose || "—")}</td><td>${k.has_private ? chip("Held in Speck", "good") : chip("Public only")}</td><td>${k.registered_as ? chip(k.registered_as, "machine") : '<span class="muted">—</span>'}</td><td class="net-row-actions"><button class="secondary" data-ssh-copy="${i}">${icon("copy")}<span>Public key</span></button>${
            k.has_private ? `<button class="secondary" data-ssh-private="${i}">Private key</button>` : ""
          }${k.registered_as ? "" : `<button class="secondary" data-ssh-register="${i}">Add to Linode</button>`}<button class="secondary" data-ssh-delete="${i}">Delete</button></td></tr>`,
      )
      .join("")}</tbody></table></div>`;
    cardify(body);
    body.querySelector("#ssh-generate")!.addEventListener("click", generateDialog);
    body.querySelectorAll<HTMLButtonElement>("[data-ssh-copy]").forEach((b) =>
      b.addEventListener("click", () => copy(sshKeys[+b.dataset.sshCopy!].public_key, "Copied public key")),
    );
    body.querySelectorAll<HTMLButtonElement>("[data-ssh-private]").forEach((b) =>
      b.addEventListener("click", async () => {
        const k = sshKeys[+b.dataset.sshPrivate!];
        const result = await api(`/ssh/keys/${encodeURIComponent(k.name)}/private`);
        const d = dialog(
          "Private key · " + k.name,
          `<div class="net-confirm"><p class="muted">Recorded in Activity. Save it with mode 600 and never commit it.</p><pre class="keys-value">${esc(result.private_key)}</pre><div class="dialog-footer"><button class="secondary" id="ssh-private-close">Done</button><button class="primary" id="ssh-private-copy">${icon("copy")}<span>Copy</span></button></div></div>`, { className: "wide" });
        d.querySelector("#ssh-private-close")!.addEventListener("click", () => d.close());
        d.querySelector("#ssh-private-copy")!.addEventListener("click", () => copy(result.private_key, "Copied private key"));
      }),
    );
    body.querySelectorAll<HTMLButtonElement>("[data-ssh-register]").forEach((b) =>
      b.addEventListener("click", async () => {
        const k = sshKeys[+b.dataset.sshRegister!];
        await api("/ssh/register", "POST", { name: k.name, label: k.name });
        notify(k.name + " added to Linode");
        sshKeys = await api("/ssh/keys");
        renderTab();
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
          sshKeys = await api("/ssh/keys");
          renderTab();
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
        sshKeys = await api("/ssh/keys");
        renderTab();
      } catch (err) {
        notify((err as Error).message, true);
      }
    });
  }

  // ---------------- handoffs ----------------

  function handoffsTab(body: HTMLElement) {
    body.innerHTML = `<p class="muted net-note">Markdown handoffs give another agent SSH access, DNS wiring and a system snapshot for one machine. They embed a private key, so opening one is recorded in Activity.</p>${
      handoffs.length
        ? `<div class="infra-table-wrap"><table class="net-table"><thead><tr><th>Machine</th><th>Domain</th><th>Created</th><th>Size</th><th></th></tr></thead><tbody>${handoffs
            .map(
              (h, i) =>
                `<tr><td><button class="text-link net-name" data-handoff="${i}">${esc(h.machine)}</button><small class="mono">${esc(h.filename)}</small></td><td>${esc(h.domain || "—")}</td><td>${esc(relative(h.created))}${h.origin === "austinland" ? "<small>Imported from AustinLand</small>" : ""}</td><td>${(h.size / 1024).toFixed(1)} KB</td><td class="net-row-actions"><button class="secondary" data-handoff-delete="${i}">Delete</button></td></tr>`,
            )
            .join("")}</tbody></table></div>`
        : '<div class="empty"><h2>No handoff files</h2><p>Handoffs imported from AustinLand or generated for a machine appear here.</p></div>'
    }`;
    cardify(body);
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

  async function openHandoff(h: Item) {
    const panel = sidePane(h.machine + (h.domain ? " · " + h.domain : ""), `<div class="net-pane" id="handoff-pane">${loadingState("Loading handoff…")}</div>`);
    const file = await api("/context/files/" + encodeURIComponent(h.filename));
    if (pane !== panel) return;
    let showKey = false;
    const masked = () =>
      file.markdown.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "••••  private key hidden — use Show private key  ••••");
    const draw = () => {
      panel.querySelector("#handoff-pane")!.innerHTML = `<div class="net-pane-actions"><button class="secondary" id="handoff-toggle">${icon("eye")}<span>${showKey ? "Hide private key" : "Show private key"}</span></button><button class="secondary" id="handoff-copy">${icon("copy")}<span>Copy Markdown</span></button><button class="secondary" id="handoff-download">${icon("download")}<span>Download</span></button></div><pre class="keys-markdown">${esc(showKey ? file.markdown : masked())}</pre>`;
      panel.querySelector("#handoff-toggle")!.addEventListener("click", () => {
        showKey = !showKey;
        draw();
      });
      panel.querySelector("#handoff-copy")!.addEventListener("click", () => copy(file.markdown, "Copied handoff"));
      panel.querySelector("#handoff-download")!.addEventListener("click", () => {
        const link = document.createElement("a");
        link.href = URL.createObjectURL(new Blob([file.markdown], { type: "text/markdown" }));
        link.download = h.filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      });
    };
    draw();
  }

  return { render, closePane };
}
