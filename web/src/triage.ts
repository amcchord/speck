import { resourceHref, type ResourceRef } from "./resource-navigation";
import { escapeDetail as e, detailDate } from "./resource-story";
type Item = Record<string, any>;
export type Attention = {
  key: string;
  group: string;
  title: string;
  detail: string;
  next: string;
  at?: number;
  ref?: ResourceRef;
  page?: string;
  priority: number;
};
export function operationalQueue(
  data: Item,
  now = Date.now() / 1000,
): Attention[] {
  const rows: Attention[] = [];
  for (const a of data.alerts?.items || []) {
    const historical =
      /^(job|remote):/.test(a.key || "") && now - a.opened > 86400;
    rows.push({
      key: "alert:" + a.id,
      group: historical
        ? "Historical / uncertain operations"
        : "Active incidents",
      title: a.title,
      detail:
        (a.label || "Machine") +
        " · " +
        (a.acknowledged ? "Acknowledged" : "Needs review"),
      next: historical
        ? "Inspect current machine state before retrying"
        : "Open evidence and run the suggested first check",
      at: a.opened,
      ref: { kind: "alert", id: a.id },
      priority: historical ? 5 : a.severity === "critical" ? 0 : 1,
    });
  }
  const devices = (data.fleet?.machines || []).filter(
    (d: Item) =>
      d.has_endpoint_agent !== false && d.approved && !d.archived && !d.revoked,
  );
  for (const d of devices) {
    const scan = (data.patches || []).find((r: Item) => r.device_id === d.id);
    if (
      data.patches &&
      d.telemetry?.capabilities?.managed_operations &&
      (!scan || now - scan.scanned > 86400)
    )
      rows.push({
        key: "patch:" + d.id,
        group: "Coverage gaps",
        title: scan
          ? "Patch evidence is stale"
          : "Patch inventory not collected",
        detail: d.label,
        next: "Review a fresh patch scan",
        at: scan?.scanned,
        ref: { kind: "machine", id: d.id, tab: "patches" },
        priority: 4,
      });
    const report = (data.software || []).find(
      (r: Item) => r.device_id === d.id,
    );
    if (data.software && (!report || now - report.collected > 86400))
      rows.push({
        key: "software:" + d.id,
        group: "Coverage gaps",
        title: report
          ? "Software evidence is stale"
          : "Software inventory not collected",
        detail: d.label,
        next: "Review read-only software collection",
        at: report?.collected,
        ref: { kind: "machine", id: d.id, tab: "inventory" },
        priority: 4,
      });
  }
  for (const s of data.sites?.sites || [])
    if (s.counts?.offlineDevice)
      rows.push({
        key: "network:" + s.id,
        group: "Network observations",
        title: s.counts.offlineDevice + " offline network devices reported",
        detail: s.name + " · " + s.state,
        next: "Inspect site equipment and observation freshness",
        at: data.sites.checked_at,
        ref: { kind: "site", id: String(s.id), connection: s.console_id },
        priority: 2,
      });
  for (const s of data.schedules || [])
    if (
      s.enabled &&
      ["skipped", "needs_review", "failed", "unknown"].includes(
        s.runs?.[0]?.status,
      )
    )
      rows.push({
        key: "schedule:" + s.id,
        group: "Automation exceptions",
        title: s.name + " · " + s.runs[0].status,
        detail: s.runs[0].reason || "Inspect per-machine results",
        next: "Review exclusions and next occurrence",
        at: s.runs[0].created,
        ref: { kind: "schedule", id: s.id },
        priority: 3,
      });
  const failures = (data.backup?.backup?.rows || []).filter((b: Item) =>
    ["failed", "error"].includes(b.status),
  );
  if (failures.length)
    rows.push({
      key: "backup:failures",
      group: "Backup observations",
      title: failures.length + " failed backup jobs in bounded history",
      detail:
        "Historical failures do not establish the current recovery-point state",
      next: "Review coverage and latest successful recovery point",
      page: "slide",
      priority: 3,
    });
  return rows.sort(
    (a, b) =>
      a.priority - b.priority ||
      (b.at || 0) - (a.at || 0) ||
      a.key.localeCompare(b.key),
  );
}
export function attentionList(
  rows: Attention[],
  page = "home",
  limit = Infinity,
) {
  return (
    rows
      .slice(0, limit)
      .map(
        (a) =>
          `<a class="home-alert" href="${a.ref ? resourceHref(page, a.ref) : "#" + a.page}"><span class="home-alert-dot ${a.priority === 0 ? "critical" : ""}"></span><span><small>${e(a.group)}</small><b>${e(a.title)}</b><small>${e(a.detail)} · ${a.at ? e(detailDate(a.at)) : "Observation not recorded"}</small><small>${e(a.next)} →</small></span></a>`,
      )
      .join("") ||
    '<p class="home-empty">No attention items in the loaded evidence. Missing sources are not an all-clear.</p>'
  );
}
