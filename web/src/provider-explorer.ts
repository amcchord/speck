import {
  capacity,
  detailDate,
  detailFacts as facts,
  detailHero as hero,
  detailSection as section,
  detailStatus as status,
  escapeDetail as e,
  slideName,
  slideStory,
  technicalDetail,
} from "./resource-story";
type Item = Record<string, any>;
const note = (s: string) => `<p class="resource-note">${e(s)}</p>`;
const labels: Item = {
  disks: "Instance disks",
  configs: "Boot profiles",
  volumes: "Attached volumes",
  firewalls: "Attached firewalls",
  backup: "Backup jobs",
  snapshot: "Recovery snapshots",
};
export function mountProviderExplorer(ui: Item, r: Item, root: HTMLElement) {
  const base = `/infrastructure/connections/${encodeURIComponent(r.connection_id)}/resources/${r.kind}/${encodeURIComponent(r.id)}`;
  let generation = 0;
  const isSlide = r.provider === "slide";
  const entry = (key: string, row: Item) => {
    if (isSlide)
      return {
        title: slideName(row),
        state: row.status || row.verify_fs_status || "Snapshot",
        sub: detailDate(row.started_at || row.backup_ended_at),
      };
    if (key === "disks")
      return {
        title: row.label,
        state: row.status,
        sub: capacity(row.size * 1048576) + " · " + row.filesystem,
      };
    if (key === "configs")
      return {
        title: row.label,
        state: row.virt_mode,
        sub:
          "Root " +
          row.root_device +
          " · " +
          Object.values(row.devices || {}).filter(Boolean).length +
          " devices",
      };
    if (key === "volumes")
      return {
        title: row.label,
        state: row.status,
        sub: row.size + " GB · " + row.region,
      };
    return {
      title: row.label,
      state: row.status,
      sub:
        "Inbound " +
        (row.rules?.inbound_policy || "not reported") +
        " · Outbound " +
        (row.rules?.outbound_policy || "not reported"),
    };
  };
  function inspect(key: string, row: Item, rows: Item[], all: Item) {
    let html = "";
    const title = entry(key, row).title || labels[key];
    if (isSlide) html = slideStory(key, row);
    else {
      html = hero("Linode · " + labels[key], row.status, title);
      if (key === "disks")
        html += facts([
          ["Disk ID", row.id],
          ["Filesystem", row.filesystem],
          ["Allocated capacity", capacity(row.size * 1048576)],
          ["Encryption", row.disk_encryption],
          ["Created", detailDate(row.created)],
          ["Updated", detailDate(row.updated)],
        ]);
      if (key === "volumes")
        html += facts([
          ["Volume ID", row.id],
          ["Capacity", row.size + " GB"],
          ["Region", row.region],
          ["Filesystem path", row.filesystem_path],
          ["Hardware", row.hardware_type],
          ["Encryption", row.encryption],
          ["Tags", row.tags],
        ]);
      if (key === "configs") {
        html += facts([
          ["Profile ID", row.id],
          ["Kernel", row.kernel],
          ["Root device", row.root_device],
          [
            "Memory limit",
            row.memory_limit ? row.memory_limit + " MB" : "Instance allocation",
          ],
          ["Virtualization", row.virt_mode],
          ["Run level", row.run_level],
          ["Updated", detailDate(row.updated)],
        ]);
        html += section(
          "Boot device attachments",
          `<div class="resource-related">${Object.entries(row.devices || {})
            .filter(([, v]) => v)
            .map(([slot, v]: [string, any]) => {
              const kind = v.volume_id ? "volumes" : "disks",
                match = (all[kind]?.data?.data || []).find(
                  (d: Item) => d.id === (v.volume_id || v.disk_id),
                );
              return match
                ? `<button data-boot-kind="${kind}" data-boot-id="${match.id}"><span><b>${e(slot + " · " + match.label)}</b><small>${e(kind === "volumes" ? "Attached block volume" : "Instance disk")}</small></span>→</button>`
                : `<div>${e(slot)} · ${e(v.volume_id ? "Volume " + v.volume_id : "Disk " + v.disk_id)}</div>`;
            })
            .join("")}</div>`,
        );
      }
      if (key === "firewalls") {
        html += facts([
          ["Firewall ID", row.id],
          ["Inbound default", row.rules?.inbound_policy],
          ["Outbound default", row.rules?.outbound_policy],
          ["Created", detailDate(row.created)],
          ["Updated", detailDate(row.updated)],
        ]);
        for (const direction of ["inbound", "outbound"])
          html += section(
            direction === "inbound" ? "Inbound rules" : "Outbound rules",
            (row.rules?.[direction] || [])
              .map(
                (rule: Item) =>
                  `<article class="provider-rule"><b>${e(rule.label || rule.action)}</b>${facts(
                    [
                      ["Action", rule.action],
                      ["Protocol", rule.protocol],
                      ["Ports", rule.ports || "All"],
                      ["IPv4 addresses", rule.addresses?.ipv4],
                      ["IPv6 addresses", rule.addresses?.ipv6],
                    ],
                  )}</article>`,
              )
              .join("") ||
              note("No explicit rules reported. The default policy applies."),
          );
      }
      html += technicalDetail(row);
    }
    const pane: HTMLDialogElement = ui.flyout(title, html, {
      tone: isSlide ? "protection" : "compute",
      subtitle: r.connection_name + " · " + r.name,
    });
    const back = document.createElement("button");
    back.className = "text-link";
    back.textContent = "← Back to " + r.name;
    back.onclick = () => ui.openResource?.(r);
    pane.querySelector(".resource-body")!.prepend(back);
    pane.querySelectorAll<HTMLElement>("[data-boot-id]").forEach(
      (b) =>
        (b.onclick = () => {
          const k = b.dataset.bootKind!,
            list = all[k]?.data?.data || [];
          inspect(
            k,
            list.find((x: Item) => String(x.id) === b.dataset.bootId),
            list,
            all,
          );
        }),
    );
    pane.querySelectorAll<HTMLElement>("[data-slide-related]").forEach(
      (b) =>
        (b.onclick = () => {
          const kind = b.dataset.slideRelated!,
            id = b.dataset.resourceId!;
          if (kind === "agent") return ui.openResource?.(r);
          if (kind === "device")
            return ui.openResource?.({
              ...r,
              kind: "box",
              id,
              name: "Backup appliance",
            });
          const match = (all.snapshot?.data?.rows || []).find(
            (v: Item) => v.snapshot_id === id,
          );
          if (match) inspect("snapshot", match, [], all);
          else
            ui.notify(
              "This snapshot is not in the loaded history. Load more snapshots to inspect it.",
            );
        }),
    );
  }
  async function load(fresh = false) {
    const current = ++generation;
    root.innerHTML = note(
      "Reading " +
        (isSlide
          ? "backup history and verification"
          : "disks, boot profiles, volumes and firewalls") +
        "…",
    );
    try {
      const response = await (fresh ? ui.freshApi : ui.api)(base + "/explore");
      if (!root.isConnected || current !== generation) return;
      const all = response.sections as Item;
      ui.onEvidence?.(all,response.checked_at);
      root.innerHTML =
        `<div class="resource-refresh"><span>${e("Provider detail · " + detailDate(response.checked_at))}</span><button class="text-link" data-explore-refresh>Refresh</button></div>` +
        Object.entries(all)
          .map(([key, value]: [string, any]) =>
            section(labels[key], `<div data-provider-section="${key}"></div>`),
          )
          .join("");
      root
        .querySelector("[data-explore-refresh]")!
        .addEventListener("click", () => void load(true));
      for (const [key, value] of Object.entries(all) as [string, Item][]) {
        const target = root.querySelector<HTMLElement>(
          '[data-provider-section="' + key + '"]',
        )!;
        if (value.state !== "available") {
          target.innerHTML = note(value.message);
          continue;
        }
        let rows = value.data?.rows || value.data?.data || [],
          cursor = value.data?.next_offset;
        const draw = () => {
          target.innerHTML =
            `<div class="resource-related">${rows
              .map((row: Item, i: number) => {
                const x = entry(key, row);
                return `<button data-provider-row="${i}"><span><b>${e(x.title)}</b><small>${e(x.sub)}</small></span>${status(x.state)}<span>→</span></button>`;
              })
              .join("")}</div>` +
            (rows.length
              ? ""
              : note("No " + labels[key].toLowerCase() + " returned.")) +
            (isSlide
              ? note(
                  "Provider-reported history. Snapshot availability and verification do not establish application recovery.",
                )
              : value.data?.pages > 1
                ? note(
                    "Showing the first " +
                      rows.length +
                      " of " +
                      value.data.results +
                      " provider records.",
                  )
                : "") +
            (cursor != null
              ? '<button class="secondary" data-history-more>Load more ' +
                e(labels[key].toLowerCase()) +
                "</button>"
              : "");
          target
            .querySelectorAll<HTMLElement>("[data-provider-row]")
            .forEach(
              (b) =>
                (b.onclick = () =>
                  inspect(key, rows[Number(b.dataset.providerRow)], rows, all)),
            );
          target
            .querySelector<HTMLButtonElement>("[data-history-more]")
            ?.addEventListener("click", async (ev) => {
              const button = ev.currentTarget as HTMLButtonElement;
              button.disabled = true;
              try {
                const next = await ui.api(
                  base + "/history?resource=" + key + "&offset=" + cursor,
                );
                if (!target.isConnected) return;
                rows = [...rows, ...next.rows];
                cursor = next.next_offset;
                all[key].data.rows = rows;
                all[key].data.next_offset = cursor;
                ui.onEvidence?.(all,response.checked_at);
                draw();
              } catch (err) {
                if (target.isConnected) {
                  button.disabled = false;
                  ui.notify((err as Error).message, true);
                }
              }
            });
        };
        draw();
      }
    } catch {
      if (root.isConnected && current === generation) {
        root.innerHTML =
          note(
            "Additional provider details are unavailable. The resource overview remains visible.",
          ) + '<button class="secondary" data-explore-retry>Try again</button>';
        root
          .querySelector("[data-explore-retry]")!
          .addEventListener("click", () => void load(true));
      }
    }
  }
  void load();
}
