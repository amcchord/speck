/** Safari's ImageBitmap decode can reject without unblocking Guacamole's queue.
 * Use Guacamole's Image-based stream decoder, which handles load AND error.
 * This is scoped to this display and leaves Chromium/native decoding unchanged. */
export function useReliableImageDecoder(display: any, Guacamole: any, userAgent: string) {
  if (!/AppleWebKit/i.test(userAgent) || /Chrome\/|Chromium\/|Edg\/|OPR\//i.test(userAgent)) return;
  display.drawStream = (layer: any, x: number, y: number, stream: any, mimetype: string) => {
    const reader = new Guacamole.DataURIReader(stream, mimetype);
    reader.onend = () => display.draw(layer, x, y, reader.getURI());
  };
}

/** Ignore transparent/black initial canvases. Cursor is a separate Guacamole layer. */
export function hasVisiblePixels(pixels: ArrayLike<number>) {
  let visible = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] > 0 && Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 16 && ++visible >= 4) return true;
  }
  return false;
}

type StartupOptions = {
  visible: () => boolean;
  ready: () => boolean;
  wake: () => void;
  recover: () => void;
  show: () => void;
  stalled: () => void;
  canRecover: boolean;
};

/** Count foreground time only. Never reconnect a desktop the operator has used. */
export function watchRemoteStartup(options: StartupOptions) {
  let connected = false, done = false, interacted = false, elapsed = 0, woke = false;
  const stop = () => { done = true; clearInterval(timer); };
  const show = () => { if (done) return; stop(); options.show(); };
  const timer = setInterval(() => {
    if (!connected || done) return;
    if (options.ready()) return show();
    if (!options.visible()) return;
    elapsed += 500;
    if (elapsed >= 2000 && !woke && !interacted) { woke = true; options.wake(); }
    if (elapsed >= 12000) {
      stop();
      if (options.canRecover && !interacted) options.recover();
      else options.stalled();
    }
  }, 500);
  return {
    connected() { connected = true; },
    interacted() { interacted = true; },
    show,
    stop,
  };
}
