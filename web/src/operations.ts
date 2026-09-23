import { loadingState } from "./loading";
type Item = Record<string, any>;
export function createOperations(ui: Item) {
  const { api, esc, badge, date, icon, on, value, notify, content } = ui;
  const dialog: (title: string, body: string) => HTMLDialogElement = ui.dialog;
  let templates: Item[] = [];
  const button = (id: string, label: string, primary = false) =>
    `<button id="${id}" class="${primary ? "primary" : "secondary"}">${label}</button>`;
  async function refreshTemplates() {
    templates = await api("/templates");
    return templates;
  }
  async function reviewBatch(body: Item) {
    const draft = await api("/batches/preview", "POST", body);
    const modal = dialog(
      "Review operation",
      `<p><b>${esc(draft.name)}</b> on ${draft.targets.length} machine${draft.targets.length === 1 ? "" : "s"}.</p><div class="target-chips">${draft.targets.map((t: Item) => `<span>${esc(t.label)}</span>`).join("")}</div>${draft.kind === "patch.install" ? "<p>Selected updates only. Machines will not reboot automatically. Windows update installation accepts the selected updates’ license terms.</p>" : ""}<details><summary>Review scripts and time limits</summary>${draft.targets.map((t: Item) => `<h3>${esc(t.label)} <small>${t.timeout / 60} minute limit</small></h3><pre>${esc(t.script)}</pre>`).join("")}</details><div class="dialog-footer">${button("confirm-operation", "Run on " + draft.targets.length + " machines", true)}</div>`,
    );
    modal.classList.add("operation-review");
    on("confirm-operation", async () => {
      const batch = await api("/batches", "POST", { ...body, confirmed: true });
      modal.close();
      notify("Operation queued. Each machine reports its own result.");
      showBatch(batch.id);
    });
  }
  async function scan(ids: string[]) {
    if (!ids.length) throw new Error("Select at least one machine");
    const result = await api("/batches", "POST", {
      request_id: crypto.randomUUID(),
      name: "Scan for updates",
      kind: "patch.scan",
      device_ids: ids,
      confirmed: true,
    });
    showBatch(result.id);
  }
  function jobsHtml(batch: Item) {
    return `<div class="run-heading"><div><h3>${esc(batch.name)}</h3><small>${date(batch.created)}</small></div><span>${batch.jobs.filter((j: Item) => j.status === "complete").length}/${batch.jobs.length} complete</span></div><div class="scroll"><table><thead><tr><th>Machine</th><th>Status</th><th>Result</th></tr></thead><tbody>${batch.jobs.map((j: Item) => `<tr><td>${esc(j.label)}</td><td>${badge(j.status)}</td><td>${j.result ? `<details><summary>${j.result.exit_code === 0 ? "Completed" : esc(j.result.error || "View output")}</summary><pre>${esc(j.result.stdout || "")}${j.result.stderr ? "\n" + esc(j.result.stderr) : ""}${j.result.error ? "\n" + esc(j.result.error) : ""}</pre></details>` : "Waiting for agent"}</td></tr>`).join("")}</tbody></table></div>`;
  }
  async function showBatch(id: string) {
    const modal = dialog(
      "Operation progress",
      `<div id="batch-progress">${loadingState("Loading operation…")}</div><div class="dialog-footer">` +
        button("cancel-queued", "Cancel queued jobs") +
        "</div>",
    );
    modal.classList.add("operation-review");
    on("cancel-queued", async () => {
      const r = await api("/batches/" + id + "/cancel", "POST");
      notify(`${r.cancelled} queued jobs cancelled. Running jobs continue.`);
    });
    const el = modal.querySelector("#batch-progress")!;
    while (el.isConnected) {
      try {
        const batches = await api("/batches");
        const b = batches.find((b: Item) => b.id === id);
        if (!el.isConnected) return;
        el.innerHTML = b
          ? jobsHtml(b)
          : "Operation no longer in recent history";
        if (
          b &&
          !b.jobs.some((j: Item) =>
            ["queued", "leased", "running"].includes(j.status),
          )
        ) {
          (
            modal.querySelector("#cancel-queued") as HTMLButtonElement
          ).disabled = true;
          return;
        }
      } catch (e) {
        el.textContent = (e as Error).message;
        return;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  async function renderPatches() {
    ui.loading("Loading updates…");
    const [devices, reports, batches] = await Promise.all([
      ui.devices(),
      api("/patches"),
      api("/batches"),
    ]);
    const total = reports.reduce(
      (sum: number, r: Item) => sum + (r.report.total || 0),
      0,
    );
    content(
      `<div class="page-intro"><div><p>Scan machines, review available updates and install what you choose.</p></div>${button("patch-scan", "Scan selected", true)}</div><div class="metric-strip"><div><b>${total}</b><span>Available updates</span></div><div><b>${reports.filter((r: Item) => r.report.reboot_required).length}</b><span>Reboot needed</span></div><div><b>${devices.filter((d: Item) => !reports.some((r: Item) => r.device_id === d.id)).length}</b><span>Not scanned</span></div></div><div class="panel operations-panel"><div class="section-head"><h2>Patch inventory</h2><label class="check"><input id="patch-select-all" type="checkbox"> Select online machines</label></div><div class="scroll"><table><thead><tr><th></th><th>Machine</th><th>Updates</th><th>Last scan</th><th>Reboot</th><th></th></tr></thead><tbody>${devices
        .map((d: Item) => {
          const r = reports.find((r: Item) => r.device_id === d.id);
          return `<tr><td><input type="checkbox" data-patch-target="${d.id}" aria-label="Select ${esc(d.label)}" ${d.approved && d.online && d.telemetry?.capabilities?.managed_operations ? "" : "disabled"}></td><td><b>${esc(d.label)}</b><small>${esc(d.telemetry?.host?.platform || d.platform)}</small></td><td>${r ? badge(String(r.report.total) + " available", r.report.total === 0) : '<span class="muted">Not scanned</span>'}</td><td>${r ? date(r.scanned) : "—"}</td><td>${r?.report.reboot_required ? badge("Required") : "—"}</td><td><button class="secondary" data-patch-detail="${d.id}">Review</button></td></tr>`;
        })
        .join(
          "",
        )}</tbody></table></div><small>Windows Update, apt and dnf. No automatic reboot. Updated Speck agents are required.</small></div><div class="section-head"><h2>Recent operations</h2>${button("patch-refresh", "Refresh")}</div><div class="operation-history">${
        batches
          .filter((b: Item) => b.kind.startsWith("patch"))
          .slice(0, 8)
          .map(
            (b: Item) =>
              `<button class="operation-card" data-batch="${b.id}"><b>${esc(b.name)}</b><span>${b.jobs.filter((j: Item) => j.status === "complete").length}/${b.jobs.length} complete</span><small>${date(b.created)}</small></button>`,
          )
          .join("") ||
        '<div class="empty">Your update operations will appear here.</div>'
      }</div>`,
    );
    document
      .getElementById("patch-select-all")!
      .addEventListener("change", (e) =>
        document
          .querySelectorAll<HTMLInputElement>(
            "[data-patch-target]:not(:disabled)",
          )
          .forEach((x) => (x.checked = (e.target as HTMLInputElement).checked)),
      );
    on("patch-scan", () =>
      scan(
        [
          ...document.querySelectorAll<HTMLInputElement>(
            "[data-patch-target]:checked",
          ),
        ].map((e) => e.dataset.patchTarget!),
      ),
    );
    on("patch-refresh", renderPatches);
    document
      .querySelectorAll<HTMLButtonElement>("[data-patch-detail]")
      .forEach(
        (el) =>
          (el.onclick = () => ui.openDevice(el.dataset.patchDetail, "patches")),
      );
    bindBatches();
  }
  function bindBatches() {
    document
      .querySelectorAll<HTMLButtonElement>("[data-batch]")
      .forEach((el) => (el.onclick = () => void showBatch(el.dataset.batch!)));
  }
  async function devicePatches(d: Item, el: HTMLElement) {
    el.innerHTML = loadingState("Loading updates…");
    const reports = await api("/patches");
    if (!el.isConnected) return;
    const r = reports.find((r: Item) => r.device_id === d.id);
    el.innerHTML = `<div class="section-head"><h3>Available updates</h3>${button("device-scan", "Scan now")}</div>${r ? `<p>Scanned ${date(r.scanned)} · ${esc(r.report.manager)}${r.report.reboot_required ? " · Reboot required" : ""}</p><div class="scroll"><table><thead><tr><th><input id="updates-all" type="checkbox" aria-label="Select all displayed updates"></th><th>Update</th><th>Type</th></tr></thead><tbody>${r.report.updates.map((u: Item) => `<tr><td><input type="checkbox" data-update="${esc(u.id)}" aria-label="Select ${esc(u.title)}"></td><td><b>${esc(u.title)}</b><small>${esc(u.version || "")} ${esc((u.kb || []).join(", "))}</small></td><td>${esc(u.severity || "Update")}</td></tr>`).join("")}</tbody></table></div>${r.report.truncated ? "<p>Showing the first 150 updates. Install these, then scan again for the rest.</p>" : ""}<div class="toolbar">${button("install-updates", "Install selected", true)}<small>No automatic reboot.</small></div>` : '<div class="empty"><h3>Start with a scan</h3><p>Find available updates without installing them.</p></div>'}`;
    on("device-scan", () => scan([d.id]));
    document
      .getElementById("updates-all")
      ?.addEventListener("change", (e) =>
        el
          .querySelectorAll<HTMLInputElement>("[data-update]")
          .forEach((x) => (x.checked = (e.target as HTMLInputElement).checked)),
      );
    on("install-updates", () => {
      const ids = [
        ...el.querySelectorAll<HTMLInputElement>("[data-update]:checked"),
      ].map((x) => x.dataset.update!);
      if (!ids.length) throw new Error("Select updates to install");
      return reviewBatch({
        request_id: crypto.randomUUID(),
        kind: "patch.install",
        name: "Install selected updates",
        device_ids: [d.id],
        updates: { [d.id]: ids },
      });
    });
  }
  async function renderSoftware() {
    ui.loading("Loading software & scripts…");
    const [library, batches] = await Promise.all([
      refreshTemplates(),
      api("/batches"),
    ]);
    content(
      `<div class="page-intro"><div><h2>Template library</h2><p>Reusable installers and scripts for Windows and Linux.</p></div>${button("new-template", icon("plus") + " Create template", true)}</div><div class="template-grid">${library.map((t) => `<article class="template-card"><div class="template-card-top"><span class="template-kind">${t.category === "software" ? "Software" : "Script"}</span>${badge(t.platform)}${t.builtin ? "<small>STARTER</small>" : ""}</div><h2>${esc(t.name)}</h2><p>${esc(t.description || "Reusable fleet script")}</p><div class="template-meta"><span>${t.parameters.length} inputs</span><span>${Math.ceil(t.timeout / 60)} min limit</span><span>v${t.revision}</span></div><div class="toolbar"><button class="primary" data-deploy="${t.id}">Deploy</button><button class="secondary" data-edit-template="${t.id}">${t.builtin ? "Customize" : "Edit"}</button></div></article>`).join("")}</div><div class="section-head"><h2>Recent deployments</h2>${button("software-refresh", "Refresh")}</div><div class="operation-history">${
        batches
          .filter((b: Item) => b.kind === "template")
          .slice(0, 10)
          .map(
            (b: Item) =>
              `<button class="operation-card" data-batch="${b.id}"><b>${esc(b.name)}</b><span>${b.jobs.filter((j: Item) => j.status === "complete").length}/${b.jobs.length} complete</span><small>${date(b.created)}</small></button>`,
          )
          .join("") ||
        '<div class="empty">Per-machine deployment results will appear here.</div>'
      }</div>`,
    );
    on("new-template", () => templateEditor());
    on("software-refresh", renderSoftware);
    bindBatches();
    document
      .querySelectorAll<HTMLButtonElement>("[data-edit-template]")
      .forEach(
        (el) =>
          (el.onclick = () =>
            templateEditor(
              library.find((t) => t.id === el.dataset.editTemplate),
            )),
      );
    document
      .querySelectorAll<HTMLButtonElement>("[data-deploy]")
      .forEach(
        (el) => (el.onclick = () => void deployDialog([], el.dataset.deploy)),
      );
  }
  function templateEditor(source: Item = {}) {
    const t: Item = {
      name: "",
      description: "",
      platform: "windows",
      category: "script",
      script: "",
      parameters: [],
      timeout: 300,
      ...source,
    };
    const modal = dialog(
      t.id && !t.builtin ? "Edit template" : "Create template",
      `<div class="form-grid"><label>Name<input id="template-name" value="${esc(t.builtin ? t.name + " · custom" : t.name)}" placeholder="Install the office app"></label><label>Operating system<select id="template-platform"><option value="windows">Windows</option><option value="linux">Linux</option></select></label><label>Type<select id="template-category"><option value="script">Script</option><option value="software">Software deployment</option></select></label><label>Time limit (minutes)<input id="template-timeout" type="number" min="1" max="120" value="${Math.ceil(t.timeout / 60)}"></label></div><label>Description<input id="template-description" value="${esc(t.description)}" placeholder="What this template does"></label><div class="section-head"><h3>Script</h3>${button("template-ai", "Draft with AI")}</div><textarea id="template-script" aria-label="Template script" rows="12" spellcheck="false" placeholder="PowerShell for Windows; shell script for Linux">${esc(t.script)}</textarea><div class="section-head"><h3>Inputs</h3>${button("add-parameter", "Add input")}</div><small>Scripts receive inputs as SPECK_PARAM_NAME environment variables.</small><div id="template-parameters"></div><div class="dialog-footer">${button("save-template", "Save template", true)}</div>`,
    );
    modal.classList.add("template-editor");
    (modal.querySelector("#template-platform") as HTMLSelectElement).value =
      t.platform;
    (modal.querySelector("#template-category") as HTMLSelectElement).value =
      t.category;
    const inputs = modal.querySelector("#template-parameters")!;
    const addParam = (p: Item = {}) => {
      const row = document.createElement("div");
      row.className = "parameter-row";
      row.innerHTML = `<label>Variable<input data-param="name" value="${esc(p.name || "")}" placeholder="PACKAGE"></label><label>Label<input data-param="label" value="${esc(p.label || "")}" placeholder="Package name"></label><label>Default<input data-param="default" value="${esc(p.default || "")}"></label><button class="close" aria-label="Remove input">×</button>`;
      row.querySelector("button")!.onclick = () => row.remove();
      inputs.append(row);
    };
    t.parameters.forEach(addParam);
    on("add-parameter", () => addParam());
    on("template-ai", () =>
      assistDialog(
        { platform: value("template-platform") },
        value("template-script"),
        (script: string) => {
          (
            modal.querySelector("#template-script") as HTMLTextAreaElement
          ).value = script;
        },
      ),
    );
    on("save-template", async () => {
      const parameters = [...inputs.children].map((row) => {
        const get = (key: string) =>
          (row.querySelector(`[data-param="${key}"]`) as HTMLInputElement)
            .value;
        return {
          name: get("name").toUpperCase(),
          label: get("label"),
          default: get("default"),
          required: true,
        };
      });
      const body = {
        name: value("template-name"),
        description: value("template-description"),
        platform: value("template-platform"),
        category: value("template-category"),
        script: value("template-script"),
        timeout: Number(value("template-timeout")) * 60,
        parameters,
      };
      await api(
        t.id && !t.builtin ? "/templates/" + t.id : "/templates",
        t.id && !t.builtin ? "PUT" : "POST",
        body,
      );
      modal.close();
      notify("Template saved");
      if (location.hash === "#software") await renderSoftware();
    });
  }
  async function deployDialog(preselected: string[] = [], templateId?: string) {
    const [library, devices] = await Promise.all([
      refreshTemplates(),
      ui.devices(),
    ]);
    const modal = dialog(
      "Deploy a template",
      `<label>Template<select id="deploy-template">${library.map((t) => `<option value="${t.id}">${esc(t.name)} · ${t.platform}</option>`).join("")}</select></label><div id="deploy-body"></div>`,
    );
    modal.classList.add("template-editor");
    if (templateId)
      (modal.querySelector("#deploy-template") as HTMLSelectElement).value =
        templateId;
    function draw() {
      const t = library.find((t) => t.id === value("deploy-template"))!;
      const targets = devices.filter(
        (d: Item) => d.platform === t.platform && d.approved,
      );
      modal.querySelector("#deploy-body")!.innerHTML =
        `<p>${esc(t.description)}</p><div class="form-grid">${t.parameters.map((p: Item) => `<label>${esc(p.label)}<input data-value="${esc(p.name)}" value="${esc(p.default)}"></label>`).join("")}</div><div class="section-head"><h3>Target machines</h3><label class="check"><input id="deploy-all" type="checkbox"> All eligible</label></div><div class="target-list">${targets.map((d: Item) => `<label class="check"><input data-target="${d.id}" type="checkbox" ${preselected.includes(d.id) ? "checked" : ""} ${d.online && d.telemetry?.capabilities?.managed_operations ? "" : "disabled"}><span><b>${esc(d.label)}</b><small>${d.online ? (d.telemetry?.capabilities?.managed_operations ? "Online" : "Agent update required") : "Offline"}</small></span></label>`).join("") || "<p>No machines match this operating system.</p>"}</div><details><summary>Template script</summary><pre>${esc(t.script)}</pre></details><div class="dialog-footer">${button("review-deploy", "Review deployment", true)}</div>`;
      modal
        .querySelector("#deploy-all")!
        .addEventListener("change", (e) =>
          modal
            .querySelectorAll<HTMLInputElement>("[data-target]:not(:disabled)")
            .forEach(
              (el) => (el.checked = (e.target as HTMLInputElement).checked),
            ),
        );
      on("review-deploy", async () => {
        const ids = [
          ...modal.querySelectorAll<HTMLInputElement>(
            "[data-target]:checked:not(:disabled)",
          ),
        ].map((el) => el.dataset.target!);
        if (!ids.length)
          throw new Error("Choose at least one online, compatible machine");
        const parameters = Object.fromEntries(
          [...modal.querySelectorAll<HTMLInputElement>("[data-value]")].map(
            (el) => [el.dataset.value!, el.value],
          ),
        );
        await reviewBatch({
          request_id: crypto.randomUUID(),
          kind: "template",
          name: t.name,
          template_id: t.id,
          template_revision: t.revision,
          device_ids: ids,
          parameters,
        });
      });
    }
    draw();
    modal.querySelector("#deploy-template")!.addEventListener("change", draw);
  }
  async function previewPanel(d: Item, el: HTMLElement) {
    const section = document.createElement("section");
    section.className = "preview-panel";
    section.innerHTML = `<div class="section-head"><h3>Screen preview</h3><label class="switch-label"><input id="preview-policy" type="checkbox" role="switch" aria-describedby="preview-help" ${d.preview?.enabled ? "checked" : ""} ${d.approved ? "" : "disabled"}> Allow previews</label></div><div class="live-screen"></div><p class="preview-status" role="status"></p><details class="preview-help"><summary>About screen previews</summary><p id="preview-help">Live frames refresh about every 10 seconds while a desktop is available. One encrypted preview is saved about every 5 minutes, including when this page is closed, and retained until replaced. Requires a signed-in, unlocked Windows or X11 desktop and its helper. Turning this off deletes the live and saved preview.</p></details>`;
    el.prepend(section);
    const target = section.querySelector<HTMLElement>(".live-screen")!;
    const status = section.querySelector<HTMLElement>(".preview-status")!;
    const policy = section.querySelector<HTMLInputElement>("#preview-policy")!;
    let enabled = !!d.preview?.enabled;
    let generation = 0, busy = false;
    let controller: AbortController | undefined;
    const empty = (text: string) => {
      target.innerHTML = `<div class="preview-disabled">${icon("monitor")}<span>${esc(text)}</span></div>`;
    };
    const reason = (state: string) => ({
      offline: "Machine is offline. Capture resumes when it reconnects.",
      no_desktop: "No active desktop. Sign in or reconnect and unlock the machine to resume previews.",
      helper_unavailable: "Desktop helper is not reporting. Sign in to a Windows or X11 desktop; reinstall the agent if this persists.",
      unsupported: "This desktop does not support previews. Linux previews require X11.",
      capture_failed: "Desktop capture failed. Speck will retry automatically.",
      capture_timeout: "Desktop capture timed out. Speck will retry automatically.",
    }[state] || "No desktop frame is available yet. Check that the desktop is signed in and unlocked.");
    const draw = async () => {
      if (!enabled) {
        empty("Screen preview is off for this machine");
        status.textContent = "";
        return;
      }
      if (busy) return;
      busy = true;
      const request = generation;
      const requestController = new AbortController();
      controller = requestController;
      let timer: ReturnType<typeof setTimeout> | undefined;
      if (!target.innerHTML) target.innerHTML = loadingState("Loading screen preview…");
      try {
        const info: Item = await Promise.race([
          api("/devices/" + d.id + "/preview-status", "GET", undefined, requestController.signal),
          new Promise((_, reject) => { timer = setTimeout(() => { requestController.abort(); reject(new Error("Preview timed out")); }, 8000); }),
        ]);
        if (!target.isConnected || !enabled || request !== generation) return;
        if (info.enabled === false) {
          enabled = false;
          policy.checked = false;
          empty("Screen preview is off for this machine");
          status.textContent = "";
          return;
        }
        if (info.available) {
          const label = info.source === "live" ? "Live" : "Last saved";
          const url = `/api/devices/${d.id}/preview?t=${info.captured_at}`;
          status.textContent = info.source === "live" ? "Live preview · Saved automatically every 5 minutes" : reason(info.state);
          if (target.dataset.capture !== String(info.captured_at) || !target.querySelector(":scope > img")) {
            target.dataset.capture = String(info.captured_at);
            target.innerHTML = `<img src="${url}" alt="Screen preview of ${esc(d.label)}"><span class="capture-time">${label} · ${date(info.captured_at)}</span>`;
            target.querySelector<HTMLImageElement>(":scope > img")!.onerror = () => {
              if (!enabled || request !== generation) return;
              empty("Preview unavailable. Retrying automatically…");
            };
          } else {
            target.querySelector(".capture-time")!.textContent = `${label} · ${date(info.captured_at)}`;
          }
        } else {
          empty("No preview captured yet");
          status.textContent = reason(info.state);
        }
      } catch {
        if (!target.isConnected || !enabled || request !== generation) return;
        if (!target.querySelector(":scope > img")) empty("Preview unavailable. Retrying automatically…");
        // A previously rendered frame is still useful, but must not claim to be live.
        const caption = target.querySelector(".capture-time");
        if (caption) caption.textContent = caption.textContent!.replace(/^Live/, "Last received");
        status.textContent = "Cannot refresh the preview right now. Retrying automatically…";
      } finally {
        clearTimeout(timer);
        if (request === generation) busy = false;
      }
    };
    on("preview-policy", async () => {
      const previous = enabled;
      enabled = policy.checked;
      generation++;
      controller?.abort();
      busy = false;
      policy.disabled = true;
      // Hide the old frame immediately, even while policy confirmation is pending.
      if (!enabled) await draw();
      try {
        await api("/devices/" + d.id + "/preview-policy", "PUT", { enabled });
        d.preview = { ...d.preview, enabled, available: false };
        await draw();
      } catch (e) {
        enabled = previous;
        policy.checked = enabled;
        await draw();
        throw e;
      } finally {
        policy.disabled = false;
      }
    }, "change");
    // Install polling before the initial fetch so failures cannot stop recovery.
    const interval = setInterval(() => {
      if (!target.isConnected) { clearInterval(interval); generation++; controller?.abort(); return; }
      void draw();
    }, 10000);
    void draw();
  }
  async function assistDialog(
    d: Item,
    script = "",
    accept?: (script: string) => void,
    alertTask?: { alert: Item; intent: "diagnose" | "fix" },
  ) {
    const cfg = alertTask ? await api("/ai/settings") : null;
    const fixing = alertTask?.intent === "fix";
    const modal = dialog(
      alertTask ? (fixing ? "AI fix · review a repair" : "AI diagnose · investigate the cause") : "Ask Speck AI",
      `<p>${d.label ? esc(d.label) + " · " : ""}${d.platform === "linux" ? "Linux shell" : "Windows PowerShell"}</p>${alertTask ? `<div class="ai-alert-context"><strong>${esc(alertTask.alert.title)}</strong><p>${esc(alertTask.alert.explanation || "Investigate the selected alert.")}</p></div>${!d.online ? '<p class="callout">This machine is offline. AI can review recorded evidence; reconnect it before running a script.</p>' : ""}${cfg?.configured ? "" : '<p class="callout">Connect OpenAI in Settings to use AI assistance.</p>'}` : ""}<label>What do you need?<textarea id="ai-prompt" rows="3" placeholder="Find out why this application cannot reach the server"></textarea></label>${d.id ? '<label class="check"><input id="ai-health" type="checkbox" checked> Include current OS, CPU, memory, disks and service status</label>' : ""}${alertTask?.alert.job ? '<label class="check"><input id="ai-job-evidence" type="checkbox"> Include original script and job output (may contain sensitive data)</label>' : ""}<small>Your request${alertTask ? ", alert and job metadata" : ""} and selected context are sent to OpenAI. ${fixing ? "Review the proposed changes and verification before running a repair." : "AI suggests diagnostic checks; review any script before running it."}</small><div class="toolbar">${button("ai-ask", alertTask ? (fixing ? "Propose a fix" : "Diagnose this alert") : "Get help", true)}</div><div id="ai-result" aria-live="polite"></div>`,
    );
    modal.classList.add("assistant-dialog");
    if (alertTask) {
      (modal.querySelector("#ai-prompt") as HTMLTextAreaElement).value = fixing
        ? "Find the root cause of this alert and propose a targeted repair with verification and rollback. If evidence is insufficient, explain what to check first."
        : "Diagnose the root cause of this alert. Explain the evidence, likely causes and any missing information. Suggest read-only checks to confirm the cause.";
      (modal.querySelector("#ai-ask") as HTMLButtonElement).disabled = !cfg?.configured;
    }
    on("ai-ask", async () => {
      modal.querySelector("#ai-result")!.innerHTML =
        '<p class="working">Working on your request…</p>';
      const result = await api("/ai/assist", "POST", {
        prompt: value("ai-prompt"),
        platform: d.platform || "windows",
        device_id: d.id || null,
        script,
        ...(alertTask ? {
          alert_id: alertTask.alert.id,
          alert_intent: alertTask.intent,
          include_job_evidence: !!(modal.querySelector("#ai-job-evidence") as HTMLInputElement)?.checked,
        } : {}),
        include_health: !!(
          document.getElementById("ai-health") as HTMLInputElement
        )?.checked,
      }).catch((error: Error) => {
        modal.querySelector("#ai-result")?.replaceChildren();
        throw error;
      });
      if (!modal.isConnected) return;
      const out = modal.querySelector("#ai-result")!;
      out.innerHTML = `<div class="ai-answer"><p>${esc(result.summary)}</p>${result.script ? `<h3>Suggested script</h3><pre>${esc(result.script)}</pre>` : ""}${result.caution ? `<p class="callout">${esc(result.caution)}</p>` : ""}<h3>Verify</h3><p>${esc(result.verification)}</p>${result.script ? `<div class="toolbar">${button("ai-use", alertTask ? "Review in terminal →" : "Use this script", true)}${button("ai-template", "Save as template")}</div>` : ""}</div>`;
      on("ai-use", async () => {
        modal.close();
        if (accept) accept(result.script);
        else if (d.id) {
          await ui.openDevice(d.id, "terminal");
          ui.setScript(result.script, alertTask ? {
            title: alertTask.alert.title,
            caution: result.caution,
            verification: result.verification,
          } : undefined);
        } else
          templateEditor({
            name: "AI draft",
            platform: d.platform || "windows",
            script: result.script,
          });
      });
      on("ai-template", () => {
        modal.close();
        templateEditor({
          name: "AI draft",
          platform: d.platform || "windows",
          script: result.script,
        });
      });
    });
  }
  async function renderAssistant() {
    ui.loading("Loading AI assistant…");
    const cfg = await api("/ai/settings");
    content(
      `<div class="assistant-home"><h2>What are we fixing?</h2><p>Draft a script, diagnose an issue, or create a reusable template.</p><div class="assistant-composer"><label>Operating system<select id="assistant-platform"><option value="windows">Windows · PowerShell</option><option value="linux">Linux · shell</option></select></label><label>Your task<textarea id="assistant-task" rows="4" placeholder="Write a script that checks disk space and reports services that failed to start"></textarea></label><div class="toolbar">${button("assistant-start", "Ask Speck", true)}<small>${cfg.configured ? "Connected · " + esc(cfg.model) : "Connect OpenAI in Settings"}</small></div></div><div class="assistant-prompts">${["Diagnose a slow workstation", "Check DNS and connectivity", "Draft a software installer"].map((s) => `<button class="secondary" data-prompt="${esc(s)}">${esc(s)}</button>`).join("")}</div><p class="muted">AI drafts are reviewed before execution. For machine context, use Ask AI in its detail panel.</p></div>`,
    );
    on("assistant-start", async () => {
      const prompt = value("assistant-task");
      await assistDialog({ platform: value("assistant-platform") });
      (document.getElementById("ai-prompt") as HTMLTextAreaElement).value =
        prompt;
    });
    document.querySelectorAll<HTMLButtonElement>("[data-prompt]").forEach(
      (el) =>
        (el.onclick = () => {
          (
            document.getElementById("assistant-task") as HTMLTextAreaElement
          ).value = el.dataset.prompt!;
        }),
    );
  }
  async function settingsPanel() {
    const el = document.createElement("section");
    el.className = "settings-grid";
    el.innerHTML = loadingState("Loading AI settings…");
    document.getElementById("content")!.append(el);
    const cfg = await api("/ai/settings");
    if (!el.isConnected) return;
    el.innerHTML = `<article class="panel"><span class="eyebrow">AI ASSISTANT</span><h2>OpenAI</h2><p>${cfg.configured ? "Connected" : "Not connected"}. Keys stay encrypted on the server.</p><label>Model<input id="ai-model" value="${esc(cfg.model)}"></label><label>API key<input id="ai-key" type="password" autocomplete="new-password" placeholder="${cfg.configured ? "Leave blank to keep the current key" : "OpenAI API key"}"></label>${button("save-ai", "Save AI settings", true)}</article><article class="panel"><span class="eyebrow">REMOTE ACCESS</span><h2>Remote workspace</h2><label>Open remote sessions with<select id="remote-client"><option value="browser">Browser workspace</option><option value="desktop">Speck Desktop, with browser fallback</option></select></label><p>Speck Desktop adds shared clipboard and native key shortcuts.</p><a class="text-link" href="#downloads">Download Speck Desktop →</a></article>`;
    document.getElementById("content")!.append(el);
    (el.querySelector("#remote-client") as HTMLSelectElement).value =
      localStorage.getItem("speck-remote-client") || "browser";
    el.querySelector("#remote-client")!.addEventListener("change", () =>
      localStorage.setItem("speck-remote-client", value("remote-client")),
    );
    on("save-ai", async () => {
      await api("/ai/settings", "PUT", {
        model: value("ai-model"),
        key: value("ai-key"),
      });
      (document.getElementById("ai-key") as HTMLInputElement).value = "";
      notify("AI settings saved");
    });
  }
  return {
    renderPatches,
    renderSoftware,
    renderAssistant,
    scan,
    deployDialog,
    templateEditor,
    assistDialog,
    devicePatches,
    previewPanel,
    settingsPanel,
    showBatch,
  };
}
