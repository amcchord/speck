import { icon } from "./icons";

type Item = Record<string, any>;

/** Guided template VM creation: choose, review, create, then follow the VM until it has a LAN IP. */
export async function launchVm(ui: Item) {
  const { api, esc, notify } = ui;
  const dialog: (title: string, html: string, options?: Item) => HTMLDialogElement = ui.dialog;
  const loading = dialog("New VM", `<div class="net-confirm">${ui.loadingState ? ui.loadingState("Checking cluster capacity…") : "Loading…"}</div>`, { className: "wide" });
  let options: Item, keys: Item[];
  try {
    [options, keys] = await Promise.all([api("/vms/options"), api("/ssh/keys").catch(() => [])]);
  } catch (err) {
    loading.close();
    notify((err as Error).message, true);
    return;
  }
  loading.close();
  const osOptions = (options.os_options || []) as Item[];
  const nodes = (options.nodes || []) as Item[];
  const presets = (options.presets || []) as Item[];
  const d = dialog(
    "New VM",
    `<form class="net-form keys-form vm-form"><div class="net-form-row"><label>Name<input id="vm-name" required maxlength="63" pattern="[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?" spellcheck="false" placeholder="shop-web"></label><label>Project (optional)<input id="vm-project" maxlength="100" spellcheck="false" placeholder="Repository name"></label></div><fieldset class="keys-services vm-os"><legend>Operating system</legend>${osOptions
      .map(
        (o, i) =>
          `<label class="keys-service ${o.ready ? "" : "disabled"}"><input type="radio" name="vm-os" value="${esc(o.id)}" ${o.ready ? "" : "disabled"} ${i === 0 && o.ready ? "checked" : ""}><span><b>${esc(o.label || o.id)}</b><small>${esc(o.ready ? `Template ${o.template_vmid} on ${o.template_node} · signs in as ${o.user}` : "Template not ready")}</small></span></label>`,
      )
      .join("")}</fieldset><fieldset class="vm-sizes"><legend>Size</legend>${presets
      .map(
        (p, i) =>
          `<label class="vm-size"><input type="radio" name="vm-size" value="${esc(p.id)}" ${i === 1 ? "checked" : ""}><span><b>${esc(p.id[0].toUpperCase() + p.id.slice(1))}</b><small>${p.cores} vCPU · ${p.memory_mb / 1024} GB · ${p.disk_gb} GB</small></span></label>`,
      )
      .join("")}</fieldset><label>Node<select id="vm-node"><option value="auto">Automatic (recommended: ${esc(options.recommended_node || "best fit")})</option>${nodes
      .map(
        (n) =>
          `<option value="${esc(n.name)}" ${n.online ? "" : "disabled"}>${esc(n.name)} · ${Math.round((n.memory_available_mb || 0) / 1024)} GB RAM free · ${n.storage_avail_gb ?? "?"} GB disk free</option>`,
      )
      .join("")}</select></label><fieldset class="vm-keys" id="vm-keys"><legend>SSH keys for root (Debian)</legend>${
      keys.length
        ? keys.map((k) => `<label class="check"><input type="checkbox" name="vm-key" value="${esc(k.name)}"><span><span class="mono">${esc(k.name)}</span> <small>${esc(k.purpose || k.comment || "")}</small></span></label>`).join("")
        : '<p class="muted">No SSH keys in Speck yet. Add one under Keys → SSH keys, or sign in with the generated password.</p>'
    }</fieldset><label class="check"><input type="checkbox" id="vm-save" checked> Save the generated administrator password to the vault</label><div class="dialog-footer"><button type="button" class="secondary" id="vm-cancel">Cancel</button><button class="primary">Review</button></div></form>`,
    { className: "wide" },
  );
  const keyBox = d.querySelector<HTMLElement>("#vm-keys")!;
  const syncOs = () => {
    const windows = (d.querySelector("input[name=vm-os]:checked") as HTMLInputElement | null)?.value === "win11";
    keyBox.hidden = windows;
    if (windows) {
      const large = d.querySelector<HTMLInputElement>("input[name=vm-size][value=xlarge]") || d.querySelector<HTMLInputElement>("input[name=vm-size][value=large]");
      const chosen = (d.querySelector("input[name=vm-size]:checked") as HTMLInputElement).value;
      if (["small", "medium"].includes(chosen) && large) large.checked = true;
    }
  };
  d.querySelectorAll("input[name=vm-os]").forEach((el) => el.addEventListener("change", syncOs));
  syncOs();
  d.querySelector("#vm-cancel")!.addEventListener("click", () => d.close());
  d.querySelector("form")!.addEventListener("submit", (e) => {
    e.preventDefault();
    const request = {
      name: (d.querySelector("#vm-name") as HTMLInputElement).value.trim(),
      project: (d.querySelector("#vm-project") as HTMLInputElement).value.trim(),
      os: (d.querySelector("input[name=vm-os]:checked") as HTMLInputElement | null)?.value,
      preset: (d.querySelector("input[name=vm-size]:checked") as HTMLInputElement).value,
      node: (d.querySelector("#vm-node") as HTMLSelectElement).value,
      ssh_keys: keyBox.hidden ? [] : [...d.querySelectorAll<HTMLInputElement>("input[name=vm-key]:checked")].map((i) => i.value),
      save_password: (d.querySelector("#vm-save") as HTMLInputElement).checked,
    };
    if (!request.os) return notify("No template is ready", true);
    d.close();
    review(request);
  });

  function review(request: Item) {
    const preset = presets.find((p) => p.id === request.preset) || {};
    const r = dialog(
      "Create " + request.name,
      `<div class="net-confirm"><dl class="keys-hints vm-review"><dt>Template</dt><dd>${esc(osOptions.find((o) => o.id === request.os)?.label || request.os)}</dd><dt>Size</dt><dd>${preset.cores} vCPU · ${preset.memory_mb / 1024} GB memory · ${preset.disk_gb} GB disk</dd><dt>Node</dt><dd>${esc(request.node === "auto" ? "Automatic (" + (options.recommended_node || "best fit") + ")" : request.node)}</dd><dt>SSH keys</dt><dd>${esc(request.ssh_keys.join(", ") || "None")}</dd><dt>Password</dt><dd>${request.save_password ? "Generated and saved as " + esc(request.name) + "-admin" : "Generated and shown once"}</dd></dl><p class="muted">Cloning, placement and first boot take one to five minutes. The VM starts on the private LAN; map a public IP afterwards to reach it from the Internet.</p><div class="dialog-footer"><button class="secondary" id="vm-back">Back</button><button class="primary" id="vm-create">Create VM</button></div></div>`,
      { className: "wide" },
    );
    r.querySelector("#vm-back")!.addEventListener("click", () => r.close());
    r.querySelector("#vm-create")!.addEventListener("click", async () => {
      r.close();
      await create(request);
    });
  }

  async function create(request: Item) {
    const p = dialog(
      "Creating " + request.name,
      `<div class="net-confirm" id="vm-progress">${ui.loadingState ? ui.loadingState("Cloning the template and starting the VM…") : "Creating…"}</div>`,
      { className: "wide" },
    );
    let result: Item;
    try {
      result = await api("/vms", "POST", request);
    } catch (err) {
      p.querySelector("#vm-progress")!.innerHTML = `<div class="empty" role="alert"><h2>VM creation did not complete</h2><p>${esc((err as Error).message)}</p><p>Check Infrastructure → Activity before trying again.</p></div>`;
      return;
    }
    const body = p.querySelector<HTMLElement>("#vm-progress")!;
    let stopped = false;
    p.addEventListener("close", () => (stopped = true));
    const draw = (status: Item | null) => {
      const lan = status?.lan?.[0]?.ip;
      body.innerHTML = `<dl class="keys-hints vm-review"><dt>VM</dt><dd>${esc(result.name)} · VMID ${esc(result.vmid)} on ${esc(result.node)}</dd><dt>Sign in</dt><dd>${esc(result.user)}${result.password_entry ? ` · password in <a class="text-link" href="#keys">vault entry ${esc(result.password_entry)}</a>` : ""}</dd><dt>State</dt><dd>${esc(status?.state || result.status)}</dd><dt>LAN IP</dt><dd>${lan ? `<span class="mono">${esc(lan)}</span>` : '<span class="muted">Waiting for DHCP…</span>'}</dd></dl>${
        result.password ? `<p>Password (shown once): <span class="mono">${esc(result.password)}</span></p>` : ""
      }<div class="dialog-footer">${lan && ui.exposeHost ? `<button class="primary" id="vm-expose">${icon("globe")}<span>Map a public IP</span></button>` : ""}<button class="secondary" id="vm-done">Done</button></div>`;
      body.querySelector("#vm-done")!.addEventListener("click", () => p.close());
      body.querySelector("#vm-expose")?.addEventListener("click", () => {
        p.close();
        ui.exposeHost(lan, result.name);
      });
    };
    draw(null);
    const deadline = Date.now() + 8 * 60 * 1000;
    while (!stopped && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10000));
      if (stopped) break;
      const status = await api("/vms/" + encodeURIComponent(result.name), "GET", undefined, undefined, false).catch(() => null);
      if (stopped) break;
      draw(status);
      if (status?.ready) break;
    }
  }
}
