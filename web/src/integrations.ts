type Item = Record<string, any>;

export async function integrationSettings(ui: Item) {
  const { api, esc, date, on, value, notify, dialog } = ui;
  const data = await api("/integrations/tokens");
  const root = document.querySelector(".settings-grid");
  if (!root) return;
  root.insertAdjacentHTML(
    "beforeend",
    `<article class="panel"><span class="eyebrow">READ-ONLY INTEGRATIONS</span><h2>Slide Chat</h2><p>Connect a Speck site to a client in <a href="https://chat.slide.recipes" target="_blank" rel="noopener noreferrer">Slide Chat</a>. Tokens can read inventory, health, services, existing patch reports and open alerts for one exact site.</p><p>Assign machines to a site from their Manage panel first. Moving a machine out of that site immediately removes integration access.</p><button id="integration-create" class="secondary" ${data.sites.length ? "" : "disabled"}>Create integration token</button>${data.sites.length ? "" : "<p>No named sites yet. Assign a site to a machine to get started.</p>"}<div id="integration-token-list"></div></article>`,
  );
  const list = document.getElementById("integration-token-list")!;
  const renderList = (tokens: Item[]) => {
    list.innerHTML = tokens.length
      ? tokens
          .map(
            (t, i) =>
              `<div class="section-head"><div><strong>${esc(t.name)}</strong><br><small>${esc(t.site)} · ${t.revoked ? "Revoked" : t.expires * 1000 < Date.now() ? "Expired" : "Expires " + date(t.expires)}<br>Last used: ${date(t.last_used)}</small></div>${!t.revoked && t.expires * 1000 > Date.now() ? `<button class="secondary" id="integration-revoke-${i}">Revoke</button>` : ""}</div>`,
          )
          .join("")
      : "<p>No integration tokens.</p>";
    tokens.forEach((t, i) =>
      on("integration-revoke-" + i, async () => {
        await api("/integrations/tokens/" + t.id, "DELETE");
        notify("Integration token revoked");
        renderList((await api("/integrations/tokens")).tokens);
      }),
    );
  };
  renderList(data.tokens);
  on("integration-create", () => {
    const d = dialog(
      "Connect Slide Chat",
      `<p>Choose the Speck site that belongs to one Slide client. This token grants read access only and cannot run commands, access remote sessions or make changes.</p><label>Name<input id="integration-name" maxlength="80" value="Slide Chat"></label><label>Speck site<select id="integration-site">${data.sites.map((s: string) => `<option value="${esc(s)}">${esc(s)}</option>`).join("")}</select></label><label>Expires after<select id="integration-expiry"><option value="30">30 days</option><option value="90">90 days</option><option value="365">1 year</option></select></label><div class="dialog-footer"><button id="integration-save" class="primary">Create token</button></div>`,
    );
    on("integration-save", async () => {
      const b = document.getElementById(
        "integration-save",
      ) as HTMLButtonElement;
      b.disabled = true;
      try {
        const t = await api("/integrations/tokens", "POST", {
          name: value("integration-name"),
          site: value("integration-site"),
          expires_days: Number(value("integration-expiry")),
        });
        d.close();
        const receipt = dialog(
          "Copy your integration token",
          `<p>This is the only time Speck displays this token. In Slide Chat, open Connections, choose Speck RMM, and map the matching Slide client.</p><label>Speck site<input value="${esc(t.site)}" readonly></label><label>Read-only token<input id="integration-issued" type="password" value="${esc(t.token)}" readonly autocomplete="off"></label><p>Expires ${date(t.expires)}. Store it only in Connections, never in a chat message.</p><div class="dialog-footer"><button id="integration-copy" class="primary">Copy token</button><button id="integration-done" class="secondary">Done</button></div>`,
        );
        receipt.addEventListener("close", () => receipt.remove(), {
          once: true,
        });
        on("integration-copy", async () => {
          await navigator.clipboard.writeText(t.token);
          notify("Integration token copied");
        });
        on("integration-done", () => receipt.close());
        renderList((await api("/integrations/tokens")).tokens);
      } finally {
        b.disabled = false;
      }
    });
  });
}
