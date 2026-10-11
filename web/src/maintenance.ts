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
    const current = ui.checkpoint?.() || (() => {});
    const results = await Promise.allSettled([
      ui.api("/schedules"),
      ui.api("/maintenance/runbooks"),
      ui.api("/maintenance/runs"),
    ]);
    current();
    const sources = ["Current routines", "Saved runbooks", "Runbook progress"];
    const unavailable = results.flatMap((r, i) => r.status === "rejected" ? [sources[i]] : []);
    const [schedules, books, runs] = results.map(r => r.status === "fulfilled" ? r.value : []);
    ui.content(
      `<div class="maintenance-workspace">${unavailable.length ? `<p class="resource-notice" role="status">Unavailable: ${e(unavailable.join(", "))}. Other routines remain available. Use Refresh to retry.</p>` : ""}<p>Start from an editable routine. Every schedule previews exact scripts, target coverage and exclusions. Patch installation and credential rotation are never implied by an inventory routine.</p><div class="routine-grid">${[
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
        )}</div><div class="section-head"><h2>Reusable runbooks</h2><button class="primary" data-new-runbook>Create a reviewed runbook</button></div><p>Gather → reviewed change → verification. Each stage requires a separate confirmation; an unsuccessful or uncertain stage blocks the next one.</p><div class="maintenance-runbooks" data-runbooks>${books.map((b: Item, i: number) => `<article class="panel"><h3>${e(b.name)}</h3><p>${b.spec.stages[0].device_ids.length} targets · ${e(b.spec.stages.map((s: Item) => s.kind).join(" → "))}</p><button class="secondary" data-start-runbook="${i}">Start review</button></article>`).join("") || (unavailable.includes("Saved runbooks") ? "<p>Saved runbooks could not be loaded.</p>" : "<p>No saved runbooks. Create one to review and repeat an operation.</p>")}</div>${section("Current routines", schedules.map((s: Item) => `<p><a href="${resourceHref("maintenance", { kind: "schedule", id: s.id })}">${e(s.name)} →</a> · ${s.enabled ? "Next " + e(detailDate(s.next_run)) : "Paused"} · ${e(s.operation.target_policy === "eligible" ? "Eligible targets independently" : "Every target required")}</p>`).join("") || (unavailable.includes("Current routines") ? "<p>Current routines could not be loaded.</p>" : "<p>No schedules yet. Review a daily routine above to create one.</p>"))}${section("Runbook progress", runs.map((r: Item, i: number) => `<article class="panel"><h3>${e(r.spec.name)}</h3><p>${e(detailDate(r.created))} · ${r.state.length} / 3 stages submitted</p>${r.state.map((id: string, j: number) => `<p><a href="${resourceHref("maintenance", { kind: "batch", id })}">${["Gather evidence", "Reviewed change", "Verification"][j]} receipts →</a> · ${e(r.receipts[j].map((s: Item) => s.status).join(", "))}</p>`).join("")}${r.state.length < 3 ? `<button class="primary" data-runbook-stage="${i}">Review ${["gathering", "change", "verification"][r.state.length]}</button>` : "<p>All stages submitted. Review verification receipts to establish the actual result; submission alone is not success.</p>"}<p data-runbook-error="${i}" role="alert"></p></article>`).join("") || (unavailable.includes("Runbook progress") ? "<p>Runbook progress could not be loaded.</p>" : "<p>No runbook runs. Start a saved runbook to review its first stage.</p>"))}</div>`,
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
      .addEventListener("click", async (event) => {
        const button = event.currentTarget as HTMLButtonElement;
        button.disabled = true;
        try { await create(); }
        catch (error) { ui.notify((error as Error).message, true); }
        finally { button.disabled = false; }
      });
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
    const current = ui.checkpoint?.() || (() => {});
    const [templates, devices] = await Promise.all([
      ui.api("/templates"),
      ui.api("/devices"),
    ]);
    current();
    const pane: HTMLDialogElement = ui.dialog(
      "Create reviewed runbook",
      `<label>Name<input data-runbook-name required maxlength="100" placeholder="Application maintenance"></label><label>Gather and verify<select data-runbook-collect><option value="inspection.software">Software inventory</option><option value="inspection.processes">Process inventory</option><option value="inspection.disks">Disk inventory</option><option value="patch.scan">Patch scan</option></select></label><label>Change template<select data-runbook-template>${templates.map((t: Item) => `<option value="${e(t.id)}">${e(t.name)} · ${e(t.platform)} · revision ${t.revision}</option>`).join("") || '<option value="">No templates available</option>'}</select></label><p>Templates with required inputs must first be customized into a parameter-free reviewed template in Software & scripts.</p><p data-runbook-selection role="status"></p><div class="runbook-targets" data-runbook-targets>${devices.map((d: Item) => `<label class="check"><input type="checkbox" data-runbook-target="${e(d.id)}" data-platform="${e(d.platform)}" data-eligible="${!!(d.approved && d.online && !d.revoked && !d.archived)}" ${d.approved && d.online && !d.revoked && !d.archived ? "" : "disabled"}>${e(d.label)} · ${e(d.platform)}${!d.online ? " · Offline" : ""}${!d.approved ? " · Approval required" : ""}${d.revoked ? " · Access revoked" : ""}${d.archived ? " · Archived" : ""}</label>`).join("")}</div><p data-runbook-error role="alert"></p><button class="primary" data-runbook-save ${templates.length && devices.length ? "" : "disabled"}>Review exact runbook</button>${!templates.length ? '<p>Add a template in <a href="#software">Software &amp; scripts</a> before creating a runbook.</p>' : ""}${!devices.length ? '<p>Add an approved Windows or Linux endpoint in <a href="#fleet">Fleet</a> before creating a runbook.</p>' : ""}`,
      { className: "wide" },
    );
    listWorkspace(
      pane.querySelector("[data-runbook-targets]")!,
      "label",
      "runbook targets",
    );
    const syncTargets = () => {
      const template = templates.find((t: Item) => t.id === pane.querySelector<HTMLSelectElement>("[data-runbook-template]")!.value);
      let eligible = 0;
      pane.querySelectorAll<HTMLInputElement>("[data-runbook-target]").forEach(box => {
        box.disabled = box.dataset.eligible !== "true" || !template || box.dataset.platform !== template.platform;
        if (box.disabled) box.checked = false;
        else eligible++;
      });
      const count = pane.querySelectorAll("[data-runbook-target]:checked").length;
      pane.querySelector("[data-runbook-selection]")!.textContent = template ? `${count} selected · ${eligible} eligible ${template.platform} targets. Every stage uses these exact machines.` : "Choose a saved change template to select targets.";
    };
    pane.querySelector<HTMLSelectElement>("[data-runbook-template]")!.onchange = syncTargets;
    pane.querySelectorAll<HTMLInputElement>("[data-runbook-target]").forEach(box => box.onchange = syncTargets);
    syncTargets();
    pane.querySelector<HTMLButtonElement>("[data-runbook-save]")!.onclick =
      async (event) => {
        const button = event.currentTarget as HTMLButtonElement;
        const nameInput = pane.querySelector<HTMLInputElement>("[data-runbook-name]")!;
        nameInput.value = nameInput.value.trim();
        if (!nameInput.reportValidity()) return;
        button.disabled = true;
        pane.querySelector("[data-runbook-error]")!.textContent = "";
        try {
          const template = templates.find(
            (t: Item) =>
              t.id ===
              pane.querySelector<HTMLSelectElement>("[data-runbook-template]")!
                .value,
          );
          if (!template) throw new Error("Choose an available change template first.");
          if ((template.parameters || []).some((p: Item) => p.required && [undefined, null, ""].includes(p.default)))
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
          if (!ids.length) throw new Error("Select at least one eligible machine for this runbook.");
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
        } finally {
          button.disabled = false;
        }
      };
  }
  return { render };
}
