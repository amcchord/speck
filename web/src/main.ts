import Guacamole from "guacamole-common-js";
import "../../brand/tokens.css";
import "./style.css";
import "./operations.css";
import "./orbits.css";
import { createOperations } from "./operations";
import { createManagement } from "./management";
import { icon, wordmark } from "./icons";

type Item = Record<string, any>;
const app = document.querySelector<HTMLDivElement>("#app")!;
let csrf = "",
  username = "",
  role = "viewer",
  page = "fleet",
  fleet: Item[] = [],
  selected = "",
  tab = "overview",
  fleetQuery = "",
  fleetFilter = "all";
const fleetSelection = new Set<string>();
let fleetPlatform = "all",
  fleetSort = "name",
  fleetPage = 0,
  showPreviews = false;
let remoteCleanup = () => {};
let remote: any = null,
  keyboard: any = null,
  recorder: any = null,
  polling = false;
const esc = (v: any) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const bytes = (n: number) =>
  !n
    ? "0 B"
    : n >= 1073741824
      ? (n / 1073741824).toFixed(1) + " GB"
      : n >= 1048576
        ? (n / 1048576).toFixed(1) + " MB"
        : n >= 1024
          ? (n / 1024).toFixed(1) + " KB"
          : n + " B";
const date = (n: number | string) =>
  n ? new Date(typeof n === "number" ? n * 1000 : n).toLocaleString() : "—";
const pretty = (v: any) => esc(JSON.stringify(v, null, 2));
const badge = (s: string, good = false) => {
  const status = s.toLowerCase();
  const positive =
    good ||
    [
      "healthy",
      "online",
      "active",
      "running",
      "complete",
      "passed",
      "succeeded",
      "matched",
      "verified",
    ].includes(status);
  const tone = positive
    ? "good"
    : ["failed", "error", "expired"].includes(status)
      ? "bad"
      : ["review", "pending", "needs_attention", "unknown"].includes(status)
        ? ""
        : "neutral";
  return `<span class="badge ${tone}">${esc(s)}</span>`;
};

async function api(path: string, method = "GET", body?: any): Promise<any> {
  const headers: Record<string, string> = { "X-CSRF-Token": csrf };
  if (body !== undefined && !(body instanceof FormData))
    headers["Content-Type"] = "application/json";
  const r = await fetch("/api" + path, {
    method,
    headers,
    body:
      body instanceof FormData
        ? body
        : body === undefined
          ? undefined
          : JSON.stringify(body),
  });
  const value = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== "/auth/login") {
    login();
    throw new Error("Your session ended. Sign in again.");
  }
  if (!r.ok)
    throw new Error(
      typeof value.detail === "string"
        ? value.detail
        : JSON.stringify(value.detail || "Request failed"),
    );
  return value;
}
function notify(message: string, error = false) {
  const n = document.createElement("div");
  n.className = "toast" + (error ? " error" : "");
  n.textContent = message;
  n.setAttribute("role", error ? "alert" : "status");
  document.body.append(n);
  setTimeout(() => n.remove(), 7000);
}
function on(id: string, handler: (e: Event) => any, event = "click") {
  document.getElementById(id)?.addEventListener(event, async (e) => {
    e.preventDefault();
    const el = e.currentTarget as HTMLButtonElement;
    if (el.disabled) return;
    el.disabled = true;
    try {
      await handler(e);
    } catch (err) {
      notify((err as Error).message, true);
    } finally {
      el.disabled = false;
    }
  });
}
function value(id: string) {
  return (document.getElementById(id) as HTMLInputElement)?.value || "";
}
function disconnect() {
  remoteCleanup();
  remoteCleanup = () => {};
  if (recorder) recorder.sendEnd();
  recorder = null;
  remote?.disconnect();
  remote = null;
  keyboard?.reset();
  keyboard = null;
}
function login() {
  disconnect();
  csrf = "";
  username = "";
  app.innerHTML = `<main class="login"><div class="login-brand">${wordmark(true)}<span class="eyebrow">A LITTLE LIGHTWEIGHT RMM</span><div class="orbit" aria-hidden="true"><i></i><i></i><i></i><img src="/assets/brand/speck-mark-lime.svg" alt=""></div></div><form id="login" class="login-card"><h1>Sign in</h1><label>Username<input id="username" autocomplete="username" required autofocus></label><label>Password<input id="password" type="password" autocomplete="current-password" required></label><label>Authenticator or recovery code <small>if enabled</small><input id="login-code" autocomplete="one-time-code" maxlength="40"></label><button class="primary" type="submit">Sign in ${icon("arrow")}</button></form></main>`;
  on(
    "login",
    async () => {
      const r = await api("/auth/login", "POST", {
        username: value("username"),
        password: value("password"),
        code: value("login-code"),
      });
      csrf = r.csrf;
      username = r.username;
      role = r.role;
      await render();
    },
    "submit",
  );
}
function shell(title: string, subtitle: string) {
  document.body.dataset.role = role;
  app.innerHTML = `<a class="skip-link" href="#content">Skip to content</a><aside><a class="brand" href="#fleet" aria-label="Speck home">${wordmark(true)}<span class="version">0.2</span></a><nav aria-label="Main navigation">${[
    ["fleet", "fleet", "Fleet"],
    ["alerts", "activity", "Alerts"],
    ["schedules", "activity", "Schedules"],
    ["patches", "patch", "Patches"],
    ["software", "package", "Software & scripts"],
    ["assistant", "spark", "AI assistant"],
    ["recovery", "recovery", "Recovery lab"],
    ["slide", "slide", "Slide"],
    ["activity", "activity", "Activity"],
    ["settings", "settings", "Settings"],
  ]
    .filter(
      ([id]) =>
        role !== "viewer" ||
        ["fleet", "alerts", "activity", "settings"].includes(id),
    )
    .map(
      ([id, symbol, label]) =>
        `<button data-page="${id}" class="${page === id ? "active" : ""}" ${page === id ? 'aria-current="page"' : ""}>${icon(symbol)}<span>${label}</span></button>`,
    )
    .join(
      "",
    )}</nav><div class="side-note"><span class="eyebrow">A LITTLE<br>LIGHTWEIGHT RMM</span></div><button id="logout" class="account"><b>${esc(username.slice(0, 1).toUpperCase())}</b><span>${esc(username)}<small>Sign out</small></span>${icon("logout")}</button></aside><main class="workspace"><header><div><h1>${esc(title)}</h1>${subtitle ? `<p>${esc(subtitle)}</p>` : ""}</div><div class="header-actions"><button id="refresh" class="secondary" aria-label="Refresh">${icon("refresh")}<span>Refresh</span></button></div></header><section id="content" tabindex="-1"></section></main>`;
  document.querySelectorAll<HTMLElement>("[data-page]").forEach(
    (el) =>
      (el.onclick = () => {
        location.hash = el.dataset.page!;
      }),
  );
  document.querySelector<HTMLAnchorElement>(".skip-link")!.onclick = (e) => {
    e.preventDefault();
    document.getElementById("content")!.focus();
  };
  on("logout", async () => {
    await api("/auth/logout", "POST");
    login();
  });
  on("refresh", render);
}
function content(html: string) {
  document.getElementById("content")!.innerHTML = html;
}
async function render() {
  disconnect();
  document
    .querySelectorAll<HTMLDialogElement>("dialog")
    .forEach((d) => d.close());
  page = location.hash.slice(1) || "fleet";
  if (page.startsWith("remote/")) {
    await renderRemotePage(page.slice(7));
    return;
  }
  if (
    ![
      "fleet",
      "alerts",
      "schedules",
      "account",
      "jobs",
      "patches",
      "software",
      "assistant",
      "recovery",
      "slide",
      "activity",
      "settings",
    ].includes(page)
  )
    page = "fleet";
  const titles: Record<string, string[]> = {
    fleet: ["Fleet", ""],
    alerts: ["Alerts", ""],
    schedules: ["Schedules", ""],
    account: ["Account & access", ""],
    jobs: ["Job history", ""],
    patches: ["Patches", ""],
    software: ["Software & scripts", ""],
    assistant: ["AI assistant", ""],
    recovery: ["Recovery lab", ""],
    slide: ["Slide", ""],
    activity: ["Activity", ""],
    settings: ["Settings", ""],
  };
  shell(...(titles[page] as [string, string]));
  try {
    await {
      fleet: renderFleet,
      alerts: management.renderAlerts,
      schedules: management.renderSchedules,
      account: management.renderAccount,
      jobs: renderJobs,
      patches: ops.renderPatches,
      software: ops.renderSoftware,
      assistant: ops.renderAssistant,
      recovery: renderRecovery,
      slide: renderSlide,
      activity: management.renderAudit,
      settings: renderSettings,
    }[page]!();
    void management.updateIndicator().catch(() => {});
  } catch (err) {
    content(
      `<div class="empty"><h2>Unable to load</h2><p>${esc((err as Error).message)}</p></div>`,
    );
  }
}
const ops = createOperations({
  api,
  esc,
  badge,
  date,
  bytes,
  icon,
  on,
  value,
  notify,
  dialog,
  content,
  devices: () => api("/devices"),
  selected: () => [...fleetSelection],
  openDevice,
  setScript: (script: string) => {
    const editor = document.getElementById("script") as HTMLTextAreaElement;
    if (editor) editor.value = script;
  },
});
const management = createManagement({
  api,
  esc,
  badge,
  date,
  on,
  value,
  notify,
  dialog,
  content,
  openDevice,
  role: () => role,
  username: () => username,
  refresh: render,
});
async function renderFleet() {
  if (role === "viewer") {
    showPreviews = false;
    fleetSelection.clear();
  }
  fleet = await api("/devices");
  fleetSelection.forEach((id) => {
    if (!fleet.some((d) => d.id === id)) fleetSelection.delete(id);
  });
  content(`<div class="fleet-summary"><span><i class="status-dot"></i><b>${fleet.filter((d) => d.online).length}</b> online</span><span><b>${fleet.length}</b> machines</span><span><b>${fleet.filter((d) => !d.approved).length}</b> need review</span><button id="add" class="primary">${icon("plus")} Add a device</button></div>
  <div class="fleet-toolbar"><div class="search-field">${icon("search")}<input id="fleet-search" aria-label="Search devices" placeholder="Search machines, sites, tags or apps" value="${esc(fleetQuery)}"></div><select id="fleet-filter" aria-label="Filter status"><option value="all">All statuses</option><option value="online">Online</option><option value="review">Needs review</option><option value="offline">Offline</option></select><select id="fleet-os" aria-label="Filter operating system"><option value="all">All systems</option><option value="windows">Windows</option><option value="linux">Linux</option></select><select id="fleet-sort" aria-label="Sort machines"><option value="name">Name A–Z</option><option value="cpu">CPU high–low</option><option value="memory">Memory high–low</option><option value="seen">Last seen</option></select><label class="check preview-toggle"><input id="fleet-previews" type="checkbox" ${showPreviews ? "checked" : ""}> Live previews</label></div>
  <div id="bulk-actions" class="bulk-actions"></div><div class="fleet-table-wrap"><table class="fleet-table"><thead><tr><th><input id="select-page" type="checkbox" aria-label="Select machines on this page"></th><th>Machine</th><th>Status</th><th>Active app</th><th>CPU / RAM</th><th>Network</th><th class="preview-column" ${showPreviews ? "" : "hidden"}>Live screen</th><th class="fleet-actions-head">Connect</th></tr></thead><tbody id="fleet-rows"></tbody></table></div><div class="fleet-pagination"><span id="fleet-count"></span><div><button id="fleet-prev" class="secondary">Previous</button><button id="fleet-next" class="secondary">Next</button></div></div>`);
  on("add", enrollmentDialog);
  (document.getElementById("fleet-filter") as HTMLSelectElement).value =
    fleetFilter;
  (document.getElementById("fleet-os") as HTMLSelectElement).value =
    fleetPlatform;
  (document.getElementById("fleet-sort") as HTMLSelectElement).value =
    fleetSort;
  for (const id of ["fleet-search", "fleet-filter", "fleet-os", "fleet-sort"])
    document
      .getElementById(id)!
      .addEventListener(id === "fleet-search" ? "input" : "change", () => {
        fleetQuery = value("fleet-search");
        fleetFilter = value("fleet-filter");
        fleetPlatform = value("fleet-os");
        fleetSort = value("fleet-sort");
        fleetPage = 0;
        renderFleetRows();
      });
  on(
    "fleet-previews",
    () => {
      showPreviews = (
        document.getElementById("fleet-previews") as HTMLInputElement
      ).checked;
      document
        .querySelector(".preview-column")!
        .toggleAttribute("hidden", !showPreviews);
      renderFleetRows();
    },
    "change",
  );
  on("fleet-prev", () => {
    fleetPage--;
    renderFleetRows();
  });
  on("fleet-next", () => {
    fleetPage++;
    renderFleetRows();
  });
  document.getElementById("select-page")!.addEventListener("change", () => {
    const checked = (document.getElementById("select-page") as HTMLInputElement)
      .checked;
    visibleFleet()
      .slice(fleetPage * 50, fleetPage * 50 + 50)
      .filter((d) => d.approved)
      .forEach((d) =>
        checked ? fleetSelection.add(d.id) : fleetSelection.delete(d.id),
      );
    renderFleetRows();
  });
  renderFleetRows();
}
function primaryAddress(d: Item) {
  return (
    (d.telemetry?.network?.interfaces || [])
      .flatMap((n: Item) => n.addrs || [])
      .map((a: Item) => a.address)
      .find((a: string) => a && !a.startsWith("127.") && !a.includes(":")) ||
    "—"
  );
}
function visibleFleet() {
  return fleet
    .filter(
      (d) =>
        `${d.label} ${d.hostname} ${d.site || ""} ${(d.tags || []).join(" ")} ${d.platform} ${d.telemetry?.active_app?.process || ""} ${primaryAddress(d)}`
          .toLowerCase()
          .includes(fleetQuery.toLowerCase()) &&
        (fleetPlatform === "all" || d.platform === fleetPlatform) &&
        (fleetFilter === "all" ||
          (fleetFilter === "online" && d.online && d.approved) ||
          (fleetFilter === "offline" && !d.online) ||
          (fleetFilter === "review" && !d.approved)),
    )
    .sort((a, b) =>
      fleetSort === "cpu"
        ? Number(b.telemetry?.cpu_percent || 0) -
          Number(a.telemetry?.cpu_percent || 0)
        : fleetSort === "memory"
          ? Number(b.telemetry?.memory?.usedPercent || 0) -
            Number(a.telemetry?.memory?.usedPercent || 0)
          : fleetSort === "seen"
            ? b.last_seen - a.last_seen
            : a.label.localeCompare(b.label),
    );
}
function renderFleetRows() {
  const rows = visibleFleet();
  fleetPage = Math.max(0, Math.min(fleetPage, Math.ceil(rows.length / 50) - 1));
  const shown = rows.slice(fleetPage * 50, fleetPage * 50 + 50);
  document.getElementById("fleet-rows")!.innerHTML =
    shown
      .map(
        (d) =>
          `<tr data-row="${d.id}" class="${fleetSelection.has(d.id) ? "selected-row" : ""}"><td class="select-cell"><input type="checkbox" data-select="${d.id}" aria-label="Select ${esc(d.label)}" ${fleetSelection.has(d.id) ? "checked" : ""} ${d.approved ? "" : "disabled"}></td><td class="machine-cell"><button data-device="${d.id}" class="machine-name">${icon(d.platform === "windows" ? "windows" : "linux")}<span><b>${esc(d.label)}</b><small>${esc(d.telemetry?.host?.platform || d.platform)}</small></span></button></td><td data-label="Status">${badge(!d.approved ? "Review" : d.online ? "Online" : "Offline")}<small>${d.online ? "Reporting now" : date(d.last_seen)}</small></td><td data-label="Active app" class="app-cell"><span title="${esc(d.telemetry?.active_app?.title || "")}">${esc(d.telemetry?.active_app?.process || "No desktop")}</span><small>${esc(d.telemetry?.active_app?.user || "")}</small></td><td data-label="CPU / RAM" class="util-cell"><span>${Number(d.telemetry?.cpu_percent || 0).toFixed(0)}% <small>CPU</small></span><span>${Number(d.telemetry?.memory?.usedPercent || 0).toFixed(0)}% <small>RAM</small></span></td><td data-label="Network" class="network-cell mono">${esc(primaryAddress(d))}</td>${showPreviews ? `<td class="screen-cell">${d.preview?.available ? `<button data-device="${d.id}" class="preview-thumb"><img loading="lazy" src="/api/devices/${d.id}/preview?t=${d.preview.captured_at}" alt="Live screen of ${esc(d.label)}"><span>${date(d.preview.captured_at)}</span></button>` : `<button class="preview-empty" data-device="${d.id}">${d.preview?.enabled ? "Waiting for desktop" : "Preview off"}</button>`}</td>` : ""}<td class="connect-cell"><button data-screen="${d.id}" class="quick-action" ${d.online && d.approved ? "" : "disabled"} title="${d.remote_protocol === "ssh" ? "Open SSH" : "Screen control"}">${icon("monitor")}<span>${d.remote_protocol === "ssh" ? "SSH" : "Screen"}</span></button><button data-terminal="${d.id}" class="quick-action" ${d.online && d.approved ? "" : "disabled"} title="Open ${d.platform === "windows" ? "PowerShell" : "shell"}">${icon("terminal")}<span>Prompt</span></button></td></tr>`,
      )
      .join("") ||
    `<tr><td colspan="8"><div class="empty"><h3>No matching machines</h3><p>Try another search or filter.</p></div></td></tr>`;
  document.getElementById("fleet-count")!.textContent = rows.length
    ? `${fleetPage * 50 + 1}–${Math.min(rows.length, fleetPage * 50 + 50)} of ${rows.length} machines`
    : "0 machines";
  (document.getElementById("fleet-prev") as HTMLButtonElement).disabled =
    fleetPage === 0;
  (document.getElementById("fleet-next") as HTMLButtonElement).disabled =
    (fleetPage + 1) * 50 >= rows.length;
  const selectable = shown.filter((d) => d.approved);
  const all = document.getElementById("select-page") as HTMLInputElement;
  all.checked =
    selectable.length > 0 && selectable.every((d) => fleetSelection.has(d.id));
  all.indeterminate =
    !all.checked && selectable.some((d) => fleetSelection.has(d.id));
  document.querySelectorAll<HTMLInputElement>("[data-select]").forEach(
    (el) =>
      (el.onchange = () => {
        el.checked
          ? fleetSelection.add(el.dataset.select!)
          : fleetSelection.delete(el.dataset.select!);
        renderFleetRows();
      }),
  );
  document
    .querySelectorAll<HTMLButtonElement>("[data-device]")
    .forEach((el) => (el.onclick = () => void openDevice(el.dataset.device!)));
  document
    .querySelectorAll<HTMLButtonElement>("[data-terminal]")
    .forEach(
      (el) =>
        (el.onclick = () => void openDevice(el.dataset.terminal!, "terminal")),
    );
  document
    .querySelectorAll<HTMLButtonElement>("[data-screen]")
    .forEach(
      (el) =>
        (el.onclick = () =>
          launchRemote(fleet.find((d) => d.id === el.dataset.screen)!)),
    );
  const bulk = document.getElementById("bulk-actions")!;
  bulk.hidden = !fleetSelection.size;
  bulk.innerHTML = `<b>${fleetSelection.size} selected</b><button id="bulk-scan" class="secondary">${icon("patch")} Scan updates</button><button id="bulk-deploy" class="secondary">${icon("package")} Deploy template</button><button id="bulk-clear" class="text-link">Clear</button>`;
  on("bulk-clear", () => {
    fleetSelection.clear();
    renderFleetRows();
  });
  on("bulk-scan", () => ops.scan([...fleetSelection]));
  on("bulk-deploy", () => ops.deployDialog([...fleetSelection]));
}
async function openDevice(id: string, initialTab = "overview") {
  selected = id;
  tab = role === "viewer" ? "overview" : initialTab;
  if (!fleet.some((d) => d.id === id))
    fleet = await api("/devices?include_archived=true");
  if (fleet.find((d) => d.id === id)?.archived) tab = "overview";
  const old = document.querySelector<HTMLDialogElement>(".device-drawer");
  old?.close();
  const panel = dialog("Machine details", '<div id="detail"></div>');
  panel.classList.add("device-drawer");
  await renderDevice();
}
function launchRemote(d: Item) {
  if (!d.remote_configured) {
    configureRemote(d);
    return;
  }
  if (localStorage.getItem("speck-remote-client") === "desktop") {
    let launched = false;
    const blur = () => {
      launched = true;
    };
    window.addEventListener("blur", blur, { once: true });
    const handoff = dialog(
      "Open Speck Desktop",
      `<p>Opening the installed client. You can also continue in your browser.</p><div class="toolbar"><button id="browser-fallback" class="primary">Continue in browser</button><a class="secondary" href="https://github.com/amcchord/speck/releases" target="_blank" rel="noopener">Download desktop client</a></div>`,
    );
    on("browser-fallback", () => {
      handoff.close();
      location.hash = "remote/" + d.id;
    });
    location.href = `speck://connect/${encodeURIComponent(d.id)}`;
    setTimeout(() => {
      window.removeEventListener("blur", blur);
      if (!launched && handoff.isConnected) {
        handoff.close();
        location.hash = "remote/" + d.id;
      }
    }, 1800);
    notify("Opening Speck Desktop. Your browser connection remains available.");
  } else location.hash = "remote/" + d.id;
}
async function renderDevice() {
  disconnect();
  const d = fleet.find((x) => x.id === selected)!;
  if (!d) return;
  const t = d.telemetry || {},
    names =
      role === "viewer" || d.archived
        ? ["overview"]
        : [
            "overview",
            "services",
            "network",
            "terminal",
            "files",
            "patches",
            "remote",
          ];
  document.getElementById("detail")!.innerHTML =
    `<div class="detail-head"><div><span class="eyebrow">${esc(d.platform)} / ${esc(d.arch)}</span><h2>${esc(d.label)}</h2><small>Last report ${date(d.last_seen)}</small></div>${role !== "viewer" && !d.archived ? '<button id="device-edit" class="secondary">Edit</button>' : ""}</div>${d.archived ? '<div class="callout">Archived. Management is disabled; retained history and Slide identity remain available.</div>' : !d.approved ? '<div class="callout">This appears to be a restored machine. Review its identity and approve it before sending commands.</div>' : ""}<div class="tabs">${names.map((n) => `<button data-tab="${n}" aria-pressed="${tab === n}" class="${tab === n ? "active" : ""}">${n[0].toUpperCase() + n.slice(1)}</button>`).join("")}</div><div id="device-body"></div>`;
  document.querySelectorAll<HTMLElement>("[data-tab]").forEach(
    (el) =>
      (el.onclick = () => {
        tab = el.dataset.tab!;
        renderDevice();
      }),
  );
  on("device-edit", () => editDevice(d));
  if (d.approved && !d.archived && role !== "viewer") {
    document
      .querySelector(".detail-head")!
      .insertAdjacentHTML(
        "afterend",
        `<div class="drawer-actions"><button id="drawer-screen" class="primary">${icon("monitor")} ${d.remote_protocol === "ssh" ? "Open SSH" : "Screen control"}</button><button id="drawer-terminal" class="secondary">${icon("terminal")} ${d.platform === "windows" ? "PowerShell" : "Shell"}</button><button id="drawer-ai" class="secondary">${icon("spark")} Ask AI</button></div>`,
      );
    on("drawer-screen", () => launchRemote(d));
    on("drawer-terminal", () => {
      tab = "terminal";
      return renderDevice();
    });
    on("drawer-ai", () => ops.assistDialog(d));
  }
  const body = document.getElementById("device-body")!;
  if (tab === "overview") {
    body.innerHTML = `<div class="meters"><div><small>Processor</small><strong>${Number(t.cpu_percent || 0).toFixed(1)}<em>%</em></strong><progress aria-label="Processor utilization" max="100" value="${Number(t.cpu_percent || 0)}"></progress></div><div><small>Memory</small><strong>${Number(t.memory?.usedPercent || 0).toFixed(0)}<em>%</em></strong><progress aria-label="Memory utilization" max="100" value="${Number(t.memory?.usedPercent || 0)}"></progress><small>${bytes(t.memory?.used)} / ${bytes(t.memory?.total)}</small></div></div><div class="info-block"><span class="eyebrow">IN THE FOREGROUND</span><h3>${esc(t.active_app?.title || "No interactive desktop reported")}</h3><p>${esc(t.active_app ? `${t.active_app.process || ""} · ${t.active_app.user || ""}` : "Headless servers report services and network activity.")}</p></div><h3>Storage</h3>${(t.disks || []).map((x: Item) => `<div class="disk"><b>${esc(x.path)}</b><span>${bytes(x.used)} / ${bytes(x.total)}</span><progress aria-label="Storage utilization ${esc(x.path)}" value="${Number(x.usedPercent)}" max="100"></progress></div>`).join("")}<div class="mini-grid"><div><small>Operating system</small>${esc(t.host?.platform || d.platform)} ${esc(t.host?.platformVersion)}</div><div><small>Kernel</small>${esc(t.host?.kernelVersion)}</div><div><small>Agent</small>${esc(t.version || "Waiting for telemetry")}</div><div><small>Slide protection</small>${esc(d.slide_agent_id || "Not linked")}</div></div>`;

    management.devicePanel(d, body);
    if (role !== "viewer" && !d.archived) await ops.previewPanel(d, body);
  } else if (tab === "patches") {
    await ops.devicePatches(d, body);
  } else if (tab === "services") {
    body.innerHTML = `<div class="toolbar"><input id="service-search" aria-label="Filter services" placeholder="Filter services…"><small>${(t.services || []).length} services</small></div><div class="scroll"><table><thead><tr><th>Service</th><th>State</th><th>Control</th></tr></thead><tbody id="services"></tbody></table></div>`;
    const rows = () => {
      document.getElementById("services")!.innerHTML = (t.services || [])
        .filter((s: Item) =>
          JSON.stringify(s)
            .toLowerCase()
            .includes(value("service-search").toLowerCase()),
        )
        .map(
          (s: Item, i: number) =>
            `<tr><td><b>${esc(s.name)}</b><small>${esc(s.display_name || s.description)}</small></td><td>${badge(s.state || s.status || "unknown", ["running", "active"].includes(s.state || s.status))}</td><td><select data-service="${esc(s.name)}" aria-label="Control ${esc(s.name)}"><option value="">Action…</option><option>start</option><option>stop</option><option>restart</option></select></td></tr>`,
        )
        .join("");
      document.querySelectorAll<HTMLSelectElement>("[data-service]").forEach(
        (el) =>
          (el.onchange = async () => {
            if (!el.value) return;
            try {
              await queue("service.control", {
                name: el.dataset.service,
                action: el.value,
              });
            } catch (err) {
              notify((err as Error).message, true);
            }
            el.value = "";
          }),
      );
    };
    rows();
    document.getElementById("service-search")!.addEventListener("input", rows);
  } else if (tab === "network") {
    const n = t.network || {};
    body.innerHTML = `<div class="toolbar probe-toolbar"><select id="probe-kind" aria-label="Network test"><option value="ping">Ping</option><option value="dns">DNS lookup</option><option value="tcp">TCP connect</option><option value="trace">Trace route</option></select><input id="probe-target" aria-label="Host or IP" placeholder="Host or IP"><input id="probe-port" aria-label="Port" type="number" value="443" style="width:85px"><button id="probe" class="primary">Test</button></div><div id="job-result"></div>${(n.interfaces || []).map((x: Item) => `<div class="nic"><b>${esc(x.name)}</b><span>${esc((x.addrs || []).map((a: Item) => a.address).join(" · "))}</span><small>MAC ${esc(x.mac || "—")} · MTU ${esc(x.mtu)} · ${esc((x.flags || []).join(", "))}</small></div>`).join("")}<details><summary>Routes and DNS</summary><pre>${pretty({ routes: n.routes, dns: n.dns || n.dns_servers, resolver: n.resolver_details })}</pre></details><details><summary>Traffic counters</summary><pre>${pretty(n.counters)}</pre></details><details open><summary>Connections ${n.connections_truncated ? "(first 350)" : ""}</summary><div class="scroll"><table><thead><tr><th>Process</th><th>Local → Remote</th><th>State</th></tr></thead><tbody>${(n.connections || []).map((c: Item) => `<tr><td>${esc(c.process)}<small>PID ${c.pid}</small></td><td class="mono">${esc(c.local?.ip)}:${c.local?.port}<small>→ ${esc(c.remote?.ip)}:${c.remote?.port}</small></td><td>${esc(c.status || (c.type === 2 ? "UDP" : ""))}</td></tr>`).join("")}</tbody></table></div></details>`;
    on("probe", async () =>
      showJob(
        await queue("network.check", {
          kind: value("probe-kind"),
          target: value("probe-target"),
          port: Number(value("probe-port")),
        }),
      ),
    );
  } else if (tab === "terminal") {
    body.innerHTML = `<p>Run as ${d.platform === "windows" ? "Local System using PowerShell" : "the agent service account using /bin/sh"}. Output is captured and audited.</p><textarea id="script" aria-label="Command" class="code" spellcheck="false" rows="7" placeholder="${d.platform === "windows" ? "Get-Service | Select-Object -First 10" : "systemctl --failed"}"></textarea><div class="toolbar"><select id="shell" aria-label="Command shell"><option value="auto">${d.platform === "windows" ? "PowerShell" : "Shell (/bin/sh)"}</option>${d.platform === "linux" ? '<option value="powershell">PowerShell (pwsh required)</option>' : ""}</select><button id="execute" class="primary">Run command →</button></div><div id="job-result"></div>`;
    on("execute", async () =>
      showJob(
        await queue(
          "command",
          { script: value("script"), shell: value("shell") },
          180,
        ),
      ),
    );
    body.insertAdjacentHTML(
      "afterbegin",
      `<div class="terminal-tools"><button id="terminal-ai" class="secondary">${icon("spark")} Help with this script</button><button id="terminal-save" class="secondary">Save as template</button></div>`,
    );
    on("terminal-ai", () => ops.assistDialog(d, value("script")));
    on("terminal-save", () =>
      ops.templateEditor({
        name: "New script",
        platform: d.platform,
        category: "script",
        script: value("script"),
        parameters: [],
        timeout: 180,
      }),
    );
  } else if (tab === "files") {
    body.innerHTML = `<p>Transfers are verified with SHA-256. Maximum file size: 256 MiB.</p><div class="toolbar"><input id="file-path" aria-label="Full file path" placeholder="Full path on this device" value="${d.platform === "windows" ? "C:\\ProgramData" : "/tmp"}"><button id="browse" class="secondary">List</button><button id="download" class="primary">Download</button></div><div class="toolbar"><input id="file-upload" aria-label="Choose file to upload" type="file"><button id="upload" class="secondary">Upload to path</button></div><small>Upload path includes the filename. Existing files are preserved.</small><div id="job-result"></div><div id="transfers"></div>`;
    on("browse", async () =>
      showJob(await queue("files.list", { path: value("file-path") })),
    );
    on("download", async () => {
      const r = await api(`/devices/${d.id}/files/download`, "POST", {
        path: value("file-path"),
      });
      await showJob(r.job_id);
      await transfers(d.id);
    });
    on("upload", async () => {
      const f = (document.getElementById("file-upload") as HTMLInputElement)
        .files?.[0];
      if (!f) throw new Error("Choose a file first");
      const form = new FormData();
      form.append("file", f);
      const r = await api(
        `/devices/${d.id}/files/upload?path=${encodeURIComponent(value("file-path"))}`,
        "POST",
        form,
      );
      await showJob(r.job_id);
      await transfers(d.id);
    });
    await transfers(d.id);
  } else if (tab === "remote") {
    body.innerHTML = `<div class="remote-intro"><h2>Remote access</h2><p>${d.remote_protocol === "ssh" ? "Open an SSH terminal through the agent." : d.remote_protocol === "vnc" ? "Open a VNC desktop through the agent." : "Open an RDP desktop through the agent, with speaker output and microphone input."}</p><div class="toolbar"><button id="connect" class="primary">Open browser session</button><button id="remote-config" class="secondary">Connection settings</button></div>${d.remote_protocol === "rdp" ? `<a class="text-link" href="/api/devices/${d.id}/remote/native.rdp">Download native RDP fallback ↗</a><small>The native viewer needs a LAN or VPN route to this machine.</small>` : ""}<div class="callout">RDP creates or reconnects a desktop session. Windows client editions may lock the local console. Linux needs an RDP or VNC desktop service; headless machines can use browser SSH.</div></div>`;
    on("remote-config", () => configureRemote(d));
    on("connect", () => launchRemote(d));
  }
}
async function queue(kind: string, payload: Item, timeout = 60) {
  const r = await api(`/devices/${selected}/jobs`, "POST", {
    kind,
    payload,
    timeout,
  });
  notify("Job queued");
  return r.id;
}
async function showJob(id: string) {
  const output = document.getElementById("job-result");
  if (!output) return;
  for (let i = 0; i < 115; i++) {
    const j = await api("/jobs/" + id);
    if (!output.isConnected) return;
    output.innerHTML = `<div class="job-output"><div>${badge(j.status, j.status === "complete")}<small>${esc(j.kind)} · ${esc(id.slice(0, 8))}</small></div><pre>${j.result ? (j.result.stdout !== undefined ? esc(j.result.stdout + (j.result.stderr ? "\n" + j.result.stderr : "") + (j.result.error ? "\n" + j.result.error : "")) : pretty(j.result)) : "Waiting for the agent…"}</pre></div>`;
    if (["complete", "failed", "unknown", "expired"].includes(j.status)) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
}
async function transfers(id: string) {
  const rows = await api("/transfers?device_id=" + id);
  const el = document.getElementById("transfers");
  if (el)
    el.innerHTML = `<h3>Recent transfers</h3>${rows.map((r: Item) => `<div class="transfer"><span>${esc(r.name)}<small>${esc(r.direction)} · ${bytes(r.size)} · ${esc(r.status)}</small></span>${r.status === "ready" ? `<a href="/api/transfers/${r.id}/file">Save file ↗</a>` : ""}</div>`).join("") || "<p>No transfers yet.</p>"}`;
}
function dialog(title: string, html: string) {
  const d = document.createElement("dialog");
  d.setAttribute("aria-label", title);
  d.innerHTML = `<div class="dialog-head"><h2>${esc(title)}</h2><button class="close" aria-label="Close">×</button></div>${html}`;
  document.body.append(d);
  d.showModal();
  d.querySelector(".close")!.addEventListener("click", () => d.close());
  d.addEventListener("close", () => d.remove());
  return d;
}
async function enrollmentDialog() {
  const d = dialog(
    "Add a device",
    `<p>Create a single-use enrollment token. It expires in 15 minutes.</p><label>Device name<input id="enroll-label" placeholder="Front desk PC"></label><button id="enroll" class="primary">Create enrollment</button><div id="enroll-result"></div>`,
  );
  on("enroll", async () => {
    const r = await api("/enrollments", "POST", {
      label: value("enroll-label"),
    });
    d.querySelector("#enroll-result")!.innerHTML =
      `<div class="callout">Keep this token private. It can enroll one device.</div><label>Enrollment token<input readonly value="${esc(r.token)}"></label><p>Download and inspect an installer, then run it as Administrator or root. Enter this token when prompted.</p><div class="toolbar"><a class="secondary" href="/downloads/install-windows.ps1">Windows installer ↓</a><a class="secondary" href="/downloads/install-linux.sh">Linux installer ↓</a></div><small>Server: ${esc(r.server)}</small>`;
  });
}
async function editDevice(d: Item) {
  let systems: Item[] = [];
  try {
    systems = await api("/slide/inventory?resource=agent");
  } catch {
    /* Linking is optional. */
  }
  const currentMissing =
    d.slide_agent_id && !systems.some((a) => a.agent_id === d.slide_agent_id);

  const modal = dialog(
    "Device details",
    `<label>Name<input id="edit-label" value="${esc(d.label)}"></label><label>Slide protected system<select id="edit-slide"><option value="">Not linked</option>${systems.map((a) => `<option value="${esc(a.agent_id)}" ${a.agent_id === d.slide_agent_id ? "selected" : ""}>${esc(a.display_name || a.hostname || a.agent_id)}</option>`).join("")}${currentMissing ? `<option value="${esc(d.slide_agent_id)}" selected>${esc(d.slide_agent_id)}</option>` : ""}</select></label><label class="check"><input id="edit-approved" type="checkbox" ${d.approved ? "checked" : ""}> Approved for management</label><p class="muted">Hardware identity: ${esc(d.hardware_id)}</p><button id="save-device" class="primary">Save changes</button>`,
  );
  on("save-device", async () => {
    await api("/devices/" + d.id, "PATCH", {
      label: value("edit-label"),
      approved: (document.getElementById("edit-approved") as HTMLInputElement)
        .checked,
      slide_agent_id: value("edit-slide") || null,
    });
    modal.close();
    await renderFleet();
  });
}
function configureRemote(d: Item) {
  const modal = dialog(
    "Remote connection",
    `<p>The agent connects to this service on its own loopback address. Credentials are encrypted on the server.</p><div class="form-grid"><label>Protocol<select id="protocol"><option value="rdp">RDP · screen + audio</option><option value="ssh">SSH · terminal</option><option value="vnc">VNC · screen</option></select></label><label>Port<input id="remote-port" type="number" value="${d.platform === "windows" ? 3389 : 22}"></label></div><label>Username<input id="remote-user" autocomplete="off"></label><label>Password<input id="remote-password" type="password" autocomplete="new-password"></label><label>Domain (optional)<input id="remote-domain"></label><details><summary>SSH key authentication</summary><label>Private key<textarea id="remote-key" rows="4" autocomplete="off" spellcheck="false"></textarea></label><label>Key passphrase<input id="remote-key-passphrase" type="password" autocomplete="new-password"></label></details><label class="check"><input type="checkbox" id="remote-cert"> Trust this endpoint's self-signed certificate</label><button id="save-remote" class="primary">Save connection</button>`,
  );
  (document.getElementById("protocol") as HTMLSelectElement).value =
    d.platform === "windows" ? "rdp" : "ssh";
  document.getElementById("protocol")!.addEventListener("change", () => {
    (document.getElementById("remote-port") as HTMLInputElement).value = (
      { rdp: "3389", ssh: "22", vnc: "5900" } as Item
    )[value("protocol")];
  });
  on("save-remote", async () => {
    await api("/devices/" + d.id + "/remote", "PUT", {
      protocol: value("protocol"),
      port: Number(value("remote-port")),
      username: value("remote-user"),
      password: value("remote-password"),
      domain: value("remote-domain"),
      private_key: value("remote-key"),
      passphrase: value("remote-key-passphrase"),
      ignore_certificate: (
        document.getElementById("remote-cert") as HTMLInputElement
      ).checked,
    });
    d.remote_configured = true;
    d.remote_protocol = value("protocol");
    modal.close();
    notify("Connection saved");
  });
}
async function renderRemotePage(id: string) {
  app.innerHTML =
    '<main class="remote-workspace"><div class="remote-header"><a href="#fleet" class="remote-back">← Fleet</a><h1>Opening remote workspace…</h1></div></main>';
  try {
    fleet = await api("/devices");
    const d = fleet.find((d) => d.id === id);
    if (!d) throw new Error("Machine not found");
    if (!d.remote_configured)
      throw new Error(
        "Configure the machine’s Remote connection in Fleet first.",
      );
    await connectRemote(d);
  } catch (e) {
    app.innerHTML = `<main class="remote-workspace"><div class="remote-header"><a href="#fleet" class="remote-back">← Fleet</a><h1>Remote workspace</h1></div><div class="empty"><p class="remote-error">${esc((e as Error).message)}</p></div></main>`;
  }
}
async function connectRemote(d: Item) {
  app.innerHTML = `<main class="remote-workspace"><header class="remote-header"><a href="#fleet" class="remote-back">← Fleet</a>${wordmark(true)}<div class="remote-title"><h1>${esc(d.label)}</h1><small id="remote-status">Connecting…</small></div><button id="remote-ai" class="secondary">${icon("spark")} Screen assistant</button><button id="fullscreen" class="secondary">Full screen</button></header><div class="remote-controls"><button id="mic" class="secondary">Enable microphone</button><label>Keys <select id="key-macro"><option value="">Send shortcut…</option value="cad">Ctrl + Alt + Del</option><option value="task">Task manager</option><option value="run">Windows + R</option><option value="alt-tab">Alt + Tab</option><option value="copy">Ctrl + C</option><option value="paste">Ctrl + V</option><option value="escape">Escape</option><option value="tab">Tab</option></select></label><button id="type-secret" class="secondary">Type password</button><button id="fit-screen" class="secondary">View at 100%</button><button id="desktop-launch" class="secondary">Open in desktop app</button><span id="remote-stats"></span></div><section class="remote-stage"><div id="remote-display" tabindex="0" aria-label="Remote screen. Keyboard input is sent to this machine."></div></section><footer class="remote-footer"><input id="clipboard" aria-label="Remote clipboard" placeholder="Text for the remote clipboard"><button id="paste" class="secondary">Copy to remote</button><button id="read-clipboard" class="secondary">Use my clipboard</button><label class="check"><input id="shared-clipboard" type="checkbox"> Shared clipboard</label></footer></main>`;
  const modal = document.querySelector<HTMLElement>(".remote-workspace")!;
  remoteCleanup = () => {
    modal.dispatchEvent(new Event("close"));
  };
  const native = (window as any).speckDesktop;
  if (!native) {
    document.getElementById("shared-clipboard")!.parentElement!.title =
      "Automatic shared clipboard is available in Speck Desktop";
    (document.getElementById("shared-clipboard") as HTMLInputElement).disabled =
      true;
  } else {
    document.getElementById("desktop-launch")!.hidden = true;
  }
  on("desktop-launch", () => {
    localStorage.setItem("speck-remote-client", "desktop");
    location.href = "speck://connect/" + encodeURIComponent(d.id);
  });
  if (d.platform === "linux")
    document.getElementById("mic")!.title =
      "Microphone is supported by RDP desktop sessions";
  // Keep RDP resolution stable: display-update in the deployed Guacamole/FreeRDP
  // gateway can assert during a resize. Fit/100% never interrupts the desktop.
  const isDesktop = d.remote_protocol !== "ssh";
  const width = Math.min(1920, Math.max(isDesktop ? 1600 : 768, innerWidth)),
    height = Math.min(1080, Math.max(isDesktop ? 900 : 480, innerHeight - 134));
  const session = await api("/devices/" + d.id + "/remote/sessions", "POST", {
    width,
    height,
  });
  if (session.protocol !== "rdp") {
    document.getElementById("mic")!.hidden = true;
  }
  if (session.protocol === "ssh")
    document.getElementById("remote-ai")!.hidden = true;
  const tunnel = new Guacamole.WebSocketTunnel(
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/remote/sessions/${session.id}/ws`,
  );
  const client = new Guacamole.Client(tunnel);
  remote = client;
  const display = document.getElementById("remote-display")!;
  display.appendChild(client.getDisplay().getElement());
  const status = document.getElementById("remote-status")!;
  client.onstatechange = (state: number) =>
    (status.textContent = (
      {
        0: "Idle",
        1: "Connecting…",
        2: "Waiting for session…",
        3: "Connected",
        4: "Disconnecting…",
        5: "Disconnected",
      } as Item
    )[state]);
  let remoteError = "";
  client.onerror = (error: Item) => {
    remoteError = error.message;
    status.textContent = remoteError;
    notify(remoteError, true);
  };
  const statistics = setInterval(async () => {
    if (!modal.isConnected || client.getState() !== 3) return;
    try {
      const stats = await api("/remote/sessions/" + session.id + "/stats");
      status.textContent =
        session.protocol === "rdp"
          ? `Connected · ${stats.audio_bytes ? (stats.audio_bytes / 1024).toFixed(0) + " KB audio received" : "Audio idle"}`
          : "Connected";
    } catch {
      if (remoteError) status.textContent = remoteError;
    }
  }, 3000);
  modal.addEventListener("close", () => clearInterval(statistics));
  const mouse = new Guacamole.Mouse(client.getDisplay().getElement());
  mouse.onEach(["mousedown", "mouseup", "mousemove"], (event: any) => {
    client.sendMouseState(event.state, true);
  });
  const touch = new Guacamole.Mouse.Touchscreen(
    client.getDisplay().getElement(),
  );
  touch.onEach(["mousedown", "mouseup", "mousemove"], (event: any) =>
    client.sendMouseState(event.state, true),
  );
  keyboard = new Guacamole.Keyboard(display);
  keyboard.onkeydown = (key: number) => {
    client.sendKeyEvent(1, key);
    return false;
  };
  keyboard.onkeyup = (key: number) => client.sendKeyEvent(0, key);
  display.addEventListener("mousedown", () => display.focus(), true);
  let fit = true;
  const stage = document.querySelector<HTMLElement>(".remote-stage")!;
  const resize = () => {
    const w = client.getDisplay().getWidth(),
      h = client.getDisplay().getHeight();
    client
      .getDisplay()
      .scale(
        fit
          ? Math.min(
              stage.clientWidth / Math.max(1, w),
              stage.clientHeight / Math.max(1, h),
            )
          : 1,
      );
  };
  let resizeTimer: ReturnType<typeof setTimeout>;
  const resizeRemote = () => {
    resize();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (modal.isConnected && session.protocol === "ssh")
        client.sendSize(
          Math.min(3840, Math.max(768, stage.clientWidth)),
          Math.min(2160, Math.max(480, stage.clientHeight)),
        );
    }, 180);
  };
  const observer = new ResizeObserver(resizeRemote);
  observer.observe(stage);
  client.getDisplay().onresize = resize;
  const fullscreenChanged = () => {
    document.getElementById("fullscreen")!.textContent =
      document.fullscreenElement ? "Exit full screen" : "Full screen";
    resizeRemote();
  };
  document.addEventListener("fullscreenchange", fullscreenChanged);
  const releaseKeys = () => keyboard?.reset();
  window.addEventListener("blur", releaseKeys);
  display.addEventListener("blur", releaseKeys);
  modal.addEventListener("close", () => {
    observer.disconnect();
    clearTimeout(resizeTimer);
    document.removeEventListener("fullscreenchange", fullscreenChanged);
    window.removeEventListener("blur", releaseKeys);
    if (document.fullscreenElement === modal) void document.exitFullscreen();
  });
  on("fit-screen", () => {
    fit = !fit;
    stage.classList.toggle("actual-size", !fit);
    document.getElementById("fit-screen")!.textContent = fit
      ? "View at 100%"
      : "Fit to window";
    resize();
  });
  const shortcuts: Record<string, number[]> = {
    cad: [0xffe3, 0xffe9, 0xffff],
    task: [0xffe3, 0xffe1, 0xff1b],
    run: [0xffeb, 0x72],
    "alt-tab": [0xffe9, 0xff09],
    copy: [0xffe3, 0x63],
    paste: [0xffe3, 0x76],
    escape: [0xff1b],
    tab: [0xff09],
  };
  const sendKeys = (keys: number[]) => {
    keys.forEach((k) => client.sendKeyEvent(1, k));
    [...keys].reverse().forEach((k) => client.sendKeyEvent(0, k));
    display.focus();
  };
  document.getElementById("key-macro")!.addEventListener("change", () => {
    const keys = shortcuts[value("key-macro")];
    if (keys) sendKeys(keys);
    (document.getElementById("key-macro") as HTMLSelectElement).value = "";
  });
  const removeMacro = native?.onMacro((name: string) => {
    if (shortcuts[name]) sendKeys(shortcuts[name]);
  });
  modal.addEventListener("close", () => removeMacro?.());
  const copyToRemote = (text: string) => {
    const writer = new Guacamole.StringWriter(
      client.createClipboardStream("text/plain"),
    );
    writer.sendText(text.slice(0, 65536));
    writer.sendEnd();
  };
  let sharedText = "";
  const sharedEnabled = () =>
    !!(document.getElementById("shared-clipboard") as HTMLInputElement)
      ?.checked;
  const clipboardTimer = setInterval(async () => {
    if (native && sharedEnabled() && document.hasFocus()) {
      try {
        const text = await native.readClipboard();
        if (text !== sharedText) {
          sharedText = text;
          copyToRemote(text);
        }
      } catch {
        /* Focus can change while a clipboard request is in flight. */
      }
    }
  }, 1000);
  modal.addEventListener("close", () => clearInterval(clipboardTimer));
  on("read-clipboard", async () => {
    const text = native
      ? await native.readClipboard()
      : await navigator.clipboard.readText();
    (document.getElementById("clipboard") as HTMLInputElement).value = text;
    copyToRemote(text);
    notify(
      "Clipboard copied to the remote machine. Paste it in the remote app.",
    );
  });
  on("remote-ai", () => remoteAssistant(d, client, sendKeys, copyToRemote));
  client.onclipboard = (stream: any, mimetype: string) => {
    if (mimetype === "text/plain") {
      const reader = new Guacamole.StringReader(stream);
      let text = "";
      reader.ontext = (s: string) => {
        if (text.length < 65536) text += s;
      };
      reader.onend = () => {
        (document.getElementById("clipboard") as HTMLInputElement).value = text;
        if (native && sharedEnabled()) {
          sharedText = text;
          void native.writeClipboard(text).catch(() => {});
        }
      };
    }
  };
  on("paste", () => {
    const writer = new Guacamole.StringWriter(
      client.createClipboardStream("text/plain"),
    );
    writer.sendText(value("clipboard"));
    writer.sendEnd();
    display.focus();
  });
  on("type-secret", () => {
    const prompt = dialog(
      "Type into the remote session",
      `<label>Password<input id="remote-secret" type="password" autocomplete="off"></label><button id="send-secret" class="primary">Type password</button>`,
    );
    on("send-secret", () => {
      const input = document.getElementById(
        "remote-secret",
      ) as HTMLInputElement;
      for (const character of input.value) {
        const point = character.codePointAt(0)!;
        const key = point <= 255 ? point : 0x01000000 | point;
        client.sendKeyEvent(1, key);
        client.sendKeyEvent(0, key);
      }
      input.value = "";
      prompt.close();
      display.focus();
    });
  });
  on("fullscreen", async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await modal.requestFullscreen();
  });
  on("mic", () => {
    if (recorder) {
      recorder.sendEnd();
      recorder = null;
      document.getElementById("mic")!.textContent = "Enable microphone";
      return;
    }
    const stream = client.createAudioStream("audio/L16;rate=44100,channels=1");
    recorder = Guacamole.AudioRecorder.getInstance(
      stream,
      "audio/L16;rate=44100,channels=1",
    );
    if (!recorder)
      throw new Error("Microphone capture is not available in this browser");
    recorder.onerror = () =>
      notify("Microphone permission or remote audio input failed", true);
    document.getElementById("mic")!.textContent = "Mute microphone";
  });
  client.connect("");
  display.focus();
}
async function renderSlide() {
  const cfg = await api("/slide/connection");
  if (!cfg.connected) {
    content(
      '<div class="empty"><h2>Connect your Slide account.</h2><p>Add an API token in Settings to see live backup and recovery data.</p><a class="primary" href="#settings">Open settings →</a></div>',
    );
    return;
  }
  content(
    `<div class="section-head"><div><h2>Slide inventory</h2><p>${esc(cfg.url)}</p></div><select id="slide-resource" aria-label="Slide resource type"><option value="agent">Protected systems</option><option value="device">Slide appliances</option><option value="snapshot">Snapshots + verification</option><option value="backup">Backup jobs</option><option value="network">Recovery networks</option><option value="restore/virt">Restored virtual machines</option><option value="restore/file">File restores</option><option value="restore/image">Image exports</option></select></div><div id="slide-data"></div>`,
  );
  const load = async () => {
    const resource = value("slide-resource");
    const rows = await api(
      "/slide/inventory?resource=" + encodeURIComponent(resource),
    );
    document.getElementById("slide-data")!.innerHTML =
      rows
        .map(
          (r: Item, i: number) =>
            `<details class="provider"><summary><b>${esc(r.display_name || r.name || r.hostname || r.agent_id || r.backup_id || r.snapshot_id || r.virt_id || "Resource")}</b><span>${badge(r.status || r.state || r.verify_boot_status || r.service_status || resource)}</span></summary><pre>${pretty(r)}</pre>${resource === "agent" ? `<button data-backup="${esc(r.agent_id)}" class="primary">Request backup</button>` : ""}</details>`,
        )
        .join("") ||
      '<div class="empty"><h3>No resources returned.</h3><p>This is the live response from the connected Slide account.</p></div>';
    document.querySelectorAll<HTMLElement>("[data-backup]").forEach(
      (el) =>
        (el.onclick = async () => {
          try {
            const r = await api("/slide/backups", "POST", {
              agent_id: el.dataset.backup,
            });
            notify("Backup requested: " + r.backup_id);
          } catch (e) {
            notify((e as Error).message, true);
          }
        }),
    );
  };
  document
    .getElementById("slide-resource")!
    .addEventListener("change", () =>
      load().catch((e) => notify(e.message, true)),
    );
  await load();
}
function recoveryEvidence(run: Item) {
  const rows = (run.state.members || [])
    .map((member: Item) => {
      const proof = (run.report.members || []).find(
        (result: Item) => result.source_device_id === member.source_device_id,
      );
      const source = fleet.find((d) => d.id === member.source_device_id);
      const restored = fleet.find((d) => d.id === member.restored_device_id);
      const result = proof
        ? badge(
            proof.passed ? (proof.compared ? "Matched" : "Passed") : "Failed",
            proof.passed,
          )
        : "Pending";
      return `<tr><td><b>${esc(source?.label || member.source_device_id)}</b></td><td>${badge(member.backup_status || "Pending", member.backup_status === "succeeded")}</td><td>${esc(restored?.label || (member.virt_id ? "Created · awaiting check" : "Pending"))}</td><td>${result}</td></tr>`;
    })
    .join("");
  return `<div class="table-wrap"><table><thead><tr><th>System</th><th>Backup</th><th>Restored instance</th><th>Application check</th></tr></thead><tbody>${rows}</tbody></table></div><details><summary>Detailed evidence</summary><pre>${pretty({ state: run.state, report: run.report })}</pre></details>`;
}
async function renderRecovery() {
  const [plans, runs, devices] = await Promise.all([
    api("/recovery/plans"),
    api("/recovery/runs"),
    api("/devices"),
  ]);
  fleet = devices;
  content(
    `<div class="recovery-banner"><span class="recovery-icon">${icon("recovery")}</span><div><h2>Recovery tests</h2><p>Capture proof → back up → restore together → compare.</p></div><button id="new-plan" class="primary">${icon("plus")} New recovery plan</button></div><div class="section-head"><div><h2>Your recovery plans</h2><p>Each run creates a shared, isolated network for its restored machines.</p></div></div><div class="plan-grid">${plans.map((p: Item) => `<article class="plan"><span class="eyebrow">RECOVERY PLAN</span><h2>${esc(p.name)}</h2><p>${p.spec.members.length} systems · ${esc(p.spec.router_prefix)}</p><button data-run="${p.id}" class="primary">Run recovery test →</button><details><summary>View plan</summary><pre>${pretty(p.spec)}</pre></details></article>`).join("") || '<div class="empty"><h3>No recovery plans</h3><p>Link devices to their Slide agent IDs, then define application checks.</p></div>'}</div><div class="section-head"><h2>Runs & evidence</h2><button id="refresh-runs" class="secondary">Refresh</button></div>${runs.map((r: Item) => `<details class="provider" ${r.status === "stopped" ? "" : "open"}><summary><b>${esc(r.state.name)}</b>${badge(r.status, r.status === "passed")}<small>${date(r.created)}</small></summary><div class="run-phase">${esc(r.phase.replaceAll("_", " "))}</div>${r.state.error ? `<div class="callout">${esc(r.state.error)}</div>` : ""}${recoveryEvidence(r)}<div class="toolbar">${r.status === "awaiting_clones" ? `<button data-verify="${r.id}" class="primary">Verify restored machines</button>` : ""}${r.status !== "running" && r.status !== "stopped" ? `<button data-stop="${r.id}" class="secondary">Stop restored VMs</button>` : ""}</div></details>`).join("")}`,
  );
  on("refresh-runs", renderRecovery);
  on("new-plan", newPlan);
  document.querySelectorAll<HTMLElement>("[data-run]").forEach(
    (el) =>
      (el.onclick = async () => {
        try {
          await api("/recovery/plans/" + el.dataset.run + "/runs", "POST", {});
          notify("Recovery run started");
          await renderRecovery();
        } catch (e) {
          notify((e as Error).message, true);
        }
      }),
  );
  document.querySelectorAll<HTMLElement>("[data-stop]").forEach(
    (el) =>
      (el.onclick = async () => {
        try {
          await api("/recovery/runs/" + el.dataset.stop + "/stop", "POST", {});
          await renderRecovery();
        } catch (e) {
          notify((e as Error).message, true);
        }
      }),
  );
  document.querySelectorAll<HTMLElement>("[data-verify]").forEach(
    (el) =>
      (el.onclick = async () => {
        const run = runs.find((r: Item) => r.id === el.dataset.verify);
        fleet = await api("/devices");
        const m = dialog(
          "Match restored machines",
          `<p>Approve each restored instance in Fleet, then match it to its source. Application checks run only on these selected instances.</p>${run.state.members
            .map(
              (r: Item, i: number) =>
                `<label>${esc(fleet.find((d) => d.id === r.source_device_id)?.label || r.source_device_id)}<select id="clone-${i}"><option value="">Choose restored instance…</option>${fleet
                  .filter(
                    (d) =>
                      d.installation_id === r.installation_id &&
                      d.id !== r.source_device_id &&
                      d.approved,
                  )
                  .map(
                    (d) =>
                      `<option value="${d.id}">${esc(d.label)} · ${esc(d.hardware_id.slice(0, 12))}</option>`,
                  )
                  .join("")}</select></label>`,
            )
            .join(
              "",
            )}<button id="verify-run" class="primary">Run application checks</button>`,
        );
        on("verify-run", async () => {
          const devices: Item = {};
          run.state.members.forEach(
            (r: Item, i: number) =>
              (devices[r.source_device_id] = value("clone-" + i)),
          );
          await api("/recovery/runs/" + run.id + "/verify", "POST", {
            devices,
          });
          m.close();
          await renderRecovery();
        });
      }),
  );
}
async function newPlan() {
  const [devices, appliances, snapshots] = await Promise.all([
    api("/devices"),
    api("/slide/inventory?resource=device"),
    api("/slide/inventory?resource=snapshot"),
  ]);
  fleet = devices;
  const eligible = fleet.filter((d) => d.approved && d.slide_agent_id);
  if (!eligible.length)
    throw new Error(
      "Link at least one approved device to a Slide protected system first.",
    );
  const targets = new Map<string, string>(
    appliances.map((d: Item) => [
      d.device_id,
      d.display_name || d.hostname || d.device_id,
    ]),
  );
  for (const snapshot of snapshots)
    for (const location of snapshot.locations || []) {
      if (location.type === "cloud" && !targets.has(location.device_id))
        targets.set(location.device_id, "Slide cloud · " + location.device_id);
    }
  const m = dialog(
    "New recovery plan",
    `<label>Plan name<input id="plan-name" placeholder="Office recovery"></label><h3>Systems and application checks</h3><p>Choose the systems to restore. Proof commands should print stable results and fail with a nonzero exit code if the application is unhealthy.</p>${eligible.map((d, i) => `<article class="plan-member"><label class="check"><input type="checkbox" id="member-${i}"> ${esc(d.label)} <small>${esc(d.platform)}</small></label><div id="member-fields-${i}" hidden><label>Restore location<select id="target-${i}">${[...targets].map(([id, name]) => `<option value="${id}">${esc(name)}</option>`).join("")}</select></label><div class="form-grid"><label>Virtual CPUs<input type="number" min="1" max="16" value="2" id="cpu-${i}"></label><label>Memory (MiB)<input type="number" min="1024" max="32768" step="1024" value="4096" id="memory-${i}"></label></div><label>Before backup<textarea id="baseline-${i}" class="code" rows="4" spellcheck="false" placeholder="${d.platform === "windows" ? "PowerShell proof command" : "Shell proof command"}"></textarea></label><label>After restore<textarea id="recovered-${i}" class="code" rows="4" spellcheck="false" placeholder="Leave empty to repeat the same proof command"></textarea></label><label class="check"><input type="checkbox" id="compare-${i}" checked> Require matching output</label></div></article>`).join("")}<details><summary>Isolated network settings</summary><p>The restored systems share a new private network with Internet access. No LAN bridge is created.</p><div class="form-grid"><label>Router and subnet<input id="plan-router" value="10.217.0.1/24"></label><label>WireGuard router and subnet<input id="plan-wg" value="10.218.0.1/24"></label><label>DHCP range start<input id="plan-start" value="10.217.0.100"></label><label>DHCP range end<input id="plan-end" value="10.217.0.200"></label><label>Slide client ID (optional)<input id="plan-client" placeholder="c_…"></label><label>Backup deadline (minutes)<input id="plan-timeout" type="number" value="120" min="10" max="1440"></label></div></details><button id="save-plan" class="primary">Create plan</button>`,
  );
  m.classList.add("wide");
  eligible.forEach((_, i) =>
    document.getElementById("member-" + i)!.addEventListener("change", () => {
      document.getElementById("member-fields-" + i)!.hidden = !(
        document.getElementById("member-" + i) as HTMLInputElement
      ).checked;
    }),
  );
  on("save-plan", async () => {
    const members = eligible.flatMap((d, i) =>
      (document.getElementById("member-" + i) as HTMLInputElement).checked
        ? [
            {
              device_id: d.id,
              slide_agent_id: d.slide_agent_id,
              restore_device_id: value("target-" + i),
              cpu_count: Number(value("cpu-" + i)),
              memory_in_mb: Number(value("memory-" + i)),
              baseline_script: value("baseline-" + i),
              recovery_script:
                value("recovered-" + i) || value("baseline-" + i),
              compare_output: (
                document.getElementById("compare-" + i) as HTMLInputElement
              ).checked,
            },
          ]
        : [],
    );
    if (!members.length) throw new Error("Choose at least one system.");
    await api("/recovery/plans", "POST", {
      name: value("plan-name"),
      members,
      router_prefix: value("plan-router"),
      wg_prefix: value("plan-wg"),
      dhcp_range_start: value("plan-start"),
      dhcp_range_end: value("plan-end"),
      client_id: value("plan-client"),
      timeout_minutes: Number(value("plan-timeout")),
    });
    m.close();
    await renderRecovery();
  });
}
async function renderJobs() {
  const [audit, jobs, devices] = await Promise.all([
    api("/audit"),
    api("/jobs"),
    api("/devices"),
  ]);
  content(
    `<h2>Recent jobs</h2><div class="scroll"><table><thead><tr><th>Job</th><th>Device</th><th>Status</th><th>When</th></tr></thead><tbody>${jobs.map((j: Item) => `<tr><td><details><summary>${esc(j.kind)}</summary><pre>${pretty(j.result)}</pre></details></td><td class="mono">${esc(devices.find((d: Item) => d.id === j.device_id)?.label || j.device_id.slice(0, 10))}</td><td>${badge(j.status, j.status === "complete")}</td><td>${date(j.created)}</td></tr>`).join("")}</tbody></table></div><h2>Audit trail</h2><table><thead><tr><th>Action</th><th>Actor</th><th>When</th></tr></thead><tbody>${audit.map((a: Item) => `<tr><td><details><summary>${esc(a.action)}</summary><pre>${pretty(a.detail)}</pre></details></td><td>${esc(a.actor)}</td><td>${date(a.at)}</td></tr>`).join("")}</tbody></table>`,
  );
}
async function renderSettings() {
  if (role === "viewer") return management.renderAccount();
  const c = await api("/slide/connection");
  content(
    `<div class="settings-grid"><article class="panel"><span class="eyebrow">SLIDE INTEGRATION</span><h2>Slide connection</h2><p>${c.connected ? "A Slide account is connected. Enter a new token to replace it." : "Add an account-scoped Slide API token."}</p><label>API origin<input id="slide-url" value="${esc(c.url || "https://api.slide.tech")}"></label><label>API token<input id="slide-token" type="password" autocomplete="new-password"></label><button id="save-slide" class="primary">Verify & connect</button></article><article class="panel"><span class="eyebrow">DEVICE ENROLLMENT</span><h2>Windows and Linux agents</h2><p>Install Speck as a Windows service or a Linux systemd service. Devices connect outbound over HTTPS.</p><button id="enrollment" class="secondary">Add a device</button><hr><h3>Remote access</h3><p>Browser RDP with audio and microphone, VNC for desktop viewing, or SSH for a terminal. Configure each connection from the device's Remote tab.</p><p>Native RDP fallback requires network reachability to the endpoint.</p></article></div>`,
  );
  on("save-slide", async () => {
    await api("/slide/connection", "PUT", {
      url: value("slide-url"),
      token: value("slide-token"),
    });
    notify("Slide connected");
    await renderSettings();
  });
  on("enrollment", enrollmentDialog);
  await ops.settingsPanel();
  await management.settingsPanel();
  if (role !== "admin") {
    for (const id of ["save-slide", "save-ai"])
      document.getElementById(id)?.setAttribute("disabled", "");
  }
}
window.addEventListener("hashchange", () => {
  if (username) render();
});
setInterval(async () => {
  if (
    !username ||
    polling ||
    page !== "fleet" ||
    remote ||
    document.querySelector("dialog") ||
    ["fleet-search", "fleet-filter", "fleet-os", "fleet-sort"].includes(
      document.activeElement?.id || "",
    )
  )
    return;
  polling = true;
  try {
    fleet = await api("/devices");
    if (document.getElementById("fleet-rows")) renderFleetRows();
  } catch {
  } finally {
    polling = false;
  }
}, 15000);
setInterval(() => {
  if (username) void management.updateIndicator().catch(() => {});
}, 30000);
api("/auth/me")
  .then(async (r) => {
    csrf = r.csrf;
    username = r.username;
    role = r.role;
    await render();
  })
  .catch(() => login());

async function remoteAssistant(
  d: Item,
  client: any,
  sendKeys: (keys: number[]) => void,
  copyToRemote: (text: string) => void,
) {
  const modal = dialog(
    "Screen assistant",
    `<p>Describe what you want to do on this screen. The current remote screen and your request will be sent to OpenAI.</p><label>Task<textarea id="screen-ai-prompt" rows="3" placeholder="Help me navigate to the application’s connection settings"></textarea></label><div class="toolbar"><button id="screen-ai-explain" class="primary">Explain this screen</button><button id="screen-ai-step" class="secondary">Suggest next action</button></div><div id="screen-ai-result"></div>`,
  );
  modal.classList.add("remote-ai-dialog");
  let originalImage = "";
  const capture = () =>
    client.getDisplay().flatten().toDataURL("image/jpeg", 0.8);
  const ask = async (mode: string) => {
    originalImage = capture();
    const result = await api("/ai/assist", "POST", {
      prompt: value("screen-ai-prompt"),
      platform: d.platform,
      device_id: d.id,
      image: originalImage,
      mode,
      width: client.getDisplay().getWidth(),
      height: client.getDisplay().getHeight(),
    });
    const el = modal.querySelector("#screen-ai-result")!;
    const extra =
      mode === "assist"
        ? `<p>${esc(result.verification || "")}</p><p>${esc(result.caution || "")}</p>`
        : result.actions.length
          ? `<h3>Proposed actions</h3><pre>${pretty(result.actions)}</pre><p>Check the actions before applying them. Nothing has run.</p><button id="apply-screen-step" class="primary">Apply this step</button>`
          : "<p>Use manual control for this step.</p>";
    el.innerHTML = `<p>${esc(result.summary)}</p>` + extra;

    if (mode === "computer" && result.actions?.length) {
      on("apply-screen-step", async () => {
        if (capture() !== originalImage)
          throw new Error(
            "The screen changed. Ask for a fresh step before applying it.",
          );
        const keyNames: Record<string, number> = {
          CTRL: 0xffe3,
          CONTROL: 0xffe3,
          ALT: 0xffe9,
          SHIFT: 0xffe1,
          META: 0xffeb,
          SUPER: 0xffeb,
          WIN: 0xffeb,
          ENTER: 0xff0d,
          RETURN: 0xff0d,
          TAB: 0xff09,
          ESC: 0xff1b,
          ESCAPE: 0xff1b,
          BACKSPACE: 0xff08,
          DELETE: 0xffff,
          SPACE: 0x20,
          ARROWUP: 0xff52,
          ARROWDOWN: 0xff54,
          ARROWLEFT: 0xff51,
          ARROWRIGHT: 0xff53,
        };
        // Validate the entire step before sending any input.
        for (const a of result.actions) {
          if (a.type === "scroll" && a.scroll_x)
            throw new Error("Horizontal scrolling needs manual control.");
          if (
            a.type === "keypress" &&
            a.keys.some(
              (key: string) =>
                !(key.toUpperCase() in keyNames) && key.length !== 1,
            )
          )
            throw new Error("This key shortcut needs manual control.");
        }
        for (const a of result.actions) {
          if (["click", "double_click", "move"].includes(a.type)) {
            const state = {
              x: a.x,
              y: a.y,
              left: false,
              middle: false,
              right: false,
              up: false,
              down: false,
            };
            const button = a.button || "left";
            client.sendMouseState(state);
            if (a.type !== "move") {
              for (let i = 0; i < (a.type === "double_click" ? 2 : 1); i++) {
                client.sendMouseState({ ...state, [button]: true });
                client.sendMouseState(state);
              }
            }
          }
          if (a.type === "type") {
            for (const c of a.text) {
              const point = c.codePointAt(0)!;
              sendKeys([point <= 255 ? point : 0x01000000 | point]);
            }
          }
          if (a.type === "keypress")
            sendKeys(
              a.keys.map(
                (k: string) =>
                  keyNames[k.toUpperCase()] ?? k.toLowerCase().codePointAt(0),
              ),
            );
          if (a.type === "scroll") {
            const dy = a.scroll_y || 0;
            for (const [delta, positive, negative] of [[dy, "down", "up"]] as [
              number,
              string,
              string,
            ][]) {
              if (!delta) continue;
              const state = {
                x: a.x,
                y: a.y,
                left: false,
                middle: false,
                right: false,
                up: false,
                down: false,
              };
              for (
                let i = 0;
                i < Math.min(20, Math.ceil(Math.abs(delta) / 80));
                i++
              ) {
                client.sendMouseState({
                  ...state,
                  [delta > 0 ? positive : negative]: true,
                });
                client.sendMouseState(state);
              }
            }
          }
        }
        await api("/ai/actions/applied", "POST", {
          request_id: result.request_id,
          device_id: d.id,
          actions: result.actions.map((a: Item) => a.type),
        });
        modal.close();
        notify("Step applied. Inspect the screen before asking for another.");
      });
    }
  };
  on("screen-ai-explain", () => ask("assist"));
  on("screen-ai-step", () => ask("computer"));
}
