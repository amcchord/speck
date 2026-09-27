import { resourceHref, type ResourceRef } from "./resource-navigation";
import {
  detailFacts as facts,
  detailSection as section,
  escapeDetail as e,
  detailDate,
} from "./resource-story";
import { listWorkspace } from "./list-workspace";
import { operationalQueue, attentionList } from "./triage";
type Item = Record<string, any>;
export function createCustomerWorkspaces(ui: Item) {
  const identity = (a: Item) =>
    JSON.stringify(
      ["kind", "id", "connection", "resourceKind", "provider"].map(
        (k) => a[k] || "",
      ),
    );
  async function render() {
    ui.loading("Loading customer workspaces…");
    const spaces: Item[] = await ui.api("/workspaces");
    const id = new URLSearchParams(location.hash.split("?")[1] || "").get(
      "workspace",
    );
    const selected = spaces.find((w) => w.id === id);
    ui.content(
      `<div class="toolbar"><button class="primary" data-new-workspace>Create customer / site workspace</button>${selected ? '<button class="secondary" data-edit-workspace>Review associations</button>' : ""}<a class="secondary" href="#maintenance">Maintenance routines</a></div><p class="resource-note">Explicit associations preserve context across endpoints, network, backup resources, credentials and schedules. A workspace does not grant additional resource permissions.</p><div class="customer-tabs">${spaces.map((w) => `<a class="secondary" aria-current="${selected?.id === w.id ? "page" : "false"}" href="#workspaces?workspace=${e(w.id)}">${e(w.name)}</a>`).join("") || "<p>No workspaces yet. Create one and review its exact resources; names are never used to infer ownership.</p>"}</div><div data-customer-content></div>`,
    );
    document
      .querySelector("[data-new-workspace]")!
      .addEventListener("click", () => void edit());
    document
      .querySelector("[data-edit-workspace]")
      ?.addEventListener("click", () => void edit(selected));
    const root = document.querySelector<HTMLElement>(
      "[data-customer-content]",
    )!;
    root.innerHTML = '<p role="status">Reading operational evidence…</p>';
    const sources: Item = {
      fleet: "/fleet?compact=true",
      alerts: "/alerts?state=active&limit=100",
      patches: "/patches",
      software: "/software/inventory",
      sites: "/unifi/sites",
      schedules: "/schedules",
      backup: "/slide/coverage",
      catalog: "/workspaces/catalog",
      jobs: "/jobs",
    };
    const results = await Promise.allSettled(
      Object.values(sources).map((path) => ui.api(path)),
    );
    if (!root.isConnected) return;
    const data: Item = {},
      failed: string[] = [];
    Object.keys(sources).forEach((key, i) => {
      const r = results[i];
      if (r.status === "fulfilled") data[key] = r.value;
      else failed.push(key);
    });
    const assigned = new Set(
      spaces.flatMap((w) =>
        w.associations
          .filter((a: Item) => a.kind === "machine")
          .map((a: Item) => a.id),
      ),
    );
    const machines: Item[] = data.fleet?.machines || [];
    const rows: Item[] = selected?.associations || [];
    const ids = new Set(
      rows.filter((a) => a.kind === "machine").map((a) => a.id),
    );
    const backupIDs = new Set(
      rows
        .filter(
          (a) =>
            a.kind === "infrastructure" &&
            a.provider === "slide" &&
            a.resourceKind === "protected" &&
            a.connection === "slide-settings",
        )
        .map((a) => a.id),
    );
    machines
      .filter((d) => ids.has(d.id))
      .forEach((d) => {
        if (d.slide_agent_id) backupIDs.add(d.slide_agent_id);
      });
    const scoped = selected
      ? {
          ...data,
          fleet: { machines: machines.filter((d) => ids.has(d.id)) },
          alerts: data.alerts
            ? {
                items: data.alerts.items.filter((a: Item) =>
                  ids.has(a.device_id),
                ),
              }
            : null,
          sites: data.sites
            ? {
                sites: data.sites.sites.filter((s: Item) =>
                  rows.some(
                    (a) =>
                      a.kind === "site" &&
                      a.id === String(s.id) &&
                      a.connection === s.console_id,
                  ),
                ),
              }
            : null,
          schedules: data.schedules?.filter((s: Item) =>
            rows.some((a) => a.kind === "schedule" && a.id === s.id),
          ),
          backup: data.backup
            ? {
                ...data.backup,
                backup: {
                  ...data.backup.backup,
                  rows: data.backup.backup.rows.filter((b: Item) =>
                    backupIDs.has(b.agent_id),
                  ),
                },
              }
            : null,
        }
      : data;
    const label = (a: Item) =>
      data.catalog?.items.find((r: Item) => identity(r) === identity(a))
        ?.label ||
      machines.find((d) => d.id === a.id)?.label ||
      a.id;
    root.innerHTML =
      (failed.length
        ? `<p class="resource-notice">Unavailable sources: ${e(failed.join(", "))}. Other evidence remains usable.</p>`
        : "") +
      (selected
        ? facts([
            ["Customer / site", selected.name],
            ["Reviewed associations", rows.length],
            ["Last reviewed", detailDate(selected.updated)],
            ["Recovery retest objective", selected.retest_days + " days"],
          ]) +
          section(
            "Pinned resources",
            rows
              .filter((a) => a.pinned)
              .map(
                (a) =>
                  `<a class="secondary" href="${resourceHref("workspaces?workspace=" + selected.id, a as ResourceRef)}">${e(label(a))} →</a>`,
              )
              .join("") || "<p>Pin a resource from Review associations.</p>",
          )
        : "") +
      section(
        "Daily operational queue",
        `<p class="resource-note">Active incidents, historical uncertainty and coverage gaps remain separate. No condition is automatically acknowledged or resolved here.</p><div data-customer-queue>${attentionList(operationalQueue(scoped), "workspaces" + (selected ? "?workspace=" + selected.id : ""))}</div>`,
      ) +
      section(
        selected ? "Associated resources" : "Unassigned machines",
        `<div class="resource-related" data-customer-resources>${(selected ? rows : machines.filter((d) => !assigned.has(d.id)).map((d) => ({ kind: "machine", id: d.id }))).map((a: Item) => `<a href="${resourceHref("workspaces" + (selected ? "?workspace=" + selected.id : ""), a as ResourceRef)}"><span><b>${e(label(a))}</b><small>${e(a.kind)}${a.connection ? " · " + e(a.connection) : ""}</small></span>→</a>`).join("") || "<p>No resources in this scope.</p>"}</div>`,
      );
    if (selected)
      root.insertAdjacentHTML(
        "beforeend",
        section(
          "Recent endpoint operations",
          (data.jobs || [])
            .filter((j: Item) => ids.has(j.device_id))
            .slice(0, 12)
            .map(
              (j: Item) =>
                `<p><a href="${resourceHref("workspaces?workspace=" + selected.id, { kind: "job", id: j.id })}">${e(j.label || j.device_id)} · ${e(j.kind)} →</a> · ${e(j.status)} · ${e(detailDate(j.created))}</p>`,
            )
            .join("") ||
            "<p>No endpoint operations in the returned history for this workspace.</p>",
        ),
      );
    const queue = root.querySelector<HTMLElement>("[data-customer-queue]")!;
    listWorkspace(queue, ".home-alert", "operational queue", { size: 25 });
    listWorkspace(
      root.querySelector<HTMLElement>("[data-customer-resources]")!,
      "a",
      "associated resources",
    );
  }
  async function edit(existing?: Item) {
    const catalog = await ui.api("/workspaces/catalog");
    const rows: Item[] = catalog.items;
    for (const a of existing?.associations || [])
      if (!rows.some((r) => identity(r) === identity(a)))
        rows.push({
          ...a,
          label: a.id,
          description:
            "Previously associated; unavailable in current inventory",
        });
    const pane: HTMLDialogElement = ui.dialog(
      existing ? "Review customer associations" : "Create customer workspace",
      `<label>Customer / site name<input data-customer-name maxlength="100" value="${e(existing?.name || "")}"></label><label>Recovery retest objective (days)<input data-retest type="number" min="1" max="365" value="${existing?.retest_days || 30}"></label><p>Choose exact resources and connections. These associations are organizational context, not a tenant access boundary. Existing permissions remain required.</p><div data-association-list>${rows
        .map((r, i) => {
          const previous = existing?.associations.find(
            (a: Item) => identity(a) === identity(r),
          );
          return `<div class="association-row"><label class="check"><input type="checkbox" data-association="${i}" ${previous ? "checked" : ""}><span><b>${e(r.label)}</b><small>${e(r.kind)} · ${e(r.description || r.connection || "")}</small></span></label><label class="check"><input type="checkbox" data-pin="${i}" ${previous?.pinned ? "checked" : ""}> Pin</label></div>`;
        })
        .join(
          "",
        )}</div><p data-workspace-error role="alert"></p><button class="primary" data-save-workspace>Confirm reviewed associations</button>`,
      { className: "wide" },
    );
    listWorkspace(
      pane.querySelector("[data-association-list]")!,
      ".association-row",
      "resource associations",
      { size: 30 },
    );
    pane.querySelector<HTMLButtonElement>("[data-save-workspace]")!.onclick =
      async (event) => {
        const button = event.currentTarget as HTMLButtonElement;
        button.disabled = true;
        try {
          const associations = [
            ...pane.querySelectorAll<HTMLInputElement>(
              "[data-association]:checked",
            ),
          ].map((b) => {
            const row = rows[Number(b.dataset.association)];
            return Object.fromEntries(
              ["kind", "id", "connection", "resourceKind", "provider"]
                .map((k) => [k, row[k] || ""])
                .concat([
                  [
                    "pinned",
                    (
                      pane.querySelector(
                        `[data-pin="${b.dataset.association}"]`,
                      ) as HTMLInputElement
                    ).checked as any,
                  ],
                ]),
            );
          });
          const result = await ui.api(
            "/workspaces" + (existing ? "/" + existing.id : ""),
            existing ? "PUT" : "POST",
            {
              name: pane.querySelector<HTMLInputElement>(
                "[data-customer-name]",
              )!.value,
              associations,
              members: existing?.members || [],
              revision: existing?.revision || 0,
              retest_days: Number(
                pane.querySelector<HTMLInputElement>("[data-retest]")!.value,
              ),
              confirmed: true,
            },
          );
          pane.close();
          location.hash = "workspaces?workspace=" + result.id;
          await render();
        } catch (error) {
          pane.querySelector("[data-workspace-error]")!.textContent = (
            error as Error
          ).message;
          button.disabled = false;
        }
      };
  }
  return { render };
}
