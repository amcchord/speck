import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import "@xterm/xterm/css/xterm.css";
import "./web-shell.css";
import { wordmark } from "./icons";
import { loadingState } from "./loading";

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
type Device = {
  id: string;
  label: string;
  configured_remote_protocol?: string;
};

// A synchronous disposer owns even an in-flight session creation response.
export function openWebShell(
  host: HTMLElement,
  device: Device,
  csrf: string,
  expired: () => void,
) {
  host.innerHTML = `<main class="remote-workspace shell-workspace"><header class="remote-header"><a href="#fleet" class="remote-back">← Fleet</a>${wordmark(true)}<div class="remote-title"><h1>${escape(device.label)}</h1><small>Web shell · Linux</small></div><button id="shell-fullscreen" class="secondary">Full screen</button></header><div class="remote-controls shell-controls"><button id="shell-copy" class="secondary">Copy selection</button><button id="shell-paste" class="secondary" data-shell-input>Paste</button><label>Keys <select id="shell-keys" data-shell-input><option value="">Send shortcut…</option><option value="interrupt">Ctrl + C · interrupt</option><option value="eof">Ctrl + D · end input</option><option value="suspend">Ctrl + Z · suspend</option><option value="clear">Ctrl + L · clear</option><option value="enter">Enter</option><option value="backspace">Backspace</option><option value="tab">Tab</option><option value="escape">Escape</option><option value="up">↑ Previous command</option><option value="down">↓ Next command</option></select></label><button id="shell-smaller" class="secondary" aria-label="Decrease terminal font size">A−</button><button id="shell-larger" class="secondary" aria-label="Increase terminal font size">A+</button><button id="shell-reconnect" class="secondary">Reconnect</button><button id="shell-disconnect" class="secondary">Disconnect</button></div><div class="shell-search"><label for="shell-search">Search scrollback</label><input id="shell-search" type="search" placeholder="Find in this session" autocomplete="off"><button id="shell-previous" class="secondary" aria-label="Previous match">↑</button><button id="shell-next" class="secondary" aria-label="Next match">↓</button><span id="shell-match" role="status"></span></div><section class="shell-stage"><div id="shell-terminal" aria-label="Interactive terminal for ${escape(device.label)}"></div><div id="shell-startup" class="remote-startup">${loadingState("Opening web shell…", "Connecting through the Speck agent.")}</div></section><footer class="remote-footer shell-footer"><span id="shell-status" role="status">Connecting…</span><span id="shell-size"></span><span class="shell-account">Agent service account</span><label class="check"><input id="shell-screen-reader" type="checkbox"> Screen reader support</label>${device.configured_remote_protocol ? `<a href="#remote/${encodeURIComponent(device.id)}?mode=connection">Use saved ${escape(device.configured_remote_protocol.toUpperCase())} connection</a>` : ""}</footer></main>`;
  const root = host.querySelector<HTMLElement>(".shell-workspace")!;
  const element = <T extends HTMLElement = HTMLElement>(id: string) =>
    root.querySelector<T>("#" + id)!;
  const status = element("shell-status");
  const terminal = new Terminal({
    cursorBlink: true,
    cursorStyle: "bar",
    fontSize: 15,
    lineHeight: 1.2,
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
    scrollback: 10000,
    // xterm screen-reader mode suppresses insertText input (mobile/emoji).
    // Keep it opt-in so the normal terminal accepts those input methods.
    screenReaderMode: false,
    allowProposedApi: false,
    theme: {
      background: "#101d17",
      foreground: "#edf2e6",
      cursor: "#dcecab",
      cursorAccent: "#192e24",
      selectionBackground: "#385d44",
      black: "#192e24",
      red: "#f28c82",
      green: "#b9d890",
      yellow: "#ebd28f",
      blue: "#95b8df",
      magenta: "#d7a7d6",
      cyan: "#8cd3c5",
      white: "#edf2e6",
      brightBlack: "#9aae9d",
      brightRed: "#ffb0a5",
      brightGreen: "#dcecab",
      brightYellow: "#ffebae",
      brightBlue: "#b4d7ff",
      brightMagenta: "#f0c5ef",
      brightCyan: "#b2efe1",
      brightWhite: "#ffffff",
    },
  });
  const fit = new FitAddon(),
    search = new SearchAddon();
  terminal.loadAddon(fit);
  terminal.loadAddon(search);
  terminal.open(element("shell-terminal"));
  terminal.textarea?.setAttribute("aria-label", "Shell input");
  let disposed = false,
    ready = false,
    sessionId = "",
    generation = 0;
  let socket: WebSocket | undefined;
  let resizeTimer: ReturnType<typeof setTimeout>;
  let startupTimer: ReturnType<typeof setTimeout>;
  const native = (window as any).speckDesktop;
  const setReady = (value: boolean) => {
    ready = value;
    terminal.options.disableStdin = !value;
    root
      .querySelectorAll<
        HTMLButtonElement | HTMLSelectElement
      >("[data-shell-input]")
      .forEach((e) => (e.disabled = !value));
  };
  element<HTMLInputElement>("shell-screen-reader").addEventListener("change", (event) => {
    terminal.options.screenReaderMode = (event.target as HTMLInputElement).checked;
    terminal.focus();
  });
  setReady(false);
  const send = (message: object) => {
    if (socket?.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify(message));
  };
  const size = () => {
    element("shell-size").textContent = `${terminal.cols} × ${terminal.rows}`;
    if (ready)
      send({
        type: "resize",
        cols: Math.min(500, terminal.cols),
        rows: Math.min(200, terminal.rows),
      });
  };
  const resize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!disposed) {
        fit.fit();
        size();
      }
    }, 100);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(element("shell-terminal"));
  terminal.onResize(size);
  terminal.onData((data) => {
    if (!ready) return;
    // Bound each frame, including pasted Unicode, without splitting surrogate pairs.
    let part = "",
      count = 0;
    for (const char of data) {
      if (count + char.length > 4000) {
        send({ type: "input", data: part });
        part = "";
        count = 0;
      }
      part += char;
      count += char.length;
    }
    if (part) send({ type: "input", data: part });
  });
  const end = (id: string) => {
    if (id)
      void fetch(`/api/remote/sessions/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { "X-CSRF-Token": csrf },
        keepalive: true,
      }).catch(() => {});
  };
  const stop = () => {
    generation++;
    clearTimeout(startupTimer);
    setReady(false);
    socket?.close();
    socket = undefined;
    end(sessionId);
    sessionId = "";
    element("shell-startup").hidden = true;
  };
  const connect = async () => {
    stop();
    const current = generation;
    terminal.reset();
    element("shell-startup").hidden = false;
    status.textContent = "Connecting…";
    try {
      fit.fit();
      const response = await fetch(
        `/api/devices/${encodeURIComponent(device.id)}/remote/sessions`,
        {
          method: "POST",
          headers: { "X-CSRF-Token": csrf, "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "shell",
            cols: Math.min(500, terminal.cols),
            rows: Math.min(200, terminal.rows),
          }),
        },
      );
      const session = await response.json();
      if (disposed || current !== generation) {
        if (response.ok) end(session.id);
        return;
      }
      if (response.status === 401) {
        expired();
        return;
      }
      if (!response.ok)
        throw new Error(
          typeof session.detail === "string"
            ? session.detail
            : "Unable to open the web shell",
        );
      sessionId = session.id;
      const ws = (socket = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/remote/sessions/${encodeURIComponent(sessionId)}/ws`,
        "speck-shell",
      ));
      ws.binaryType = "arraybuffer";
      startupTimer = setTimeout(() => {
        if (current !== generation || disposed) return;
        stop();
        status.textContent =
          "Connection timed out. Check the agent, then reconnect.";
      }, 45000);
      ws.onmessage = (event) => {
        if (disposed || current !== generation) return;
        if (event.data instanceof ArrayBuffer) {
          terminal.write(new Uint8Array(event.data), () => {
            if (!disposed && current === generation) send({ type: "ack" });
          });
        } else {
          const message = JSON.parse(event.data);
          if (message.type === "ready") {
            clearTimeout(startupTimer);
            setReady(true);
            element("shell-startup").hidden = true;
            status.textContent = "Connected";
            fit.fit();
            size();
            terminal.focus();
          } else if (message.type === "error" || message.type === "ended") {
            stop();
            status.textContent =
              message.type === "error"
                ? message.message
                : "Shell ended. Reconnect to start a new session.";
          }
        }
      };
      ws.onclose = () => {
        if (disposed || current !== generation) return;
        stop();
        status.textContent = "Disconnected. Reconnect to start a new session.";
      };
      ws.onerror = () => {
        if (!disposed && current === generation)
          status.textContent =
            "Connection failed. Check the agent, then reconnect.";
      };
    } catch (error) {
      if (!disposed && current === generation) {
        stop();
        status.textContent = (error as Error).message;
      }
    }
  };
  const button = (id: string, action: () => void | Promise<void>) =>
    element(id).addEventListener("click", () => {
      void Promise.resolve()
        .then(action)
        .catch((error) => {
          if (!disposed) status.textContent = (error as Error).message;
        });
    });
  button("shell-reconnect", connect);
  button("shell-disconnect", () => {
    stop();
    status.textContent = "Disconnected. Reconnect to start a new session.";
  });
  button("shell-copy", async () => {
    const text = terminal.getSelection();
    if (!text) {
      status.textContent = "Select terminal text to copy.";
      return;
    }
    if (native?.writeClipboard) await native.writeClipboard(text);
    else await navigator.clipboard.writeText(text);
    status.textContent = "Selection copied";
    terminal.focus();
  });
  button("shell-paste", async () => {
    const current = generation;
    const text = native?.readClipboard
      ? await native.readClipboard()
      : await navigator.clipboard.readText();
    if (ready && !disposed && current === generation) {
      terminal.paste(text);
      terminal.focus();
    }
  });
  button("shell-smaller", () => {
    terminal.options.fontSize = Math.max(11, terminal.options.fontSize! - 1);
    fit.fit();
  });
  button("shell-larger", () => {
    terminal.options.fontSize = Math.min(24, terminal.options.fontSize! + 1);
    fit.fit();
  });
  const keys: Record<string, string> = {
    interrupt: "\x03",
    eof: "\x04",
    suspend: "\x1a",
    clear: "\x0c",
    enter: "\r",
    backspace: "\x7f",
    tab: "\t",
    escape: "\x1b",
    up: "\x1b[A",
    down: "\x1b[B",
  };
  element<HTMLSelectElement>("shell-keys").addEventListener(
    "change",
    (event) => {
      const select = event.target as HTMLSelectElement;
      if (ready && keys[select.value])
        send({ type: "input", data: keys[select.value] });
      select.value = "";
      terminal.focus();
    },
  );
  const find = (previous = false) => {
    const query = element<HTMLInputElement>("shell-search").value;
    const found = previous
      ? search.findPrevious(query)
      : search.findNext(query);
    element("shell-match").textContent = query && !found ? "No match" : "";
  };
  element("shell-search").addEventListener("input", () => find());
  element("shell-search").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      find(event.shiftKey);
    }
    if (event.key === "Escape") terminal.focus();
  });
  button("shell-previous", () => find(true));
  button("shell-next", () => find());
  terminal.attachCustomKeyEventHandler((event) => {
    if (
      (event.ctrlKey || event.metaKey) &&
      event.shiftKey &&
      event.code === "KeyF"
    ) {
      if (event.type === "keydown") element("shell-search").focus();
      return false;
    }
    if (
      (event.metaKey || (event.ctrlKey && event.shiftKey)) &&
      ["KeyC", "KeyV"].includes(event.code)
    ) {
      if (event.type === "keydown")
        element(event.code === "KeyC" ? "shell-copy" : "shell-paste").click();
      return false;
    }
    return true;
  });
  const fullscreenChanged = () => {
    element("shell-fullscreen").textContent = document.fullscreenElement
      ? "Exit full screen"
      : "Full screen";
    resize();
  };
  document.addEventListener("fullscreenchange", fullscreenChanged);
  const removeNativeFullscreen = native?.onFullscreen?.((full: boolean) => {
    element("shell-fullscreen").textContent = full
      ? "Exit full screen"
      : "Full screen";
    resize();
  });
  button("shell-fullscreen", async () => {
    if (native?.toggleFullscreen) await native.toggleFullscreen();
    else if (document.fullscreenElement) await document.exitFullscreen();
    else await root.requestFullscreen();
    terminal.focus();
  });
  window.addEventListener("pagehide", stop);
  void connect();
  return () => {
    disposed = true;
    stop();
    observer.disconnect();
    clearTimeout(resizeTimer);
    window.removeEventListener("pagehide", stop);
    document.removeEventListener("fullscreenchange", fullscreenChanged);
    removeNativeFullscreen?.();
    if (document.fullscreenElement === root) void document.exitFullscreen();
    terminal.dispose();
  };
}
