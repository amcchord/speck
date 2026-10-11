import { escapeDetail as e, detailDate } from "./resource-story";
type Item = Record<string, any>;
export function recoveryDocument(report: Item): string {
  const fields = (data: Item) =>
    "<dl>" +
    Object.entries(data)
      .map(
        ([k, v]) =>
          `<dt>${e(k.replaceAll("_", " "))}</dt><dd>${e(v ?? "Not recorded")}</dd>`,
      )
      .join("") +
    "</dl>";
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Private recovery evidence</title><style>body{font:15px/1.5 system-ui;max-width:900px;margin:40px auto;padding:24px;color:#172638}h1{font-size:32px}h2{border-top:1px solid #ccc;padding-top:20px}dt{font-weight:600}dd{margin:0 0 12px;overflow-wrap:anywhere}.private{color:#765726}@media print{body{margin:0}h2{break-after:avoid}section{break-inside:avoid}}</style><p class="private">PRIVATE · Recovery evidence · ${e(detailDate(report.generated_at))}</p><h1>${e(report.name)}</h1>${fields({ run: report.run_id, plan: report.plan_id, initiator: report.actor, status: report.status, started: detailDate(report.started), verified: detailDate(report.verified_at), measured_time_to_verification: report.measured_time_to_verification_seconds == null ? "Not measured" : report.measured_time_to_verification_seconds + " seconds", retest_objective: report.retest_days + " days", next_retest: detailDate(report.next_retest_due) })}<h2>Isolation</h2><p>${e(report.isolation)}</p><h2>Systems and application checks</h2>${report.members.map((m: Item) => `<section><h3>${e(m.source_name)}</h3>${fields({ ...m, snapshot_at: detailDate(m.snapshot_at) })}</section>`).join("") || "<p>No member evidence recorded.</p>"}<h2>Observed timeline</h2>${report.timeline.map((t: Item) => `<p>${e(detailDate(t.at))} · ${e(t.phase)} · ${e(t.status)}</p>`).join("") || "<p>Phase timestamps were not retained.</p>"}<h2>Cleanup</h2><p>${e(report.cleanup)}</p><h2>Exceptions and limits</h2><ul>${[...report.exceptions, ...report.limits].map((v) => "<li>" + e(v) + "</li>").join("")}</ul></html>`;
}
export function downloadRecovery(report: Item) {
  const url = URL.createObjectURL(
    new Blob([recoveryDocument(report)], { type: "text/html" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "speck-recovery-" + report.run_id + ".html";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
