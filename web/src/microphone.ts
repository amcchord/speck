type Environment = {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createContext: () => AudioContext;
  createNode: (context: AudioContext) => AudioWorkletNode;
  createWriter: (stream: any) => any;
};

/** Own every capture resource so cancel, disconnect and late permission replies stop the mic. */
export function startMicrophone(
  client: any,
  handlers: { state: (state: "starting" | "waiting" | "active" | "stopped") => void; error: (message: string) => void },
  env: Environment,
) {
  let stopped = false;
  let media: MediaStream | null = null;
  let context: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let node: AudioWorkletNode | null = null;
  let stream: any = null;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (node) { node.port.onmessage = null; node.disconnect(); }
    source?.disconnect();
    media?.getTracks().forEach((track) => track.stop());
    if (context) void context.close().catch(() => {});
    stream?.sendEnd();
    handlers.state("stopped");
  };
  const fail = (message: string) => {
    if (stopped) return;
    stop(); handlers.error(message);
  };
  handlers.state("starting");
  void (async () => {
    try {
      const acquired = await env.getUserMedia({ audio: true });
      if (stopped) { acquired.getTracks().forEach((track) => track.stop()); return; }
      media = acquired;
      context = env.createContext();
      await context.audioWorklet.addModule('/assets/speck-microphone-v1.js');
      if (stopped) return;
      await context.resume();
      if (stopped) return;
      node = env.createNode(context);
      source = context.createMediaStreamSource(media);
      stream = client.createAudioStream(`audio/L16;rate=${context.sampleRate},channels=1`);
      const writer = env.createWriter(stream);
      let active = false;
      // RDP acknowledges input only when a remote application opens the
      // recording device. Waiting for that application is not a timeout error.
      handlers.state("waiting");
      writer.onack = (status: { code: number }) => {
        if (stopped) return;
        if (status.code === 0x0206) { stop(); return; } // RESOURCE_CLOSED: recording ended normally.
        if (status.code !== 0) { fail("The remote machine closed microphone input."); return; }
        if (active) return;
        active = true;
        node!.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
          if (!stopped && event.data.byteLength <= 16384) writer.sendData(event.data);
        };
        source!.connect(node!); node!.connect(context!.destination);
        handlers.state("active");
      };
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      fail(name === "NotFoundError" ? "No microphone was found. Connect an input device and try again."
        : name === "NotAllowedError" ? "Microphone access was not allowed. Enable it in system permissions and try again."
        : "Microphone access failed. Check the device and permission, then try again.");
    }
  })();
  return { stop };
}
