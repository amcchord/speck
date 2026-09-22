/** Shared, accessible loading state. Labels are plain text, never markup. */
export function loadingState(label = "Loading…", detail = "") {
  const escape = (text: string) => text.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  return `<div class="loading-state" role="status" aria-live="polite"><span class="loading-orbit" aria-hidden="true"><i></i><img src="/assets/brand/speck-mark-forest.svg" alt=""></span><strong>${escape(label)}</strong>${detail ? `<small>${escape(detail)}</small>` : ""}</div>`;
}

export class StaleViewError extends Error {
  constructor() { super("This view is no longer active"); this.name = "StaleViewError"; }
}

/** Prevent delayed responses (including completed mutations) from repainting a newer view. */
export function createViewScope() {
  let version = 0;
  return {
    reset() { version++; },
    checkpoint() {
      const started = version;
      return () => { if (started !== version) throw new StaleViewError(); };
    },
  };
}
