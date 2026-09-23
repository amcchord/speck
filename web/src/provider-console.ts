import Guacamole from "guacamole-common-js";
import { useReliableImageDecoder } from "./remote-startup";
type Item = Record<string, any>;
export async function openProviderConsole(ui: Item, resource: Item) {
  const d: HTMLDialogElement = ui.dialog(
    resource.name + " · provider console",
    `<div class="infra-console-toolbar"><span role="status">Connecting…</span><button class="secondary" data-cad>Ctrl + Alt + Del</button><button class="secondary" data-fit>View at 100%</button><button class="secondary" data-full>Full screen</button><button class="secondary" data-reconnect>Reconnect</button></div><div class="infra-console-stage" tabindex="0" aria-label="Virtual machine console"></div><small class="muted">Provider console · Works without a Speck agent inside the guest · Click the screen to send keyboard input</small>`,
  );
  d.classList.add("infra-console");
  const stage = d.querySelector<HTMLElement>(".infra-console-stage")!;
  const status = d.querySelector<HTMLElement>("[role=status]")!;
  let sessionID = "",
    client: any = null,
    keyboard: any = null,
    observer: ResizeObserver | null = null,
    fit = true,
    closed = false;
  const release = () => keyboard?.reset();
  window.addEventListener("blur", release);
  stage.addEventListener("blur", release);
  d.addEventListener("close", () => {
    closed = true;
    release();
    window.removeEventListener("blur", release);
    observer?.disconnect();
    client?.disconnect();
    if (sessionID)
      void ui.api("/remote/sessions/" + sessionID, "DELETE").catch(() => {});
    if (document.fullscreenElement === d) void document.exitFullscreen();
  });
  try {
    const session = await ui.api(
      "/infrastructure/connections/" + resource.connection_id + "/console",
      "POST",
      { kind: resource.kind, resource_id: resource.id },
    );
    sessionID = session.id;
    if (closed) {
      await ui.api("/remote/sessions/" + sessionID, "DELETE");
      return;
    }
    const tunnel = new Guacamole.WebSocketTunnel(
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/remote/sessions/${session.id}/ws`,
    );
    client = new Guacamole.Client(tunnel);
    const display = client.getDisplay();
    useReliableImageDecoder(display, Guacamole, navigator.userAgent);
    stage.append(display.getElement());
    const resize = () =>
      display.scale(
        fit
          ? Math.min(
              stage.clientWidth / Math.max(1, display.getWidth()),
              stage.clientHeight / Math.max(1, display.getHeight()),
            )
          : 1,
      );
    display.onresize = resize;
    observer = new ResizeObserver(resize);
    observer.observe(stage);
    client.onerror = (error: Item) => {
      status.textContent =
        error.message || "Console connection ended. Reconnect to try again.";
    };
    client.onstatechange = (state: number) => {
      if (state === 3) status.textContent = "Connected";
      if (state === 5) status.textContent = "Disconnected";
    };
    const mouse = new Guacamole.Mouse(display.getElement());
    mouse.onEach(["mousedown", "mouseup", "mousemove"], (e: Item) =>
      client.sendMouseState(e.state, true),
    );
    const touch = new Guacamole.Mouse.Touchscreen(display.getElement());
    touch.onEach(["mousedown", "mouseup", "mousemove"], (e: Item) =>
      client.sendMouseState(e.state, true),
    );
    keyboard = new Guacamole.Keyboard(stage);
    keyboard.onkeydown = (key: number) => {
      client.sendKeyEvent(1, key);
      return false;
    };
    keyboard.onkeyup = (key: number) => client.sendKeyEvent(0, key);
    stage.addEventListener("mousedown", () => stage.focus(), true);
    (d.querySelector("[data-cad]") as HTMLButtonElement).onclick = () => {
      [0xffe3, 0xffe9, 0xffff].forEach((k) => client.sendKeyEvent(1, k));
      [0xffff, 0xffe9, 0xffe3].forEach((k) => client.sendKeyEvent(0, k));
      stage.focus();
    };
    (d.querySelector("[data-fit]") as HTMLButtonElement).onclick = (e) => {
      fit = !fit;
      (e.currentTarget as HTMLElement).textContent = fit
        ? "View at 100%"
        : "Fit to window";
      resize();
    };
    (d.querySelector("[data-full]") as HTMLButtonElement).onclick = () => {
      void (
        document.fullscreenElement
          ? document.exitFullscreen()
          : d.requestFullscreen()
      ).catch(() => {});
    };
    (d.querySelector("[data-reconnect]") as HTMLButtonElement).onclick =
      async () => {
        client?.disconnect();
        await ui.api("/remote/sessions/" + sessionID, "DELETE");
        d.close();
        await openProviderConsole(ui, resource);
      };
    client.connect();
  } catch (e) {
    status.textContent = (e as Error).message;
  }
}
