import {downloadRecovery} from "./recovery-export";
import {
  detailFacts as facts,
  detailSection as section,
  detailHero as hero,
  detailStatus as status,
  detailDate as date,
  escapeDetail as e,
  technicalDetail,
} from "./resource-story";
import {
  rememberResource,
  registerResource,
  resourceHref,
} from "./resource-navigation";
type Item = Record<string, any>;
const link = (kind: string, id: any, label: string, resourceKind?: string) =>
  id
    ? `<a href="${resourceHref(location.hash.slice(1), { kind, id: String(id), resourceKind })}">${e(label)} →</a>`
    : '<span class="resource-note">Not recorded</span>';
export function recoveryReadiness(plan: Item, runs: Item[], devices: Item[]) {
  const history = runs.filter((r) => r.plan_id === plan.id),
    verified = history.find((r) => r.report?.passed);
  const sources = plan.spec.members.map((m: Item) =>
    devices.find((d) => d.id === m.device_id),
  );
  return {
    verified,
    latest: history[0],
    history,
    ready: sources.filter(
      (d: Item) =>
        d &&
        d.approved &&
        !d.archived &&
        !d.revoked &&
        Date.now() / 1000 - d.last_seen < 90,
    ).length,
    total: sources.length,
  };
}
export function createRecoveryInspection(ui: Item) {
  async function openPlan(id: string) {
    const [plans, runs, devices] = await Promise.all([
      ui.api("/recovery/plans"),
      ui.api("/recovery/runs"),
      ui.api("/devices?include_archived=true"),
    ]);
    const p = plans.find((x: Item) => x.id === id);
    if (!p) throw new Error("Recovery plan unavailable");
    rememberResource({ kind: "recovery-plan", id }, () => openPlan(id));
    const r = recoveryReadiness(p, runs, devices);
    ui.flyout(
      p.name,
      hero(
        "Recovery plan",
        r.verified ? "Historically verified" : "Not yet verified",
        "Current source availability and historical recovery proof are separate observations.",
        [
          ["Available approved sources", r.ready + " / " + r.total],
          [
            "Latest verified run",
            r.verified
              ? date(r.verified.report.verified_at || r.verified.created)
              : "None",
          ],
        ],
      ) +
        section(
          "Isolation",
          facts([
            ["Private subnet", p.spec.router_prefix],
            ["WireGuard subnet", p.spec.wg_prefix],
            ["Deadline", p.spec.timeout_minutes + " minutes"],
            [
              "Connectivity",
              "New isolated network with Internet access; no production LAN bridge",
            ],
          ]),
        ) +
        section(
          "Source systems",
          p.spec.members
            .map((m: Item) =>
              section(
                devices.find((d: Item) => d.id === m.device_id)?.label ||
                  m.device_id,
                link("machine", m.device_id, "Original machine") +
                  " · " +
                  link("slide", m.slide_agent_id, "Protected system", "agent") +
                  " · " +
                  link(
                    "slide",
                    m.restore_device_id,
                    "Restore appliance",
                    "device",
                  ) +
                  facts([
                    ["CPU allocation", m.cpu_count],
                    ["Memory allocation", m.memory_in_mb + " MiB"],
                    [
                      "Proof rule",
                      m.compare_output
                        ? "Successful command with exact matching trimmed output"
                        : "Successful command exit code",
                    ],
                  ]) +
                  `<details class="resource-technical"><summary>Reviewed proof commands</summary><h4>Original baseline</h4><pre>${e(m.baseline_script)}</pre><h4>Isolated restored copy</h4><pre>${e(m.recovery_script)}</pre></details>`,
              ),
            )
            .join(""),
        ) +
        section(
          "Execution history",
          r.history
            .map(
              (run: Item) =>
                `<p>${link("recovery-run", run.id, date(run.created))} ${status(run.status)} ${run.report?.passed ? " · historical proof retained" : ""}</p>`,
            )
            .join("") || "<p>No runs recorded.</p>",
        ) +
        '<p class="resource-note">Source availability alone does not establish recoverability. Starting a test still validates provider access, snapshots and isolated restore resources.</p>',
      { tone: "protection", subtitle: "Recovery · Plan" },
    );
  }
  async function openRun(id: string) {
    const [runs, devices] = await Promise.all([
      ui.api("/recovery/runs"),
      ui.api("/devices?include_archived=true"),
    ]);
    const r = runs.find((x: Item) => x.id === id);
    if (!r) throw new Error("Recovery run unavailable");
    rememberResource({ kind: "recovery-run", id }, () => openRun(id));
    const verified = r.report?.verified_at;
    const pane=ui.flyout(
      r.state.name || "Recovery run",
      hero(
        "Isolated recovery",
        r.status,
        r.report?.passed
          ? "Historical application proof passed. Inspect current inventory for the present state."
          : "Follow source, recovery point and isolated copy to inspect each check.",
      ) +
        facts([
          ["Initiator", r.state.actor],
          ["Started", date(r.created)],
          ["Last update", date(r.updated)],
          [
            "Verified",
            verified
              ? date(verified)
              : r.report?.passed
                ? "Legacy proof; completion timestamp was not retained"
                : "Not verified",
          ],
          [
            "Time to verification",
            verified
              ? Math.round((verified - r.created) / 60) + " minutes"
              : null,
          ],
          [
            "Cleanup",
            r.status === "stopped"
              ? "Restored VMs stopped; snapshots, VMs, network and evidence retained"
              : "No completed cleanup recorded",
          ],
        ]) +
        link("recovery-plan", r.plan_id, "Inspect plan") +
        (r.state.error
          ? `<p class="resource-notice">${e(r.state.error)}</p>`
          : "") +
        section(
          "Phase timeline",
          (r.state.timeline || [])
            .map(
              (t: Item) =>
                `<p><time>${e(date(t.at))}</time> · <b>${e(t.phase.replaceAll("_", " "))}</b> · ${e(t.status)}</p>`,
            )
            .join("") ||
            `<p>Current recorded phase: ${e(r.phase)}. Detailed phase timestamps were not retained for this older run.</p>`,
        ) +
        section(
          "Recovery evidence",
          (r.state.members || [])
            .map((m: Item) => {
              const proof = (r.report.members || []).find(
                  (p: Item) => p.source_device_id === m.source_device_id,
                ),
                restored = devices.find(
                  (d: Item) => d.id === m.restored_device_id,
                ),
                snapshot = m.snapshot_verification || {};
              return section(
                devices.find((d: Item) => d.id === m.source_device_id)?.label ||
                  m.source_device_id,
                link("machine", m.source_device_id, "Original machine") +
                  " · " +
                  link("slide", m.snapshot_id, "Recovery point", "snapshot") +
                  " · " +
                  link(
                    "machine",
                    m.restored_device_id,
                    restored?.archived
                      ? "Archived restored copy"
                      : "Restored copy",
                  ) +
                  facts([
                    ["Backup status", m.backup_status],
                    [
                      "Snapshot time",
                      date(snapshot.backup_ended_at || snapshot.created_at),
                    ],
                    [
                      "Data age at start",
                      snapshot.backup_ended_at
                        ? Math.max(
                            0,
                            Math.round(
                              (r.created -
                                Date.parse(snapshot.backup_ended_at) / 1000) /
                                60,
                            ),
                          ) + " minutes"
                        : null,
                    ],
                    ["Provider restore ID", m.virt_id],
                    [
                      "Current restored inventory",
                      restored
                        ? restored.archived
                          ? "Archived"
                          : Date.now() / 1000 - restored.last_seen < 90
                            ? "Recently reporting"
                            : "Not recently reporting"
                        : "Unavailable",
                    ],
                    [
                      "Proof",
                      proof
                        ? proof.passed
                          ? "Passed"
                          : "Failed"
                        : "Not completed",
                    ],
                    [
                      "Comparison",
                      proof?.compared
                        ? proof.output_matches
                          ? "Baseline and restored output matched"
                          : "Outputs differed"
                        : "Output comparison not required / not recorded",
                    ],
                  ]) +
                  link("job", m.baseline_job_id, "Original baseline output") +
                  " · " +
                  link("job", m.verify_job_id, "Restored verification output"),
              );
            })
            .join(""),
        ) +
        '<section class="resource-section"><h3>Private recovery report</h3><label>Retest objective (days)<input data-report-retest type="number" min="1" max="365" value="30"></label><button class="secondary" data-recovery-export>Download private recovery report</button><p data-export-status role="status">Export includes measured evidence and limitations; no command output or credentials.</p></section>'+technicalDetail({ state: r.state, report: r.report }),
      { tone: "protection", subtitle: "Recovery · Evidence" },
    );
    pane.querySelector('[data-recovery-export]').onclick=async()=>{try{const days=Number(pane.querySelector('[data-report-retest]').value);const report=await ui.api('/recovery/runs/'+encodeURIComponent(id)+'/evidence?retest_days='+days);downloadRecovery(report);pane.querySelector('[data-export-status]').textContent='Private report downloaded. Open it locally to print or save as PDF.';}catch(error){pane.querySelector('[data-export-status]').textContent=(error as Error).message;}};
  }
  registerResource("recovery-plan", (ref) => openPlan(ref.id));
  registerResource("recovery-run", (ref) => openRun(ref.id));
  return { openPlan, openRun };
}
