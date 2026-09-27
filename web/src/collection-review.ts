import { escapeDetail as e } from "./resource-story";
import { listWorkspace } from "./list-workspace";
type Item = Record<string, any>;
export async function reviewCollection(
  ui: Item,
  devices: Item[],
  kind = "software",
) {
  const eligible = (d: Item) =>
    d.approved &&
    !d.archived &&
    !d.revoked &&
    d.online &&
    d.telemetry?.capabilities?.managed_operations;
  const pane: HTMLDialogElement = ui.dialog(
    "Review " + kind + " collection",
    `<p>Read-only inventory under the agent service account. Windows collects machine registry applications; Linux collects dpkg/RPM packages. Reports retain job receipts and timestamps.</p><div data-collection-targets>${devices.map((d) => `<label class="check"><input type="checkbox" data-collection-target="${e(d.id)}" ${eligible(d) ? "checked" : "disabled"}><span><b>${e(d.label)}</b><small>${e(d.platform)} · ${e(d.site || "Unassigned")} · ${!d.approved ? "Approval required" : d.revoked ? "Revoked" : d.archived ? "Archived" : !d.online ? "Offline" : !d.telemetry?.capabilities?.managed_operations ? "Agent update required" : "Eligible"}</small></span></label>`).join("")}</div><p data-collection-error role="alert"></p><button class="primary" data-preview-collection>Review exact scripts and targets</button>`,
    { className: "wide" },
  );
  listWorkspace(
    pane.querySelector("[data-collection-targets]")!,
    "label",
    "collection targets",
  );
  pane.querySelector<HTMLButtonElement>("[data-preview-collection]")!.onclick =
    async () => {
      try {
        const body = {
          request_id: crypto.randomUUID(),
          name: kind + " inventory",
          kind: "inspection." + kind,
          device_ids: [
            ...pane.querySelectorAll<HTMLInputElement>(
              "[data-collection-target]:checked",
            ),
          ].map((b) => b.dataset.collectionTarget),
        };
        const preview = await ui.api("/batches/preview", "POST", body);
        const review: HTMLDialogElement = ui.dialog(
          "Confirm inventory collection",
          `<p>${preview.targets.length} reviewed targets. No software is installed or removed.</p>${preview.targets.map((t: Item) => `<h3>${e(t.label)}</h3><pre>${e(t.script)}</pre>`).join("")}<button class="primary" data-confirm-collection>Collect inventory</button>`,
        );
        review.querySelector<HTMLButtonElement>(
          "[data-confirm-collection]",
        )!.onclick = async (event) => {
          const b = event.currentTarget as HTMLButtonElement;
          b.disabled = true;
          try {
            const result = await ui.api("/batches", "POST", {
              ...body,
              confirmed: true,
            });
            review.close();
            pane.close();
            await ui.showBatch(result.id);
          } catch (error) {
            ui.notify((error as Error).message, true);
            b.disabled = false;
          }
        };
      } catch (error) {
        pane.querySelector("[data-collection-error]")!.textContent = (
          error as Error
        ).message;
      }
    };
}
