import { escapeDetail as e } from "./resource-story";
import { resourceHref, type ResourceRef } from "./resource-navigation";
type Item = Record<string, any>;
type Hit = {
  title: string;
  description: string;
  page?: string;
  ref?: ResourceRef;
  search?: string;
};
export function createCommandPalette(ui: Item) {
  let active: HTMLDialogElement | null = null;
  function open() {
    if (active?.open) {
      active.querySelector("input")?.focus();
      return;
    }
    const routes: Hit[] = ui
      .navigation()
      .map((n: Item) => ({
        title: n.title,
        description: "Go to page",
        page: n.id,
      }));
    let hits = [...routes],
      selected = 0,
      failed = 0,
      pending = 0;
    const pane: HTMLDialogElement = ui.dialog(
      "Find in Speck",
      '<label class="sr-only" for="workspace-command">Search machines, sites, keys, templates or jobs</label><input id="workspace-command" type="search" autocomplete="off" placeholder="Find a machine, site, key, template or job…"><div class="command-results" role="listbox" aria-label="Workspace results"></div><div class="command-footer"><span data-command-status role="status">Loading inventory…</span>' +
        (ui.role() !== "viewer"
          ? '<button class="text-link" data-command-ai>Draft a task with AI →</button>'
          : "") +
        "</div>",
      { className: "command-palette" },
    );
    active = pane;
    const input = pane.querySelector<HTMLInputElement>("input")!,
      results = pane.querySelector<HTMLElement>(".command-results")!;
    const page = location.hash.slice(1).split("?")[0] || "home";
    let visible: Hit[] = [];
    const choose = (hit: Hit) => {
      pane.close();
      location.hash = hit.ref ? resourceHref(page, hit.ref) : hit.page!;
    };
    const draw = () => {
      if (!pane.open) return;
      const terms = input.value
        .toLocaleLowerCase()
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      visible = hits
        .filter((h) =>
          terms.every((q) =>
            (h.title + " " + h.description + " " + (h.search || ""))
              .toLocaleLowerCase()
              .includes(q),
          ),
        )
        .slice(0, 40);
      selected = Math.min(selected, Math.max(0, visible.length - 1));
      results.innerHTML =
        visible
          .map(
            (h, i) =>
              `<button class="command-result" role="option" aria-selected="${i === selected}" data-command-result="${i}"><span><b>${e(h.title)}</b><small>${e(h.description)}</small></span><span aria-hidden="true">→</span></button>`,
          )
          .join("") ||
        '<p class="resource-note">No matching objects in the loaded sources. Try a name, address or another word.</p>';
      results
        .querySelectorAll<HTMLButtonElement>("[data-command-result]")
        .forEach(
          (b) =>
            (b.onclick = () =>
              choose(visible[Number(b.dataset.commandResult)])),
        );
      pane.querySelector("[data-command-status]")!.textContent =
        `${hits.length - routes.length} objects indexed${pending ? " · " + pending + " sources loading" : ""}${failed ? " · " + failed + " sources unavailable" : ""} · ↑↓ to choose · Enter to open`;
    };
    input.oninput = () => {
      selected = 0;
      draw();
    };
    input.onkeydown = (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        selected = Math.max(
          0,
          Math.min(
            visible.length - 1,
            selected + (event.key === "ArrowDown" ? 1 : -1),
          ),
        );
        draw();
        results
          .querySelector('[aria-selected="true"]')
          ?.scrollIntoView({ block: "nearest" });
      }
      if (event.key === "Enter" && visible[selected]) {
        event.preventDefault();
        choose(visible[selected]);
      }
    };
    pane
      .querySelector<HTMLButtonElement>("[data-command-ai]")
      ?.addEventListener("click", () => {
        pane.close();
        void ui.plan(input.value);
      });
    const source = (path: string, map: (data: any) => Hit[]) => {
      pending++;
      void ui
        .api(path)
        .then((data: any) => {
          if (pane.open) hits.push(...map(data));
        })
        .catch(() => {
          failed++;
        })
        .finally(() => {
          pending--;
          draw();
        });
    };
    source("/fleet", (data) =>
      data.machines.map((d: Item) => ({
        title: d.label,
        description:
          "Machine · " +
          (d.location || d.site || d.platform || "Discovered resource"),
        search: [d.hostname, ...(d.addresses || []), ...(d.aliases || [])].join(
          " ",
        ),
        ref: { kind: "machine", id: d.id },
      })),
    );
    if (ui.role() !== "viewer") {
      source("/unifi/equipment/index", (rows) =>
        rows.map((d: Item) => ({
          title: d.name || d.id,
          description: "Network equipment · " + d.model,
          search: [d.ipAddress, d.macAddress].join(" "),
          ref: {
            kind: "equipment",
            id: d.id,
            site: d.site_id,
            connection: d.console_id,
          },
        })),
      );
      source("/schedules", (rows) =>
        rows.map((s: Item) => ({
          title: s.name,
          description: "Schedule · " + (s.enabled ? "Active" : "Paused"),
          ref: { kind: "schedule", id: s.id },
        })),
      );
      source("/templates", (rows) =>
        rows.map((t: Item) => ({
          title: t.name,
          description: "Template · " + t.platform + " · revision " + t.revision,
          search: t.description,
          ref: { kind: "template", id: t.id },
        })),
      );
      source("/jobs", (rows) =>
        rows.map((j: Item) => ({
          title: j.kind + " · " + j.id.slice(0, 8),
          description: "Job · " + j.status + " · " + j.device_id,
          ref: { kind: "job", id: j.id },
        })),
      );
      source("/unifi/sites", (data) =>
        (data.sites || []).map((s: Item) => ({
          title: s.name,
          description: "Network site · " + (s.isp || s.timezone || s.state),
          ref: { kind: "site", id: String(s.id), connection: s.console_id },
        })),
      );
      source("/dns/domains", (data) =>
        (data.domains || []).map((d: Item) => ({
          title: d.domain || d.name,
          description: "DNS zone",
          ref: { kind: "domain", id: d.domain || d.name },
        })),
      );
      source("/unifi/pool", (data) =>
        (data.pool || []).map((p: Item) => ({
          title: p.ip,
          description: "Public address · " + p.status,
          search: p.lan_ip,
          ref: { kind: "public-ip", id: p.ip },
        })),
      );
    }
    if (ui.role() === "admin")
      source("/keys", (rows) =>
        rows.map((k: Item) => ({
          title: k.name,
          description: "Credential metadata · " + k.service,
          search: [k.project, ...(k.secret_names || [])].join(" "),
          ref: { kind: "key", id: k.name },
        })),
      );
    draw();
    input.focus();
  }
  return { open };
}
