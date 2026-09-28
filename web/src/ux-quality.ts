import { escapeDetail as e } from "./resource-story";
type Item = Record<string, any>;
let queue: Item[] = [],
  sender: ((body: Item) => Promise<any>) | null = null;
const surfaces = new Set(
  "home fleet alerts schedules patches software infrastructure network slide recovery keys api activity settings workspaces maintenance quality browser".split(
    " ",
  ),
);
export function configureMetrics(send: (body: Item) => Promise<any>) {
  sender = send;
}
export function measureJourney(
  journey: string,
  surface: string,
  duration: number,
  outcome = "ready",
) {
  if (!surfaces.has(surface) || !Number.isFinite(duration)) return;
  queue.push({
    journey,
    surface,
    outcome,
    duration_ms: Math.min(600000, Math.max(0, Math.round(duration))),
  });
  queue = queue.slice(-30);
}
export function clearMetrics() {
  queue = [];
}
setInterval(() => {
  if (!sender || !queue.length) return;
  const items = queue;
  queue = [];
  void sender({ items }).catch(() => {});
}, 10000);
export function startJourney(journey: string, surface: string) {
  const start = performance.now();
  let finished = false;
  return (outcome = "ready") => {
    if (!finished) {
      finished = true;
      measureJourney(journey, surface, performance.now() - start, outcome);
    }
  };
}
export async function qualityPage(ui: Item) {
  const data = await ui.api("/ux/scorecard"),
    groups = new Map<string, Item[]>();
  data.rows.forEach((r: Item) => {
    const k = r.journey + " · " + r.surface;
    groups.set(k, [...(groups.get(k) || []), r]);
  });
  const quantile = (rows: Item[], p: number) => {
    const ready = rows
        .filter((r) => r.outcome === "ready")
        .sort((a, b) => a.bucket - b.bucket),
      total = ready.reduce((n, r) => n + r.count, 0);
    let n = 0;
    for (const r of ready) {
      n += r.count;
      if (n >= total * p) return "≤ " + r.bucket.toLocaleString() + " ms";
    }
    return "No successful samples";
  };
  ui.content(
    `<p>Last ${data.window_days} days · ${e(data.client)}. Targets: navigation feedback 100 ms, cached useful lists 200 ms, ordinary uncached lists 1 second under controlled test conditions. Production samples mix cache and network conditions.</p><div class="scroll"><table><thead><tr><th>Journey / surface</th><th>Samples</th><th>p50 bound</th><th>p95 bound</th><th>Failed / unknown / cancelled</th></tr></thead><tbody>${[...groups].map(([name, rows]) => `<tr><td>${e(name.replaceAll("_", " "))}</td><td>${rows.reduce((n, r) => n + r.count, 0)}</td><td>${quantile(rows, 0.5)}</td><td>${quantile(rows, 0.95)}</td><td>${rows.filter((r) => r.outcome !== "ready").reduce((n, r) => n + r.count, 0)}</td></tr>`).join("") || '<tr><td colspan="5">No observations yet. Instrumented journeys appear as operators use the console.</td></tr>'}</tbody></table></div><h3>Endpoint operation outcomes</h3><p>Jobs created in the last seven days. Completion describes the reported process result; it does not independently verify a requested effect.</p><div class="scroll"><table><thead><tr><th>Reported state</th><th>Jobs</th></tr></thead><tbody>${(data.operation_outcomes || []).map((r: Item) => `<tr><td>${e(r.status)}</td><td>${r.count}</td></tr>`).join("") || '<tr><td colspan="2">No endpoint operations recorded in this window.</td></tr>'}</tbody></table></div><p class="resource-note">${e(data.note)}</p><p>First content and full page enrichment are distinct measurements. Native desktop/iOS behavior and physical Windows/Linux sessions need separate acceptance; this scorecard does not certify them.</p>`,
  );
}
