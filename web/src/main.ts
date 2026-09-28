import {createCustomerWorkspaces} from "./customer-workspaces";
import {createMaintenance} from "./maintenance";
import {configureMetrics,clearMetrics,measureJourney,qualityPage,startJourney} from "./ux-quality";
import { serviceStartup } from "./inspection-model";
import { resourceHref } from "./resource-navigation";
import {mountBackupCoverage} from "./backup-coverage";
import {createRecoveryInspection,recoveryReadiness} from "./recovery-inspection";
import { createCommandPalette } from "./command-palette";
import { listWorkspace, clearListViews } from "./list-workspace";
import { createMachineInspection } from "./machine-inspection";
import { mountFiles } from "./file-workbench";
import { backupEvidence } from "./backup-evidence";
import { detailFacts, detailSection, detailDate, technicalDetail } from "./resource-story";
import { bindResourceNavigation, rememberResource, registerResource, restoreResource, clearResourceHistory, currentResource } from "./resource-navigation";
import { createRunDetails } from "./run-detail";
import {mountProviderExplorer} from "./provider-explorer";
import { columns, defaultPreferences, hasEndpoint, hasAgent, selectableMachine, machineState, agentLabel, kindLabel, cpu, memory, sortMachines } from "./fleet-model";
import { editColumns } from "./fleet-columns";
import { fleetToolbar, bindFleetPopovers, updateFilterChips } from "./fleet-toolbar";
import { bindFleetHeaders, reorderedColumns } from "./fleet-headers";
import { available as passkeysAvailable, ceremony as passkeyCeremony, encode as encodePasskey } from "./passkeys";
import { createInfrastructure } from "./infrastructure";
import { createHome } from "./home";
import { createReadCache, readPolicy } from "./read-cache";
import { createFlyout } from "./flyout";
import { slideStory, slideName, slideKinds, detailStatus } from "./resource-story";
import { createNetwork } from "./network";
import { createKeys } from "./keys";
import { createApiAccess } from "./api-access";
import { launchVm } from "./vm-launch";
import { integrationDirectory, integrationSettings } from "./integrations";
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
import { startResponsive } from "./responsive";
import "./responsive.css";

const viewScope = createViewScope();

type Item = Record<string, any>;
const app = document.querySelector<HTMLDivElement>("#app")!;
let csrf = "",
  username = "",
  role = "viewer",
  page = "home",
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
let fleetPrefs = defaultPreferences(), fleetPrefsLoaded = false, fleetCoverage = "all";
let fleetSources: Item[] = [];
let fleetInteractionsCleanup = () => {};
let preferencesSave = Promise.resolve();
function saveFleetPreferences() {
  const snapshot = structuredClone(fleetPrefs), owner = username, session = csrf;
  preferencesSave = preferencesSave.catch(() => {}).then(() => {
    if (username === owner && csrf === session) return api("/fleet/preferences", "PUT", snapshot);
  }).catch((error) => {
    if (!(error instanceof StaleViewError) && username === owner && csrf === session) notify("Could not save Fleet preferences. Try again.");
  });
}
async function loadFleet(force = false, fresh = false) {
  const [result, prefs] = await Promise.all([api("/fleet?compact=true" + (force ? "&refresh=true" : ""), "GET", undefined, undefined, true, fresh), fleetPrefsLoaded ? Promise.resolve(null) : api("/fleet/preferences")]);
  if (prefs) { fleetPrefs = { ...defaultPreferences(), ...prefs }; fleetPrefsLoaded = true; fleetCoverage = fleetPrefs.agent_filter; fleetSort = prefs.sort; showPreviews = prefs.visible.includes("preview"); }
  fleetSources = result.connections;
  fleet = result.machines;
  fleetCache = fleet;
}
function activeColumns() { return fleetPrefs.order.filter(k => fleetPrefs.visible.includes(k) && (k !== "preview" || role !== "viewer")); }
function fleetHeaders() {
  return `<th><input id="select-page" type="checkbox" aria-label="Select machines on this page"></th>${activeColumns().map(k => `<th scope="col" data-column="${k}" class="${k === "name" ? "machine-head" : ""}" style="width:${fleetPrefs.widths[k] || columns[k].width}px" aria-sort="${fleetPrefs.sort === k ? fleetPrefs.direction === "asc" ? "ascending" : "descending" : "none"}"><button data-sort-column="${k}" aria-describedby="fleet-header-help" title="Click to sort · Drag to reorder"><span class="header-label">${columns[k].label}</span><span class="header-sort">${icon(fleetPrefs.sort === k ? fleetPrefs.direction === "asc" ? "sortUp" : "sortDown" : "sort")}</span><span class="header-grip">${icon("grip")}</span></button></th>`).join("")}<th class="fleet-actions-head" scope="col">Connect</th>`;
}
function editFleetColumns() {
  document.getElementById("fleet-view-panel")?.hidePopover();
  editColumns(fleetPrefs, (title, html, options) => {
    const d = dialog(title, html, options);
    d.addEventListener("close", () => document.getElementById("fleet-view")?.focus({preventScroll:true}));
    return d;
  }, draft => {
    fleetPrefs = draft;
    fleetSort = draft.sort;
    showPreviews = draft.visible.includes("preview");
    saveFleetPreferences();
    drawFleet();
    document.getElementById("fleet-view")?.focus({ preventScroll: true });
  });
}
let activeDevicePanel: HTMLDialogElement | null = null;
let fleetScroll = { x: 0, y: 0, table: 0 };
function clearFleetState() {
  signInStarted=null;pageFailed.clear();
  clearMetrics(); clearResourceHistory(); clearListViews(); home.reset(); commandPalette.reset();
  readCache.clear();
  pageReads.clear();
  document.querySelectorAll<HTMLDialogElement>('dialog').forEach(d => { d.close(); d.remove(); });
  network.reset(); infrastructure.reset();
  reachMap = null;
  fleetInteractionsCleanup();
  activeDevicePanel?.close();
  activeDevicePanel?.remove();
  activeDevicePanel = null;
  selected = "";
  fleet = [];
  fleetCache = null;
  fleetPrefs = defaultPreferences(); fleetPrefsLoaded = false; fleetCoverage = "all"; fleetSources = [];
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

const readCache = createReadCache((path, signal) => requestApi(path, "GET", undefined, signal));
let pageReads = new Map<string, number>();
let staleMeasured=false;
let pageFailed=new Set<string>();
let signInStarted:number|null=null;
let pendingReads = new Map<Map<string,number>,number>();
function freshness() {
  const el = document.getElementById("page-freshness");
  if (!el) return;
  if (pendingReads.get(pageReads) || document.querySelector("#content .loading-state")) { el.textContent = "Loading sources…"; return; }
  if(pageFailed.size){el.innerHTML='Some sources unavailable · available evidence retained <button class="text-link" id="retry-page-sources">Retry</button>';document.getElementById("retry-page-sources")!.onclick=()=>void render(true);return;}
  const states = [...pageReads].map(([path, used]) => ({...readCache.state(path), used})).filter(s => s.at);
  if (!states.length) { el.innerHTML = ""; return; }
  const failed = states.some(s => s.failed), expired = states.some(s => s.expired), pending = states.some(s => s.pending), changed = states.some(s => s.revision! > s.used);
  if((failed || expired) && !staleMeasured){staleMeasured=true;measureJourney("stale_evidence",page,0,failed?"failed":"unknown");}
  const seconds = Math.max(0, Math.floor((Date.now() - Math.min(...states.map(s => s.at!))) / 1000));
  const age = seconds < 5 ? "just now" : seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)}m ago`;
  el.dataset.state = failed ? "failed" : pending ? "updating" : "ready";
  el.innerHTML = `${failed ? 'Saved data · refresh failed' : pending ? 'Saved data · updating in background' : expired ? 'Saved data · refresh needed' : changed ? 'Updated data is ready' : 'Loaded '+age}${failed || expired || changed ? ' <button class="text-link" id="show-latest">'+(failed ? 'Retry' : expired ? 'Refresh' : 'Show latest')+'</button>' : ''}`;
  document.getElementById("show-latest")?.addEventListener("click", () => void render(failed || expired));
}
readCache.subscribe(freshness);
setInterval(freshness, 15000);
const flyout = createFlyout(dialog);
const freshApi = (path: string) => api(path, "GET", undefined, undefined, true, true);
async function api(path: string, method = "GET", body?: any, signal?: AbortSignal, scoped = true, fresh = false): Promise<any> {
  const current = scoped ? viewScope.checkpoint() : () => {};
  const reads = pageReads;
  if (method === "GET") { pendingReads.set(reads,(pendingReads.get(reads)||0)+1); freshness(); }
  if (fresh && /^\/dns\/domains\/[^/]+\/records$/.test(path)) readCache.invalidate(path+"?cached=true");
  if (method === "GET" && /^\/keys\/[^/?]+(?:\/env)?$/.test(path) && !/^\/keys\/(services|system-targets)$/.test(path)) readCache.invalidate('/keys');
  // Console creation/cleanup changes only an ephemeral session, not inventory.
  const mutates = method !== "GET" && path !== "/fleet/preferences" && !/^\/(remote\/sessions\/|infrastructure\/connections\/[^/]+\/console$)/.test(path);
  if (mutates) readCache.clear();
  try {
    const policy = method === "GET" && username ? readPolicy(path) : null;
    const cached = policy !== null && !fresh ? readCache.peek(path) : undefined;
    const result = policy !== null ? await readCache.read(path, {signal, fresh}) : await requestApi(path, method, body, signal);
    current(); if(reads===pageReads)pageFailed.delete(path);
    if (policy !== null && reads === pageReads) {
      reads.set(path, cached?.revision ?? readCache.state(path).revision ?? 0);
      freshness();
    }
    return result;
  } catch (error) { current();if(method==="GET"&&reads===pageReads)pageFailed.add(path);throw error; }
  finally { if (method === "GET") { const count=(pendingReads.get(reads)||1)-1;if(count)pendingReads.set(reads,count);else pendingReads.delete(reads);freshness(); } if (mutates) readCache.clear(); }
}
async function requestApi(path: string, method = "GET", body?: any, signal?: AbortSignal): Promise<any> {
  const owner = csrf;
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
  });
  const value = await r.json().catch(() => ({}));
  if (owner !== csrf) throw new StaleViewError();
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
const STALE_VIEW = new StaleViewError().message;
// Phones collapse machine identity to one line; the choice to expand it holds while panes refresh.
let machineDetailsOpen = false;
function notify(message: string, error = false) {
  // A response for a page that is no longer shown is expected, not an error to report.
  if (error && message === STALE_VIEW) return;
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
    signInStarted=performance.now();
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

// Navigation grouped by purpose; the first group is the everyday view.
const NAV_GROUPS: [string, [string, string, string][]][] = [
  ["", [["home", "home", "Home"], ["fleet", "fleet", "Fleet"], ["workspaces","globe","Customers & sites"], ["alerts", "alerts", "Alerts"]]],
  ["Automation", [["maintenance","calendar","Maintenance"], ["schedules", "calendar", "Schedules"], ["patches", "patch", "Patches"], ["software", "package", "Software & scripts"]]],
  ["Infrastructure", [["infrastructure", "network", "Infrastructure"], ["network", "globe", "Network & DNS"], ["slide", "slide", "Slide"], ["recovery", "recovery", "Recovery lab"]]],
  ["Administration", [["keys", "key", "Keys"], ["api", "code", "API & agents"], ["activity", "history", "Activity"], ["quality","history","UX reliability"], ["settings", "settings", "Settings"], ["downloads", "download", "Downloads"]]],
];
// Pages without live data have nothing to refresh.
const STATIC_PAGES = ["assistant", "downloads", "settings", "account"];
// Short labels for the tablet rail; phones show the first four primary pages in a tab bar.
const RAIL_LABELS: Record<string, string> = { software: "Software", assistant: "AI", infrastructure: "Infra", network: "Network", recovery: "Recovery", api: "API" };
const PRIMARY_PAGES = ["home", "fleet", "alerts", "infrastructure"];
function shell(title: string, subtitle: string) {
  fleetInteractionsCleanup();
  document.body.dataset.role = role;
  document.body.dataset.workspacePage = page;
  const allowed = ([id]: [string, string, string]) => role !== "viewer" || ["home", "fleet", "alerts", "activity", "downloads", "settings"].includes(id);
  const navButton = ([id, symbol, label]: [string, string, string]) =>
    `<button aria-label="${esc(label)}" data-page="${id}" class="${page === id ? "active" : ""}" ${page === id ? 'aria-current="page"' : ""}>${icon(symbol as Parameters<typeof icon>[0])}<span>${label}</span>${RAIL_LABELS[id] ? `<span class="rail-label" aria-hidden="true">${RAIL_LABELS[id]}</span>` : ""}</button>`;
  const groups = NAV_GROUPS.map(([group, items]) => {
    const visible = items.filter(allowed);
    return visible.length ? `<div class="nav-group">${group ? `<span class="nav-label">${group}</span>` : ""}${visible.map(navButton).join("")}</div>` : "";
  }).join("");
  const everyPage = NAV_GROUPS.flatMap(([, items]) => items).filter(allowed);
  const primary = [...everyPage.filter(([id]) => PRIMARY_PAGES.includes(id)), ...everyPage.filter(([id]) => !PRIMARY_PAGES.includes(id))].slice(0, 4);
  const inMore = !primary.some(([id]) => id === page);
  app.innerHTML = `<a class="skip-link" href="#content">Skip to content</a><aside><a class="brand" href="#home" aria-label="Speck home">${wordmark(true)}<img class="brand-mark" src="/assets/brand/speck-mark-lime.svg" alt="" width="28" height="28"><span class="version">0.2</span></a><nav aria-label="Main navigation">${groups}</nav><div class="side-note"><span class="eyebrow">A LITTLE LIGHTWEIGHT RMM</span></div><button id="logout" class="account"><b>${esc(username.slice(0, 1).toUpperCase())}</b><span>${esc(username)}<small>Sign out</small></span>${icon("logout")}</button></aside><main class="workspace ${page === "fleet" ? "fleet-workspace" : ""}"><header><div class="page-heading"><h1>${esc(title)}</h1>${page === "fleet" ? '<div id="fleet-summary" class="fleet-summary" aria-label="Fleet totals"></div>' : '<div id="page-summary" class="fleet-summary page-summary" aria-label="Summary"></div>'}${subtitle ? `<p>${esc(subtitle)}</p>` : ""}<div id="page-freshness" class="page-freshness" role="status" aria-live="polite"></div></div><div class="header-actions"><button id="workspace-search" class="secondary icon-button" aria-label="Search workspace" title="Search workspace (Ctrl / ⌘ K)">${icon("search")}</button><div class="page-actions">${page === "fleet" ? `<button id="add" class="primary">${icon("plus")}<span>Add device</span></button>` : ""}</div>${STATIC_PAGES.includes(page) ? "" : `<button id="refresh" class="secondary icon-button" aria-label="Refresh" title="Refresh">${icon("refresh")}</button>`}</div></header><section id="content" tabindex="-1"></section></main><nav class="tabbar" aria-label="Primary navigation">${primary.map(navButton).join("")}<button id="more-open" class="${inMore ? "active" : ""}" aria-haspopup="dialog" ${inMore ? 'aria-current="page"' : ""}>${icon("more")}<span>More</span></button></nav><dialog class="more-sheet" id="more-sheet" aria-label="All pages" tabindex="-1"><div class="more-head"><span class="brand">${wordmark(true)}</span><button class="sheet-close" id="more-close" aria-label="Close">${icon("close")}</button></div><nav aria-label="All pages">${groups}</nav><div class="more-account"><span><b>${esc(username)}</b><small>${esc(role)}</small></span><button class="secondary" data-page="account">Account & access</button><button class="secondary" id="more-logout">${icon("logout")}<span>Sign out</span></button></div></dialog>`;
  const workspace=new URLSearchParams(location.hash.split("?")[1] || "").get("workspace");
  if(workspace&&page!=="workspaces"){
    const context=document.createElement("p");context.className="workspace-context resource-note";
    context.innerHTML='<a href="#workspaces?workspace='+encodeURIComponent(workspace)+'">Return to customer workspace →</a> · This page shows global inventory.';
    app.querySelector('main > header')!.after(context);
  }
  on("workspace-search",()=>commandPalette.open());
  const sheet = document.getElementById("more-sheet") as HTMLDialogElement;
  document.getElementById("more-open")!.onclick = () => {
    sheet.showModal();
    sheet.focus({ preventScroll: true });
  };
  document.getElementById("more-close")!.onclick = () => sheet.close();
  sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.close(); });
  app.querySelectorAll<HTMLElement>("nav [data-page], .more-account [data-page]").forEach(
    (el) =>
      (el.onclick = () => {
        (document.getElementById("more-sheet") as HTMLDialogElement | null)?.close();
        const workspace=new URLSearchParams(location.hash.split("?")[1] || "").get("workspace");
        location.hash = el.dataset.page!+(workspace?"?workspace="+encodeURIComponent(workspace):"");
      }),
  );
  document.querySelector<HTMLAnchorElement>(".skip-link")!.onclick = (e) => {
    e.preventDefault();
    document.getElementById("content")!.focus();
  };
  // Keep the current page visible in the sidebar or rail when it scrolls.
  app.querySelector<HTMLElement>("aside > nav .active")?.scrollIntoView({ block: "nearest" });
  const logout = async () => {
    await api("/auth/logout", "POST");
    history.replaceState(null, "", "#signin");
    login();
  };
  on("logout", logout);
  on("more-logout", logout);
  on("refresh", () => render(true));
  if (page === "fleet") on("add", enrollmentDialog);
}
function content(html: string) {
  if(page!=="home" && !html.includes('class="loading-state') && !html.includes('role="alert"')) usefulContent();
  const el = document.getElementById("content");
  if (!el) return;
  fleetInteractionsCleanup();
  el.innerHTML = html;
  el.setAttribute("aria-busy", "false");
  // Page-level primary actions live in the header, left of refresh, on every page.
  const actions = document.querySelector<HTMLElement>(".workspace > header .page-actions");
  actions?.querySelectorAll("[data-page-action]").forEach((node) => node.remove());
  const lifted = [...el.querySelectorAll<HTMLElement>("[data-page-action]")];
  if (lifted.length) actions?.prepend(...lifted);
  // Phones show primary page actions; secondary ones move behind one "More actions" button.
  document.getElementById("page-more")?.remove();
  const secondary = lifted.filter((node) => node.classList.contains("secondary"));
  if (secondary.length && actions?.parentElement) {
    const more = document.createElement("button");
    more.id = "page-more";
    more.className = "secondary icon-button page-more";
    more.setAttribute("aria-label", "More actions");
    more.title = "More actions";
    more.innerHTML = icon("more");
    more.onclick = () => {
      const sheet = dialog("Actions", `<div class="action-list">${secondary.map((node, i) => `<button class="secondary" data-action-index="${i}">${esc(node.textContent?.trim() || "")}</button>`).join("")}</div>`);
      sheet.querySelectorAll<HTMLButtonElement>("[data-action-index]").forEach((b) => (b.onclick = () => { sheet.close(); secondary[Number(b.dataset.actionIndex)].click(); }));
    };
    actions.parentElement.insertBefore(more, document.getElementById("refresh"));
  }
}
function summary(html: string) {
  const el = document.getElementById("page-summary");
  if (el) el.innerHTML = html;
}
function loadError(error: unknown) {
  return `<div class="empty" role="alert"><h2>Unable to load</h2><p>${esc((error as Error).message)}</p><p>Use Refresh to try again.</p></div>`;
}
function loading(label: string) {
  viewScope.reset();
  content(loadingState(label));
  document.getElementById("content")?.setAttribute("aria-busy", "true");
}
async function render(manualRefresh = false) {
  journeyStarted=performance.now();firstContent=false;
  const started=journeyStarted;
  const initialInspection = JSON.stringify(currentResource());
  if (manualRefresh) readCache.clear();
  pageReads = new Map(); staleMeasured=false;pageFailed=new Set();
  if (page === "fleet" && document.getElementById("fleet-rows")) {
    fleetScroll = { x: scrollX, y: scrollY, table: document.querySelector(".fleet-table-wrap")!.scrollLeft };
  }
  viewScope.reset();
  disconnect();
  document
    .querySelectorAll<HTMLDialogElement>("dialog")
    .forEach((d) => d.close());
  if (location.hash.startsWith("#desktop-signin/")) { await desktopSignIn(); return; }
  page = location.hash.slice(1) || "home";
  if (page.startsWith("remote/")) {
    const [id, query = ""] = page.slice(7).split("?");
    const mode = new URLSearchParams(query).get("mode") || "auto";
    await renderRemotePage(id, 0, mode);
    return;
  }
  page = page.split("?")[0];
  if (
    ![
      "home",
      "workspaces", "maintenance", "quality",
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
      "infrastructure",
      "network",
      "keys",
      "api",
      "activity",
      "settings",
      "downloads",
    ].includes(page)
  )
    page = "home";
  const titles: Record<string, string[]> = {
    home: ["Home", ""],
    workspaces:["Customers & sites",""],maintenance:["Maintenance","Reviewed routines and reusable runbooks."],quality:["UX reliability",""],
    fleet: ["Fleet", ""],
    alerts: ["Alerts", "Health checks from every agent. Expand an alert for evidence and review actions."],
    schedules: ["Schedules", "Reviewed scans and templates that run on a schedule."],
    account: ["Account & access", ""],
    jobs: ["Job history", "Commands and operations sent to endpoint agents."],
    patches: ["Patches", "Scan machines, review available updates and install what you choose."],
    software: ["Software & scripts", ""],
    assistant: ["AI assistant", ""],
    recovery: ["Recovery lab", "Capture proof → back up → restore together → compare."],
    slide: ["Slide", ""],
    infrastructure: ["Infrastructure", "Hosts, guests, cloud instances and backup appliances."],
    network: ["Network & DNS", "Domains, public IPs and LAN hosts, joined to the machines they reach."],
    keys: ["Keys", "Project credentials sealed with the server key. Every reveal is recorded in Activity."],
    api: ["API & agents", "Give Claude, scripts and CI scoped access to machines, infrastructure, DNS, public IPs and the key vault."],
    activity: ["Activity", "Every sign-in, change and remote session, with who did it and when."],
    settings: ["Settings", ""],
    downloads: ["Downloads", ""],
  };
  shell(...(titles[page] as [string, string]));
  try {
    await {
      home: home.render,
      workspaces:customers.render,maintenance:maintenance.render,quality:()=>{loading("Loading UX reliability…");return qualityPage({api,content});},
      fleet: () => renderFleet(manualRefresh),
      alerts: management.renderAlerts,
      schedules: management.renderSchedules,
      account: management.renderAccount,
      jobs: renderJobs,
      patches: ops.renderPatches,
      software: ops.renderSoftware,
      assistant: ops.renderAssistant,
      recovery: renderRecovery,
      slide: renderSlide,
      infrastructure: infrastructure.render,
      network: network.render,
      keys: keys.render,
      api: apiAccess.render,
      activity: management.renderAudit,
      settings: renderSettings,
      downloads: () => content(desktopDownloads(true)),
    }[page]!();
    if (page === "home" && focusHomeCommand) {
      focusHomeCommand = false;
      document.getElementById("home-query")?.focus();
    }
    if (initialInspection !== "null" && initialInspection === JSON.stringify(currentResource())) await restoreResource();
    if(started===journeyStarted) measureJourney("enrichment",page,performance.now()-started);
    void management.updateIndicator().catch(() => {});
  } catch (err) {
    if (!(err instanceof StaleViewError) && username && started===journeyStarted) {measureJourney("enrichment",page,performance.now()-journeyStarted,"failed"); content(loadError(err));}
  }
}
const machineInspection = createMachineInspection({api,flyout,dialog,notify,showJob:(id:string)=>runDetails.job(id),openDevice,openNetwork:(d:Item)=>network.showMachine(d)});
const recoveryInspection=createRecoveryInspection({api,flyout});
const runDetails = createRunDetails({api, flyout, openDevice, role: () => role, notify});
registerResource("machine", async ref => { await loadFleet(); await openDevice(ref.id, ref.tab || "overview"); });
const ops = createOperations({
  api, flyout, showBatch: runDetails.batch, showJob: runDetails.job, role: () => role, newSchedule: (seed:Item) => management.newSchedule(seed),
  summary,
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
  setScript: (script: string, context?: Item) => {
    const editor = document.getElementById("script") as HTMLTextAreaElement;
    if (editor) {
      editor.value = script;
      if (context) editor.insertAdjacentHTML("beforebegin", `<aside class="callout ai-command-context"><strong>${esc(context.title)}</strong>${context.caution ? `<p>${esc(context.caution)}</p>` : ""}<p><b>Verify after running:</b> ${esc(context.verification)}</p><small>The alert stays open until recovery is observed or the job outcome is marked reviewed.</small></aside>`);
    }
  },
});
const infrastructure = createInfrastructure({api, freshApi, flyout, summary, resourceInventory: () => fleet.flatMap(m => m.resources || []), sessionApi: (path: string, method: string, body?: any) => api(path, method, body, undefined, false), esc, on, value, notify, dialog, content, loading, badge, bytes, date, openDevice, role: () => role,
  newVm: () => launchVm({ api, esc, notify, dialog, loadingState, exposeHost: (ip: string, name: string) => network.exposeHost(ip, name) })});
const network = createNetwork({ api, freshApi, flyout, openMachine: async (id: string) => { if (!fleet.some(m => m.id === id)) await loadFleet(); await openDevice(id); }, summary, esc, notify, dialog, content, loading, badge, role: () => role, loadingState });
const keys = createKeys({ api, freshApi, flyout, openKeySystem: async (target: any) => {
  try {
    await loadFleet();
    const machine = fleet.find(m => m.id === target.device_id || m.id === target.id || (target.resource && m.resources?.some((r: any) => r.connection_id === target.resource.connection_id && r.kind === target.resource.kind && String(r.id) === String(target.resource.id))));
    if (!machine) { notify("This system is no longer in Fleet", true); return; }
    keys.closePane(); await openDevice(machine.id);
  } catch (error) { notify((error as Error).message, true); }
}, summary, esc, notify, dialog, content, loading, badge, role: () => role, loadingState });
const apiAccess = createApiAccess({ api, flyout, summary, esc, notify, dialog, content, loading, role: () => role, loadingState });
const management = createManagement({
  api, flyout, showBatch: runDetails.batch, showJob: runDetails.job,
  esc,
  badge,
  date,
  on,
  value,
  notify,
  dialog,
  content,
  loading,
  summary,
  openDevice,
  assistAlert: (device: Item, alert: Item, intent: "diagnose" | "fix") => ops.assistDialog(device, "", undefined, { alert, intent }),
  role: () => role,
  username: () => username,
  refresh: render,
});
const customers=createCustomerWorkspaces({api,content,loading,dialog,notify});
const maintenance=createMaintenance({api,content,loading,dialog,notify,newSchedule:(seed:Item)=>management.newSchedule(seed),showBatch:runDetails.batch});
configureMetrics(body=>username && role!=="viewer" ? requestApi("/ux/measurements","POST",body) : Promise.resolve());
let journeyStarted=performance.now(),firstContent=false;
function usefulContent(){if(!firstContent){firstContent=true;measureJourney("first_content",page,performance.now()-journeyStarted);}}
const home = createHome({
  api, esc, content, on, date, loading, dialog, useful:usefulContent,
  checkpoint: () => viewScope.checkpoint(), role: () => role, search:(query:string)=>commandPalette.open(query),
  newSchedule: () => management.newSchedule(),
  openNetwork: (machine: Item) => network.showMachine(machine),
  openMachine: async (machine: Item | undefined) => {
    if (!machine) return;
    fleet = [...fleet.filter(d => d.id !== machine.id), machine];
    await openDevice(machine.id);
  },
  assist: async (machine: Item, prompt: string) => {
    await ops.assistDialog(machine);
    const input = document.getElementById("ai-prompt") as HTMLTextAreaElement | null;
    if (input) { input.value = prompt; input.focus(); }
  },
});
async function renderFleet(manualRefresh = false) {
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
    if (manualRefresh && role !== "viewer") {
      try {
        const connection = await api("/slide/connection");
        if (connection.connected) {
          refresh.title = "Checking removed Slide restores…";
          const result = await api("/slide/restored-devices/sync", "POST");
          if (result.errors.length) {
            notify("Slide could not verify every restore. Unconfirmed machines remain in Fleet.", true);
          } else if (result.archived.length || result.pending.length) {
            notify(`${result.archived.length} removed Slide restore(s) archived; ${result.pending.length} awaiting confirmation.`);
          }
        }
      } catch (error) {
        if (error instanceof StaleViewError || !username) throw error;
        notify("Slide cleanup could not be checked. Refreshing Fleet inventory anyway.", true);
      }
    }
    await loadFleet(manualRefresh);
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
  const subset=new URLSearchParams(location.hash.split("?")[1] || "").get("coverage");
  if(subset && ["all","endpoints","connectors","candidates","missing","conflicts"].includes(subset)){fleetCoverage=subset;fleetFilter="all";fleetPlatform="all";fleetQuery="";fleetPage=0;const params=new URLSearchParams(location.hash.split("?")[1] || "");params.delete("coverage");history.replaceState(null,"",location.hash.split("?")[0]+(params.size?"?"+params:""));}
  const previousTable = document.querySelector<HTMLElement>(".fleet-table-wrap");
  if (previousTable) fleetScroll = { x: scrollX, y: scrollY, table: previousTable.scrollLeft };
  content(`${fleetToolbar(fleetPrefs, showPreviews, role === "viewer")}
  <p id="fleet-header-help" class="fleet-sr-only">Click to sort. Drag to reorder columns, or focus a heading and press Alt plus Left or Right.</p><p id="fleet-column-status" class="fleet-sr-only" role="status" aria-live="polite"></p>
  <div id="fleet-source-status" role="status"></div><div id="bulk-actions" class="bulk-actions"></div><div class="fleet-table-wrap"><table class="fleet-table unified-fleet" style="min-width:${activeColumns().reduce((n,k) => n + (fleetPrefs.widths[k] || columns[k].width), 122)}px"><thead><tr>${fleetHeaders()}</tr></thead><tbody id="fleet-rows"></tbody></table></div><div class="fleet-pagination"><span id="fleet-count"></span><div><button id="fleet-prev" class="secondary">Previous</button><button id="fleet-next" class="secondary">Next</button></div></div>`);
  (document.getElementById("fleet-search") as HTMLInputElement).value = fleetQuery;
  (document.getElementById("fleet-filter") as HTMLSelectElement).value = fleetFilter;
  (document.getElementById("fleet-os") as HTMLSelectElement).value = fleetPlatform;
  (document.getElementById("fleet-sort") as HTMLSelectElement).value = fleetSort;
  (document.getElementById("fleet-direction") as HTMLSelectElement).value = fleetPrefs.direction;
  (document.getElementById("fleet-agent") as HTMLSelectElement).value = fleetCoverage;
  const filterValues = () => ({"fleet-filter":fleetFilter,"fleet-os":fleetPlatform,"fleet-agent":fleetCoverage});
  const updateFilters = () => {
    fleetFilter = value("fleet-filter"); fleetPlatform = value("fleet-os"); fleetCoverage = value("fleet-agent");
    if (fleetPrefs.agent_filter !== fleetCoverage) {
      fleetPrefs.agent_filter = fleetCoverage; saveFleetPreferences();
    }
    (document.getElementById("fleet-agent-only") as HTMLInputElement).checked = fleetCoverage === "installed";
    fleetPage = 0;
    updateFilterChips(filterValues(), id => { (document.getElementById(id) as HTMLSelectElement).value = "all"; updateFilters(); });
    renderFleetRows();
  };
  updateFilterChips(filterValues(), id => { (document.getElementById(id) as HTMLSelectElement).value = "all"; updateFilters(); });
  on("fleet-agent-only", () => {
    (document.getElementById("fleet-agent") as HTMLSelectElement).value = (document.getElementById("fleet-agent-only") as HTMLInputElement).checked ? "installed" : "all";
    updateFilters();
  }, "change");
  on("fleet-clear-filters", () => {
    for (const id of Object.keys(filterValues())) if (id !== "fleet-agent" || fleetCoverage !== "installed") (document.getElementById(id) as HTMLSelectElement).value = "all";
    updateFilters();
  });
  for (const id of Object.keys(filterValues())) on(id, updateFilters, "change");
  on("fleet-search", () => { fleetQuery = value("fleet-search"); fleetPage = 0; renderFleetRows(); }, "input");
  on("fleet-columns", editFleetColumns);
  on("fleet-highlight", () => { fleetPrefs.highlight_agents = (document.getElementById("fleet-highlight") as HTMLInputElement).checked; saveFleetPreferences(); renderFleetRows(); }, "change");
  const updateSort = () => {
    document.querySelectorAll<HTMLElement>("th[data-column]").forEach(th => {
      const sorted = th.dataset.column === fleetSort;
      th.setAttribute("aria-sort", sorted ? fleetPrefs.direction === "asc" ? "ascending" : "descending" : "none");
      th.querySelector(".header-sort")!.innerHTML = icon(sorted ? fleetPrefs.direction === "asc" ? "sortUp" : "sortDown" : "sort");
    });
    (document.getElementById("fleet-sort") as HTMLSelectElement).value = fleetSort;
    (document.getElementById("fleet-direction") as HTMLSelectElement).value = fleetPrefs.direction;
    fleetPage = 0; saveFleetPreferences(); renderFleetRows();
  };
  document.querySelectorAll<HTMLButtonElement>("[data-sort-column]").forEach(el => el.onclick = () => {
    const key = el.dataset.sortColumn!;
    fleetPrefs.direction = fleetPrefs.sort === key && fleetPrefs.direction === "asc" ? "desc" : "asc";
    fleetPrefs.sort = fleetSort = key; updateSort();
  });
  on("fleet-sort", () => { fleetSort = fleetPrefs.sort = value("fleet-sort"); fleetPrefs.direction = ["cpu","memory","seen","agent"].includes(fleetSort) ? "desc" : "asc"; updateSort(); }, "change");
  on("fleet-direction", () => { fleetPrefs.direction = value("fleet-direction"); updateSort(); }, "change");
  on("fleet-previews", () => {
    showPreviews = (document.getElementById("fleet-previews") as HTMLInputElement).checked;
    fleetPrefs.visible = showPreviews ? [...new Set([...fleetPrefs.visible,"preview"])] : fleetPrefs.visible.filter(k => k !== "preview");
    saveFleetPreferences(); drawFleet();
    document.getElementById("fleet-view-panel")!.showPopover();
    document.getElementById("fleet-previews")?.focus();
  }, "change");
  const popoverCleanup = bindFleetPopovers();
  const headerCleanup = bindFleetHeaders(document.querySelector(".fleet-table-wrap")!, (key, index) => {
    fleetPrefs.order = reorderedColumns(fleetPrefs.order, activeColumns(), key, index);
    saveFleetPreferences();
    // Move actual cells instead of rebuilding the toolbar or losing scroll/selection.
    document.querySelectorAll(".unified-fleet tr").forEach(row => {
      const anchor = row.querySelector(".fleet-actions-head, .connect-cell");
      if (!anchor) return;
      for (const column of activeColumns()) {
        const cell = row.querySelector(`[data-column="${column}"]`);
        if (cell) row.insertBefore(cell, anchor);
      }
    });
    document.querySelector<HTMLButtonElement>(`[data-sort-column="${key}"]`)?.focus({preventScroll:true});
    document.getElementById("fleet-column-status")!.textContent = `${columns[key].label} moved to position ${index + 1} of ${activeColumns().length}.`;
  });
  fleetInteractionsCleanup = () => { popoverCleanup(); headerCleanup(); };
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
      .filter(selectableMachine)
      .forEach((d) =>
        checked ? fleetSelection.add(d.id) : fleetSelection.delete(d.id),
      );
    renderFleetRows();
  });
  document.getElementById("fleet-rows")!.addEventListener("click", (event) => {
    const target = event.target as Element;
    // Preserve checkboxes, quick actions, and text selection within a row.
    if (target.closest("button, a, input, select, textarea, label")) return;
    // The whole selection cell is the checkbox's touch target.
    const selectCell = target.closest("td.select-cell");
    if (selectCell) {
      selectCell.querySelector<HTMLInputElement>("input:not(:disabled)")?.click();
      return;
    }
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
    addresses[0] || d.addresses?.[0] || d.resources?.flatMap((r: Item) => r.addresses || [])[0] || "—";
}
function uptime(seconds: unknown) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return "Not reported";
  const minutes = Math.floor(seconds / 60), hours = Math.floor(minutes / 60), days = Math.floor(hours / 24);
  return days ? `${days}d ${hours % 24}h` : hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

function visibleFleet() {
  return sortMachines(fleet.filter(d =>
    `${d.label} ${d.hostname} ${d.client_name || ""} ${(d.clients || []).map((c: Item) => c.name).join(" ")} ${d.location || ""} ${d.provider || ""} ${(d.aliases || []).join(" ")} ${d.site || ""} ${(d.tags || []).join(" ")} ${d.platform} ${machinePresence(d).app?.title || ""} ${machinePresence(d).app?.process || ""} ${primaryAddress(d)}`.toLowerCase().includes(fleetQuery.toLowerCase()) &&
    (fleetPlatform === "all" || d.platform === fleetPlatform) &&
    (fleetCoverage === "endpoints" && selectableMachine(d) || fleetCoverage === "connectors" && hasAgent(d) && !hasEndpoint(d) || fleetCoverage === "candidates" && hasEndpoint(d) && !d.approved || fleetCoverage === "all" || fleetCoverage === "installed" && hasAgent(d) || fleetCoverage === "missing" && !hasAgent(d) || fleetCoverage === "conflicts" && (d.identity_issues?.length || d.client_conflict)) &&
    (fleetFilter === "all" || fleetFilter === "online" && ["online","running","active"].includes(machineState(d).toLowerCase()) || fleetFilter === "offline" && ["offline","stopped","off"].includes(machineState(d).toLowerCase()) || fleetFilter === "review" && (hasEndpoint(d) && !d.approved || d.identity_issues?.length || d.client_conflict))), fleetSort, fleetPrefs.direction, primaryAddress);
}
function renderFleetRows() {
  if(signInStarted!==null){measureJourney("signin_to_fleet","fleet",performance.now()-signInStarted);signInStarted=null;}
  fleetSelection.forEach((id) => {
    if (!fleet.some((d) => d.id === id && selectableMachine(d))) fleetSelection.delete(id);
  });
  const summary = document.getElementById("fleet-summary");
  if (summary) summary.innerHTML = `<button class="text-link" data-fleet-online><i class="status-dot"></i><b>${fleet.filter((d) => ["online","running","active"].includes(machineState(d).toLowerCase())).length}</b> online</button><button class="text-link" data-coverage-count="all"><b>${fleet.length}</b> discovered identities</button><button class="text-link" data-coverage-count="endpoints"><b>${fleet.filter(selectableMachine).length}</b> managed endpoints</button><button class="text-link" data-coverage-count="connectors"><b>${fleet.filter(d=>hasAgent(d)&&!hasEndpoint(d)).length}</b> host connectors</button><button class="text-link" data-coverage-count="candidates"><b>${fleet.filter(d=>hasEndpoint(d)&&!d.approved).length}</b> unapproved identities</button>`;
  summary?.querySelectorAll<HTMLElement>('[data-coverage-count]').forEach(b=>b.onclick=()=>{fleetCoverage=b.dataset.coverageCount!;fleetFilter='all';fleetPlatform='all';fleetQuery='';drawFleet();});
  summary?.querySelector<HTMLElement>("[data-fleet-online]")?.addEventListener("click",()=>{fleetCoverage="all";fleetFilter="online";fleetPlatform="all";fleetQuery="";drawFleet();});
  const sourceStatus = document.getElementById("fleet-source-status");
  if (sourceStatus) sourceStatus.innerHTML = fleetSources.filter(c => c.stale).map(c => `<p class="fleet-stale">${esc(c.name)}: ${esc(c.error)} ${c.checked_at ? "Last checked " + date(c.checked_at) : ""}</p>`).join("");
  document.querySelector(".fleet-table")?.classList.toggle("with-previews", showPreviews);
  const rows = visibleFleet();
  fleetPage = Math.max(0, Math.min(fleetPage, Math.ceil(rows.length / 50) - 1));
  const shown = rows.slice(fleetPage * 50, fleetPage * 50 + 50);
  document.getElementById("fleet-rows")!.innerHTML =
    shown
      .map((d) => {
        const os = d.telemetry?.host?.platform || d.platform;
        const status = machineState(d);
        const presence = machinePresence(d);
        const active = presence.app;
        const screenAction = `${d.remote_protocol === "shell" ? "Open web shell" : d.remote_protocol === "ssh" ? "Open SSH session" : "Screen control"} · ${d.label}`;
        const shellAction = `Run ${d.platform === "windows" ? "PowerShell" : "shell command"} · ${d.label}`;
        const none = '<span class="placeholder">—</span>';
        // Providers can report memory above 100% (ballooning); show the capped share and keep the raw value on hover.
        const usage = (value: any) => value != null && Number.isFinite(Number(value)) ? (Number(value) > 100 ? `<span title="${Number(value).toFixed(0)}% reported">100%</span>` : Number(value).toFixed(0) + "%") : none;
        const cells: Record<string,string> = {
          name: `<button data-device="${esc(d.id)}" class="machine-name" aria-expanded="false" aria-controls="machine-details" title="${esc(d.label)} · ${esc(os)}" aria-label="${esc(d.label)} — ${esc(os)}"><span class="platform-icon">${icon(d.platform === "windows" ? "windows" : d.platform === "linux" ? "linux" : "monitor")}</span><b>${esc(d.label)}</b>${d.restored_from ? '<span class="badge neutral copy-badge">Recovery copy</span>' : ''}</button>`,
          status: badge(status), client: `${d.client_name ? esc(d.client_name) : '<span class="placeholder">Unassigned</span>'}${d.client_conflict ? ' <span title="Conflicting client memberships">⚠</span>' : ''}`,
          agent: `<span class="agent-indicator ${hasAgent(d) ? "installed" : ""}">${hasAgent(d) ? "● " : "○ "}${esc(agentLabel(d))}</span>${d.identity_issues?.length ? ' <span title="Identity needs review">⚠</span>' : ''}`,
          location: d.location || d.site ? esc(d.location || d.site) : none, app: hasEndpoint(d) ? `<span title="${esc(active ? [active.title,active.process,active.user].filter(Boolean).join(" · ") : presence.desktop)}">${esc(presence.table)}</span>` : none,
          cpu: usage(cpu(d)), memory: usage(memory(d)), address: primaryAddress(d) === "—" ? none : esc(primaryAddress(d)), provider: esc(d.provider || "Speck"), kind: esc(kindLabel(d)), site: d.site ? esc(d.site) : none, seen: esc(date(d.last_seen)),
          preview: hasEndpoint(d) ? d.preview?.available ? `<button data-device="${esc(d.id)}" class="preview-thumb"><img loading="lazy" src="/api/devices/${encodeURIComponent(d.id)}/preview?t=${d.preview.captured_at}" alt="Screen preview of ${esc(d.label)}"><span>${d.preview.source === "live" ? "Live" : "Saved"} · ${date(d.preview.captured_at)}</span></button>` : `<button class="preview-empty" data-device="${esc(d.id)}">${d.preview?.enabled ? "No preview yet" : "Preview off"}</button>` : "—",
        };
        return `<tr data-row="${esc(d.id)}" class="${fleetSelection.has(d.id) ? "selected-row" : ""} ${fleetPrefs.highlight_agents && hasAgent(d) ? "agent-highlight" : ""}"><td class="select-cell"><input type="checkbox" data-select="${esc(d.id)}" aria-label="Select ${esc(d.label)}" ${fleetSelection.has(d.id) ? "checked" : ""} ${selectableMachine(d) ? "" : "disabled"}></td>${activeColumns().map(k => `<td data-column="${k}" data-label="${columns[k].label}" class="${columns[k].className || ""}" title="${k === "client" ? esc((d.clients || []).map((c: Item) => c.name).join(" · ")) : k === "location" ? esc(d.location) : ""}">${cells[k]}</td>`).join("")}<td class="connect-cell">${hasEndpoint(d) ? `<button data-screen="${esc(d.id)}" class="quick-action" ${d.online && selectableMachine(d) && role !== "viewer" ? "" : "disabled"} title="${esc(screenAction)}" aria-label="${esc(screenAction)}">${icon(["shell", "ssh"].includes(d.remote_protocol) ? "terminal" : "monitor")}</button><button data-terminal="${esc(d.id)}" class="quick-action" ${d.online && selectableMachine(d) && role !== "viewer" ? "" : "disabled"} title="${esc(shellAction)}" aria-label="${esc(shellAction)}">${icon("code")}</button>` : `<button data-device="${esc(d.id)}" class="quick-action" aria-label="Manage ${esc(d.label)}" title="Manage machine">${icon("monitor")}</button>`}</td></tr>`;
      })
      .join("") ||
    `<tr class="fleet-empty-row"><td colspan="${activeColumns().length + 2}"><div class="empty"><h3>No matching machines</h3><p>Try another search or filter.</p></div></td></tr>`;
  document.getElementById("fleet-count")!.textContent = `${rows.length} shown / ${fleet.length} discovered · ${rows.length ? fleetPage*50+1 : 0}–${Math.min((fleetPage+1)*50,rows.length)} in this page`;
  (document.getElementById("fleet-prev") as HTMLButtonElement).disabled =
    fleetPage === 0;
  (document.getElementById("fleet-next") as HTMLButtonElement).disabled =
    (fleetPage + 1) * 50 >= rows.length;
  const selectable = shown.filter(selectableMachine);
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
  rememberResource({kind:"machine",id,tab:initialTab}, () => openDevice(id,initialTab));
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
  bindResourceNavigation(panel);
  panel.id = "machine-details";
  activeDevicePanel = panel;
  highlightActiveMachine();
  const escape = (event: KeyboardEvent) => {
    if (tab === "terminal" && panel.querySelector(".shell-workspace")?.contains(event.target as Node)) return;
    if (event.key !== "Escape" || !panel.open || document.querySelector("dialog:modal")) return;
    event.preventDefault();
    panel.close();
  };
  document.addEventListener("keydown", escape);
  panel.addEventListener("close", () => {
    document.removeEventListener("keydown", escape);
    if (activeDevicePanel !== panel) return;
    activeDevicePanel = null;
    disconnect();
    detailVersion++;
    highlightActiveMachine();
    // Return to the machine after dismissal; navigation and replacement panes
    // keep their own focus instead.
    if (page === "home") document.getElementById("home-open-machine")?.focus({ preventScroll: true });
    if (page === "fleet") {
      document.querySelectorAll<HTMLButtonElement>("#fleet-rows .machine-name").forEach((button) => {
        if (button.dataset.device === id) button.focus({ preventScroll: true });
      });
    }
  });
  try {
    if (!fleet.some((d) => d.id === id))
      fleet = [...fleet, ...(await api("/devices?include_archived=true")).filter((d: Item) => !fleet.some(x => x.id === d.id))];
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
          <section class="machine-storage"><h3>Storage</h3>${(t.disks || []).map((x: Item, i: number) => `<div class="disk"><button class="text-link" data-volume="${i}">${esc(x.path)}</button><span>${x.used == null ? "—" : bytes(x.used)} / ${x.total == null ? "—" : bytes(x.total)}</span>${percent(x.usedPercent) === null ? "" : `<progress aria-label="Storage utilization ${esc(x.path)}" value="${x.usedPercent}" max="100"></progress>`}</div>`).join("") || '<small>No storage reported</small>'}</section>
          <div class="machine-foreground"><div><small>${presence.appLabel}</small><h3>${esc(presence.title)}</h3>${presence.app?.process ? `<small>${esc(presence.app.process)}</small>` : ""}${!presence.current && presence.app?.observed_at ? `<small>Last observed ${esc(date(Date.parse(presence.app.observed_at) / 1000))}</small>` : ""}</div><div class="machine-user"><small>${presence.userHeading}</small><b>${esc(presence.userLabel)}</b></div><div class="machine-desktop"><small>Interactive desktop</small><b>${esc(presence.desktop)}</b></div></div>`;
}
function refreshOpenMachine() {
  if (!activeDevicePanel?.open || tab !== "overview") return;
  const d = fleet.find(d => d.id === selected);
  if (!d) { activeDevicePanel.close(); return; }
  if (!hasEndpoint(d)) return;
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
function machineInventorySummary(d: Item) {
  return `<section class="machine-inventory"><dl><div><dt>Client</dt><dd>${esc(d.client_name || "Unassigned")}${d.client_conflict ? `<small>${esc(d.clients.map((c: Item) => c.name).join(" · "))}</small>` : ""}</dd></div><div><dt>Speck agent</dt><dd>${esc(agentLabel(d))}</dd></div><div><dt>Location / host</dt><dd>${esc(d.location || d.site || "—")}</dd></div></dl>${d.identity_evidence?.length ? `<p class="muted">Joined by ${esc(d.identity_evidence.join(" · "))}</p>` : ""}${d.identity_issues?.length ? `<p class="callout">Identity needs review: ${esc(d.identity_issues.join(" · "))}</p>` : ""}${d.stale ? '<p class="callout">Provider inventory is stale. Actions check the current provider before proceeding.</p>' : ""}<button class="text-link" data-identity-detail>Inspect identity &amp; coverage →</button><div class="drawer-actions">${(d.resources || []).map((r: Item,i: number) => `<button data-machine-resource="${i}" class="secondary" ${role === "viewer" ? "disabled" : ""}>${esc(r.provider)} · ${esc(r.kind)} ${esc(r.id)}</button>`).join("")}</div></section><div id="machine-reach" class="machine-reach" aria-live="polite"></div>`;
}
function inspectIdentity(d:Item){
  rememberResource({kind:'identity',id:d.id},()=>inspectIdentity(d));
  flyout(d.label+' · Identity',detailFacts([['Endpoint agent',hasEndpoint(d)?'Present':'Not installed'],['Approved for endpoint management',hasEndpoint(d)?!!d.approved:'Not applicable'],['Host connector',hasAgent(d)&&!hasEndpoint(d)?'Present':'Not recorded as a connector-only identity'],['Lifecycle',d.archived?'Archived':d.revoked?'Revoked':hasEndpoint(d)&&!d.approved?'Unapproved copy':'Active inventory'],['Hardware identity',d.hardware_id],['Installation identity',d.installation_id],['Source endpoint',d.endpoint_id || (hasEndpoint(d)?d.id:null)]])+detailSection('Join evidence',(d.identity_evidence || []).map((v:string)=>'<p>'+esc(v)+'</p>').join('')||'<p>No cross-provider join evidence recorded.</p>')+detailSection('Conflicts',(d.identity_issues || []).map((v:string)=>'<p class="resource-notice">'+esc(v)+'</p>').join('')+(d.client_conflict?'<p class="resource-notice">Provider records disagree on the client assignment.</p>':'')||'<p>No identity conflicts reported.</p>')+detailSection('Provider identities',(d.resources || []).map((r:Item)=>`<p><a href="${resourceHref(location.hash.slice(1),{kind:'infrastructure',id:String(r.id),connection:r.connection_id,resourceKind:r.kind,provider:r.provider})}">${esc(r.provider)} · ${esc(r.kind)} · ${esc(r.id)} →</a></p>`).join(''))+'<p class="resource-note">Matches use reported identity evidence. Approval changes are reviewed from the machine; this view does not merge identities or approve restored copies.</p>',{tone:'agents'});
}
registerResource('identity',async ref=>{await loadFleet();const d=fleet.find(d=>d.id===ref.id);if(!d)throw new Error('Identity is not in current inventory');inspectIdentity(d);});
function bindProviderButtons(d: Item) {
  document.querySelector('[data-identity-detail]')?.addEventListener('click',()=>{rememberResource({kind:'identity',id:d.id},()=>inspectIdentity(d));inspectIdentity(d);});
  document.querySelectorAll<HTMLButtonElement>("[data-machine-resource]").forEach(el => el.onclick = () => infrastructure.resourceDetail(d.resources[Number(el.dataset.machineResource)]));
}
// Phones show one line of identity; "Details" expands the full inventory and facts.
function machineBrief(facts: string[]) {
  return `<div class="machine-brief"><span>${esc(facts.filter(Boolean).join(" · "))}</span><button class="text-link" id="machine-more" aria-expanded="${machineDetailsOpen}" aria-controls="detail">${machineDetailsOpen ? "Hide details" : "Details"}</button></div>`;
}
function bindMachineBrief() {
  document.getElementById("detail")!.classList.toggle("show-details", machineDetailsOpen);
  document.getElementById("machine-more")?.addEventListener("click", (e) => {
    machineDetailsOpen = !machineDetailsOpen;
    document.getElementById("detail")!.classList.toggle("show-details", machineDetailsOpen);
    const button = e.currentTarget as HTMLButtonElement;
    button.textContent = machineDetailsOpen ? "Hide details" : "Details";
    button.setAttribute("aria-expanded", String(machineDetailsOpen));
  });
}
function renderProviderMachine(d: Item) {
  const heading=activeDevicePanel?.querySelector(".dialog-head h2");
  if (heading) heading.innerHTML=`<span class="machine-title">${esc(d.label)}</span>${badge(machineState(d))}`;
  activeDevicePanel?.setAttribute("aria-label",`Machine details: ${d.label}`);
  document.getElementById("detail")!.innerHTML = `${machineBrief([d.client_name || "Unassigned", primaryAddress(d) === "—" ? "" : primaryAddress(d), kindLabel(d), d.location || d.site])}${machineInventorySummary(d)}<div id="device-body"><div class="mini-grid machine-system"><div><small>Type</small>${esc(kindLabel(d))}</div><div><small>IP address</small>${esc(primaryAddress(d))}</div><div><small>CPU</small>${cpu(d) == null ? "Not reported" : Number(cpu(d)).toFixed(0)+"%"}</div><div><small>Memory</small>${memory(d) == null ? "Not reported" : Number(memory(d)).toFixed(0)+"%"}</div></div><p class="muted">Select a provider above for its management tools${d.resources?.some((r: Item) => ["qemu","virt"].includes(r.kind)) ? ", including the screen console" : ""}. A Speck endpoint agent adds commands, file transfer, patching and endpoint telemetry.</p></div>`;
  const proxmox = d.resources?.find((r: Item) => r.provider === "proxmox" && ["qemu", "lxc"].includes(r.kind));
  document.getElementById("detail")!.classList.toggle("pve-provider-pane", !!proxmox);
  if (proxmox && role !== "viewer") {
    const body = document.getElementById("device-body")!;
    body.innerHTML = '<div class="pve-root"></div>';
    infrastructure.machinePanel(proxmox, body.querySelector<HTMLElement>(".pve-root")!, tab, targetTab => {
      tab = targetTab;
      rememberResource({kind:"machine",id:d.id,tab:targetTab}, () => openDevice(d.id,targetTab));
      if (activeDevicePanel) bindResourceNavigation(activeDevicePanel);
    });
  } else if (d.resources?.length && role !== "viewer") {
    const resource = d.resources.find((r: Item) => r.kind === "node") || d.resources[0];
    const body = document.getElementById("device-body")!;
    body.classList.add("provider-story");
    void infrastructure.resourcePanel(resource, body);
  }
  bindProviderButtons(d);
  bindMachineBrief();
  void showReach(d);
}
let reachMap: { at: number; value: Promise<Item> } | null = null;
async function showReach(d: Item) {
  if (role === "viewer") return;
  if (!reachMap || reachMap.at < Date.now() - 60000) reachMap = { at: Date.now(), value: api("/network/map", "GET", undefined, undefined, false) };
  let map: Item;
  try {
    map = await reachMap.value;
  } catch {
    reachMap = null;
    return;
  }
  const el = document.getElementById("machine-reach");
  const m = map.machines.find((x: Item) => x.id === d.id || (d.endpoint_id && x.endpoint_id === d.endpoint_id));
  if (!el || selected !== d.id || !m) return;
  // Show the strip only when it adds more than the address the pane already reports.
  const reported = primaryAddress(d).split("/")[0];
  if (!m.network_clients?.length && !m.public.length && !m.dns.length && m.lan.every((l: Item) => l.ip === reported)) return;
  const chip = (text: string, tone = "") => `<span class="net-chip ${tone}">${esc(text)}</span>`;
  el.innerHTML = `<dl><div><dt>LAN</dt><dd>${m.lan.map((l: Item) => `<span class="mono">${esc(l.ip)}</span>`).join(" ") || "—"}</dd></div><div><dt>Public</dt><dd>${m.public.map((p: Item) => `<span class="mono">${esc(p.ip)}</span>${p.via === "unifi_nat" ? chip("NAT") : ""}`).join(" ") || "—"}</dd></div><div><dt>DNS names</dt><dd>${m.dns.slice(0, 8).map((n: Item) => `<a class="net-chip" href="${resourceHref(location.hash.slice(1),{kind:"dns-record",id:n.name || "@",connection:n.domain,resourceKind:n.type || "A"})}">${esc(n.fqdn)}</a>`).join("") || "—"}${m.dns.length > 8 ? `<small>+${m.dns.length - 8} more</small>` : ""}</dd></div></dl><a class="text-link" href="#network">Network &amp; DNS</a>${m.network_clients?.length ? '<div class="machine-uplinks">'+m.network_clients.map((c:Item,i:number)=>'<button data-machine-uplink="'+i+'">'+esc(c.uplink_name || 'Network equipment')+(c.port?' · Port '+esc(c.port):'')+' →</button>').join('')+'</div><small>Matched by unique MAC address · provider observations</small>':''}`;
  el.querySelectorAll<HTMLElement>('[data-machine-uplink]').forEach(b=>b.onclick=()=>{const c=m.network_clients[Number(b.dataset.machineUplink)];void network.openEquipment(c,c.uplink_id,c.port);});
}
async function renderDeviceContent() {
  disconnect();
  const d = fleet.find((x) => x.id === selected)!;
  if (!d) return;
  if (!hasEndpoint(d)) { renderProviderMachine(d); return; }
  if (d.telemetry_compact) {
    const machineId = d.id;
    const full = await api('/devices/' + encodeURIComponent(machineId));
    if (selected !== machineId || !activeDevicePanel?.open) return;
    Object.assign(d, full, {telemetry_compact:false});
  }
  const t = d.telemetry || {},
    names =
      role === "viewer" || d.archived
        ? ["overview"]
        : [
            "overview",
            "services",
            "inventory",
            "network",
            "terminal",
            "scripts",
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
    ${machineBrief([d.client_name || "Unassigned", address !== "—" ? address : "", t.host?.platform || d.platform, typeof t.host?.uptime === "number" ? "up " + uptime(t.host.uptime) : ""])}
    ${machineInventorySummary(d)}
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
  bindProviderButtons(d);
  bindMachineBrief();
  void showReach(d);
  on("copy-machine-ip", async () => {
    await navigator.clipboard.writeText(address);
    notify("IP address copied");
  });
  document.querySelectorAll<HTMLElement>("[data-tab]").forEach(
    (el) =>
      (el.onclick = () => {
        tab = el.dataset.tab!;
        const targetTab = tab;
        rememberResource({kind:"machine",id:d.id,tab:targetTab}, () => openDevice(d.id,targetTab));
        if (activeDevicePanel) bindResourceNavigation(activeDevicePanel);
        renderDevice();
      }),
  );
  on("device-edit", () => editDevice(d));
  if (d.approved && !d.archived && role !== "viewer") {
    on("drawer-screen", () => launchRemote(d));
    on("drawer-terminal", () => {
      tab = "terminal";
      rememberResource({kind:"machine",id:d.id,tab}, () => openDevice(d.id,"terminal"));
      if (activeDevicePanel) bindResourceNavigation(activeDevicePanel);
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

    body.addEventListener("click", event => {
      const volume = (event.target as Element).closest<HTMLButtonElement>("[data-volume]");
      if (volume) { const current = fleet.find(item => item.id === d.id) || d; const disk = current.telemetry?.disks?.[Number(volume.dataset.volume)]; if (disk) machineInspection.volume(current, disk); }
    });
    management.devicePanel(d, body);
    if (canPreview) await ops.previewPanel(d, body.querySelector<HTMLElement>("#machine-preview")!);
  } else if (tab === "patches") {
    await ops.devicePatches(d, body);
  } else if (tab === "inventory") {
    await machineInspection.inventory(d,body);
  } else if (tab === "services") {
    body.innerHTML = `<div class="toolbar"><input id="service-search" aria-label="Filter services" placeholder="Filter services…"><label>State<select id="service-state"><option value="">All states</option><option value="running">Running / active</option><option value="stopped">Stopped / inactive</option><option value="failed">Failed</option></select></label><small id="service-count"></small></div><div class="scroll"><table><thead><tr><th>Service</th><th>State / startup</th><th>Control</th></tr></thead><tbody id="services"></tbody></table></div>`;
    const rows = () => {
      const matching = (t.services || []).filter((s:Item) => !value("service-state") || (value("service-state")==="running" ? ["running","active"].includes(s.state || s.status) : value("service-state")==="stopped" ? ["stopped","inactive"].includes(s.state || s.status) : (s.state || s.status)==="failed"));
      const visible = matching.filter((s:Item)=>JSON.stringify(s).toLowerCase().includes(value("service-search").toLowerCase()));
      document.getElementById("service-count")!.textContent = `${visible.length} of ${(t.services || []).length} services · on-demand services may be stopped normally`;
      document.getElementById("services")!.innerHTML = visible
        .filter((s: Item) =>
          JSON.stringify(s)
            .toLowerCase()
            .includes(value("service-search").toLowerCase()),
        )
        .map(
          (s: Item, i: number) =>
            `<tr><td><button class="text-link" data-service-detail="${esc(s.name)}">${esc(s.name)}</button><small>${esc(s.display_name || s.description)}</small></td><td>${badge(s.state || s.status || "unknown", ["running", "active"].includes(s.state || s.status))}<small>${esc(serviceStartup(s.start_type ?? s.detail, d.platform))}</small></td><td><select data-service="${esc(s.name)}" aria-label="Control ${esc(s.name)}"><option value="">Action…</option><option>start</option><option>stop</option><option>restart</option></select></td></tr>`,
        )
        .join("");
      document.querySelectorAll<HTMLButtonElement>('[data-service-detail]').forEach(b=>b.onclick=()=>machineInspection.service(d,(t.services || []).find((s:Item)=>s.name===b.dataset.serviceDetail)));
      document.querySelectorAll<HTMLSelectElement>("[data-service]").forEach(
        (el) =>
          (el.onchange = async () => {
            if (!el.value) return;
            try {
              await machineInspection.serviceControl(d,el.dataset.service!,el.value);
            } catch (err) {
              notify((err as Error).message, true);
            }
            el.value = "";
          }),
      );
    };
    rows();
    on("service-state", rows, "change");
    document.getElementById("service-search")!.addEventListener("input", rows);
  } else if (tab === "network") {
    const n = t.network || {};
    body.innerHTML = `<div class="toolbar probe-toolbar"><select id="probe-kind" aria-label="Network test"><option value="ping">Ping</option><option value="dns">DNS lookup</option><option value="tcp">TCP connect</option><option value="trace">Trace route</option></select><input id="probe-target" aria-label="Host or IP" placeholder="Host or IP"><input id="probe-port" aria-label="Port" type="number" value="443" style="width:85px"><button id="probe" class="primary">Test</button></div><div id="job-result"></div>`;
    machineInspection.network(d,body);
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
    if (!d.remote_shell_available) {
      body.innerHTML=`<section class="terminal-intro"><span class="resource-eyebrow">Interactive terminal</span><h2>${d.platform==='windows'?'PowerShell':'Shell'}</h2><p>Update the Speck agent on this machine to enable a persistent interactive session with command history, completion and Ctrl+C.</p><p class="muted">${d.platform==='windows'?'Windows 10 / Server 2019 or newer is required for the pseudoconsole.':'Linux uses a native PTY through the agent.'}</p><button class="secondary" id="open-scripts">Open script runner</button></section>`;
      on('open-scripts',()=>{tab='scripts';void renderDevice();});
    } else {
      const panel=activeDevicePanel,deviceID=d.id;
      const {openWebShell}=await import('./web-shell');
      if(!body.isConnected||panel!==activeDevicePanel||selected!==deviceID||tab!=='terminal')return;
      body.innerHTML=`<section class="terminal-intro"><h2>Interactive ${d.platform==='windows'?'PowerShell':'terminal'}</h2><p>Commands run as ${d.platform==='windows'?'Local System':'the agent service account (normally root)'}. This opens a persistent session; it does not execute a prepared script. Session activity is audited.</p><button id="terminal-connect" class="primary">Connect terminal</button><button id="open-scripts" class="secondary">Run a script instead</button></section>`;
      on('open-scripts',()=>{tab='scripts';void renderDevice();});
      on('terminal-connect',()=>{if(body.isConnected&&selected===deviceID)remoteCleanup=openWebShell(body,{id:d.id,label:d.label,platform:d.platform,embedded:true},csrf,signedOut);});
    }
  } else if (tab === "scripts") {
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
    mountFiles({api,flyout,dialog,showJob:runDetails.job},d,body);
  } else if (tab === "remote") {
    body.innerHTML = `<div class="remote-intro"><h2>${["shell","ssh"].includes(d.remote_protocol) ? "Interactive terminal" : "View / control desktop"}</h2><p>${d.remote_protocol === "shell" ? "Open an interactive web shell through the agent. No SSH setup is needed." : d.remote_protocol === "ssh" ? "Open an SSH terminal through the agent." : d.remote_protocol === "vnc" ? "Open a VNC desktop through the agent." : "Open an RDP desktop through the agent, with speaker output and microphone input."}</p><div class="toolbar"><button id="connect" class="primary">${["shell","ssh"].includes(d.remote_protocol) ? "Connect terminal" : "Connect desktop"}</button><button id="remote-config" class="secondary">Connection settings</button>${d.remote_shell_available && d.remote_protocol !== "shell" ? `<a class="secondary" href="#remote/${d.id}?mode=shell">Open web shell</a>` : ""}</div>${d.remote_protocol === "rdp" ? `<a class="text-link" href="/api/devices/${d.id}/remote/native.rdp">Download native RDP fallback ↗</a><small>The native viewer needs a LAN or VPN route to this machine.</small>` : ""}<div class="callout">${d.remote_protocol==="rdp" ? "RDP creates or reconnects a desktop session and may lock the local Windows console." : d.remote_protocol==="vnc" ? "VNC can interact with the visible desktop and its signed-in user." : "An interactive terminal runs commands under the configured SSH account or agent service account. No session starts until you choose Connect."}</div></div>`;
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
  if (matchMedia("(pointer: coarse)").matches) {
    d.tabIndex = -1;
    d.focus({ preventScroll: true });
  }
  d.querySelector(".close")!.addEventListener("click", () => d.close());
  d.addEventListener("close", () => d.remove());
  return d;
}
async function enrollmentDialog() {
  const d = dialog(
    "Add a device",
    `<p><b>Manage a Windows or Linux machine</b> with the endpoint agent. To operate Speck from your own desktop, <a href="#downloads">download the operator app</a>.</p><details open><summary>Before creating an enrollment</summary><ol><li>Choose a unique machine name. Keep restored copies separate from their originals.</li><li>Windows: run PowerShell as Administrator. Linux: run the installer as root on a systemd host.</li><li>Download and inspect the <a href="/downloads/install-windows.ps1">Windows installer</a> or <a href="/downloads/install-linux.sh">Linux installer</a>. The agent needs outbound HTTPS to this server.</li><li>When ready, create a single-use token, install within 15 minutes, then verify connection, approval and the first report in Fleet.</li></ol></details><label>Device name<input id="enroll-label" placeholder="Front desk PC"></label><button id="enroll" class="primary">Create enrollment</button><div id="enroll-result"></div>`,
  );
  on("enroll", async () => {
    (d.querySelector("#enroll") as HTMLButtonElement).disabled=true;
    try { const r = await api("/enrollments", "POST", {
      label: value("enroll-label"),
    });
    d.querySelector("#enroll-result")!.innerHTML =
      `<div class="callout">Keep this token private. It can enroll one device.</div><label>Enrollment token<input readonly value="${esc(r.token)}"></label><p>Download and inspect an installer, then run it as Administrator or root. Enter this token when prompted.</p><div class="toolbar"><a class="secondary" href="/downloads/install-windows.ps1">Windows installer ↓</a><a class="secondary" href="/downloads/install-linux.sh">Linux installer ↓</a></div><small>Server: ${esc(r.server)}</small><p>Installation progress: token created → installer connects → new identity appears → review approval → first health report.</p><a class="secondary" href="#fleet">Check connection and first report in Fleet →</a>`;
    } catch(error){(d.querySelector("#enroll") as HTMLButtonElement).disabled=false;throw error;}
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
    await loadFleet();
    const d = fleet.find((d) => d.id === id);
    if (!d) throw new Error("Machine not found");
    if (!d.remote_configured && !(mode === "shell" && d.remote_shell_available))
      throw new Error(
        "Configure the machine’s Remote connection in Fleet first.",
      );
    if (mode === "shell" || (mode === "auto" && d.remote_protocol === "shell")) {
      const current = viewScope.checkpoint();
      const { openWebShell } = await import("./web-shell");
      current();
      remoteCleanup = openWebShell(app, { id: d.id, label: d.label, platform: d.platform, configured_remote_protocol: d.configured_remote_protocol }, csrf, signedOut);
    } else {
      await connectRemote({ ...d, remote_protocol: d.configured_remote_protocol || d.remote_protocol }, attempt);
    }
  } catch (e) {
    if (e instanceof StaleViewError || !username) return;
    app.innerHTML = `<main class="remote-workspace"><div class="remote-header"><a href="#fleet" class="remote-back">← Fleet</a><h1>Remote workspace</h1></div><div class="empty"><p class="remote-error">${esc((e as Error).message)}</p></div></main>`;
  }
}
async function connectRemote(d: Item, attempt = 0) {
  const finishFrame=startJourney("session_first_frame","browser");
  app.innerHTML = `<main class="remote-workspace"><header class="remote-header"><a href="#fleet" class="remote-back">← Fleet</a>${wordmark(true)}<div class="remote-title"><h1>${esc(d.label)}</h1><small id="remote-status">Connecting…</small></div><button id="remote-ai" class="secondary">Screen assistant</button><button id="fullscreen" class="secondary">Full screen</button></header><div class="remote-controls"><button id="remote-keyboard" class="secondary">Keyboard</button><button id="sound" class="secondary">Enable sound</button><button id="mic" class="secondary">Enable microphone</button><label>Keys <select id="key-macro"><option value="">Send shortcut…</option><option value="cad">Ctrl + Alt + Del</option><option value="task">Task manager</option><option value="run">Windows + R</option><option value="alt-tab">Alt + Tab</option><option value="copy">Ctrl + C</option><option value="paste">Ctrl + V</option><option value="enter">Return / Enter</option><option value="backspace">Backspace</option><option value="escape">Escape</option><option value="tab">Tab</option></select></label><button id="type-secret" class="secondary">Type password</button><button id="fit-screen" class="secondary">View at 100%</button><button id="remote-reconnect" class="secondary">Reconnect</button><button id="desktop-launch" class="secondary">Open in desktop app</button><span id="remote-stats"></span></div><section class="remote-stage"><div id="remote-display" tabindex="0" aria-label="Remote screen. Keyboard input is sent to this machine."></div><div id="remote-startup" class="remote-startup">${loadingState(attempt ? "Reconnecting the display…" : "Connecting to machine…", "The screen will appear as soon as it is ready.")}</div></section><footer class="remote-footer"><input id="clipboard" aria-label="Remote clipboard" placeholder="Text for the remote clipboard"><button id="paste" class="secondary">Copy to remote</button><button id="read-clipboard" class="secondary">Use my clipboard</button><label class="check"><input id="shared-clipboard" type="checkbox"> Shared clipboard</label></footer></main>`;
  const modal = document.querySelector<HTMLElement>(".remote-workspace")!;
  let closed = false;
  remoteCleanup = () => {
    closed = true;finishFrame("cancelled");
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
  }).catch(error=>{finishFrame(error instanceof StaleViewError?"cancelled":"failed");throw error;});
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
    finishFrame(flushed?"ready":"unknown");
    screenReady = true;
    guacDisplay.statisticWindow = 0;
    overlay.hidden = true;
    display.setAttribute("aria-busy", "false");
    status.textContent = "Connected";
    if (document.hasFocus()) display.focus();
  };
  const showFailure = (message: string) => {
    finishFrame("failed");
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
  modal.addEventListener("close", () => { finishFrame("cancelled");startup.stop(); guacDisplay.onstatistics = null; });
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
// The few facts that identify a Slide resource at a glance; full detail stays in the row.
function slideFacts(r: Item) {
  const facts: string[] = [];
  const name = String(r.display_name || r.name || r.hostname || "").toLowerCase();
  if (r.hostname && r.hostname.toLowerCase() !== name) facts.push(r.hostname);
  if (r.os || r.os_name) facts.push([r.os || r.os_name, r.os_version].filter(Boolean).join(" "));
  else if (r.platform) facts.push(r.platform);
  if (r.serial_number) facts.push(r.serial_number);
  if (r.hardware_model_name) facts.push(r.hardware_model_name);
  if (r.storage_used_bytes && r.storage_total_bytes) facts.push(`${bytes(r.storage_used_bytes)} of ${bytes(r.storage_total_bytes)}`);
  const when = r.last_seen_at || r.backup_ended_at || r.ended_at || r.started_at || r.created_at;
  if (when) facts.push((r.last_seen_at ? "seen " : "") + date(when));
  return facts.slice(0, 3);
}
let slideResource = "agent";
async function openSlideResource(resource: string, row: Item) {
  rememberResource({kind:"slide",id:String(row[resource.split("/").at(-1)!+"_id"] || row.id),resourceKind:resource},()=>openSlideResource(resource,row));
  const pane = flyout(slideName(row), `<div class="slide-detail">${slideStory(resource,row)}</div>${resource === 'agent' ? '<section class="resource-actions"><h3>Backup operations</h3><p class="resource-note">Request a new backup through the connected Slide account.</p><button class="secondary" data-slide-backup>Request backup</button></section>' : ''}`, {tone:"protection",subtitle:"Slide · "+(slideKinds[resource] || 'Resource')});
  const bindRelated = () => pane.querySelectorAll<HTMLButtonElement>('[data-slide-related]').forEach(button => button.onclick = async () => {
    button.disabled = true;
    try {
      const kind = button.dataset.slideRelated!;
      const rows = await api('/slide/inventory?resource='+encodeURIComponent(kind));
      if (!pane.open || !pane.isConnected) return;
      const match = rows.find((r: Item) => String(r[kind+'_id'] || r.id) === button.dataset.resourceId);
      if (match) await openSlideResource(kind,match);
      else notify('This related resource is not present in the current Slide inventory.');
    } catch (error) { if (pane.open) notify((error as Error).message,true); }
    finally { button.disabled = false; }
  });
  bindRelated();
  if(resource==='agent'){
    const history=document.createElement('div');pane.querySelector('.resource-body')!.append(history);
    mountProviderExplorer({api,freshApi,flyout,notify,openResource:(r:Item)=>infrastructure.resourceDetail(r),onEvidence:(sections:Item,checked:number)=>{
      const evidence=backupEvidence(sections,row),target=pane.querySelector('[data-protection-summary]');
      if(!pane.open||!target)return;
      target.innerHTML=detailSection('Protection evidence',detailFacts([['Latest recorded recovery point',detailDate(evidence.latestPoint)],['Evidence source',evidence.source],['Latest successful backup job',detailDate(evidence.successful)],['Latest provider-verified point',detailDate(evidence.verified)],['Coverage',evidence.state],['Failed jobs in loaded history',evidence.failed],['History checked',detailDate(checked)],['Agent last seen',detailDate(row.last_seen_at)],['Backup agent version',row.agent_version]]))+'<p class="resource-note">Provider snapshot verification does not prove application recovery. '+(evidence.complete?'Showing all returned history.':'Summary uses the loaded history; more records are available below.')+'</p>';
    }}, {provider:'slide' ,kind:'protected',connection_id:'slide-settings',connection_name:'Slide (Settings)',id:row.agent_id,name:slideName(row)},history);
  }
  const backup = pane.querySelector<HTMLButtonElement>('[data-slide-backup]');
  if (backup) backup.onclick = async () => {
    backup.disabled = true;
    try {
      const result = await api('/slide/backups','POST',{agent_id:row.agent_id});
      if (pane.open) { backup.textContent = 'Backup requested'; notify('Backup requested: '+result.backup_id); }
    } catch (error) { if (pane.open) notify((error as Error).message,true); backup.disabled=false; }
  };
  if (resource === 'device') {
    const target = pane.querySelector<HTMLElement>('[data-slide-protected]')!;
    try {
      const agents = await api('/slide/inventory?resource=agent');
      if (!pane.open || !target.isConnected) return;
      const protectedSystems = agents.filter((a: Item) => a.device_id === row.device_id);
      target.innerHTML = protectedSystems.length ? `<div class="resource-related">${protectedSystems.map((a: Item)=>`<button type="button" data-slide-related="agent" data-resource-id="${esc(a.agent_id)}"><span><b>${esc(slideName(a))}</b><small>${esc([a.os || a.platform,a.os_version].filter(Boolean).join(' '))}</small></span><span aria-hidden="true">→</span></button>`).join('')}</div>` : '<p class="resource-note">No protected systems in the returned inventory refer to this appliance.</p>';
      bindRelated();
    } catch {
      if (pane.open && target.isConnected) target.innerHTML = '<p class="resource-notice">Protected-system inventory is unavailable. Appliance details remain visible.</p>';
    }
  }
}
registerResource('slide',async ref=>{
  const kind=ref.resourceKind || 'agent', rows=await api('/slide/inventory?resource='+encodeURIComponent(kind));
  const row=rows.find((r:Item)=>String(r[kind.split('/').at(-1)!+'_id'] || r.id)===ref.id);
  if(!row)throw new Error('This Slide resource is not in the current inventory. Historical recovery evidence remains available in Recovery lab.');
  await openSlideResource(kind,row);
});
async function renderSlide() {
  loading("Loading Slide…");
  const [cfg,connections] = await Promise.all([api("/slide/connection"),api("/infrastructure/connections")]);
  const slideConnections=connections.filter((c:Item)=>c.provider==="slide");
  slideResource=new URLSearchParams(location.hash.split("?")[1] || "").get("view") || "agent";
  let connectionId=new URLSearchParams(location.hash.split("?")[1] || "").get("connection") || "slide-settings";
  if(slideConnections.length&&!slideConnections.some((c:Item)=>c.id===connectionId))connectionId=slideConnections[0].id;
  if (!cfg.connected && !slideConnections.length) {
    content('<div class="empty"><h2>Connect your Slide account.</h2><p>Add an API token in Settings to see live backup and recovery data.</p><a class="primary" href="#settings">Open settings →</a></div>');
    return;
  }
  content(`<div class="section-head"><div><h2>Backup & recovery inventory</h2><p>Each connection is an independent account scope. Coverage and resource details use the selected connection.</p><label>Provider connection<select id="slide-connection">${slideConnections.map((c:Item)=>`<option value="${esc(c.id)}" ${c.id===connectionId?"selected":""}>${esc(c.name)}${c.id==="slide-settings"?" · configured in Settings":" · configured in Infrastructure"}</option>`).join("")}</select></label></div><select id="slide-resource" aria-label="Slide resource type">${Object.entries(slideKinds).map(([key,label])=>'<option value="'+key+'" '+(slideResource===key?'selected':'')+'>'+esc(label)+'</option>').join('')}</select></div><div id="backup-coverage"></div><label class="slide-search">Find a resource<input id="slide-search" type="search" placeholder="Name, address or resource ID"></label><div id="slide-data"></div><details class="resource-section"><summary>Restored-machine cleanup</summary><article id="restore-cleanup" class="panel"></article></details>`);
  let generation = 0;
  const load = async () => {
    const current = ++generation;
    slideResource = value('slide-resource');
    const resource = slideResource, target = document.getElementById('slide-data')!;
    target.innerHTML = loadingState('Loading '+(slideKinds[resource] || 'inventory').toLowerCase()+'…');
    const rows = await api('/slide/inventory?resource='+encodeURIComponent(resource)+(connectionId==='slide-settings'?'':'&connection_id='+encodeURIComponent(connectionId)));
    const openScoped=(kind:string,row:Item)=>connectionId==='slide-settings'?openSlideResource(kind,row):infrastructure.resourceDetail({connection_id:connectionId,provider:'slide',kind:({agent:'protected',device:'box','restore/virt':'virt'} as Item)[kind] || kind,id:row[kind.split('/').at(-1)!+'_id'] || row.id,name:slideName(row)});
    if (!target.isConnected || current !== generation) return;
    const coverage=document.getElementById("backup-coverage")!;
    if(resource==="agent") {mountBackupCoverage({api,flyout,connection:connectionId},coverage,rows,openScoped);target.innerHTML="";(document.querySelector(".slide-search") as HTMLElement).hidden=true;return;}else {coverage.innerHTML="";(document.querySelector(".slide-search") as HTMLElement).hidden=false;}
    let limit = 100;
    const search = document.getElementById('slide-search') as HTMLInputElement;
    const draw = () => {
      const query = search.value.trim().toLowerCase();
      const filtered = rows.filter((r: Item) => !query || JSON.stringify(r).toLowerCase().includes(query));
      target.innerHTML = filtered.length ? `<p class="resource-note">${filtered.length} resources · Select one to explore its details and relationships.</p><div class="slide-list">${filtered.slice(0,limit).map((r: Item,i: number)=>`<button class="slide-resource-row" data-slide-detail="${i}" aria-haspopup="dialog"><span><b>${esc(slideName(r))}</b><small>${esc(slideFacts(r).join(' · ') || slideKinds[resource])}</small></span>${detailStatus(r.status || r.state || r.verify_boot_status || r.verify_fs_status || r.service_status)}<span aria-hidden="true">→</span></button>`).join('')}</div>${filtered.length>limit ? '<button class="secondary" id="slide-more">Show '+Math.min(100,filtered.length-limit)+' more</button>' : ''}` : '<div class="empty"><h3>No matching resources.</h3><p>Try another search or resource type.</p></div>';
      target.querySelectorAll<HTMLElement>('[data-slide-detail]').forEach(b=>b.onclick=()=>void openScoped(resource,filtered[Number(b.dataset.slideDetail)]));
      target.querySelector('#slide-more')?.addEventListener('click',()=>{limit+=100;draw();});
    };
    search.oninput = () => {limit=100;draw();};
    draw();
  };
  document.getElementById('slide-connection')!.addEventListener('change',()=>{connectionId=value('slide-connection');const params=new URLSearchParams(location.hash.split('?')[1] || '');params.set('connection',connectionId);history.replaceState(null,'','#slide?'+params);void load().catch(error=>notify(error.message,true));});
  document.getElementById('slide-resource')!.addEventListener('change',()=>{const params=new URLSearchParams(location.hash.split('?')[1] || '');params.set('view',value('slide-resource'));history.pushState(null,'','#slide?'+params);void load().catch(e=>notify(e.message,true));});
  await Promise.all([load(),renderRestoreCleanup().catch(error=> {
    const target=document.getElementById('restore-cleanup');
    if (target) target.innerHTML='<p class="resource-notice">Cleanup status unavailable. '+esc((error as Error).message)+'</p>';
  })]);
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
      return `<tr><td><b>${esc(source?.label || member.source_device_id)}</b></td><td>${badge(member.backup_status || "Pending", member.backup_status === "succeeded")}</td><td>${esc(restored?.label || (proof?.passed ? "Historically verified · current inventory unavailable" : member.virt_id ? "Created · awaiting check" : "Pending"))}</td><td>${result}</td></tr>`;
    })
    .join("");
  return `<div class="table-wrap"><table><thead><tr><th>System</th><th>Backup</th><th>Restored instance</th><th>Application check</th></tr></thead><tbody>${rows}</tbody></table></div><details><summary>Detailed evidence</summary><pre>${pretty({ state: run.state, report: run.report })}</pre></details>`;
}
async function renderRecovery() {
  loading("Loading recovery lab…");
  const [plans, runs, devices] = await Promise.all([
    api("/recovery/plans"),
    api("/recovery/runs"),
    api("/devices?include_archived=true"),
  ]);
  fleet = devices;
  content(
    `<button id="new-plan" class="primary" data-page-action>${icon("plus")}<span>New recovery plan</span></button><div class="section-head"><div><h2>Your recovery plans</h2><p>Each run creates a shared, isolated network for its restored machines.</p></div></div><div class="plan-grid">${plans.map((p: Item) => `<article class="plan"><span class="eyebrow">RECOVERY PLAN</span><h2>${esc(p.name)}</h2><p>${p.spec.members.length} systems · ${esc(p.spec.router_prefix)}</p><button data-run="${p.id}" class="primary">Run recovery test →</button><button class="secondary" data-plan-detail="${p.id}">Readiness &amp; proof</button><p class="resource-note">${recoveryReadiness(p,runs,devices).ready} / ${p.spec.members.length} approved sources reporting · ${recoveryReadiness(p,runs,devices).verified?"Historical proof available":"No verified run"}</p></article>`).join("") || '<div class="empty"><h3>No recovery plans</h3><p>Link devices to their Slide agent IDs, then define application checks.</p></div>'}</div><div class="section-head"><h2>Runs & evidence</h2></div>${runs.map((r: Item) => `<details class="provider" ${r.status === "stopped" ? "" : "open"}><summary><b>${esc(r.state.name)}</b>${badge(r.status, r.status === "passed")}<small>${date(r.created)}</small></summary><div class="run-phase">${esc(r.phase.replaceAll("_", " "))}</div>${r.state.error ? `<div class="callout">${esc(r.state.error)}</div>` : ""}<button class="secondary" data-run-detail="${r.id}">Inspect timeline &amp; evidence</button><div class="toolbar">${r.status === "awaiting_clones" ? `<button data-verify="${r.id}" class="primary">Verify restored machines</button>` : ""}${r.status !== "running" && r.status !== "stopped" ? `<button data-stop="${r.id}" class="secondary">Stop restored VMs</button>` : ""}</div></details>`).join("")}`,
  );
  document.querySelectorAll<HTMLElement>("[data-plan-detail]").forEach(b=>b.onclick=()=>void recoveryInspection.openPlan(b.dataset.planDetail!));
  document.querySelectorAll<HTMLElement>("[data-run-detail]").forEach(b=>b.onclick=()=>void recoveryInspection.openRun(b.dataset.runDetail!));
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
  const [jobs, devices] = await Promise.all([api("/jobs"), api("/devices?include_archived=true")]);
  content(
    `<div class="scroll"><table class="jobs-table"><thead><tr><th>Job</th><th>Machine</th><th>Status</th><th>By</th><th>When</th></tr></thead><tbody>${jobs.map((j: Item) => {
      const device = devices.find((d: Item) => d.id === j.device_id);
      return `<tr><td><button class="text-link" data-job-detail="${esc(j.id)}">${esc(j.kind)} →</button></td><td>${device ? esc(device.label) : '<span class="placeholder">Removed machine</span>'}</td><td>${badge(j.status, j.status === "complete")}</td><td>${j.actor ? esc(j.actor) : '<span class="placeholder">—</span>'}</td><td>${date(j.created)}</td></tr>`;
    }).join("") || '<tr><td colspan="5" class="placeholder">No jobs yet.</td></tr>'}</tbody></table></div><p class="muted jobs-note">The complete audit trail is in <a class="text-link" href="#activity">Activity</a>.</p>`,
  );
  document.querySelectorAll<HTMLButtonElement>("[data-job-detail]").forEach(b => b.onclick = () => void runDetails.job(b.dataset.jobDetail!));
}
async function renderSettings() {
  loading("Loading settings…");
  if (role === "viewer") return management.renderAccount();
  const c = await api("/slide/connection");
  content(
    `<div class="toolbar settings-sections" role="navigation" aria-label="Settings sections"><a class="secondary" href="#account">Account & access</a><a class="secondary" href="#api">AI / API clients</a><button class="secondary" id="settings-integrations">Integration directory</button><button class="secondary" data-settings-group="agents">Endpoint agent policy</button><button class="secondary" data-settings-group="all">All settings</button></div><p class="resource-note">Endpoint agents manage Windows/Linux machines. AI and API clients use separately scoped credentials to access Speck.</p><div class="settings-grid"><article class="panel"><span class="eyebrow">SLIDE INTEGRATION</span><h2>Slide connection</h2><a class="text-link" href="${resourceHref("settings",{kind:"connection",id:"slide-settings"})}">Inspect integration health &amp; resources →</a><p>${c.connected ? "A Slide account is connected. Enter a new token to replace it." : "Add an account-scoped Slide API token."}</p><label>API origin<input id="slide-url" value="${esc(c.url || "https://api.slide.tech")}"></label><label>API token<input id="slide-token" type="password" autocomplete="new-password"></label><button id="save-slide" class="primary">Verify & connect</button></article><article class="panel"><span class="eyebrow">DEVICE ENROLLMENT</span><h2>Windows and Linux agents</h2><p>Install Speck as a Windows service or a Linux systemd service. Devices connect outbound over HTTPS.</p><button id="enrollment" class="secondary">Add a device</button></article></div>`,
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
  on('settings-integrations',()=>integrationDirectory({api,flyout}));
  document.querySelectorAll<HTMLButtonElement>('[data-settings-group]').forEach(b=>b.onclick=()=>{document.querySelectorAll<HTMLElement>('.settings-grid>article').forEach(card=>card.hidden=b.dataset.settingsGroup!=='all'&&!/DEVICE ENROLLMENT|AGENT UPDATES/.test(card.textContent || ''));});
  if (role === "admin") {
    const updates = await api("/agent-updates");
    document
      .querySelector(".settings-grid")!
      .insertAdjacentHTML(
        "beforeend",
        `<article class="panel"><span class="eyebrow">AGENT UPDATES</span><h2>Automatic updates</h2><p>Keep Windows and Linux agents current with verified, signed releases. Updates wait for commands and remote sessions to finish.</p><label class="check"><input id="agent-updates-enabled" type="checkbox" ${updates.enabled ? "checked" : ""}> Automatically update agents</label><p>${updates.version ? `Published agent: <strong>${esc(updates.version)}</strong>` : "No agent release published yet."}</p><p>Agents reconnect after a brief service restart. If the new agent cannot reconnect, Speck attempts to restore the previous version.</p><button id="save-agent-updates" class="secondary">Save update policy</button><button id="inspect-agent-rollout" class="text-link">Inspect device rollout →</button><p>${(updates.devices || []).filter((d: Item) => d.status === "installing").length} updating · ${(updates.devices || []).filter((d: Item) => ["failed", "rollback_failed"].includes(d.status)).length} need attention</p></article>`,
      );
    on('inspect-agent-rollout',()=>{
      const rows=updates.rollout || updates.devices || [];
      const pane=flyout('Agent rollout','<p class="resource-note">A signed release and approval are required. Recovery candidates remain excluded until separately approved. These are observed states; no update is started by opening this view.</p><div class="resource-related">'+rows.map((r:Item,i:number)=>`<button data-rollout-device="${i}"><span><b>${esc(r.label)}</b><small>${esc(r.platform || '')} · installed ${esc(r.installed || 'Not reported')} → ${esc(r.target || updates.version || 'No release')}</small></span><span>${esc(r.reason || r.status)} →</span></button>`).join('')+'</div>',{tone:'agents'});
      const root=pane.querySelector<HTMLElement>('.resource-body')!;listWorkspace(root,'[data-rollout-device]','agent rollout');
      root.querySelectorAll<HTMLButtonElement>('[data-rollout-device]').forEach(b=>b.onclick=()=>{const r=rows[Number(b.dataset.rolloutDevice)];const detail=flyout(r.label,detailFacts([['Platform',[r.platform,r.arch].filter(Boolean).join(' · ')],['Installed',r.installed],['Published target',r.target || updates.version],['Eligibility / pending reason',r.reason || r.status],['Last agent report',detailDate(r.last_seen)],['Attempted',detailDate(r.attempt?.attempted)],['Latest outcome',r.attempt?.status],['Last outcome update',detailDate(r.attempt?.updated)]])+technicalDetail(r.reported_update || r.attempt)+'<button class="secondary" data-rollout-machine>Open machine</button>',{tone:'agents'});detail.querySelector('[data-rollout-machine]')!.addEventListener('click',()=>void openDevice(r.device_id));});
    });
    on("save-agent-updates", async () => {
      await api("/agent-updates", "PUT", {
        enabled: (
          document.getElementById("agent-updates-enabled") as HTMLInputElement
        ).checked,
      });
      notify("Agent update policy saved");
    });
  }
  if (role === "admin") await integrationSettings({ api, esc, date, on, value, notify, dialog });
  await ops.settingsPanel();
  await management.settingsPanel();
  // Sections load from several modules; pack them into one set of columns without row gaps.
  const grids = [...document.querySelectorAll<HTMLElement>("#content .settings-grid")];
  grids.slice(1).forEach((grid) => {
    grids[0].append(...grid.children);
    grid.remove();
  });
  grids[0]?.classList.add("settings-masonry");
  if (role !== "admin") {
    for (const id of ["save-slide", "save-ai"])
      document.getElementById(id)?.setAttribute("disabled", "");
  }
}
startResponsive();
let focusHomeCommand = false;
const commandPalette=createCommandPalette({api,dialog,role:()=>role,navigation:()=>NAV_GROUPS.flatMap(([,items])=>items).map(([id,,title])=>({id,title})).filter((n:Item)=>role!=='viewer'||['home','fleet','alerts','activity','downloads','account'].includes(n.id)),plan:(prompt:string)=>home.plan(prompt)});
window.addEventListener("keydown", event=>{
  if(!(event.key.toLowerCase()==='k'&&(event.metaKey||event.ctrlKey))||!username||page.startsWith('remote/')||document.querySelector('dialog:modal'))return;
  event.preventDefault();commandPalette.open();
});
window.addEventListener("hashchange", event => {
  const params=(url:string)=>{const p=new URLSearchParams(new URL(url).hash.split("?")[1] || "");p.delete("inspect");return p.toString();};
  const changedView=params(event.oldURL)!==params(event.newURL);
  if (username) {
    const next = (location.hash.slice(1) || "home").split("?")[0];
    if(next===page&&next==="fleet"&&new URLSearchParams(location.hash.split("?")[1]||"").has("coverage")) drawFleet();
    else if (next === page && !next.startsWith("remote/") && !changedView) void restoreResource().catch(error => notify(error.message,true));
    else void render();
  } else { clearResourceHistory(); signedOut(); }
});
setInterval(async () => {
  if (
    !username ||
    !fleetCache ||
    polling ||
    document.querySelector<HTMLButtonElement>("#refresh")?.disabled ||
    page !== "fleet" ||
    remote ||
    document.querySelector("dialog:modal") ||
    ["fleet-search", "fleet-filter", "fleet-os", "fleet-sort", "fleet-agent", "fleet-direction"].includes(
      document.activeElement?.id || "",
    )
  )
    return;
  polling = true;
  try {
    await loadFleet(false, true);
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
