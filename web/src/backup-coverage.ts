import { backupEvidence } from "./backup-evidence";
import {
  escapeDetail as e,
  detailDate,
  detailSection as section,
} from "./resource-story";
import { listWorkspace } from "./list-workspace";
type Item = Record<string, any>;
export function mountBackupCoverage(
  ui: Item,
  root: HTMLElement,
  agents: Item[],
  open: (kind: string, row: Item) => void,
) {
  root.innerHTML =
    '<p class="resource-note">Loading protection evidence independently of inventory…</p>';
  void ui
    .api("/slide/coverage")
    .then((data: Item) => {
      if (!root.isConnected) return;
      const rows = agents.map((a) => {
        const b = data.backup.rows.filter(
            (r: Item) => r.agent_id === a.agent_id,
          ),
          s = data.snapshot.rows.filter((r: Item) => r.agent_id === a.agent_id);
        return {
          a,
          b,
          s,
          evidence: backupEvidence(
            {
              backup: {
                data: {
                  rows: b,
                  next_offset: data.backup.partial ? 100 : null,
                },
              },
              snapshot: {
                data: {
                  rows: s,
                  next_offset: data.snapshot.partial ? 100 : null,
                },
              },
            },
            a,
          ),
        };
      });
      root.innerHTML = section(
        "Protection coverage",
        `<p class="resource-note">${e(data.note)}</p>${data.backup.error || data.snapshot.error ? '<p class="resource-notice">Some provider evidence is unavailable. Coverage remains partial.</p>' : ""}<div class="table-wrap"><table><thead><tr><th>Protected system</th><th>Latest observed recovery point</th><th>Provider verification</th><th>Evidence</th></tr></thead><tbody>${rows.map((r, i) => `<tr data-coverage-status="${e(r.evidence.state)}"><td><button class="text-link" data-coverage-agent="${i}">${e(r.a.display_name || r.a.hostname || r.a.agent_id)}</button></td><td>${e(detailDate(r.evidence.latestPoint))}<small>${e(r.evidence.state)}</small></td><td>${r.evidence.verified ? e(detailDate(r.evidence.verified)) : "No passed verification in returned evidence"}</td><td>${r.evidence.failed} failed jobs · ${r.evidence.complete ? "Complete returned history" : "Partial history"}</td></tr>`).join("")}</tbody></table></div><button class="secondary" data-backup-calendar>Explore recovery-point calendar</button>`,
      );
      root
        .querySelectorAll<HTMLElement>("[data-coverage-agent]")
        .forEach(
          (b) =>
            (b.onclick = () =>
              open("agent", rows[Number(b.dataset.coverageAgent)].a)),
        );
      listWorkspace(root, "tbody tr", "backup-coverage", {
        size: 25,
        filters: [
          {
            label: "Evidence",
            values: [...new Set(rows.map((r) => r.evidence.state))],
            value: (r) => r.dataset.coverageStatus!,
          },
        ],
      });
      root
        .querySelector("[data-backup-calendar]")!
        .addEventListener("click", () => {
          const snapshots: Item[] = data.snapshot.rows;
          const days = [
            ...new Set(
              snapshots.map((s) =>
                String(s.backup_ended_at || s.created_at || "").slice(0, 10),
              ),
            ),
          ]
            .filter(Boolean)
            .sort()
            .reverse();
          const pane: HTMLDialogElement = ui.flyout(
            "Recovery-point calendar",
            '<p class="resource-note">Recorded provider snapshot dates. Blank dates do not establish missed backups; this overview is bounded to the first 100 returned snapshots.</p>' +
              days
                .map((day) =>
                  section(
                    day,
                    snapshots
                      .map((s, i) => ({ s, i }))
                      .filter(({ s }) =>
                        String(
                          s.backup_ended_at || s.created_at || "",
                        ).startsWith(day),
                      )
                      .map(
                        ({ s, i }) =>
                          `<button class="secondary" data-calendar-snapshot="${i}">${e(agents.find((a) => a.agent_id === s.agent_id)?.display_name || s.agent_id)} · ${e(detailDate(s.backup_ended_at || s.created_at))}</button>`,
                      )
                      .join(""),
                  ),
                )
                .join(""),
            { tone: "protection" },
          );
          pane
            .querySelectorAll<HTMLElement>("[data-calendar-snapshot]")
            .forEach(
              (b) =>
                (b.onclick = () =>
                  open(
                    "snapshot",
                    snapshots[Number(b.dataset.calendarSnapshot)],
                  )),
            );
        });
    })
    .catch((error: Error) => {
      if (root.isConnected)
        root.innerHTML =
          '<p class="resource-notice">Coverage unavailable. ' +
          e(error.message) +
          "</p>";
    });
}
