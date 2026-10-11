import {startJourney} from "./ux-quality";
import { escapeDetail as e } from "./resource-story";
import { resourceHref, type ResourceRef } from "./resource-navigation";
type Item = Record<string, any>;
export type Hit = {
  title: string;
  description: string;
  page?: string;
  ref?: ResourceRef;
  search?: string;
};
export function createCommandPalette(ui: Item) {
  let active: HTMLDialogElement | null = null;
  const recent:Hit[] = [];
  function open(initialQuery = "") {
    if (active?.open) {
      active.querySelector("input")?.focus();
      return;
    }
    const finish=startJourney("search_to_target","browser");
    const routes: Hit[] = ui
      .navigation()
      .map((n: Item) => ({
        title: n.title,
        description: "Go to page",
        page: n.id,
      }));
    let hits = [...routes],
      selected = 0,
      failed = new Set<string>(),
      pending = new Set<string>();
    let selectedKey = "";
    const identity = (h:Hit)=>JSON.stringify(h.ref || h.page);
    const pane: HTMLDialogElement = ui.dialog(
      "Find in Speck",
      '<label class="sr-only" for="workspace-command">Search machines, sites, keys, templates or jobs</label><input id="workspace-command" type="text" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="command-results" autocomplete="off" placeholder="Find a machine, site, key, template or job…"><div id="command-results" class="command-results" role="listbox" aria-label="Workspace results"></div><div class="command-footer"><span data-command-status role="status">Loading inventory…</span>' +
        (ui.role() !== "viewer"
          ? '<button class="text-link" data-command-ai>Draft a task with AI →</button>'
          : "") +
        "</div>",
      { className: "command-palette" },
    );
    active = pane; pane.addEventListener("close",()=>finish("cancelled"));
    const input = pane.querySelector<HTMLInputElement>("input")!,
      results = pane.querySelector<HTMLElement>(".command-results")!;
    const page = location.hash.slice(1).split("?")[0] || "home";
    let visible: Hit[] = [];
    const choose = (hit: Hit) => {
      finish();
      recent.splice(0,recent.length,...[hit,...recent.filter(h=>identity(h)!==identity(hit))].slice(0,8));
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
      visible = rankHits(terms.length ? hits : [...recent,...routes], input.value).filter((h,i,all)=>all.findIndex(x=>identity(x)===identity(h))===i).slice(0,40);
      const preserved=visible.findIndex(h=>identity(h)===selectedKey);
      selected = preserved>=0 ? preserved : Math.min(selected,Math.max(0,visible.length-1));
      selectedKey = visible[selected] ? identity(visible[selected]) : '';
      input.setAttribute('aria-activedescendant',visible.length?'command-result-'+selected:'');
      results.innerHTML =
        visible
          .map(
            (h, i) =>
              `<button id="command-result-${i}" class="command-result" role="option" aria-selected="${i === selected}" data-command-result="${i}"><span><b>${e(h.title)}</b><small>${e(h.description)}</small></span><span aria-hidden="true">→</span></button>`,
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
        `${hits.length - routes.length} objects indexed${pending.size ? " · Loading: " + [...pending].join(", ") : ""}${failed.size ? " · Unavailable: " + [...failed].join(", ") : ""} · ↑↓ to choose · Enter to open`;
    };
    input.oninput = () => {
      selected = 0; selectedKey="";
      draw();
    };
    input.onkeydown = (event) => {
      if(event.key === "Escape") { event.preventDefault(); event.stopPropagation(); pane.close(); return; }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        selected = Math.max(
          0,
          Math.min(
            visible.length - 1,
            selected + (event.key === "ArrowDown" ? 1 : -1),
          ),
        );
        selectedKey=visible[selected] ? identity(visible[selected]) : "";
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
      const sourceName=sourceLabel(path); pending.add(sourceName);
      void ui
        .api(path)
        .then((data: any) => {
          if (pane.open) hits.push(...map(data));
        })
        .catch(() => {
          failed.add(sourceName);
        })
        .finally(() => {
          pending.delete(sourceName);
          draw();
        });
    };
    source("/fleet?compact=true", (data) =>
      data.machines.map((d: Item) => ({
        title: d.label,
        description:
          (d.restored_from ? "Recovery copy · " : d.has_endpoint_agent && d.approved ? "Managed endpoint · " : d.has_speck_agent ? "Connector / unapproved identity · " : "Provider resource · ") +
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
          title: j.kind + " · " + (j.label || j.id.slice(0, 8)),
          description: "Job · " + j.status + " · " + (j.label || j.device_id),
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
    input.value=initialQuery;
    draw();
    input.focus();
  }
  return { open, reset:()=>{recent.length=0;active?.close();active=null;} };
}

export function sourceLabel(path:string) { const specific:Item={'/unifi/equipment/index':'Equipment','/unifi/sites':'Sites','/unifi/pool':'Public IPs'}; return specific[path] || ({fleet:'Machines',unifi:'Network',schedules:'Schedules',templates:'Templates',jobs:'Operations',dns:'DNS',keys:'Credentials'} as Item)[path.split('/')[1].split('?')[0]] || 'Resources'; }
export function rankHits(hits:Hit[],query:string):Hit[] {
  const text=query.toLocaleLowerCase().trim(), terms=text.split(/\s+/).filter(Boolean);
  const score=(h:Hit)=>h.title.toLocaleLowerCase()===text?0:h.title.toLocaleLowerCase().startsWith(text)?1:terms.every(t=>h.title.toLocaleLowerCase().includes(t))?2:3;
  return hits.filter(h=>terms.every(q=>(h.title+' '+h.description+' '+(h.search || '')).toLocaleLowerCase().includes(q))).sort((a,b)=>score(a)-score(b)||a.description.split(' · ')[0].localeCompare(b.description.split(' · ')[0])||a.title.localeCompare(b.title));
}
