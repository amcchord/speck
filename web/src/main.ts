import { available as passkeysAvailable, ceremony as passkeyCeremony, encode as encodePasskey } from "./passkeys";
import { machinePresence } from "./presence";
import Guacamole from "guacamole-common-js";
import "../../brand/tokens.css";
import "./style.css";
import "./operations.css";
import "./orbits.css";
import "./downloads.css";
import { desktopDownloads } from "./downloads";
import { createOperations } from "./operations";
import { createManagement } from "./management";
import { icon, wordmark } from "./icons";
import { startMicrophone } from "./microphone";
import { loadingState, createViewScope, StaleViewError } from "./loading";
import { useReliableImageDecoder, hasVisiblePixels, watchRemoteStartup } from "./remote-startup";
import "./loading.css";
import "./ui.css";
import "./fleet.css";
import "./machine.css";
import { remoteTextKeys } from "./remote-input";

const viewScope = createViewScope();

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
let fleetCache: Item[] | null = null;
let activeDevicePanel: HTMLDialogElement | null = null;
let fleetScroll = { x: 0, y: 0, table: 0 };
function clearFleetState() {
  activeDevicePanel?.close();
  activeDevicePanel?.remove();
  activeDevicePanel = null;
  selected = "";
  fleet = [];
  fleetCache = null;
  fleetSelection.clear();
  fleetQuery = ""; fleetFilter = "all"; fleetPlatform = "all"; fleetSort = "name";
  fleetPage = 0; showPreviews = false;
  fleetScroll = { x: 0, y: 0, table: 0 };
}
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

async function api(path: string, method = "GET", body?: any, signal?: AbortSignal): Promise<any> {
  const current = viewScope.checkpoint();
  const headers: Record<string, string> = { "X-CSRF-Token": csrf };
  if (body !== undefined && !(body instanceof FormData))
    headers["Content-Type"] = "application/json";
  const r = await fetch("/api" + path, {
    method,
    headers,
    signal,
    body:
      body instanceof FormData
        ? body
        : body === undefined
          ? undefined
          : JSON.stringify(body),
  }).catch((err) => { current(); throw err; });
  const value = await r.json().catch(() => ({}));
  current();
  if (r.status === 401 && !path.startsWith("/auth/")) {
    signedOut();
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
  // Native dialogs occupy the top layer, above any body-level z-index.
  // Keep feedback for a dialog visible and available to assistive technology.
  const host = Array.from(document.querySelectorAll("dialog[open]")).at(-1) || document.body;
  host.append(n);
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
      if (err instanceof StaleViewError) return;
      if (document.getElementById("content")?.getAttribute("aria-busy") === "true")
        content(loadError(err));
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
  if (recorder) recorder.stop();
  recorder = null;
  remote?.disconnect();
  remote = null;
  keyboard?.reset();
  keyboard = null;
}
function signedOut() {
  clearFleetState();
  viewScope.reset();
  disconnect();
  csrf = "";
  username = "";
  if (location.hash.startsWith("#desktop-signin/")) { void desktopSignIn(); return; }
  if (location.hash !== "#downloads") return login();
  app.innerHTML = `<main class="downloads-public"><header><a href="#signin" aria-label="Speck home">${wordmark()}</a><a class="secondary" href="#signin">Sign in ${icon("arrow")}</a></header><h1>Downloads</h1>${desktopDownloads(false)}</main>`;
}
function login() {
  clearFleetState();
  viewScope.reset();
  disconnect();
  csrf = "";
  username = "";
  app.innerHTML = `<main class="login"><div class="login-brand">${wordmark(true)}<span class="eyebrow">A LITTLE LIGHTWEIGHT RMM</span><div class="orbit" aria-hidden="true"><i></i><i></i><i></i><img src="/assets/brand/speck-mark-lime.svg" alt=""></div></div><form id="login" class="login-card"><h1>Sign in</h1><button id="passkey-login" class="primary" type="button">Sign in with a passkey</button>${(window as any).speckDesktop?.openPasskeyBrowser ? '<button id="passkey-browser" class="secondary" type="button">Use a passkey from your browser</button><p id="passkey-browser-status" role="status"></p>' : ""}<button id="passkey-cancel" type="button" class="secondary" hidden>Cancel passkey sign-in</button><span class="login-divider">or use your password</span><label>Username<input id="username" autocomplete="username" required></label><label>Password<input id="password" type="password" autocomplete="current-password" required></label><label>Authenticator or recovery code <small>if enabled</small><input id="login-code" autocomplete="one-time-code" maxlength="40"></label><button class="secondary" type="submit">Sign in with password</button><a class="login-downloads" href="#downloads">${icon("download")}Download Speck Desktop</a></form></main>`;
  let authBusy = false;
  let authController: AbortController | null = null;
  const cancelButton = document.getElementById("passkey-cancel") as HTMLButtonElement;
  on("passkey-cancel", () => authController?.abort());
  const authenticate = (action: (signal: AbortSignal) => Promise<void>, cancellable = true) => async () => {
    if (authBusy) return;
    authBusy = true;
    authController = new AbortController();
    cancelButton.hidden = !cancellable;
    const buttons = Array.from(app.querySelectorAll<HTMLButtonElement>("button:not(#passkey-cancel)"));
    buttons.forEach(button => button.disabled = true);
    try { await action(authController.signal); }
    finally {
      authBusy = false; authController = null; cancelButton.hidden = true;
      buttons.forEach(button => { if (button.isConnected) button.disabled = false; });
      if (passkeyButton.isConnected) passkeyButton.disabled = !passkeysAvailable();
    }
  };
  const passkeyButton = document.getElementById("passkey-login") as HTMLButtonElement;
  passkeyButton.disabled = !passkeysAvailable();
  if (passkeyButton.disabled) passkeyButton.title = "Use an updated browser over HTTPS for passkeys";
  on("passkey-browser", authenticate(async (signal) => {
    const current = viewScope.checkpoint();
    const verifier = encodePasskey(crypto.getRandomValues(new Uint8Array(32)).buffer);
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))))
      .map(b => b.toString(16).padStart(2, "0")).join("");
    const started = await api("/auth/desktop/start", "POST", { verifier_hash: hash });
    const status = document.getElementById("passkey-browser-status")!;
    status.textContent = "Confirm code " + started.code + " in your browser. Waiting for your passkey…";
    await (window as any).speckDesktop.openPasskeyBrowser(started.id);
    const end = Date.now() + 120000;
    try {
      while (Date.now() < end) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        current();
        if (signal.aborted) throw new Error("Desktop sign-in canceled.");
        const result = await api("/auth/desktop/claim", "POST", { id: started.id, verifier });
        if (result.pending) continue;
        csrf = result.csrf; username = result.username; role = result.role;
        await render(); return;
      }
      throw new Error("Desktop sign-in timed out. Try again.");
    } finally { if (status.isConnected) status.textContent = ""; }
  }));
  on("passkey-login", authenticate(async (signal) => {
    const current = viewScope.checkpoint();
    const options = await api("/auth/passkeys/options", "POST");
    const credential = await passkeyCeremony(options.publicKey, false, signal);
    current();
    cancelButton.hidden = true;
    const result = await api("/auth/passkeys/verify", "POST", { challenge_id: options.challenge_id, credential });
    csrf = result.csrf; username = result.username; role = result.role;
    await render();
  }));
  on(
    "login",
    authenticate(async () => {
      const r = await api("/auth/login", "POST", {
        username: value("username"),
        password: value("password"),
        code: value("login-code"),
      });
      csrf = r.csrf;
      username = r.username;
      role = r.role;
      await render();
    }, false),
    "submit",
  );
}
async function desktopSignIn() {
  viewScope.reset(); disconnect();
  const id = location.hash.slice("#desktop-signin/".length);
  app.innerHTML = `<main class="downloads-public"><header>${wordmark()}</header><article class="panel" style="max-width:520px;margin:40px auto"><h1>Sign in to Speck Desktop</h1><div id="desktop-approval">${loadingState("Opening sign-in request…")}</div></article></main>`;
  try {
    if (!/^[A-Za-z0-9_-]{43}$/.test(id)) throw new Error("Invalid desktop sign-in request.");
    const options = await api("/auth/desktop/" + id);
    const target = document.getElementById("desktop-approval")!;
    target.innerHTML = `<p>Check that this code matches the one in Speck Desktop on your computer.</p><p class="passkey-pair-code">${esc(options.code)}</p><label class="check"><input id="desktop-code-matches" type="checkbox"> I started this sign-in and the codes match</label><button id="desktop-authorize" class="primary">Continue with passkey</button><p>Only approve a request you started yourself. This signs the desktop app in; it does not change your browser account.</p>`;
    on("desktop-authorize", async () => {
      if (!(document.getElementById("desktop-code-matches") as HTMLInputElement).checked)
        throw new Error("Check the code in Speck Desktop before continuing.");
      const current = viewScope.checkpoint();
      const credential = await passkeyCeremony(options.publicKey);
      current();
      await api("/auth/desktop/authorize", "POST", { challenge_id: id, credential });
      target.innerHTML = `<h2>You’re ready</h2><p>Return to Speck Desktop. You can close this tab.</p>`;
    });
  } catch (error) {
    if (!(error instanceof StaleViewError)) document.getElementById("desktop-approval")!.innerHTML = loadError(error);
  }
}

function shell(title: string, subtitle: string) {
  document.body.dataset.role = role;
  app.innerHTML = `<a class="skip-link" href="#content">Skip to content</a><aside><a class="brand" href="#fleet" aria-label="Speck home">${wordmark(true)}<span class="version">0.2</span></a><nav aria-label="Main navigation">${[
    ["fleet", "fleet", "Fleet"],
    ["alerts", "alerts", "Alerts"],
    ["schedules", "calendar", "Schedules"],
    ["patches", "patch", "Patches"],
    ["software", "package", "Software & scripts"],
    ["assistant", "spark", "AI assistant"],
    ["recovery", "recovery", "Recovery lab"],
    ["slide", "slide", "Slide"],
    ["activity", "history", "Activity"],
    ["downloads", "download", "Downloads"],
    ["settings", "settings", "Settings"],
  ]
    .filter(
      ([id]) =>
        role !== "viewer" ||
        ["fleet", "alerts", "activity", "downloads", "settings"].includes(id),
    )
    .map(
      ([id, symbol, label]) =>
        `<button data-page="${id}" class="${page === id ? "active" : ""}" ${page === id ? 'aria-current="page"' : ""}>${icon(symbol as Parameters<typeof icon>[0])}<span>${label}</span></button>`,
    )
    .join(
      "",
    )}</nav><div class="side-note"><span class="eyebrow">A LITTLE LIGHTWEIGHT RMM</span></div><button id="logout" class="account"><b>${esc(username.slice(0, 1).toUpperCase())}</b><span>${esc(username)}<small>Sign out</small></span>${icon("logout")}</button></aside><main class="workspace ${page === "fleet" ? "fleet-workspace" : ""}"><header><div class="page-heading"><h1>${esc(title)}</h1>${page === "fleet" ? '<div id="fleet-summary" class="fleet-summary" aria-label="Fleet totals"></div>' : ""}${subtitle ? `<p>${esc(subtitle)}</p>` : ""}</div><div class="header-actions"><button id="refresh" class="secondary" aria-label="Refresh" title="Refresh">${icon("refresh")}${page === "fleet" ? "" : "<span>Refresh</span>"}</button>${page === "fleet" ? `<button id="add" class="primary">${icon("plus")}<span>Add device</span></button>` : ""}</div></header><section id="content" tabindex="-1"></section></main>`;
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
  const navigation = app.querySelector<HTMLElement>("aside > nav")!;
  const active = navigation.querySelector<HTMLElement>(".active");
  if (active && matchMedia("(max-width: 760px)").matches)
    navigation.scrollLeft = active.offsetLeft - navigation.clientWidth / 2 + active.clientWidth / 2;
  on("logout", async () => {
    await api("/auth/logout", "POST");
    history.replaceState(null, "", "#signin");
    login();
  });
  on("refresh", render);
  if (page === "fleet") on("add", enrollmentDialog);
}
function content(html: string) {
  const el = document.getElementById("content");
  if (!el) return;
  el.innerHTML = html;
  el.setAttribute("aria-busy", "false");
}
function loadError(error: unknown) {
  return `<div class="empty" role="alert"><h2>Unable to load</h2><p>${esc((error as Error).message)}</p><p>Use Refresh to try again.</p></div>`;
}
function loading(label: string) {
  viewScope.reset();
  content(loadingState(label));
  document.getElementById("content")?.setAttribute("aria-busy", "true");
}
async function render() {
  if (page === "fleet" && document.getElementById("fleet-rows")) {
    fleetScroll = { x: scrollX, y: scrollY, table: document.querySelector(".fleet-table-wrap")!.scrollLeft };
  }
  viewScope.reset();
  disconnect();
  document
    .querySelectorAll<HTMLDialogElement>("dialog")
    .forEach((d) => d.close());
  if (location.hash.startsWith("#desktop-signin/")) { await desktopSignIn(); return; }
  page = location.hash.slice(1) || "fleet";
  if (page.startsWith("remote/")) {
    const [id, query = ""] = page.slice(7).split("?");
    const mode = new URLSearchParams(query).get("mode") || "auto";
    await renderRemotePage(id, 0, mode);
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
      "downloads",
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
    downloads: ["Downloads", ""],
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
      downloads: () => content(desktopDownloads(true)),
    }[page]!();
    void management.updateIndicator().catch(() => {});
  } catch (err) {
    if (!(err instanceof StaleViewError) && username) content(loadError(err));
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
  loading,
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
  loading,
  openDevice,
  role: () => role,
  username: () => username,
  refresh: render,
});
async function renderFleet() {
  if (!fleetCache) loading("Loading fleet…");
  else viewScope.reset();
  if (role === "viewer") {
    showPreviews = false;
    fleetSelection.clear();
  }
  const hadCache = fleetCache !== null;
  if (fleetCache) fleet = fleetCache;
  const refresh = document.getElementById("refresh") as HTMLButtonElement;
  refresh.disabled = true;
  refresh.setAttribute("aria-busy", "true");
  refresh.title = "Updating machines…";
  if (hadCache) drawFleet();
  try {
    const updated = await api("/devices");
    fleet = updated;
    fleetCache = updated;
    if (hadCache) renderFleetRows();
    else drawFleet();
  } catch (err) {
    if (err instanceof StaleViewError || !hadCache) throw err;
    const summary = document.getElementById("fleet-summary");
    summary?.insertAdjacentHTML("beforeend", '<span class="fleet-stale" role="status" title="Showing cached machines. Use Refresh to try again.">Refresh unavailable</span>');
  } finally {
    refresh.disabled = false;
    refresh.removeAttribute("aria-busy");
    refresh.title = "Refresh";
  }
}
function drawFleet() {
  content(`<div class="fleet-toolbar"><div class="search-field">${icon("search")}<input id="fleet-search" aria-label="Search devices" placeholder="Search machines, sites, tags or apps" value="${esc(fleetQuery)}"></div><select id="fleet-filter" aria-label="Filter status"><option value="all">All statuses</option><option value="online">Online</option><option value="review">Needs review</option><option value="offline">Offline</option></select><select id="fleet-os" aria-label="Filter operating system"><option value="all">All systems</option><option value="windows">Windows</option><option value="linux">Linux</option></select><select id="fleet-sort" aria-label="Sort machines"><option value="name">Name A–Z</option><option value="cpu">CPU high–low</option><option value="memory">Memory high–low</option><option value="seen">Last seen</option></select><label class="check preview-toggle"><input id="fleet-previews" type="checkbox" ${showPreviews ? "checked" : ""}> Previews</label></div>
  <div id="bulk-actions" class="bulk-actions"></div><div class="fleet-table-wrap"><table class="fleet-table"><thead><tr><th><input id="select-page" type="checkbox" aria-label="Select machines on this page"></th><th class="machine-head" scope="col">Machine</th><th class="status-head" scope="col">Status</th><th class="app-head" scope="col">Active app</th><th class="util-head" scope="col">CPU</th><th class="util-head" scope="col">RAM</th><th class="network-head" scope="col">IP address</th><th class="preview-column" ${showPreviews ? "" : "hidden"}>Screen preview</th><th class="fleet-actions-head">Connect</th></tr></thead><tbody id="fleet-rows"></tbody></table></div><div class="fleet-pagination"><span id="fleet-count"></span><div><button id="fleet-prev" class="secondary">Previous</button><button id="fleet-next" class="secondary">Next</button></div></div>`);
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
  document.getElementById("fleet-rows")!.addEventListener("click", (event) => {
    const target = event.target as Element;
    // Preserve checkboxes, quick actions, and text selection within a row.
    if (target.closest("button, a, input, select, textarea, label")) return;
    if (window.getSelection()?.isCollapsed === false) return;
    const row = target.closest<HTMLTableRowElement>("tr[data-row]");
    if (row) void openDevice(row.dataset.row!);
  });
  renderFleetRows();
  const table = document.querySelector<HTMLElement>(".fleet-table-wrap")!;
  table.scrollLeft = fleetScroll.table;
  // Restore after layout, without a late callback scrolling a different page.
  requestAnimationFrame(() => { if (table.isConnected) window.scrollTo(fleetScroll.x, fleetScroll.y); });
}
function primaryAddress(d: Item) {
  const interfaces = d.telemetry?.network?.interfaces || [];
  const addresses = [...interfaces]
    .sort((a: Item, b: Item) => Number(!!b.flags?.includes("up")) - Number(!!a.flags?.includes("up")))
    .flatMap((n: Item) => n.addrs || [])
    .map((a: Item) => String(a.address || ""))
    .filter((a: string) => {
      const ip = a.split("/")[0].toLowerCase();
      return ip && !ip.startsWith("127.") && ip !== "::1" && ip !== "::" && ip !== "0.0.0.0";
    });
  return addresses.find((a: string) => !a.includes(":") && !a.startsWith("169.254.")) ||
    addresses.find((a: string) => a.includes(":") && !a.toLowerCase().startsWith("fe80:")) ||
    addresses[0] || "—";
}
function uptime(seconds: unknown) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return "Not reported";
  const minutes = Math.floor(seconds / 60), hours = Math.floor(minutes / 60), days = Math.floor(hours / 24);
  return days ? `${days}d ${hours % 24}h` : hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

function visibleFleet() {
  return fleet
    .filter(
      (d) =>
        `${d.label} ${d.hostname} ${d.site || ""} ${(d.tags || []).join(" ")} ${d.platform} ${machinePresence(d).app?.title || ""} ${machinePresence(d).app?.process || ""} ${primaryAddress(d)}`
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
  fleetSelection.forEach((id) => {
    if (!fleet.some((d) => d.id === id)) fleetSelection.delete(id);
  });
  const summary = document.getElementById("fleet-summary");
  if (summary) summary.innerHTML = `<span><i class="status-dot"></i><b>${fleet.filter((d) => d.online).length}</b> online</span><span><b>${fleet.length}</b> machines</span><span><b>${fleet.filter((d) => !d.approved).length}</b> need review</span>`;
  document.querySelector(".fleet-table")?.classList.toggle("with-previews", showPreviews);
  const rows = visibleFleet();
  fleetPage = Math.max(0, Math.min(fleetPage, Math.ceil(rows.length / 50) - 1));
  const shown = rows.slice(fleetPage * 50, fleetPage * 50 + 50);
  document.getElementById("fleet-rows")!.innerHTML =
    shown
      .map((d) => {
        const os = d.telemetry?.host?.platform || d.platform;
        const status = !d.approved ? "Review" : d.online ? "Online" : "Offline";
        const presence = machinePresence(d);
        const active = presence.app;
        const screenAction = `${d.remote_protocol === "shell" ? "Open web shell" : d.remote_protocol === "ssh" ? "Open SSH session" : "Screen control"} · ${d.label}`;
        const shellAction = `Run ${d.platform === "windows" ? "PowerShell" : "shell command"} · ${d.label}`;
        const usage = (value: any) => value != null && Number.isFinite(Number(value)) ? Number(value).toFixed(0) + "%" : "—";
        return `<tr data-row="${d.id}" class="${fleetSelection.has(d.id) ? "selected-row" : ""}"><td class="select-cell"><input type="checkbox" data-select="${d.id}" aria-label="Select ${esc(d.label)}" ${fleetSelection.has(d.id) ? "checked" : ""} ${d.approved ? "" : "disabled"}></td><td class="machine-cell"><button data-device="${d.id}" class="machine-name" aria-expanded="false" aria-controls="machine-details" title="${esc(d.label)} · ${esc(os)}" aria-label="${esc(d.label)} — ${esc(os)}"><span class="platform-icon" title="${esc(os)}">${icon(d.platform === "windows" ? "windows" : "linux")}</span><b>${esc(d.label)}</b></button></td><td data-label="Status" class="status-cell" title="Last report: ${date(d.last_seen)}">${badge(status)}</td><td data-label="App" class="app-cell"><span title="${esc(active ? [active.title, active.process, active.user].filter(Boolean).join(" · ") : presence.desktop)}">${esc(presence.table)}</span></td><td data-label="CPU" class="util-cell cpu-cell">${usage(d.telemetry?.cpu_percent)}</td><td data-label="RAM" class="util-cell ram-cell">${usage(d.telemetry?.memory?.usedPercent)}</td><td data-label="IP address" class="network-cell mono" title="${esc(primaryAddress(d))}">${esc(primaryAddress(d))}</td>${showPreviews ? `<td class="screen-cell">${d.preview?.available ? `<button data-device="${d.id}" class="preview-thumb"><img loading="lazy" src="/api/devices/${d.id}/preview?t=${d.preview.captured_at}" alt="Screen preview of ${esc(d.label)}"><span>${d.preview.source === "live" ? "Live" : "Saved"} · ${date(d.preview.captured_at)}</span></button>` : `<button class="preview-empty" data-device="${d.id}">${d.preview?.enabled ? "No preview yet" : "Preview off"}</button>`}</td>` : ""}<td class="connect-cell"><button data-screen="${d.id}" class="quick-action" ${d.online && d.approved ? "" : "disabled"} title="${esc(screenAction)}" aria-label="${esc(screenAction)}">${icon(["shell", "ssh"].includes(d.remote_protocol) ? "terminal" : "monitor")}</button><button data-terminal="${d.id}" class="quick-action" ${d.online && d.approved ? "" : "disabled"} title="${esc(shellAction)}" aria-label="${esc(shellAction)}">${icon("code")}</button></td></tr>`;
      })
      .join("") ||
    `<tr class="fleet-empty-row"><td colspan="${showPreviews ? 9 : 8}"><div class="empty"><h3>No matching machines</h3><p>Try another search or filter.</p></div></td></tr>`;
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
  highlightActiveMachine();
  const bulk = document.getElementById("bulk-actions")!;
  bulk.hidden = !fleetSelection.size;
  bulk.innerHTML = `<b>${fleetSelection.size} selected</b><button id="bulk-scan" class="secondary">Scan updates</button><button id="bulk-deploy" class="secondary">Deploy template</button><button id="bulk-clear" class="text-link">Clear</button>`;
  on("bulk-clear", () => {
    fleetSelection.clear();
    renderFleetRows();
  });
  on("bulk-scan", () => ops.scan([...fleetSelection]));
  on("bulk-deploy", () => ops.deployDialog([...fleetSelection]));
}
function highlightActiveMachine() {
  document.querySelectorAll<HTMLTableRowElement>("#fleet-rows tr[data-row]").forEach((row) => {
    const active = !!activeDevicePanel?.open && row.dataset.row === selected;
    row.classList.toggle("active-machine", active);
    row.querySelector(".machine-name")?.setAttribute("aria-expanded", String(active));
  });
}
async function openDevice(id: string, initialTab = "overview") {
  if (activeDevicePanel?.open && selected === id && tab === initialTab) {
    activeDevicePanel.querySelector<HTMLButtonElement>(".close")?.focus();
    return;
  }
  // Remove synchronously: close events are queued, and two #detail trees must
  // never coexist while a different machine is being rendered.
  activeDevicePanel?.close();
  activeDevicePanel?.remove();
  selected = id;
  tab = role === "viewer" ? "overview" : initialTab;
  const panel = dialog("Machine details", `<div id="detail">${loadingState("Loading machine…")}</div>`,
    { className: "device-drawer", modal: false });
  panel.id = "machine-details";
  activeDevicePanel = panel;
  highlightActiveMachine();
  const escape = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !panel.open || document.querySelector("dialog:modal")) return;
    event.preventDefault();
    panel.close();
  };
  document.addEventListener("keydown", escape);
  panel.addEventListener("close", () => {
    document.removeEventListener("keydown", escape);
    if (activeDevicePanel !== panel) return;
    activeDevicePanel = null;
    detailVersion++;
    highlightActiveMachine();
    // Return to the machine after dismissal; navigation and replacement panes
    // keep their own focus instead.
    if (page === "fleet") {
      document.querySelectorAll<HTMLButtonElement>("#fleet-rows .machine-name").forEach((button) => {
        if (button.dataset.device === id) button.focus({ preventScroll: true });
      });
    }
  });
  try {
    if (!fleet.some((d) => d.id === id))
      fleet = await api("/devices?include_archived=true");
    if (!panel.isConnected || !panel.open || activeDevicePanel !== panel) return;
    if (fleet.find((d) => d.id === id)?.archived) tab = "overview";
    await renderDevice();
  } catch (err) {
    if (!(err instanceof StaleViewError) && panel.isConnected && panel.open)
      panel.querySelector("#detail")!.innerHTML = loadError(err);
  }
}
function launchRemote(d: Item) {
  if (!d.remote_configured) {
    configureRemote(d);
    return;
  }
  if (d.remote_protocol !== "shell" && localStorage.getItem("speck-remote-client") === "desktop") {
    let launched = false;
    const blur = () => {
      launched = true;
    };
    window.addEventListener("blur", blur, { once: true });
    const handoff = dialog(
      "Open Speck Desktop",
      `<p>Opening the installed client. You can also continue in your browser.</p><div class="toolbar"><button id="browser-fallback" class="primary">Continue in browser</button><a class="secondary" href="#downloads">Download desktop client</a></div>`,
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
let detailVersion = 0;
function machineHealth(d: Item) {
  const t = d.telemetry || {}, presence = machinePresence(d);
  const percent = (n: unknown) => typeof n === "number" && Number.isFinite(n) ? n : null;
  const cpu = percent(t.cpu_percent), memory = percent(t.memory?.usedPercent);
  return `
          <div class="meters">
            <div><small>Processor</small><strong>${cpu === null ? "—" : cpu.toFixed(1) + "<em>%</em>"}</strong>${cpu === null ? '<small>Not reported</small>' : `<progress aria-label="Processor utilization" max="100" value="${cpu}"></progress>`}</div>
            <div><small>Memory</small><strong>${memory === null ? "—" : memory.toFixed(0) + "<em>%</em>"}</strong>${memory === null ? '<small>Not reported</small>' : `<progress aria-label="Memory utilization" max="100" value="${memory}"></progress>`}${t.memory?.total != null ? `<small>${t.memory.used == null ? "—" : bytes(t.memory.used)} / ${bytes(t.memory.total)}</small>` : ""}</div>
          </div>
          <section class="machine-storage"><h3>Storage</h3>${(t.disks || []).map((x: Item) => `<div class="disk"><b>${esc(x.path)}</b><span>${x.used == null ? "—" : bytes(x.used)} / ${x.total == null ? "—" : bytes(x.total)}</span>${percent(x.usedPercent) === null ? "" : `<progress aria-label="Storage utilization ${esc(x.path)}" value="${x.usedPercent}" max="100"></progress>`}</div>`).join("") || '<small>No storage reported</small>'}</section>
          <div class="machine-foreground"><div><small>${presence.appLabel}</small><h3>${esc(presence.title)}</h3>${presence.app?.process ? `<small>${esc(presence.app.process)}</small>` : ""}${!presence.current && presence.app?.observed_at ? `<small>Last observed ${esc(date(Date.parse(presence.app.observed_at) / 1000))}</small>` : ""}</div><div class="machine-user"><small>${presence.userHeading}</small><b>${esc(presence.userLabel)}</b></div><div class="machine-desktop"><small>Interactive desktop</small><b>${esc(presence.desktop)}</b></div></div>`;
}
function refreshOpenMachine() {
  if (!activeDevicePanel?.open || tab !== "overview") return;
  const d = fleet.find(d => d.id === selected);
  if (!d) { activeDevicePanel.close(); return; }
  const health = activeDevicePanel.querySelector(".machine-health");
  if (health) health.innerHTML = machineHealth(d);
  const report = activeDevicePanel.querySelector(".machine-report");
  if (report) report.textContent = date(d.last_seen);
  const up = activeDevicePanel.querySelector(".machine-uptime");
  if (up) up.textContent = uptime(d.telemetry?.host?.uptime);
  const heading = activeDevicePanel.querySelector(".dialog-head h2");
  if (heading) heading.innerHTML = `<span class="machine-title">${esc(d.label)}</span>${badge(d.online ? "Online" : "Offline")}${d.archived ? badge("Archived") : !d.approved ? badge("Review") : ""}`;
  let note = activeDevicePanel.querySelector(".telemetry-note");
  if (!d.online && !note) {
    note = document.createElement("p"); note.className = "telemetry-note";
    activeDevicePanel.querySelector("#device-body")?.prepend(note);
  }
  if (note) { note.textContent = d.online ? "" : "Machine is offline. Values below are from its last report."; }
}

async function renderDevice() {
  const version = ++detailVersion;
  try { await renderDeviceContent(); }
  catch (err) {
    const body = document.getElementById("device-body");
    if (!(err instanceof StaleViewError) && version === detailVersion && body)
      body.innerHTML = loadError(err);
  }
}
async function renderDeviceContent() {
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
  const address = primaryAddress(d).split("/")[0];
  const status = d.online ? "Online" : "Offline";
  const heading = activeDevicePanel?.querySelector(".dialog-head h2");
  if (heading) heading.innerHTML = `<span class="machine-title">${esc(d.label)}</span>${badge(status)}${d.archived ? badge("Archived") : !d.approved ? badge("Review") : ""}`;
  activeDevicePanel?.setAttribute("aria-label", `Machine details: ${d.label}`);
  document.getElementById("detail")!.innerHTML = `
    <div class="machine-summary">
      <dl class="machine-facts">
        <div><dt>IP address</dt><dd class="machine-address"><span class="mono">${esc(address)}</span>${address !== "—" ? '<button id="copy-machine-ip" class="quick-action" title="Copy IP address" aria-label="Copy IP address">' + icon("copy") + '</button>' : ""}</dd></div>
        <div><dt>Operating system</dt><dd>${esc(t.host?.platform || d.platform || "Not reported")}<small>${esc([t.host?.platformVersion, d.arch].filter(Boolean).join(" · "))}</small></dd></div>
        <div><dt>Uptime${d.online ? "" : " at last report"}</dt><dd class="machine-uptime">${uptime(t.host?.uptime)}</dd></div>
        <div><dt>Last report</dt><dd class="machine-report">${esc(date(d.last_seen))}</dd></div>
      </dl>
      <div class="drawer-actions">${d.approved && !d.archived && role !== "viewer" ? `<button id="drawer-screen" class="primary" ${d.online ? "" : "disabled"}>${icon(["shell", "ssh"].includes(d.remote_protocol) ? "terminal" : "monitor")} ${d.remote_protocol === "shell" ? "Open web shell" : d.remote_protocol === "ssh" ? "Open SSH" : "Screen control"}</button><button id="drawer-terminal" class="secondary">${icon("terminal")} ${d.platform === "windows" ? "PowerShell" : "Shell"}</button><button id="drawer-ai" class="secondary">${icon("spark")} Ask AI</button>` : ""}${role !== "viewer" && !d.archived ? '<button id="device-edit" class="secondary">Edit</button>' : ""}</div>
    </div>
    ${d.archived ? '<div class="callout">Archived. Management is disabled; retained history and Slide identity remain available.</div>' : !d.approved ? '<div class="callout">This appears to be a restored machine. Review its identity and approve it before sending commands.</div>' : ""}
    <div class="tabs">${names.map((n) => `<button data-tab="${n}" aria-pressed="${tab === n}" class="${tab === n ? "active" : ""}">${n[0].toUpperCase() + n.slice(1)}</button>`).join("")}</div><div id="device-body">${loadingState("Loading " + tab + "…")}</div>`;
  on("copy-machine-ip", async () => {
    await navigator.clipboard.writeText(address);
    notify("IP address copied");
  });
  document.querySelectorAll<HTMLElement>("[data-tab]").forEach(
    (el) =>
      (el.onclick = () => {
        tab = el.dataset.tab!;
        renderDevice();
      }),
  );
  on("device-edit", () => editDevice(d));
  if (d.approved && !d.archived && role !== "viewer") {
    on("drawer-screen", () => launchRemote(d));
    on("drawer-terminal", () => {
      tab = "terminal";
      return renderDevice();
    });
    on("drawer-ai", () => ops.assistDialog(d));
  }
  const body = document.getElementById("device-body")!;
  if (tab === "overview") {
    const canPreview = role !== "viewer" && !d.archived;
    body.innerHTML = `
      ${!d.online ? '<p class="telemetry-note">Machine is offline. Values below are from its last report.</p>' : ""}
      <div class="machine-overview ${canPreview ? "" : "without-preview"}">
        ${canPreview ? '<div id="machine-preview"></div>' : ""}
        <div class="machine-health">
          ${machineHealth(d)}
        </div>
      </div>
      <div class="mini-grid machine-system"><div><small>Hostname</small>${esc(d.hostname || "Not reported")}</div><div><small>Kernel</small>${esc(t.host?.kernelVersion || "Not reported")}</div><div><small>Agent</small>${esc(t.version || "Waiting for telemetry")}</div><div><small>Slide protection</small>${esc(d.slide_agent_id || "Not linked")}</div></div>`;

    management.devicePanel(d, body);
    if (canPreview) await ops.previewPanel(d, body.querySelector<HTMLElement>("#machine-preview")!);
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
      `<div class="terminal-tools"><button id="terminal-ai" class="secondary">Help with this script</button><button id="terminal-save" class="secondary">Save as template</button></div>`,
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
    body.innerHTML = `<p>Transfers are verified with SHA-256. Maximum file size: 256 MiB.</p><div class="toolbar"><input id="file-path" aria-label="Full file path" placeholder="Full path on this device" value="${d.platform === "windows" ? "C:\\ProgramData" : "/tmp"}"><button id="browse" class="secondary">List</button><button id="download" class="primary">Download</button></div><div class="toolbar"><input id="file-upload" aria-label="Choose file to upload" type="file"><button id="upload" class="secondary">Upload to path</button></div><small>Upload path includes the filename. Existing files are preserved.</small><div id="job-result"></div><div id="transfers">${loadingState("Loading transfers…")}</div>`;
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
    body.innerHTML = `<div class="remote-intro"><h2>Remote access</h2><p>${d.remote_protocol === "shell" ? "Open an interactive web shell through the agent. No SSH setup is needed." : d.remote_protocol === "ssh" ? "Open an SSH terminal through the agent." : d.remote_protocol === "vnc" ? "Open a VNC desktop through the agent." : "Open an RDP desktop through the agent, with speaker output and microphone input."}</p><div class="toolbar"><button id="connect" class="primary">Open browser session</button><button id="remote-config" class="secondary">Connection settings</button>${d.remote_shell_available && d.remote_protocol !== "shell" ? `<a class="secondary" href="#remote/${d.id}?mode=shell">Open web shell</a>` : ""}</div>${d.remote_protocol === "rdp" ? `<a class="text-link" href="/api/devices/${d.id}/remote/native.rdp">Download native RDP fallback ↗</a><small>The native viewer needs a LAN or VPN route to this machine.</small>` : ""}<div class="callout">RDP creates or reconnects a desktop session. Windows client editions may lock the local console. Linux needs an RDP or VNC desktop service; headless Linux machines open a web shell with an updated agent.</div></div>`;
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
  const el = document.getElementById("transfers");
  const rows = await api("/transfers?device_id=" + id);
  if (el?.isConnected)
    el.innerHTML = `<h3>Recent transfers</h3>${rows.map((r: Item) => `<div class="transfer"><span>${esc(r.name)}<small>${esc(r.direction)} · ${bytes(r.size)} · ${esc(r.status)}</small></span>${r.status === "ready" ? `<a href="/api/transfers/${r.id}/file">Save file ↗</a>` : ""}</div>`).join("") || "<p>No transfers yet.</p>"}`;
}
function dialog(title: string, html: string, options: { className?: string; modal?: boolean } = {}) {
  const d = document.createElement("dialog");
  d.setAttribute("aria-label", title);
  if (options.className) d.className = options.className;
  d.innerHTML = `<div class="dialog-head"><h2>${esc(title)}</h2><button class="close" aria-label="Close">×</button></div>${html}`;
  document.body.append(d);
  if (options.modal === false) d.show();
  else d.showModal();
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
    d.configured_remote_protocol = value("protocol");
    d.remote_protocol = d.remote_shell_available && d.telemetry?.capabilities?.desktop === "headless" ? "shell" : value("protocol");
    modal.close();
    notify("Connection saved");
  });
}
async function renderRemotePage(id: string, attempt = 0, mode = "auto") {
  app.innerHTML =
    `<main class="remote-workspace"><div class="remote-header"><a href="#fleet" class="remote-back">← Fleet</a><h1>Remote workspace</h1></div><section class="remote-stage"><div class="remote-startup">${loadingState("Opening remote workspace…")}</div></section></main>`;
  try {
    fleet = await api("/devices");
    fleetCache = fleet;
    const d = fleet.find((d) => d.id === id);
    if (!d) throw new Error("Machine not found");
    if (!d.remote_configured)
      throw new Error(
        "Configure the machine’s Remote connection in Fleet first.",
      );
    if (mode === "shell" || (mode === "auto" && d.remote_protocol === "shell")) {
      const current = viewScope.checkpoint();
      const { openWebShell } = await import("./web-shell");
      current();
      remoteCleanup = openWebShell(app, { id: d.id, label: d.label, configured_remote_protocol: d.configured_remote_protocol }, csrf, signedOut);
    } else {
      await connectRemote({ ...d, remote_protocol: d.configured_remote_protocol || d.remote_protocol }, attempt);
    }
  } catch (e) {
    if (e instanceof StaleViewError || !username) return;
    app.innerHTML = `<main class="remote-workspace"><div class="remote-header"><a href="#fleet" class="remote-back">← Fleet</a><h1>Remote workspace</h1></div><div class="empty"><p class="remote-error">${esc((e as Error).message)}</p></div></main>`;
  }
}
async function connectRemote(d: Item, attempt = 0) {
  app.innerHTML = `<main class="remote-workspace"><header class="remote-header"><a href="#fleet" class="remote-back">← Fleet</a>${wordmark(true)}<div class="remote-title"><h1>${esc(d.label)}</h1><small id="remote-status">Connecting…</small></div><button id="remote-ai" class="secondary">Screen assistant</button><button id="fullscreen" class="secondary">Full screen</button></header><div class="remote-controls"><button id="remote-keyboard" class="secondary">Keyboard</button><button id="sound" class="secondary">Enable sound</button><button id="mic" class="secondary">Enable microphone</button><label>Keys <select id="key-macro"><option value="">Send shortcut…</option><option value="cad">Ctrl + Alt + Del</option><option value="task">Task manager</option><option value="run">Windows + R</option><option value="alt-tab">Alt + Tab</option><option value="copy">Ctrl + C</option><option value="paste">Ctrl + V</option><option value="enter">Return / Enter</option><option value="backspace">Backspace</option><option value="escape">Escape</option><option value="tab">Tab</option></select></label><button id="type-secret" class="secondary">Type password</button><button id="fit-screen" class="secondary">View at 100%</button><button id="remote-reconnect" class="secondary">Reconnect</button><button id="desktop-launch" class="secondary">Open in desktop app</button><span id="remote-stats"></span></div><section class="remote-stage"><div id="remote-display" tabindex="0" aria-label="Remote screen. Keyboard input is sent to this machine."></div><div id="remote-startup" class="remote-startup">${loadingState(attempt ? "Reconnecting the display…" : "Connecting to machine…", "The screen will appear as soon as it is ready.")}</div></section><footer class="remote-footer"><input id="clipboard" aria-label="Remote clipboard" placeholder="Text for the remote clipboard"><button id="paste" class="secondary">Copy to remote</button><button id="read-clipboard" class="secondary">Use my clipboard</button><label class="check"><input id="shared-clipboard" type="checkbox"> Shared clipboard</label></footer></main>`;
  const modal = document.querySelector<HTMLElement>(".remote-workspace")!;
  let closed = false;
  remoteCleanup = () => {
    closed = true;
    modal.dispatchEvent(new Event("close"));
  };
  const reconnect = async (nextAttempt = 0) => {
    if (closed || !modal.isConnected) return;
    disconnect();
    viewScope.reset();
    await renderRemotePage(d.id, nextAttempt, "connection");
  };
  on("remote-reconnect", () => reconnect());
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
    mode: "connection",
  });
  if (closed || !modal.isConnected) return;
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
  const guacDisplay = client.getDisplay();
  useReliableImageDecoder(guacDisplay, Guacamole, navigator.userAgent);
  display.appendChild(guacDisplay.getElement());
  const status = document.getElementById("remote-status")!;
  let connectionState = 0, screenReady = false, flushed = false;
  const overlay = document.getElementById("remote-startup")!;
  const sample = document.createElement("canvas");
  sample.width = 32; sample.height = 18;
  const context = sample.getContext("2d", { willReadFrequently: true });
  guacDisplay.statisticWindow = 1000;
  guacDisplay.onstatistics = () => { flushed = true; };
  const showScreen = () => {
    screenReady = true;
    guacDisplay.statisticWindow = 0;
    overlay.hidden = true;
    display.setAttribute("aria-busy", "false");
    status.textContent = "Connected";
    if (document.hasFocus()) display.focus();
  };
  const showFailure = (message: string) => {
    overlay.hidden = false;
    overlay.setAttribute("data-error", "");
    display.setAttribute("aria-busy", "false");
    overlay.innerHTML = loadingState(message, "Try reconnecting, or inspect the current screen.") +
      '<div class="toolbar"><button id="retry-screen" class="secondary">Reconnect</button><button id="show-screen" class="secondary">Show current screen</button></div>';
    on("retry-screen", () => reconnect());
    on("show-screen", () => { startup.stop(); showScreen(); status.textContent = connectionState === 3 ? "Connected" : "Disconnected"; });
  };
  display.setAttribute("aria-busy", "true");
  const startup = watchRemoteStartup({
    visible: () => !document.hidden && document.hasFocus(),
    ready: () => {
      if (!flushed || !guacDisplay.getWidth() || !guacDisplay.getHeight()) return false;
      if (session.protocol === "ssh") return true;
      if (!context) return true;
      try {
        context.clearRect(0, 0, 32, 18);
        context.drawImage(guacDisplay.getDefaultLayer().getCanvas(), 0, 0, 32, 18);
        return hasVisiblePixels(context.getImageData(0, 0, 32, 18).data);
      } catch { return true; }
    },
    wake: () => client.sendMouseState({ x: 1, y: 1, left: false, middle: false, right: false, up: false, down: false }),
    recover: () => { void reconnect(attempt + 1); },
    show: showScreen,
    stalled: () => showFailure("The desktop hasn’t appeared yet"),
    canRecover: attempt === 0,
  });
  modal.addEventListener("close", () => { startup.stop(); guacDisplay.onstatistics = null; });
  client.onstatechange = (state: number) => {
    connectionState = state;
    status.textContent = (
      {
        0: "Idle",
        1: "Connecting…",
        2: "Waiting for session…",
        3: screenReady ? "Connected" : "Waiting for first screen…",
        4: "Disconnecting…",
        5: "Disconnected",
      } as Item
    )[state];
    if (state === 3) {
      startup.connected();
      if (!screenReady) overlay.querySelector("strong")!.textContent = "Waiting for first screen…";
    }
    if (state === 5) {
      startup.stop();
      if (!closed && modal.isConnected) showFailure(remoteError || "Session disconnected");
    }
  };
  let remoteError = "";
  client.onerror = (error: Item) => {
    remoteError = error.message;
    status.textContent = remoteError;
    startup.stop();
    if (!closed && modal.isConnected) showFailure(remoteError || "Unable to connect");
  };
  const statistics = setInterval(async () => {
    if (!modal.isConnected || connectionState !== 3 || !screenReady) return;
    try {
      const stats = await api("/remote/sessions/" + session.id + "/stats");
      if (closed || connectionState !== 3) return;
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
    startup.interacted();
    client.sendMouseState(event.state, true);
  });
  const touch = new Guacamole.Mouse.Touchscreen(
    client.getDisplay().getElement(),
  );
  touch.onEach(["mousedown", "mouseup", "mousemove"], (event: any) => {
    startup.interacted();
    client.sendMouseState(event.state, true);
  });
  keyboard = new Guacamole.Keyboard(display);
  keyboard.onkeydown = (key: number) => {
    startup.interacted();
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
  if (!native?.toggleFullscreen) document.addEventListener("fullscreenchange", fullscreenChanged);
  const updateNativeFullscreen = (full: boolean) => {
    if (!modal.isConnected) return;
    document.getElementById("fullscreen")!.textContent = full
      ? "Exit full screen" : "Full screen";
    resizeRemote();
  };
  const removeFullscreen = native?.onFullscreen?.(updateNativeFullscreen);
  if (native?.getFullscreen) void native.getFullscreen().then(updateNativeFullscreen).catch(() => {});
  const releaseKeys = () => keyboard?.reset();
  window.addEventListener("blur", releaseKeys);
  display.addEventListener("blur", releaseKeys);
  modal.addEventListener("close", () => {
    observer.disconnect();
    clearTimeout(resizeTimer);
    document.removeEventListener("fullscreenchange", fullscreenChanged);
    window.removeEventListener("blur", releaseKeys);
    removeFullscreen?.();
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
    cut: [0xffe3, 0x78],
    selectAll: [0xffe3, 0x61],
    undo: [0xffe3, 0x7a],
    redo: [0xffe3, 0x79],
    enter: [0xff0d],
    backspace: [0xff08],
    escape: [0xff1b],
    tab: [0xff09],
  };
  const sendKeys = (keys: number[]) => {
    startup.interacted();
    keyboard?.reset();
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
  const removeEdit = native?.onEdit?.(async (action: string) => {
    if (!modal.isConnected || document.activeElement !== display || !shortcuts[action]) return;
    if (action === "paste" && sharedEnabled()) {
      try {
        const text = await native.readClipboard();
        if (!modal.isConnected || !sharedEnabled() || document.activeElement !== display) return;
        sharedText = text;
        copyToRemote(text);
      } catch {
        notify("Could not read your clipboard. Focus the session and try again.", true);
        return;
      }
    }
    sendKeys(shortcuts[action]);
  });
  modal.addEventListener("close", () => removeEdit?.());
  const clipboardTimer = setInterval(async () => {
    if (native && sharedEnabled() && document.hasFocus()) {
      try {
        const text = await native.readClipboard();
        if (!modal.isConnected || !sharedEnabled() || !document.hasFocus()) return;
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
        text = (text + s).slice(0, 65536);
      };
      reader.onend = () => {
        if (!modal.isConnected) return;
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
  on("remote-keyboard", () => {
    const prompt = dialog(
      "Remote keyboard",
      `<label>Text to type<textarea id="remote-text" rows="4" maxlength="8192" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Type text or a command…"></textarea></label><p>Text is typed into the focused remote application. New lines press Return.</p><button id="send-text" class="primary">Type text</button><div class="toolbar remote-keyboard-keys"><button id="remote-enter" class="secondary">Return</button><button id="remote-tab" class="secondary">Tab</button><button id="remote-escape" class="secondary">Escape</button><button id="remote-backspace" class="secondary">Backspace</button></div>`,
    );
    on("send-text", () => {
      for (const key of remoteTextKeys(value("remote-text"))) sendKeys([key]);
      (document.getElementById("remote-text") as HTMLTextAreaElement).value = "";
      prompt.close();
      display.focus();
    });
    for (const name of ["enter", "tab", "escape", "backspace"]) {
      on(`remote-${name}`, () => { sendKeys(shortcuts[name]); prompt.close(); });
    }
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
    if (native?.toggleFullscreen) await native.toggleFullscreen();
    else if (document.fullscreenElement) await document.exitFullscreen();
    else await modal.requestFullscreen();
    display.focus();
  });
  const sound = document.getElementById("sound")!;
  const audioContext = session.protocol === "rdp"
    ? Guacamole.AudioContextFactory.getAudioContext() : null;
  sound.hidden = !audioContext;
  const soundState = () => {
    if (!modal.isConnected || !audioContext) return;
    sound.textContent = audioContext.state === "running" ? "Mute sound" : "Enable sound";
    sound.setAttribute("aria-pressed", String(audioContext.state === "running"));
  };
  audioContext?.addEventListener("statechange", soundState);
  soundState();
  modal.addEventListener("close", () => audioContext?.removeEventListener("statechange", soundState));
  on("sound", async () => {
    if (audioContext?.state === "running") await audioContext.suspend();
    else await audioContext?.resume();
    soundState();
  });
  on("mic", () => {
    if (recorder) { recorder.stop(); recorder = null; return; }
    const micButton = document.getElementById("mic")!;
    recorder = startMicrophone(client, {
      state: (state) => {
        if (!modal.isConnected) return;
        micButton.textContent = state === "starting" ? "Cancel microphone"
          : state === "waiting" ? "Microphone ready"
          : state === "active" ? "Mute microphone" : "Enable microphone";
        micButton.title = state === "waiting"
          ? "Waiting for a remote application to record audio. Click to disable."
          : "";
        if (state === "stopped") recorder = null;
      },
      error: (message) => { if (modal.isConnected) notify(message, true); },
    }, {
      getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
      createContext: () => new AudioContext({ sampleRate: 44100 }),
      createNode: (context) => new AudioWorkletNode(context, "speck-microphone", {
        channelCount: 1, channelCountMode: "explicit", numberOfInputs: 1, numberOfOutputs: 1,
      }),
      createWriter: (stream) => new Guacamole.ArrayBufferWriter(stream),
    });
  });
  client.connect("");
  display.focus();
}
async function renderRestoreCleanup() {
  const host = document.getElementById("restore-cleanup");
  if (!host) return;
  const state = await api("/slide/restored-devices");
  if (!host.isConnected) return;
  const current = state.instances.filter((r: Item) => !r.archived);
  const retired = state.instances.filter((r: Item) => r.archived);
  host.innerHTML = `<div class="section-head"><div><h3>Restored machine cleanup</h3><p>Speck tracks Slide restore identities and automatically archives offline copies after Slide confirms deletion twice, at least five minutes apart. Stopped VMs remain in Fleet; original machines and retained history are preserved.</p><small>${current.length} tracked · ${retired.length} archived${state.last_sync?.checked_at ? " · Last checked " + date(state.last_sync.checked_at) : " · Waiting for first check"}</small></div><button id="sync-restores" class="secondary">Check now</button></div>${state.last_sync?.error || state.last_sync?.errors?.length ? '<p class="callout">Slide could not verify every restore. Unconfirmed entries remain in Fleet; the next check will retry.</p>' : ""}${state.last_sync?.pending?.length ? `<p>${state.last_sync.pending.length} removed restore(s) awaiting offline/grace checks.</p>` : ""}${role === "admin" ? `<label class="check"><input id="auto-archive-restores" type="checkbox" ${state.enabled ? "checked" : ""}> Automatically archive removed Slide restores</label>` : `<p>Automatic archiving is ${state.enabled ? "on" : "off"}.</p>`}`;
  on("sync-restores", async () => {
    const button = document.getElementById(
      "sync-restores",
    ) as HTMLButtonElement;
    button.disabled = true;
    try {
      const result = await api("/slide/restored-devices/sync", "POST");
      notify(
        `${result.linked.length} linked; ${result.archived.length} archived; ${result.pending.length} awaiting confirmation.`,
      );
      await renderRestoreCleanup();
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  });
  if (role === "admin")
    on("auto-archive-restores", async () => {
      const input = document.getElementById(
        "auto-archive-restores",
      ) as HTMLInputElement;
      try {
        await api("/slide/restored-devices/settings", "PUT", {
          enabled: input.checked,
        });
      } catch (e) {
        input.checked = !input.checked;
        throw e;
      }
    });
}
async function renderSlide() {
  loading("Loading Slide…");
  const cfg = await api("/slide/connection");
  if (!cfg.connected) {
    content(
      '<div class="empty"><h2>Connect your Slide account.</h2><p>Add an API token in Settings to see live backup and recovery data.</p><a class="primary" href="#settings">Open settings →</a></div>',
    );
    return;
  }
  content(
    `<div class="section-head"><div><h2>Slide inventory</h2><p>${esc(cfg.url)}</p></div><select id="slide-resource" aria-label="Slide resource type"><option value="agent">Protected systems</option><option value="device">Slide appliances</option><option value="snapshot">Snapshots + verification</option><option value="backup">Backup jobs</option><option value="network">Recovery networks</option><option value="restore/virt">Restored virtual machines</option><option value="restore/file">File restores</option><option value="restore/image">Image exports</option></select></div><article id="restore-cleanup" class="panel"></article><div id="slide-data"></div>`,
  );
  await renderRestoreCleanup();
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
  loading("Loading recovery lab…");
  const [plans, runs, devices] = await Promise.all([
    api("/recovery/plans"),
    api("/recovery/runs"),
    api("/devices"),
  ]);
  fleet = devices;
  content(
    `<div class="recovery-banner"><div><h2>Recovery tests</h2><p>Capture proof → back up → restore together → compare.</p></div><button id="new-plan" class="primary">${icon("plus")} New recovery plan</button></div><div class="section-head"><div><h2>Your recovery plans</h2><p>Each run creates a shared, isolated network for its restored machines.</p></div></div><div class="plan-grid">${plans.map((p: Item) => `<article class="plan"><span class="eyebrow">RECOVERY PLAN</span><h2>${esc(p.name)}</h2><p>${p.spec.members.length} systems · ${esc(p.spec.router_prefix)}</p><button data-run="${p.id}" class="primary">Run recovery test →</button><details><summary>View plan</summary><pre>${pretty(p.spec)}</pre></details></article>`).join("") || '<div class="empty"><h3>No recovery plans</h3><p>Link devices to their Slide agent IDs, then define application checks.</p></div>'}</div><div class="section-head"><h2>Runs & evidence</h2><button id="refresh-runs" class="secondary">Refresh</button></div>${runs.map((r: Item) => `<details class="provider" ${r.status === "stopped" ? "" : "open"}><summary><b>${esc(r.state.name)}</b>${badge(r.status, r.status === "passed")}<small>${date(r.created)}</small></summary><div class="run-phase">${esc(r.phase.replaceAll("_", " "))}</div>${r.state.error ? `<div class="callout">${esc(r.state.error)}</div>` : ""}${recoveryEvidence(r)}<div class="toolbar">${r.status === "awaiting_clones" ? `<button data-verify="${r.id}" class="primary">Verify restored machines</button>` : ""}${r.status !== "running" && r.status !== "stopped" ? `<button data-stop="${r.id}" class="secondary">Stop restored VMs</button>` : ""}</div></details>`).join("")}`,
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
  loading("Loading job history…");
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
  loading("Loading settings…");
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
  if (role === "admin") {
    const updates = await api("/agent-updates");
    document
      .querySelector(".settings-grid")!
      .insertAdjacentHTML(
        "beforeend",
        `<article class="panel"><span class="eyebrow">AGENT UPDATES</span><h2>Automatic updates</h2><p>Keep Windows and Linux agents current with verified, signed releases. Updates wait for commands and remote sessions to finish.</p><label class="check"><input id="agent-updates-enabled" type="checkbox" ${updates.enabled ? "checked" : ""}> Automatically update agents</label><p>${updates.version ? `Published agent: <strong>${esc(updates.version)}</strong>` : "No agent release published yet."}</p><p>Agents reconnect after a brief service restart. If the new agent cannot reconnect, Speck attempts to restore the previous version.</p><button id="save-agent-updates" class="secondary">Save update policy</button><p>${(updates.devices || []).filter((d: Item) => d.status === "installing").length} updating · ${(updates.devices || []).filter((d: Item) => ["failed", "rollback_failed"].includes(d.status)).length} need attention</p></article>`,
      );
    on("save-agent-updates", async () => {
      await api("/agent-updates", "PUT", {
        enabled: (
          document.getElementById("agent-updates-enabled") as HTMLInputElement
        ).checked,
      });
      notify("Agent update policy saved");
    });
  }
  await ops.settingsPanel();
  await management.settingsPanel();
  if (role !== "admin") {
    for (const id of ["save-slide", "save-ai"])
      document.getElementById(id)?.setAttribute("disabled", "");
  }
}
window.addEventListener("hashchange", () => {
  if (username) render();
  else signedOut();
});
setInterval(async () => {
  if (
    !username ||
    !fleetCache ||
    polling ||
    page !== "fleet" ||
    remote ||
    document.querySelector("dialog:modal") ||
    ["fleet-search", "fleet-filter", "fleet-os", "fleet-sort"].includes(
      document.activeElement?.id || "",
    )
  )
    return;
  polling = true;
  try {
    fleet = await api("/devices");
    fleetCache = fleet;
    if (document.getElementById("fleet-rows")) renderFleetRows();
    refreshOpenMachine();
  } catch {
  } finally {
    polling = false;
  }
}, 15000);
setInterval(() => {
  if (username) void management.updateIndicator().catch(() => {});
}, 30000);
app.innerHTML = `<main class="boot-loading">${loadingState("Opening Speck…")}</main>`;
api("/auth/me")
  .then(async (r) => {
    csrf = r.csrf;
    username = r.username;
    role = r.role;
    await render();
  })
  .catch((err) => { if (!(err instanceof StaleViewError)) signedOut(); });

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
