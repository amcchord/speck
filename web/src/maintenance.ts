import {
  escapeDetail as e,
  detailSection as section,
  detailDate,
} from "./resource-story";
import { resourceHref } from "./resource-navigation";
import { listWorkspace } from "./list-workspace";
type Item = Record<string, any>;
export function createMaintenance(ui: Item) {
  async function render() {
    ui.loading("Loading reviewed maintenance…");
    const [schedules, books, runs] = await Promise.all([
      ui.api("/schedules"),
      ui.api("/maintenance/runbooks"),
      ui.api("/maintenance/runs"),
    ]);
    ui.content(
      `<p>Start from an editable routine. Every schedule previews exact scripts, target coverage and exclusions. Patch installation and credential rotation are never implied by an inventory routine.</p><div class="routine-grid">${[
        [
          "inspection.software",
          "Software freshness",
          "Collect machine applications on Windows and dpkg/RPM packages on Linux.",
        ],
        [
          "patch.scan",
          "Patch readiness",
          "Inventory available updates; no installation or reboot.",
        ],
        [
          "windows",
          "Windows health",
          "Review uptime, storage and automatic-service state.",
        ],
        [
          "linux",
          "Linux health",
          "Review uptime, storage and failed systemd units.",
        ],
      ]
        .map(
          ([kind, name, detail]) =>
            `<article class="panel"><h2>${name}</h2><p>${detail}</p><button class="secondary" data-routine="${kind}">Review daily routine</button></article>`,
        )
        .join(
          "",
        )}</div><div class="section-head"><h2>Reusable runbooks</h2><button class="primary" data-new-runbook>Create a reviewed runbook</button></div><p>Gather → reviewed change → verification. Each stage requires a separate confirmation; an unsuccessful or uncertain stage blocks the next one.</p><div data-runbooks>${books.map((b: Item, i: number) => `<article class="panel"><h3>${e(b.name)}</h3><p>${b.spec.stages[0].device_ids.length} targets · ${e(b.spec.stages.map((s: Item) => s.kind).join(" → "))}</p><button class="secondary" data-start-runbook="${i}">Start review</button></article>`).join("") || "<p>No saved runbooks.</p>"}</div>${section("Current routines", schedules.map((s: Item) => `<p><a href="${resourceHref("maintenance", { kind: "schedule", id: s.id })}">${e(s.name)} →</a> · ${s.enabled ? "Next " + e(detailDate(s.next_run)) : "Paused"} · ${e(s.operation.target_policy === "eligible" ? "Eligible targets independently" : "Every target required")}</p>`).join("") || "<p>No schedules yet.</p>")}${section("Runbook progress", runs.map((r: Item, i: number) => `<article class="panel"><h3>${e(r.spec.name)}</h3><p>${e(detailDate(r.created))} · ${r.state.length} / 3 stages submitted</p>${r.state.map((id: string, j: number) => `<p><a href="${resourceHref("maintenance", { kind: "batch", id })}">${["Gather evidence", "Reviewed change", "Verification"][j]} receipts →</a> · ${e(r.receipts[j].map((s: Item) => s.status).join(", "))}</p>`).join("")}${r.state.length < 3 ? `<button class="primary" data-runbook-stage="${i}">Review ${["gathering", "change", "verification"][r.state.length]}</button>` : "<p>All stages submitted. Review verification receipts to establish the actual result; submission alone is not success.</p>"}<p data-runbook-error="${i}" role="alert"></p></article>`).join("") || "<p>No runbook runs.</p>")}`,
    );
    document
      .querySelectorAll<HTMLButtonElement>("[data-routine]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            ui.newSchedule({
              name: (
                {
                  windows: "Daily Windows health",
                  linux: "Daily Linux health",
                  "inspection.software": "Daily software inventory",
                  "patch.scan": "Daily patch inventory",
                } as Item
              )[b.dataset.routine!],
              kind: b.dataset.routine,
              template_id: ["windows", "linux"].includes(b.dataset.routine!)
                ? "starter-" + b.dataset.routine + "-health"
                : undefined,
              target_policy: "eligible",
            })),
      );
    document
      .querySelector("[data-new-runbook]")!
      .addEventListener("click", () => void create());
    document
      .querySelectorAll<HTMLButtonElement>("[data-start-runbook]")
      .forEach(
        (b) =>
          (b.onclick = async () => {
            b.disabled = true;
            try {
              await ui.api(
                "/maintenance/runbooks/" +
                  books[Number(b.dataset.startRunbook)].id +
                  "/runs",
                "POST",
              );
              await render();
            } catch (error) {
              ui.notify((error as Error).message, true);
              b.disabled = false;
            }
          }),
      );
    document
      .querySelectorAll<HTMLButtonElement>("[data-runbook-stage]")
      .forEach(
        (b) =>
          (b.onclick = async () => {
            const i = Number(b.dataset.runbookStage),
              run = runs[i],
              stage = run.state.length;
            b.disabled = true;
            try {
              const preview = await ui.api(
                "/maintenance/runs/" + run.id + "/preview",
                "POST",
                { stage },
              );
              const pane: HTMLDialogElement = ui.dialog(
                "Review " + preview.phase,
                `<p>${preview.targets.length} exact targets. This stage runs only after this confirmation. Inspect earlier receipts before authorizing a change.</p>${preview.targets.map((t: Item) => `<h3>${e(t.label)}</h3><p>${t.timeout}s time limit</p><pre>${e(t.script)}</pre>`).join("")}<button class="primary" data-confirm-stage>Confirm this stage</button>`,
              );
              pane.querySelector<HTMLButtonElement>(
                "[data-confirm-stage]",
              )!.onclick = async (event) => {
                const confirm = event.currentTarget as HTMLButtonElement;
                confirm.disabled = true;
                try {
                  const batch = await ui.api(
                    "/maintenance/runs/" + run.id + "/steps",
                    "POST",
                    { stage, confirmed: true },
                  );
                  pane.close();
                  await render();
                  await ui.showBatch(batch.id);
                } catch (error) {
                  ui.notify((error as Error).message, true);
                  confirm.disabled = false;
                }
              };
            } catch (error) {
              document.querySelector(
                `[data-runbook-error="${i}"]`,
              )!.textContent = (error as Error).message;
            } finally {
              b.disabled = false;
            }
          }),
      );
  }
  async function create() {
    const [templates, devices] = await Promise.all([
      ui.api("/templates"),
      ui.api("/devices"),
    ]);
    const pane: HTMLDialogElement = ui.dialog(
      "Create reviewed runbook",
      `<label>Name<input data-runbook-name maxlength="100" placeholder="Application maintenance"></label><label>Gather and verify<select data-runbook-collect><option value="inspection.software">Software inventory</option><option value="inspection.processes">Process inventory</option><option value="inspection.disks">Disk inventory</option><option value="patch.scan">Patch scan</option></select></label><label>Change template<select data-runbook-template>${templates.map((t: Item) => `<option value="${e(t.id)}">${e(t.name)} · ${e(t.platform)} · revision ${t.revision}</option>`).join("")}</select></label><p>Templates with required inputs must first be customized into a parameter-free reviewed template in Software & scripts.</p><div data-runbook-targets>${devices.map((d: Item) => `<label class="check"><input type="checkbox" data-runbook-target="${e(d.id)}" ${d.approved && d.online && !d.revoked && !d.archived ? "" : "disabled"}>${e(d.label)} · ${e(d.platform)}${!d.online ? " · Offline" : ""}${!d.approved ? " · Approval required" : ""}</label>`).join("")}</div><p data-runbook-error role="alert"></p><button class="primary" data-runbook-save>Review exact runbook</button>`,
      { className: "wide" },
    );
    listWorkspace(
      pane.querySelector("[data-runbook-targets]")!,
      "label",
      "runbook targets",
    );
    pane.querySelector<HTMLButtonElement>("[data-runbook-save]")!.onclick =
      async () => {
        try {
          const template = templates.find(
            (t: Item) =>
              t.id ===
              pane.querySelector<HTMLSelectElement>("[data-runbook-template]")!
                .value,
          );
          if (template.parameters.some((p: Item) => p.required && !p.default))
            throw new Error(
              "Customize this template with reviewed inputs first.",
            );
          const name = pane.querySelector<HTMLInputElement>(
              "[data-runbook-name]",
            )!.value,
            ids = [
              ...pane.querySelectorAll<HTMLInputElement>(
                "[data-runbook-target]:checked",
              ),
            ].map((b) => b.dataset.runbookTarget),
            kind = pane.querySelector<HTMLSelectElement>(
              "[data-runbook-collect]",
            )!.value;
          const stages = [
            { kind },
            {
              kind: "template",
              template_id: template.id,
              template_revision: template.revision,
            },
            { kind },
          ].map((s, i) => ({
            ...s,
            name: name + " · " + ["gather", "change", "verify"][i],
            device_ids: ids,
            request_id: crypto.randomUUID(),
            confirmed: true,
          }));
          const previews = await Promise.all(
            stages.map((s) => ui.api("/batches/preview", "POST", s)),
          );
          const review: HTMLDialogElement = ui.dialog(
            "Confirm reusable runbook",
            `<h3>${e(name)}</h3><p>Saving creates no jobs. Each future stage is separately reviewed.</p>${previews.map((r: Item, i: number) => section(["Gather", "Change", "Verify"][i], r.targets.map((t: Item) => `<h4>${e(t.label)}</h4><pre>${e(t.script)}</pre>`).join(""))).join("")}<button class="primary" data-save-reviewed>Save reviewed runbook</button>`,
          );
          review.querySelector<HTMLButtonElement>(
            "[data-save-reviewed]",
          )!.onclick = async (event) => {
            const b = event.currentTarget as HTMLButtonElement;
            b.disabled = true;
            try {
              await ui.api("/maintenance/runbooks", "POST", {
                name,
                stages,
                confirmed: true,
              });
              review.close();
              pane.close();
              await render();
            } catch (error) {
              ui.notify((error as Error).message, true);
              b.disabled = false;
            }
          };
        } catch (error) {
          pane.querySelector("[data-runbook-error]")!.textContent = (
            error as Error
          ).message;
        }
      };
  }
  return { render };
}
