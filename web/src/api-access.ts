import "./network.css";
import "./keys.css";
import "./api-access.css";
import { icon } from "./icons";
import { relative } from "./network-model";
import { endpointGroups, snippets } from "./api-model";
import { cardify } from "./table-cards";

type Item = Record<string, any>;

export function createApiAccess(ui: Item) {
  const { api, esc, notify, content, loading } = ui;
  const dialog: (title: string, html: string, options?: Item) => HTMLDialogElement = ui.dialog;
  const chip = (text: string, tone = "") => `<span class="net-chip ${tone}">${esc(text)}</span>`;
  let tokens: Item[] = [],
    scopes: Item = {},
    schema: Item | null = null,
    endpointQuery = "",
    showInactive = false;

  async function copy(text: string, label = "Copied") {
    await navigator.clipboard.writeText(text);
    notify(label);
  }

  async function render() {
    loading("Loading API access…");
    [tokens, scopes] = await Promise.all([api("/tokens"), api("/tokens/scopes")]);
    const origin = location.origin;
    const setup = snippets(origin, "$SPECK_TOKEN");
    content(
      `<section class="api-start"><article class="card"><span class="eyebrow">1 · Token</span><h3>Create a scoped token</h3><p>Tokens act as you, never above your role. Grant only the scopes an agent needs.</p><button class="primary" id="api-new-token">${icon("plus")}<span>Create API token</span></button></article><article class="card"><span class="eyebrow">2 · Claude Code</span><h3>Connect over MCP</h3><p>Speck is an MCP server. Add it once and Claude can search, run commands and fetch keys.</p><pre class="keys-value api-snippet">${esc(setup.mcp)}</pre><button class="secondary" data-copy="mcp">${icon("copy")}<span>Copy command</span></button></article><article class="card"><span class="eyebrow">3 · Repositories</span><h3>Drop in SPECK.md</h3><p>Save <a class="text-link" href="/speck.md" target="_blank" rel="noopener">speck.md</a> in a repo so future agents know how to get keys and infrastructure.</p><pre class="keys-value api-snippet">${esc(setup.dropin)}</pre><button class="secondary" data-copy="dropin">${icon("copy")}<span>Copy command</span></button></article></section><div class="api-links"><a class="secondary" href="/agents.md" target="_blank" rel="noopener">Agent guide</a><a class="secondary" href="/llms.txt" target="_blank" rel="noopener">llms.txt</a><a class="secondary" href="/api/openapi.json" target="_blank" rel="noopener">OpenAPI schema</a></div><h2 class="api-head">API tokens</h2><div id="api-tokens"></div><h2 class="api-head">Endpoints</h2><p class="muted net-note">Every endpoint below accepts <span class="mono">Authorization: Bearer speck_pat_…</span>. GET requests can be tried here with your own session.</p><div class="infra-toolbar net-toolbar"><label class="infra-search">Search<input id="api-endpoint-q" type="search" placeholder="Path, method or description" value="${esc(endpointQuery)}"></label></div><div id="api-endpoints">${ui.loadingState ? ui.loadingState("Loading schema…") : ""}</div>`,
    );
    document.getElementById("api-new-token")!.addEventListener("click", tokenDialog);
    document.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((b) =>
      b.addEventListener("click", () => copy((setup as Item)[b.dataset.copy!], "Copied command")),
    );
    document.getElementById("api-endpoint-q")!.addEventListener("input", (e) => {
      endpointQuery = (e.target as HTMLInputElement).value.trim();
      drawEndpoints();
    });
    drawTokens();
    if (!schema) schema = await fetch("/api/openapi.json").then((r) => r.json()).catch(() => null);
    drawEndpoints();
  }

  function drawTokens() {
    const el = document.getElementById("api-tokens");
    if (!el) return;
    const active = tokens.filter((t) => t.active);
    const inactive = tokens.length - active.length;
    const shown = showInactive ? tokens : active;
    el.innerHTML = tokens.length
      ? `${shown.length ? `<div class="infra-table-wrap"><table class="net-table net-compact"><thead><tr><th>Name</th><th>Scopes</th><th>Owner</th><th>Last used</th><th>Expires</th><th>Status</th><th></th></tr></thead><tbody>${shown
          .map(
            (t, i) =>
              `<tr class="${t.active ? "" : "api-inactive"}"><td><b>${esc(t.name)}</b>${t.key_prefixes.length ? `<small>Vault limited to ${t.key_prefixes.map((p: string) => esc(p) + "*").join(", ")}</small>` : ""}</td><td>${t.scopes
                .map((s: string) => chip(s, s.startsWith("keys") ? "warn" : s === "admin" ? "machine" : ""))
                .join("")}</td><td>${esc(t.owner)}</td><td>${t.last_used ? esc(relative(t.last_used)) + `<small>${esc(t.last_ip || "")} · ${t.uses} requests</small>` : '<span class="muted">never</span>'}</td><td>${esc(relative(t.expires))}</td><td>${t.revoked ? chip("Revoked", "bad") : t.active ? chip("Active", "good") : chip("Expired", "warn")}</td><td class="net-row-actions">${t.active ? `<button class="secondary" data-revoke="${i}">Revoke</button>` : ""}</td></tr>`,
          )
          .join("")}</tbody></table></div>` : ""}<p class="muted api-token-note">${active.length ? `${active.length} active.` : "No active tokens."} Token use appears in Activity as “owner (API: token name)”.${inactive ? ` <button class="text-link" id="api-toggle-inactive">${showInactive ? "Hide" : "Show"} ${inactive} revoked or expired</button>` : ""}</p>`
      : '<div class="empty"><h2>No API tokens yet</h2><p>Create one to connect Claude Code, scripts or CI.</p></div>';
    el.querySelector("#api-toggle-inactive")?.addEventListener("click", () => {
      showInactive = !showInactive;
      drawTokens();
    });
    cardify(el);
    el.querySelectorAll<HTMLButtonElement>("[data-revoke]").forEach((b) =>
      b.addEventListener("click", async () => {
        const t = shown[+b.dataset.revoke!];
        const d = dialog(
          "Revoke " + t.name,
          `<form class="net-confirm"><p>Agents using this token lose access immediately. This cannot be undone.</p><div class="dialog-footer"><button type="button" class="secondary" id="api-revoke-cancel">Cancel</button><button class="primary" id="api-revoke-ok">Revoke token</button></div></form>`,
        );
        d.querySelector("#api-revoke-cancel")!.addEventListener("click", () => d.close());
        d.querySelector("form")!.addEventListener("submit", async (e) => {
          e.preventDefault();
          await api("/tokens/" + t.id, "DELETE");
          d.close();
          tokens = await api("/tokens");
          drawTokens();
          notify("Revoked " + t.name);
        });
      }),
    );
  }

  function tokenDialog() {
    const role = scopes.role as string;
    const allowed = (s: string) => role === "admin" || s === "read" || (s === "operate" && role === "operator");
    const d = dialog(
      "Create an API token",
      `<form class="net-form keys-form"><label>Name<input id="api-token-name" required maxlength="80" placeholder="Claude Code on my laptop" spellcheck="false"></label><fieldset class="keys-services">${Object.entries(scopes.scopes as Item)
        .map(
          ([scope, description]) =>
            `<label class="keys-service ${allowed(scope) ? "" : "disabled"}"><input type="checkbox" name="api-scope" value="${esc(scope)}" ${allowed(scope) ? "" : "disabled"} ${scope === "read" ? "checked" : ""}><span><b class="mono">${esc(scope)}</b><small>${esc(description)}</small></span></label>`,
        )
        .join("")}</fieldset><div class="net-form-row"><label>Expires after<select id="api-token-days">${[7, 30, 90, 180, 365]
        .map((n) => `<option value="${n}" ${n === 90 ? "selected" : ""}>${n} days</option>`)
        .join("")}</select></label><label>Vault name prefixes (optional)<input id="api-token-prefixes" placeholder="Lucea, brace-yourself-dental" spellcheck="false" aria-describedby="api-token-prefixes-help"></label></div><small class="net-help" id="api-token-prefixes-help">Optional: limit vault access to entries whose names start with these prefixes.</small><div class="dialog-footer"><button type="button" class="secondary" id="api-token-cancel">Cancel</button><button class="primary">Create token</button></div></form>`, { className: "wide" });
    d.querySelector("#api-token-cancel")!.addEventListener("click", () => d.close());
    d.querySelector("form")!.addEventListener("submit", async (e) => {
      e.preventDefault();
      const chosen = [...d.querySelectorAll<HTMLInputElement>("input[name=api-scope]:checked")].map((i) => i.value);
      if (!chosen.length) return notify("Choose at least one scope", true);
      try {
        const result = await api("/tokens", "POST", {
          name: (d.querySelector("#api-token-name") as HTMLInputElement).value.trim(),
          scopes: chosen,
          expires_days: +(d.querySelector("#api-token-days") as HTMLSelectElement).value,
          key_prefixes: (d.querySelector("#api-token-prefixes") as HTMLInputElement).value.split(",").map((s) => s.trim()).filter(Boolean),
        });
        d.close();
        showToken(result);
        tokens = await api("/tokens");
        drawTokens();
      } catch (err) {
        notify((err as Error).message, true);
      }
    });
  }

  function showToken(result: Item) {
    const set = snippets(location.origin, result.token);
    const d = dialog(
      "Token created",
      `<div class="net-confirm keys-result"><p>Copy it now. Speck stores only a hash and cannot show it again.</p><pre class="keys-value" id="api-token-value">${esc(result.token)}</pre><div class="net-pane-actions"><button class="primary" data-snippet="token">${icon("copy")}<span>Copy token</span></button><button class="secondary" data-snippet="env">Copy export line</button><button class="secondary" data-snippet="mcp">Copy Claude Code command</button><button class="secondary" data-snippet="curl">Copy test request</button></div><p class="muted">Scopes: ${result.scopes.map((s: string) => esc(s)).join(", ")} · expires ${esc(relative(result.expires))}</p><div class="dialog-footer"><button class="secondary" id="api-token-done">Done</button></div></div>`, { className: "wide" });
    const values: Item = { token: result.token, ...set };
    d.querySelectorAll<HTMLButtonElement>("[data-snippet]").forEach((b) => b.addEventListener("click", () => copy(values[b.dataset.snippet!], "Copied")));
    d.querySelector("#api-token-done")!.addEventListener("click", () => d.close());
    d.addEventListener("close", () => d.querySelector("#api-token-value")?.remove());
  }

  function drawEndpoints() {
    const el = document.getElementById("api-endpoints");
    if (!el) return;
    if (!schema) {
      el.innerHTML = '<div class="empty"><h2>Schema unavailable</h2></div>';
      return;
    }
    const groups = endpointGroups(schema, endpointQuery);
    el.innerHTML = groups.length
      ? groups
          .map(
            ([group, items]) =>
              `<details class="api-group" ${endpointQuery || ["keys", "dns", "unifi", "network", "search"].includes(group) ? "open" : ""}><summary><b>/api/${esc(group)}</b> <small>${items.length}</small></summary><div class="api-endpoint-list">${items
                .map(
                  (op, i) =>
                    `<div class="api-endpoint"><span class="api-method api-${op.method.toLowerCase()}">${esc(op.method)}</span><span class="mono api-path">${esc(op.path)}</span><span class="api-summary">${esc(op.summary)}</span>${
                      op.method === "GET" && !op.path.includes("{") ? `<button class="secondary" data-try="${esc(group)}:${i}">Try</button>` : ""
                    }</div>`,
                )
                .join("")}</div></details>`,
          )
          .join("")
      : '<div class="empty"><h2>No matching endpoints</h2></div>';
    el.querySelectorAll<HTMLButtonElement>("[data-try]").forEach((b) =>
      b.addEventListener("click", async () => {
        const [group, index] = b.dataset.try!.split(":");
        const op = groups.find(([g]) => g === group)![1][+index];
        b.disabled = true;
        try {
          const response = await fetch(op.path, { headers: { Accept: "application/json" } });
          const text = await response.text();
          let body = text;
          try {
            body = JSON.stringify(JSON.parse(text), null, 2);
          } catch {
            /* plain text */
          }
          const d = dialog(
            `${op.method} ${op.path}`,
            `<div class="net-confirm keys-result"><p>${chip("HTTP " + response.status, response.ok ? "good" : "bad")} ${esc(op.summary)}</p><pre class="keys-value api-response">${esc(body.length > 60000 ? body.slice(0, 60000) + "\n… truncated" : body)}</pre></div>`, { className: "wide" });
          void d;
        } finally {
          b.disabled = false;
        }
      }),
    );
  }

  return { render };
}
