type Item = Record<string, any>;
type Action = { type: string; [key: string]: any };
const keyNames: Record<string, number> = {
  CTRL: 0xffe3, CONTROL: 0xffe3, ALT: 0xffe9, SHIFT: 0xffe1,
  META: 0xffeb, SUPER: 0xffeb, WIN: 0xffeb, ENTER: 0xff0d, RETURN: 0xff0d,
  TAB: 0xff09, ESC: 0xff1b, ESCAPE: 0xff1b, BACKSPACE: 0xff08, DELETE: 0xffff,
  SPACE: 0x20, ARROWUP: 0xff52, ARROWDOWN: 0xff54, ARROWLEFT: 0xff51, ARROWRIGHT: 0xff53,
};
const fields: Record<string, string[]> = {
  click: ["type", "x", "y", "button"], double_click: ["type", "x", "y", "button"],
  move: ["type", "x", "y"], scroll: ["type", "x", "y", "scroll_x", "scroll_y"],
  type: ["type", "text"], keypress: ["type", "keys"], wait: ["type"], screenshot: ["type"],
};
/** Reject the entire proposal before sending even the first input. */
export function validateScreenActions(value: unknown, width: number, height: number): Action[] {
  if (!Array.isArray(value) || value.length > 5) throw new Error("The proposed step is invalid. Ask for one fresh step.");
  return value.map(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || typeof raw.type !== "string" ||
        !Object.hasOwn(fields, raw.type) || Object.keys(raw).some(k => !fields[raw.type].includes(k)))
      throw new Error("This action needs manual control.");
    const a = { ...raw } as Action;
    if (["click", "double_click", "move", "scroll"].includes(a.type) &&
        (!Number.isInteger(a.x) || !Number.isInteger(a.y) || a.x < 0 || a.y < 0 || a.x >= width || a.y >= height))
      throw new Error("The proposed coordinates are outside the captured screen.");
    if (["click", "double_click"].includes(a.type)) {
      a.button ??= "left";
      if (!["left", "middle", "right"].includes(a.button) || (a.type === "double_click" && a.button !== "left"))
        throw new Error("This mouse action needs manual control.");
    }
    if (a.type === "type" && (typeof a.text !== "string" || ![...a.text].length || [...a.text].length > 2000))
      throw new Error("The proposed text is invalid or too long.");
    if (a.type === "keypress" && (!Array.isArray(a.keys) || !a.keys.length || a.keys.length > 5 ||
        a.keys.some((k: unknown) => typeof k !== "string" ||
          (!Object.hasOwn(keyNames, k.toUpperCase()) && !/^[\x20-\x7e]$/.test(k)))))
      throw new Error("This key shortcut needs manual control.");
    if (a.type === "scroll") {
      a.scroll_x ??= 0; a.scroll_y ??= 0;
      if (![a.scroll_x, a.scroll_y].every(n => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 2000) || a.scroll_x !== 0)
        throw new Error("This scroll needs manual control.");
    }
    return a;
  });
}
function actionLabel(a: Action, redacted = false): string {
  if (a.type === "type") return redacted ? `Typed ${[...a.text].length} characters (text omitted)` : `Type ${[...a.text].length} characters`;
  if (a.type === "keypress") return `Press ${a.keys.join(" + ")}`;
  if (a.type === "scroll") return `Scroll ${a.scroll_y > 0 ? "down" : "up"} ${Math.abs(a.scroll_y)} at (${a.x}, ${a.y})`;
  if (a.type === "click") return `${a.button} click at (${a.x}, ${a.y})`;
  if (a.type === "double_click") return `Double-click (left) at (${a.x}, ${a.y})`;
  if (a.type === "move") return `Move pointer to (${a.x}, ${a.y})`;
  return "Observe the screen manually, then request a fresh step";
}
// No screen pixels or typed text are stored in the session's navigation history.
const sessions = new WeakMap<object, { device: string; task: string; steps: string[] }>();
/** Guacamole 1.5 does not forward a tunnel's close/error to its Client state. */
export function bindRemoteTransport(client: any, tunnel: any, closedState: number) {
  const previousState = tunnel.onstatechange, previousError = tunnel.onerror;
  let ended = false, detached = false;
  const end = () => {
    if (ended || detached) return;
    ended = true;
    client.disconnect();
  };
  const stateChanged = (state: number) => {
    try { previousState?.call(tunnel, state); }
    finally { if (state === closedState) end(); }
  };
  const failed = (error: Item) => {
    try { previousError?.call(tunnel, error); }
    // WebSocketTunnel reports its error while still OPEN, then sets CLOSED.
    // Disconnecting recursively from onerror would re-enter its close path.
    finally { if (!ended && !detached) client.onerror?.(error); }
  };
  tunnel.onstatechange = stateChanged; tunnel.onerror = failed;
  return () => {
    detached = true;
    if (tunnel.onstatechange === stateChanged) tunnel.onstatechange = previousState;
    if (tunnel.onerror === failed) tunnel.onerror = previousError;
  };
}
/** A Guacamole Client silently drops input when its underlying tunnel closes. */
export function sendRemoteKeys(client: any, keys: number[], active: () => boolean) {
  const current = () => { if (!active()) throw new Error("The remote transport disconnected. Inspect the screen before continuing."); };
  for (const pressed of [1, 0]) for (const key of pressed ? keys : [...keys].reverse()) {
    current(); client.sendKeyEvent(pressed, key); current();
  }
}
export function openScreenAssistant(ui: Item, d: Item, client: any, sendKeys: (keys: number[]) => void, active: () => boolean) {
  const { api, esc, dialog } = ui;
  let session = sessions.get(client);
  if (!session || session.device !== d.id) {
    session = { device: d.id, task: "", steps: [] }; sessions.set(client, session);
  }
  const history = session;
  const modal: HTMLDialogElement = dialog("Screen assistant", `<p><b>${esc(d.label || d.id)}</b> · ${d.platform === "linux" ? "Linux" : "Windows"}</p><p>Each request shares the current remote screen and your task with OpenAI. A next-action request also shares up to five prior steps you applied in this session; typed text is omitted from that history.</p><div data-screen-config role="status">Checking AI connection…</div><label>Task<textarea id="screen-ai-prompt" required minlength="3" maxlength="8000" rows="3" placeholder="Help me navigate to the application’s connection settings"></textarea></label><div data-screen-history></div><div class="toolbar"><button id="screen-ai-explain" class="primary" disabled>Explain this screen</button><button id="screen-ai-step" class="secondary" disabled>Suggest next action</button><button id="screen-ai-cancel" class="secondary" hidden>Stop waiting</button></div><small>Nothing runs until you review and apply a proposed step. A changed screen or session requires a fresh request.</small><div id="screen-ai-result" aria-live="polite"></div>`);
  modal.classList.add("remote-ai-dialog", "assistant-dialog");
  const prompt = modal.querySelector<HTMLTextAreaElement>("#screen-ai-prompt")!;
  const out = modal.querySelector<HTMLElement>("#screen-ai-result")!;
  const config = modal.querySelector<HTMLElement>("[data-screen-config]")!;
  const sharedHistory = modal.querySelector<HTMLElement>("[data-screen-history]")!;
  const buttons = ["#screen-ai-explain", "#screen-ai-step"].map(id => modal.querySelector<HTMLButtonElement>(id)!);
  const cancel = modal.querySelector<HTMLButtonElement>("#screen-ai-cancel")!;
  let configured = false, busy = false, generation = 0, inputSent = false, controller: AbortController | undefined;
  prompt.value = history.task;
  const live = () => modal.isConnected && modal.open;
  const showHistory = () => {
    sharedHistory.innerHTML = history.steps.length ? `<details class="ai-shared-history"><summary>${history.steps.length} applied step${history.steps.length === 1 ? "" : "s"} shared with the next-action request</summary><ol>${history.steps.map(s => `<li>${esc(s)}</li>`).join("")}</ol></details>` : "";
  };
  const controls = () => {
    buttons.forEach(b => b.disabled = busy || !configured || !active());
    prompt.disabled = busy; cancel.hidden = !busy;
    showHistory();
  };
  const abandon = () => { generation++; controller?.abort(); busy = false; controls(); };
  modal.addEventListener("close", abandon);
  cancel.onclick = () => {
    abandon();
    if (inputSent) out.querySelector<HTMLElement>("[data-screen-outcome]")!.textContent = "Input was sent. Stopped waiting for the activity receipt; check Activity before continuing. This step cannot be applied again.";
    else out.innerHTML = '<p role="status">Stopped waiting. Your task is retained; no input was sent.</p>';
    cancel.textContent = "Stop waiting";
  };
  prompt.oninput = () => {
    if (prompt.value.trim() !== history.task) { history.task = prompt.value.trim(); history.steps = []; }
    showHistory();
    generation++;
    if (out.childElementCount) out.innerHTML = '<p class="muted">Task changed. Request a fresh screen review.</p>';
  };
  const loadConfig = async () => {
    config.textContent = "Checking AI connection…"; configured = false; controls();
    try {
      const cfg = await api("/ai/settings"); if (!live()) return;
      configured = !!cfg.configured;
      config.innerHTML = configured ? "Connected to OpenAI" : 'Connect OpenAI in <a href="#settings">Settings</a> to use AI assistance.';
      config.querySelector("a")?.addEventListener("click", () => modal.close());
      if (!active()) config.textContent = "The remote screen is not connected. Reconnect and wait for a visible screen.";
    } catch (err) {
      if (!live()) return;
      config.innerHTML = `<p role="alert">AI settings unavailable. ${esc((err as Error).message)}</p><button class="secondary" data-screen-retry>Retry AI connection</button>`;
      config.querySelector<HTMLButtonElement>("[data-screen-retry]")!.onclick = () => void loadConfig();
    } finally { if (live()) controls(); }
  };
  const capture = () => {
    if (!active()) throw new Error("This remote session is no longer connected. Reconnect and request a fresh step.");
    const canvas = client.getDisplay().flatten();
    if (!canvas.width || !canvas.height || canvas.width > 3840 || canvas.height > 2160)
      throw new Error("The remote screen is unavailable or too large. Use manual control.");
    return { image: canvas.toDataURL("image/jpeg", 0.8), width: canvas.width, height: canvas.height, at: Date.now() };
  };
  const ask = async (mode: "assist" | "computer") => {
    if (busy || !configured || !live()) return;
    prompt.value = prompt.value.trim(); if (!prompt.reportValidity()) return;
    if (history.task !== prompt.value) { history.task = prompt.value; history.steps = []; }
    const task = prompt.value, version = ++generation;
    controller = new AbortController(); inputSent = false; busy = true; controls();
    out.innerHTML = '<p class="working" role="status">Reviewing your current screen…</p>';
    try {
      const screen = capture();
      const result = await api("/ai/assist", "POST", { prompt: task, platform: d.platform, device_id: d.id, mode,
        image: screen.image, width: screen.width, height: screen.height,
        ...(mode === "computer" ? { previous_steps: [...history.steps] } : {}),
      }, controller.signal);
      if (!live() || version !== generation) return;
      if (!active()) throw new Error("This remote session ended. Reconnect and request a fresh review.");
      if (!result || typeof result.summary !== "string" || !result.summary.trim() ||
          ["caution", "verification"].some(k => result[k] != null && typeof result[k] !== "string"))
        throw new Error("AI returned an incomplete answer. Please retry.");
      const actions = mode === "computer" ? validateScreenActions(result.actions, screen.width, screen.height) : [];
      const manual = result.manual_required || actions.some(a => ["wait", "screenshot"].includes(a.type));
      if (actions.length && !manual && (typeof result.request_id !== "string" || !result.request_id)) throw new Error("This proposal cannot be recorded. Request a fresh step.");
      out.innerHTML = `<div class="ai-answer"><p>${esc(result.summary)}</p>${result.caution ? `<p class="callout">${esc(result.caution)}</p>` : ""}${mode === "assist" && result.verification ? `<h3>Verify</h3><p>${esc(result.verification)}</p>` : ""}<details class="ai-shared-screen"><summary>Screen shared · ${screen.width} × ${screen.height} · ${new Date(screen.at).toLocaleTimeString()}</summary><img src="${screen.image}" alt="Remote screen shared for this request"></details>${actions.length && !manual ? `<h3>Review this step</h3><ol class="ai-action-list">${actions.map(a => `<li>${esc(actionLabel(a))}${a.type === "type" ? `<pre>${esc(a.text)}</pre>` : ""}</li>`).join("")}</ol><p>Check the screen and each action before applying. Nothing has run.</p><button id="apply-screen-step" class="primary">Apply this step</button>` : mode === "computer" ? '<p class="callout">Use manual control for this step. Inspect the screen, then ask for a fresh step.</p>' : ""}<p data-screen-outcome role="status"></p></div>`;
      out.scrollIntoView({ block: "nearest" });
      let consumed = false;
      const apply = out.querySelector<HTMLButtonElement>("#apply-screen-step");
      if (apply) apply.onclick = async () => {
        if (consumed || version !== generation || !live()) return;
        const status = out.querySelector<HTMLElement>("[data-screen-outcome]")!;
        try {
          const current = capture();
          if (Date.now() - screen.at > 120000 || current.image !== screen.image || current.width !== screen.width || current.height !== screen.height)
            throw new Error("The screen changed or this proposal expired. Ask for a fresh step before applying it.");
          validateScreenActions(actions, screen.width, screen.height);
        } catch (err) { apply.disabled = true; status.textContent = (err as Error).message; return; }
        // Claim once before sending input: an uncertain local send or audit must never replay a step.
        consumed = true; apply.disabled = true; busy = true; controls();
        const connected = () => { if (!active()) throw new Error("The remote transport disconnected."); };
        const mouse = (state: Item) => { connected(); client.sendMouseState(state); connected(); };
        const keys = (sequence: number[]) => { connected(); sendKeys(sequence); connected(); };
        try {
          for (const a of actions) {
            const state = { x: a.x, y: a.y, left: false, middle: false, right: false, up: false, down: false };
            if (["click", "double_click", "move"].includes(a.type)) {
              mouse(state);
              if (a.type !== "move") for (let i = 0; i < (a.type === "double_click" ? 2 : 1); i++) {
                mouse({ ...state, [a.type === "double_click" ? "left" : a.button]: true }); mouse(state);
              }
            } else if (a.type === "type") {
              for (const key of remoteTextKeys(a.text)) keys([key]);
            } else if (a.type === "keypress") keys(a.keys.map((k: string) => keyNames[k.toUpperCase()] ?? k.codePointAt(0)!));
            else if (a.type === "scroll") for (let i = 0; i < Math.ceil(Math.abs(a.scroll_y) / 80); i++) {
              mouse({ ...state, [a.scroll_y > 0 ? "down" : "up"]: true }); mouse(state);
            }
          }
        } catch {
          history.steps = [];
          if (live()) status.textContent = "Input may have been sent. Inspect the screen manually; this step cannot be applied again.";
          busy = false; controls(); return;
        }
        history.steps = [...history.steps, actions.map(a => actionLabel(a, true)).join("; ").slice(0, 500)].slice(-5);
        inputSent = true;
        if (live()) status.textContent = "Input sent. Recording the reviewed step…";
        // Stopping a receipt request never makes consumed input replayable.
        controller = new AbortController(); cancel.textContent = "Stop waiting for receipt";
        try {
          await api("/ai/actions/applied", "POST", { request_id: result.request_id, device_id: d.id, actions: actions.map(a => a.type) }, controller.signal);
          if (live() && version === generation) status.textContent = "Step applied and recorded. Inspect the screen before asking for another.";
        } catch {
          if (live() && version === generation) status.textContent = "Input was sent. The activity receipt could not be confirmed. Check Activity; this step cannot be applied again.";
        } finally { if (version === generation) { busy = false; cancel.textContent = "Stop waiting"; if (live()) controls(); } }
      };
    } catch (err) {
      if (live() && version === generation) out.innerHTML = `<p class="callout" role="alert">${esc((err as Error).message)}</p><p>Your task is retained. No input was sent; you can retry.</p>`;
    } finally { if (version === generation) { busy = false; if (live()) controls(); } }
  };
  buttons[0].onclick = () => void ask("assist"); buttons[1].onclick = () => void ask("computer");
  void loadConfig();
  return modal;
}
import { remoteTextKeys } from "./remote-input";

