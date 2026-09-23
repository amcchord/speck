import Guacamole from "guacamole-common-js";
import { useReliableImageDecoder } from "./remote-startup";
type Item = Record<string, any>;

/** One view-only frame, held only in this pane. Never injects input or persists images. */
export function captureProviderPreview(
  ui: Item,
  resource: Item,
  signal: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let creation: Promise<Item> | undefined;
    let client: any,
      sessionID = "",
      finished = false,
      deleting: Promise<void> | undefined;
    const removeSession = () => {
      if (sessionID && !deleting)
        deleting = (ui.sessionApi || ui.api)(
          "/remote/sessions/" + sessionID,
          "DELETE",
        ).then(() => {});
      return deleting || Promise.resolve();
    };
    const finish = async (error?: Error, image?: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      client?.disconnect();
      try {
        if (creation && !sessionID) sessionID = (await creation).id;
        await removeSession();
      } catch {
        /* The server also expires previews after 65 seconds. */
      }
      if (error) reject(error);
      else resolve(image!);
    };
    const abort = () => {
      void finish(new Error("Preview cancelled"));
    };
    const timeout = setTimeout(() => {
      void finish(
        new Error(
          "Screen capture timed out. Refresh the preview to try again.",
        ),
      );
    }, 55000);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    void (async () => {
      try {
        creation = (ui.sessionApi || ui.api)(
          `/infrastructure/connections/${resource.connection_id}/console`,
          "POST",
          {
            kind: resource.kind,
            resource_id: resource.id,
            read_only: true,
          },
        );
        const session = await creation!;
        sessionID = session.id;
        if (finished) {
          await removeSession();
          return;
        }
        const tunnel = new Guacamole.WebSocketTunnel(
          `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/remote/sessions/${sessionID}/ws`,
        );
        client = new Guacamole.Client(tunnel);
        const display = client.getDisplay();
        useReliableImageDecoder(display, Guacamole, navigator.userAgent);
        client.onerror = (e: Item) => {
          void finish(
            new Error(
              e.message || "Screen capture failed. Try opening the console.",
            ),
          );
        };
        client.onstatechange = (state: number) => {
          if (state === 5 && !finished)
            void finish(
              new Error("The preview connection ended before a frame arrived."),
            );
        };
        client.onsync = () =>
          display.flush(() => {
            if (finished || display.getWidth() <= 0 || display.getHeight() <= 0)
              return;
            // A black/blank guest screen is still a valid frame. Do not wake the VM.
            try {
              void finish(undefined, display.flatten().toDataURL("image/png"));
            } catch {
              void finish(
                new Error("The console frame could not be captured."),
              );
            }
          });
        client.connect();
      } catch (e) {
        void finish(e as Error);
      }
    })();
  });
}

export function downloadScreen(data: string, name: string) {
  const link = document.createElement("a");
  link.download = `${name.replace(/[^a-zA-Z0-9_.-]/g, "_")}-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
  link.href = data;
  link.click();
}
