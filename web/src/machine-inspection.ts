import { serviceStartup } from "./inspection-model";
import {
  escapeDetail as e,
  capacity,
  detailDate,
  detailFacts as facts,
  detailSection as section,
  technicalDetail,
} from "./resource-story";
import { listWorkspace } from "./list-workspace";
import { operationOutput } from "./run-detail";
import { rememberResource, registerResource } from "./resource-navigation";
type Item = Record<string, any>;
const table = (head: string[], rows: string[][]) =>
  rows.length
    ? `<div class="scroll"><table><thead><tr>${head.map((h) => "<th>" + e(h) + "</th>").join("")}</tr></thead><tbody>${rows.map((r) => "<tr>" + r.map((c) => "<td>" + c + "</td>").join("") + "</tr>").join("")}</tbody></table></div>`
    : '<p class="resource-note">The completed report contains no rows. Open its receipt to review the collection scope.</p>';
export function createMachineInspection(ui: Item) {
  async function collect(
    d: Item,
    kind: string,
    service = "",
    finished?: (job: Item) => void,
  ) {
    const request = { kind, service },
      preview = await ui.api(
        "/devices/" + d.id + "/inspection/preview",
        "POST",
        request,
      );
    const review: HTMLDialogElement = ui.dialog(
      "Review " + kind + " inspection",
      facts([
        ["Machine", d.label],
        [
          "Account",
          d.platform === "windows" ? "Local System" : "Agent service account",
        ],
        ["Time limit", "60 seconds"],
      ]) +
        `<p>${e(preview.note)}</p><details><summary>Exact read-only script</summary><pre>${e(preview.script)}</pre></details><button class="primary" data-collect-confirm>Collect inspection</button>`,
    );
    review.querySelector<HTMLButtonElement>("[data-collect-confirm]")!.onclick =
      async (event) => {
        const button = event.currentTarget as HTMLButtonElement;
        button.disabled = true;
        try {
          const result = await ui.api(
            "/devices/" + d.id + "/inspection",
            "POST",
            { ...request, confirmed: true },
          );
          review.close();
          if (!finished) {
            await ui.showJob(result.id);
            return;
          }
          const pane: HTMLDialogElement = ui.flyout(
            kind + " inspection",
            '<p class="resource-note" role="status">Waiting for the agent…</p>',
            { tone: "agents" },
          );
          for (let i = 0; i < 55 && pane.open; i++) {
            const job = await ui.api("/jobs/" + result.id);
            if (!pane.open) return;
            if (!["queued", "leased", "running"].includes(job.status)) {
              pane.querySelector(".resource-body")!.innerHTML =
                section("Agent result", operationOutput(job.result)) +
                '<button class="secondary" data-inspection-open>Open inventory</button>';
              pane.querySelector<HTMLButtonElement>(
                "[data-inspection-open]",
              )!.onclick = () => {
                pane.close();
                finished(job);
              };
              return;
            }
            await new Promise((resolve) => setTimeout(resolve, 1500));
          }
          if (pane.open)
            pane.querySelector(".resource-body")!.innerHTML =
              '<p>The result is still pending.</p><button class="secondary" data-inspection-job>Inspect job</button>';
          pane
            .querySelector<HTMLButtonElement>("[data-inspection-job]")
            ?.addEventListener("click", () => void ui.showJob(result.id));
        } catch (error) {
          ui.notify((error as Error).message, true);
          button.disabled = false;
        }
      };
  }
  async function serviceControl(d: Item, name: string, action: string) {
    const review: HTMLDialogElement = ui.dialog(
      "Review service " + action,
      facts([
        ["Machine", d.label],
        ["Service", name],
        ["Action", action],
      ]) +
        '<p>Service controls can interrupt dependent applications. Inspect dependencies and current service state first. The action runs once under the agent account.</p><button class="primary" data-service-confirm>Confirm ' +
        e(action) +
        "</button>",
    );
    review.querySelector<HTMLButtonElement>("[data-service-confirm]")!.onclick =
      async (event) => {
        const b = event.currentTarget as HTMLButtonElement;
        b.disabled = true;
        try {
          const job = await ui.api("/devices/" + d.id + "/jobs", "POST", {
            kind: "service.control",
            payload: { name, action },
            timeout: 60,
          });
          review.close();
          await ui.showJob(job.id);
        } catch (error) {
          ui.notify((error as Error).message, true);
          b.disabled = false;
        }
      };
  }
  function service(d: Item, s: Item) {
    rememberResource({ kind: "service", id: s.name, connection: d.id }, () =>
      service(d, s),
    );
    const pane: HTMLDialogElement = ui.flyout(
      s.display_name || s.name,
      facts([
        ["Service", s.name],
        ["State", s.state || s.status],
        ["Startup type", serviceStartup(s.start_type ?? s.startup,d.platform)],
        ["Detail", s.detail || s.description],
        ["Observed", detailDate(d.last_seen)],
        ["Machine", d.label],
      ]) +
        section(
          "Inspect before changing",
          `<p>Collect startup configuration, dependencies, process identity and up to 20 recent service events. Missing provider fields stay unreported.</p><button class="secondary" data-service-inspect>Review detailed inspection</button>`,
        ) +
        `<div class="toolbar">${["start", "stop", "restart"].map((action) => `<button class="secondary" data-service-action="${action}">${action[0].toUpperCase() + action.slice(1)}…</button>`).join("")}</div>` +
        technicalDetail(s),
      { tone: "agents", subtitle: "Service · " + d.label },
    );
    pane.querySelector<HTMLButtonElement>("[data-service-inspect]")!.onclick =
      () => void collect(d, "service", s.name);
    pane
      .querySelectorAll<HTMLButtonElement>("[data-service-action]")
      .forEach((b) => {
        b.disabled = !d.online || !d.approved || d.archived || d.revoked || (b.dataset.serviceAction==="start" && ["running","active"].includes(s.state || s.status)) || (["stop","restart"].includes(b.dataset.serviceAction!) && ["stopped","inactive"].includes(s.state || s.status));
        b.onclick = () =>
          void serviceControl(d, s.name, b.dataset.serviceAction!);
      });
  }
  async function inventory(d: Item, root: HTMLElement) {
    root.innerHTML =
      '<h3>Endpoint inventory</h3><p class="resource-note">Read-only reports are collected on request. Each report keeps its collection time and job evidence.</p><div class="toolbar"><label>Inventory<select data-inspection-kind><option value="processes">Processes</option><option value="software">Installed software</option><option value="disks">Disks & volumes</option></select></label><button class="primary" data-inspection-collect>Review collection</button><button class="secondary" data-inspection-bundle>Review diagnostic bundle</button></div><div data-inspection-report></div>';
    const target = root.querySelector<HTMLElement>("[data-inspection-report]")!;
    root.querySelector("[data-inspection-bundle]")!.addEventListener("click",()=>void collect(d,"bundle","",()=>void inventory(d,root)));
    let reports: Item[] = [];
    const draw = () => {
      const kind = root.querySelector<HTMLSelectElement>(
          "[data-inspection-kind]",
        )!.value,
        report = reports.find((r) => r.kind === kind);
      if (!report) {
        target.innerHTML =
          '<p class="resource-note">No ' +
          e(kind) +
          " inspection has been collected. Review a collection to read it from this endpoint.</p>";
        return;
      }
      const rows: Item[] = report.report.rows;
      const columns =
        kind === "software"
          ? ["name", "version", "publisher", "architecture"]
          : kind === "processes"
            ? [
                "pid",
                "name",
                "cpu_percent",
                "cpu_seconds",
                "memory_percent",
                "memory_bytes",
              ]
            : [
                "name",
                "type",
                "size",
                "size_bytes",
                "free_bytes",
                "fstype",
                "filesystem",
                "mountpoint",
                "model",
              ];
      const present = columns.filter((k) => rows.some((row) => row[k] != null));
      target.innerHTML =
        `<p class="resource-note">Collected ${e(detailDate(report.collected))} · ${Date.now()/1000-report.collected>86400 ? "Stale (over 24 hours) · " : ""}${e(report.report.scope)}. ${kind==="processes" ? d.platform==="windows" ? "CPU seconds are cumulative process time, not current utilization." : "Linux CPU percentage is the process lifetime average reported by ps." : ""} ${rows.length >= report.report.limit ? "Collection reached its row limit; inventory is partial." : ""}</p>` +
        table(
          present.map((k) => k.replaceAll("_", " ")),
          rows.map((row, i) =>
            present.map((key, j) =>
              j === 0
                ? `<button class="text-link" data-inspection-row="${i}">${e(row[key])}</button>`
                : e(
                    key.endsWith("_bytes")
                      ? capacity(row[key])
                      : (row[key] ?? "—"),
                  ),
            ),
          ),
        ) +
        `<button class="text-link" data-inspection-receipt>Open collection receipt</button>`;
      listWorkspace(target, "tbody tr", kind + " on " + d.id, {label:kind + " on " + d.label});
      target.querySelector<HTMLButtonElement>(
        "[data-inspection-receipt]",
      )!.onclick = () => ui.showJob(report.job_id);
      target
        .querySelectorAll<HTMLButtonElement>("[data-inspection-row]")
        .forEach(
          (b) =>
            (b.onclick = () => {
              const row = rows[Number(b.dataset.inspectionRow)];
              if (kind === "processes") {
                process(d, row);
                return;
              }
              ui.flyout(
                row.name || "Inventory detail",
                facts(
                  Object.entries(row)
                    .filter(([, v]) => typeof v !== "object")
                    .map(([k, v]) => [
                      k.replaceAll("_", " "),
                      k.endsWith("_bytes") ? capacity(v) : v,
                    ]),
                ) +
                  facts([
                    ["Machine", d.label],
                    ["Collected", detailDate(report.collected)],
                  ]) +
                  technicalDetail(row),
                { tone: "agents" },
              );
            }),
        );
    };
    root.querySelector<HTMLSelectElement>("select")!.onchange = draw;
    const button = root.querySelector<HTMLButtonElement>(
      "[data-inspection-collect]",
    )!;
    button.disabled = !d.online || !d.approved || d.archived;
    button.onclick = () =>
      void collect(
        d,
        root.querySelector<HTMLSelectElement>("select")!.value,
        "",
        () => {
          if (root.isConnected) void inventory(d, root);
          else void ui.openDevice(d.id, "inventory");
        },
      );
    try {
      reports = await ui.api("/devices/" + d.id + "/inspections");
      if (root.isConnected) draw();
    } catch (error) {
      if (root.isConnected) target.textContent = (error as Error).message;
    }
  }
  function process(d: Item, p: Item) {
    const connections = (d.telemetry?.network?.connections || []).filter(
      (c: Item) => String(c.pid) === String(p.pid),
    );
    ui.flyout(
      p.name || p.process || "Process " + p.pid,
      facts([
        ["PID", p.pid],
        ["Parent PID", p.parent_pid],
        ["Name", p.name || p.process],
        ["CPU utilization", p.cpu_percent != null ? p.cpu_percent + "%" : null],
        [
          "Lifetime CPU time",
          p.cpu_seconds != null ? p.cpu_seconds + " seconds" : null,
        ],
        [
          "Working set",
          p.memory_bytes != null ? capacity(p.memory_bytes) : null,
        ],
        [
          "Memory share",
          p.memory_percent != null ? p.memory_percent + "%" : null,
        ],
        ["Machine", d.label],
      ]) +
        section(
          "Connections in the last agent report",
          table(
            ["Local", "Remote", "State"],
            connections.map((c: Item) => [
              e(c.local?.ip) + ":" + e(c.local?.port),
              e(c.remote?.ip) + ":" + e(c.remote?.port),
              e(c.status),
            ]),
          ),
        ) +
        '<p class="resource-note">PIDs can be reused. Connection evidence and on-demand process inventory may have different observation times. CPU seconds is accumulated process time, not instantaneous utilization.</p>',
      { tone: "agents" },
    );
  }
  function network(d: Item, root: HTMLElement) {
    const n = d.telemetry?.network || {},
      interfaces: Item[] = n.interfaces || [],
      routes: Item[] = Array.isArray(n.routes) ? n.routes : [];
    const target = document.createElement("section");
    target.className = "resource-section";
    target.innerHTML =
      section(
        "Interfaces",
        `<div class="resource-related">${interfaces.map((nic, i) => `<button data-interface="${i}"><span><b>${e(nic.name)}</b><small>${e((nic.addrs || []).map((a: Item) => a.address).join(" · "))}</small></span>→</button>`).join("") || "<p>No interface report available.</p>"}</div>`,
      ) +
      section(
        "Routes",
        table(
          ["Destination", "Next hop", "Interface", "Metric"],
          routes.map((r) => [
            e(r.dst || r.DestinationPrefix || "default"),
            e(r.gateway || r.NextHop || "On link"),
            e(r.dev || r.InterfaceAlias || "Not reported"),
            e(r.metric ?? r.RouteMetric ?? "Not reported"),
          ]),
        ) || "<p>No route report available.</p>",
      ) +
      section(
        "DNS resolvers",
        table(
          ["Interface", "Servers"],
          (n.dns_servers || n.dns || []).map((r: any) =>
            typeof r === "string"
              ? ["System", e(r)]
              : [
                  e(r.InterfaceAlias || r.interface),
                  e((r.ServerAddresses || r.servers || []).join(", ")),
                ],
          ),
        ),
      ) +
      section(
        "Connections",
        table(
          ["Process", "Local → remote", "State"],
          (n.connections || []).map((c: Item, i: number) => [
            `<button class="text-link" data-process="${i}">${e(c.process || "Process")} · ${e(c.pid)}</button>`,
            e(c.local?.ip) +
              ":" +
              e(c.local?.port) +
              " → " +
              e(c.remote?.ip) +
              ":" +
              e(c.remote?.port),
            e(c.status || (c.type === 2 ? "UDP" : "")),
          ]),
        ),
      ) +
      '<p class="resource-note">Routes and interfaces describe the last agent report, not a successful reachability test. ' +
      (n.connections_truncated
        ? "Connections are limited to the first 350."
        : "") +
      "</p>" +
      technicalDetail({ resolver: n.resolver_details, counters: n.counters });
    root.append(target);
    target.querySelectorAll<HTMLButtonElement>("[data-interface]").forEach(
      (b) =>
        (b.onclick = () => {
          const nic = interfaces[Number(b.dataset.interface)],
            counters =
              (Array.isArray(n.counters) ? n.counters : []).find(
                (c: Item) => c.name === nic.name,
              ) || {};
          const pane: HTMLDialogElement = ui.flyout(
            nic.name,
            facts([
              [
                "Addresses",
                (nic.addrs || []).map((a: Item) => a.address).join(", "),
              ],
              ["MAC", nic.mac],
              ["MTU", nic.mtu],
              ["Flags", (nic.flags || []).join(", ")],
              ["Bytes received", capacity(counters.bytesRecv)],
              ["Bytes sent", capacity(counters.bytesSent)],
              ["Receive errors", counters.errin],
              ["Transmit errors", counters.errout],
              ["Received packets", counters.packetsRecv],
              ["Sent packets", counters.packetsSent],
              ["Observed", detailDate(d.last_seen)],
            ]) +
              section(
                "Routes using this interface",
                table(
                  ["Destination", "Next hop"],
                  routes
                    .filter((r) => (r.dev || r.InterfaceAlias) === nic.name)
                    .map((r) => [
                      e(r.dst || r.DestinationPrefix || "default"),
                      e(r.gateway || r.NextHop || "On link"),
                    ]),
                ),
              ) +
              '<p class="resource-note">Traffic totals are cumulative counters, not current rates. Physical switch relationships require unique MAC evidence.</p><button class="secondary" data-interface-network>Follow network relationships →</button>' +
              technicalDetail(nic),
            { tone: "network" },
          );
          pane.querySelector<HTMLButtonElement>(
            "[data-interface-network]",
          )!.onclick = () => {
            pane.close();
            ui.openNetwork(d);
          };
        }),
    );
    target
      .querySelectorAll<HTMLButtonElement>("[data-process]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            process(d, n.connections[Number(b.dataset.process)])),
      );
  }
  registerResource("service", async (ref) => {
    const rows = await ui.api("/devices?include_archived=true"),
      d = rows.find((d: Item) => d.id === ref.connection);
    const s = d?.telemetry?.services?.find((s: Item) => s.name === ref.id);
    if (!s) throw new Error("Service is not in the latest machine report");
    service(d, s);
  });
  function volume(d: Item, disk: Item) {
    const pane: HTMLDialogElement = ui.flyout(disk.path || "Volume", section("Reported storage", facts([
      ["Machine", d.label], ["Mount path", disk.path], ["Device", disk.device], ["Filesystem", disk.fstype],
      ["Capacity", capacity(disk.total)], ["Used", capacity(disk.used)], ["Free", capacity(disk.free)],
      ["Utilization", disk.usedPercent == null ? "Not reported" : Number(disk.usedPercent).toFixed(1) + "%"],
      ["Last report", detailDate(d.last_seen)],
    ])) + '<p class="resource-note">Filesystem usage from the endpoint report. Virtual disk allocation and filesystem capacity can differ.</p><button class="secondary" data-volume-inventory>Inspect disks and volumes →</button>' + technicalDetail(disk), {tone:"agents"});
    pane.querySelector<HTMLButtonElement>('[data-volume-inventory]')!.onclick = () => ui.openDevice(d.id, "inventory");
  }
  return { collect, service, serviceControl, inventory, network, process, volume };
}
