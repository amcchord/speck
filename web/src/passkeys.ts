/** WebAuthn JSON transport, including browsers without the newer JSON helpers. */
export function decode(value: string): ArrayBuffer {
  const text = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(text, (c) => c.charCodeAt(0)).buffer;
}
export function encode(value: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(value)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function available(): boolean {
  return window.isSecureContext && typeof PublicKeyCredential !== "undefined";
}
const descriptor = (v: any): PublicKeyCredentialDescriptor => ({ ...v, id: decode(v.id) });
export function creationOptions(v: any): PublicKeyCredentialCreationOptions {
  return { ...v, challenge: decode(v.challenge), user: { ...v.user, id: decode(v.user.id) },
    excludeCredentials: (v.excludeCredentials || []).map(descriptor) };
}
export function requestOptions(v: any): PublicKeyCredentialRequestOptions {
  return { ...v, challenge: decode(v.challenge), allowCredentials: (v.allowCredentials || []).map(descriptor) };
}
export function serialize(credential: PublicKeyCredential): object {
  const response = credential.response;
  const fields: Record<string, unknown> = { clientDataJSON: encode(response.clientDataJSON) };
  if ("attestationObject" in response) {
    const r = response as AuthenticatorAttestationResponse;
    fields.attestationObject = encode(r.attestationObject);
    fields.transports = r.getTransports?.() || [];
  } else {
    const r = response as AuthenticatorAssertionResponse;
    fields.authenticatorData = encode(r.authenticatorData);
    fields.signature = encode(r.signature);
    fields.userHandle = r.userHandle ? encode(r.userHandle) : null;
  }
  return { id: credential.id, rawId: encode(credential.rawId), type: credential.type,
    response: fields, clientExtensionResults: credential.getClientExtensionResults() };
}
export async function ceremony(options: any, register = false, signal?: AbortSignal): Promise<object> {
  if (!available()) throw new Error("Passkeys need a supported browser over HTTPS. You can still sign in with your password.");
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, 60000);
  let rejectAbort: () => void = () => {};
  const canceled = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(new DOMException("Passkey canceled", "AbortError"));
    controller.signal.addEventListener("abort", rejectAbort, { once: true });
  });
  try {
    if (controller.signal.aborted) rejectAbort();
    const pending = register
      ? navigator.credentials.create({ publicKey: creationOptions(options), signal: controller.signal })
      : navigator.credentials.get({ publicKey: requestOptions(options), signal: controller.signal });
    // Some embedded browsers leave their WebAuthn promise pending after abort.
    // Never let that trap the sign-in form or accept a late credential.
    const credential = await Promise.race([pending, canceled]);
    if (!credential) throw new Error("No passkey was selected.");
    return serialize(credential as PublicKeyCredential);
  } catch (error) {
    if (error instanceof DOMException) {
      if (["NotAllowedError", "AbortError"].includes(error.name))
        throw new Error("Passkey request canceled or timed out. Try again, or use your password.");
      if (error.name === "InvalidStateError") throw new Error("This passkey is already registered. Use another authenticator.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", rejectAbort);
  }
}
