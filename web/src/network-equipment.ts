import "./network-equipment.css";
import {
  capacity,
  detailDate,
  detailFacts as facts,
  detailHero as hero,
  detailSection as section,
  detailStatus as status,
  escapeDetail as e,
} from "./resource-story";
type Item = Record<string, any>;
const pct = (v: any) =>
  typeof v === "number" ? v.toFixed(1) + "%" : "Not reported";
const rate = (v: any) =>
  typeof v === "number" ? capacity(v / 8) + "/s" : "Not reported";
const speed = (v: any) =>
  typeof v === "number"
    ? v >= 1000
      ? v / 1000 + " Gbps"
      : v + " Mbps"
    : "Not reported";
const note = (s: string) => `<p class="resource-note">${e(s)}</p>`;
const path = (s: Item) =>
  "/unifi/sites/" +
  encodeURIComponent(s.console_id) +
  "/" +
  encodeURIComponent(s.site_id || s.id);
const kind = (d: Item) => {
  const f = d.features || {};
  return "accessPoint" in f || (Array.isArray(f) && f.includes("accessPoint"))
    ? "Access point"
    : "switching" in f || (Array.isArray(f) && f.includes("switching"))
      ? "Switch"
      : "Network device";
};
export function createEquipment(ui: Item, openClient: (c: Item) => void) {
  async function openInventory(site: Item) {
    const pane = ui.flyout(
      site.name || "Network equipment",
      note("Reading adopted devices…"),
      { tone: "network", subtitle: "Network · Equipment" },
    );
    const root = pane.querySelector(".resource-body") as HTMLElement;
    try {
      const data = await ui.api(path(site) + "/devices");
      if (!pane.open) return;
      root.innerHTML =
        hero(
          "UniFi · Equipment",
          null,
          "Explore physical connections, power and the clients that depend on them.",
          [
            ["Devices", data.devices.length],
            [
              "Online",
              data.devices.filter((d: Item) => d.state === "ONLINE").length,
            ],
            [
              "Updates",
              data.devices.filter((d: Item) => d.firmwareUpdatable).length,
            ],
          ],
        ) +
        `<label class="equipment-search">Find equipment<input type="search" placeholder="Name, address, MAC or model"></label><div data-equipment-list></div>`;
      const draw = () => {
        const q = root.querySelector("input")!.value.toLowerCase(),
          rows = data.devices
            .filter((d: Item) =>
              [d.name, d.macAddress, d.ipAddress, d.model]
                .join(" ")
                .toLowerCase()
                .includes(q),
            )
            .sort((a: Item, b: Item) => a.name.localeCompare(b.name));
        root.querySelector("[data-equipment-list]")!.innerHTML =
          `<div class="equipment-list">${rows.map((d: Item, i: number) => `<button data-equipment="${i}"><span class="equipment-symbol">${kind(d) === "Switch" ? "▦" : "◉"}</span><span><b>${e(d.name)}</b><small>${e(kind(d) + " · " + d.model)}</small><small>${e(d.ipAddress)} · ${e(d.macAddress)}</small></span>${status(d.state)}</button>`).join("")}</div>` +
          (rows.length ? "" : note("No matching equipment.")) +
          (data.truncated
            ? note("Inventory is limited to 5,000 devices.")
            : note("Select equipment to inspect ports and connected clients."));
        root
          .querySelectorAll<HTMLElement>("[data-equipment]")
          .forEach(
            (b) =>
              (b.onclick = () =>
                void openDevice(
                  site,
                  rows[Number(b.dataset.equipment)].id,
                  undefined,
                  () => void openInventory(site),
                )),
          );
      };
      root.querySelector("input")!.oninput = draw;
      draw();
    } catch (err) {
      if (pane.open)
        root.innerHTML =
          note((err as Error).message) +
          `<button class="secondary" data-retry>Try again</button>`;
      root
        .querySelector("[data-retry]")
        ?.addEventListener("click", () => void openInventory(site));
    }
  }
  async function openDevice(
    site: Item,
    id: string,
    selectedPort?: number,
    back?: () => void,
  ) {
    const pane = ui.flyout(
      "Network equipment",
      note("Reading device, ports and connection evidence…"),
      {
        tone: "network",
        subtitle: "Network · " + (site.site_id ? "Equipment" : site.name || "Equipment"),
        className: "equipment-flyout",
      },
    );
    const root = pane.querySelector(".resource-body") as HTMLElement;
    const endpoint = path(site) + "/devices/" + encodeURIComponent(id);
    let data: Item | null = null,
      tab = "ports",
      version = 0;
    const deviceLink = (d: Item, label?: string) =>
      `<button class="equipment-relation" data-hop="${e(d.id)}"><span><b>${e(label || d.name)}</b><small>${e(d.model || "Network device")}${d.parent_port ? " · Port " + e(d.parent_port) : ""}</small></span>${status(d.state)}<span aria-hidden="true">→</span></button>`;
    function clients(rows: Item[]) {
      return rows.length
        ? `<div class="equipment-list">${rows.map((c, i) => `<button data-attached-client="${i}"><span><b>${e(c.name || c.mac)}</b><small>${e(c.ip || "Address not reported")} · ${e(c.mac)}</small><small>${e(c.uplink_name || "")}${c.port ? " · Port " + e(c.port) : ""}</small></span>${status(c.state === "online" ? "Recently seen" : "Previously seen")}</button>`).join("")}</div>`
        : note(
            "No clients in the returned observations. Unmanaged devices may not appear here.",
          );
    }
    function bindClients(target: HTMLElement, rows: Item[]) {
      target
        .querySelectorAll<HTMLElement>("[data-attached-client]")
        .forEach(
          (b) =>
            (b.onclick = () =>
              openClient(rows[Number(b.dataset.attachedClient)])),
        );
    }
    function ports() {
      const ports = data!.ports as Item[];
      if (!ports.length)
        return note(
          "No physical switch ports are reported by this device. Explore its clients and radios below.",
        );
      if (!ports.some((p) => p.idx === selectedPort))
        selectedPort = ports[0].idx;
      const p = ports.find((p) => p.idx === selectedPort)!,
        o = p.observation || {},
        direct = data!.clients.filter((c: Item) => c.port === p.idx),
        children = data!.children.filter((c: Item) => c.parent_port === p.idx);
      return `<div class="port-legend"><span><i class="up"></i>Link up</span><span><i></i>Link down / unknown</span><span>ϟ PoE supplies power</span></div><div class="port-grid" role="group" aria-label="Physical ports">${ports.map((p) => `<button data-port="${p.idx}" class="port ${p.state === "UP" ? "up" : ""} ${p.idx === selectedPort ? "selected" : ""}" aria-pressed="${p.idx === selectedPort}" aria-label="Port ${p.idx}, ${p.state}${p.poe?.state === "UP" ? ", PoE on" : ""}"><b>${p.idx}</b><small>${p.connector || "Port"}</small><span>${p.poe?.state === "UP" ? "ϟ" : "·"}</span></button>`).join("")}</div><section class="port-detail"><div class="equipment-heading"><div><span class="resource-eyebrow">Physical port ${p.idx}</span><h3>${e(o.name || "Port " + p.idx)}</h3></div>${status(p.state)}</div>${facts(
        [
          ["Link speed", speed(p.speedMbps)],
          ["Maximum speed", speed(p.maxSpeedMbps)],
          [
            "PoE",
            p.poe
              ? p.poe.enabled
                ? "Enabled · " + p.poe.state
                : "Disabled"
              : "Not supported / not reported",
          ],
          [
            "Power draw",
            typeof o.poe_power === "number" ? o.poe_power + " W" : null,
          ],
          ["Power standard", p.poe?.standard],
          ["Spanning tree", o.stp_state],
          ["Received", capacity(o.rx_bytes)],
          ["Transmitted", capacity(o.tx_bytes)],
          [
            "Receive / transmit errors",
            o.rx_errors != null && o.tx_errors != null
              ? o.rx_errors + " / " + o.tx_errors
              : null,
          ],
          [
            "Dropped packets",
            o.rx_dropped != null && o.tx_dropped != null
              ? o.rx_dropped + " / " + o.tx_dropped
              : null,
          ],
        ],
      )}${ui.role() === "admin" && p.poe?.enabled && p.poe.state === "UP" ? '<button class="secondary" data-review="POWER_CYCLE">Review PoE power cycle</button>' : ""}${note("PoE cycling briefly removes power from equipment on this port. A general port reset is not exposed by the UniFi API.")}${section("Equipment on this port", children.map((d: Item) => deviceLink(d)).join("") || note("No downstream UniFi equipment is reported on this port."))}${section("Clients observed on this port", clients(direct))}</section>`;
    }
    async function drawTab() {
      const target = root.querySelector<HTMLElement>(
        "[data-equipment-content]",
      )!;
      root
        .querySelectorAll("[data-equipment-tab]")
        .forEach((b) =>
          b.setAttribute(
            "aria-selected",
            String((b as HTMLElement).dataset.equipmentTab === tab),
          ),
        );
      if (tab === "ports") {
        target.innerHTML = ports();
        bindClients(
          target,
          data!.clients.filter((c: Item) => c.port === selectedPort),
        );
        target.querySelectorAll<HTMLElement>("[data-port]").forEach(
          (b) =>
            (b.onclick = () => {
              selectedPort = Number(b.dataset.port);
              void drawTab();
            }),
        );
      } else if (tab === "clients") {
        const direct = data!.clients,
          down = data!.downstream_clients;
        target.innerHTML =
          section("Directly connected", clients(direct)) +
          section(
            "Behind downstream equipment",
            `<div data-indirect>${clients(down)}</div>`,
          );
        bindClients(target.querySelector(".resource-section")!, direct);
        bindClients(target.querySelector("[data-indirect]")!, down);
      } else if (tab === "equipment") {
        target.innerHTML =
          section(
            "Upstream",
            data!.upstream
              ? deviceLink(data!.upstream) +
                  note(
                    data!.upstream_port
                      ? "Connected to upstream port " + data!.upstream_port
                      : "Upstream port is not reported.",
                  )
              : note("No upstream UniFi device is identified."),
          ) +
          section(
            "Downstream equipment",
            data!.children.map((d: Item) => deviceLink(d)).join("") ||
              note("No directly downstream UniFi equipment reported."),
          );
      } else if (tab === "health") {
        const d = data!.device,
          s = data!.statistics || {},
          radios = d.interfaces?.radios || [];
        target.innerHTML =
          section(
            "Health & identity",
            facts([
              ["IP address", d.ipAddress],
              ["MAC address", d.macAddress],
              ["Firmware", d.firmwareVersion],
              ["Update available", d.firmwareUpdatable],
              [
                "Uptime",
                typeof s.uptimeSec === "number"
                  ? Math.floor(s.uptimeSec / 86400) +
                    " days " +
                    Math.floor((s.uptimeSec % 86400) / 3600) +
                    " hours"
                  : null,
              ],
              ["Last heartbeat", detailDate(s.lastHeartbeatAt)],
              [
                "Load average (1 / 5 / 15 minutes)",
                s.loadAverage1Min != null
                  ? [
                      s.loadAverage1Min,
                      s.loadAverage5Min,
                      s.loadAverage15Min,
                    ].join(" / ")
                  : null,
              ],
              ["Adopted", detailDate(d.adoptedAt)],
              ["Provisioned", detailDate(d.provisionedAt)],
            ]),
          ) +
          section(
            "Wireless radios",
            radios.length
              ? radios
                  .map((r: Item) =>
                    facts([
                      ["Band", r.frequencyGHz + " GHz"],
                      ["Standard", r.wlanStandard],
                      ["Channel", r.channel],
                      ["Channel width", r.channelWidthMHz + " MHz"],
                      [
                        "Transmit retries",
                        pct(
                          (s.interfaces?.radios || []).find(
                            (x: Item) => x.frequencyGHz === r.frequencyGHz,
                          )?.txRetriesPct,
                        ),
                      ],
                    ]),
                  )
                  .join("")
              : note("No wireless radios reported."),
          );
      } else {
        target.innerHTML = note("Reading operation receipts…");
        try {
          const records = await ui.api("/unifi/operations");
          if (!target.isConnected || tab !== "activity") return;
          const rows = records.filter(
            (r: Item) =>
              r.console_id === site.console_id &&
              r.site_id === (site.site_id || site.id) &&
              r.device_id === id,
          );
          target.innerHTML =
            section(
              "Operations from Speck",
              rows
                .map(
                  (r: Item) =>
                    `<details class="equipment-receipt"><summary>${e(r.operation === "RESTART" ? "Device restart" : "PoE cycle · Port " + r.port)} ${status(r.status)}</summary>${facts(
                      [
                        ["Requested by", r.actor],
                        ["Requested", detailDate(r.created)],
                        ["Receipt", r.id],
                        [
                          "Outcome",
                          r.result?.message ||
                            "No outcome recorded. Inspect the device before retrying.",
                        ],
                      ],
                    )}</details>`,
                )
                .join("") ||
                note("No operations have been requested from Speck."),
            ) +
            note(
              "Submitted means the provider accepted the request. It does not confirm recovery.",
            );
        } catch {
          if (target.isConnected)
            target.innerHTML = note("Operation receipts are unavailable.");
        }
      }
      target
        .querySelectorAll<HTMLElement>("[data-hop]")
        .forEach(
          (b) =>
            (b.onclick = () =>
              void openDevice(
                site,
                b.dataset.hop!,
                undefined,
                () => void openDevice(site, id, selectedPort, back),
              )),
        );
      target
        .querySelector("[data-review]")
        ?.addEventListener(
          "click",
          () => void reviewAction("POWER_CYCLE", selectedPort),
        );
    }
    function draw() {
      if (!pane.open || !data) return;
      const d = data.device,
        s = data.statistics || {};
      pane.setAttribute("aria-label", d.name || "Network equipment");
      pane.querySelector(".dialog-head h2")!.firstChild!.textContent =
        d.name || "Network equipment";
      root.innerHTML =
        `<div class="resource-refresh"><button class="text-link" data-equipment-back>${back ? "← Back" : "← All equipment"}</button><button class="text-link" data-equipment-refresh>Refresh observations</button></div>` +
        hero("UniFi · " + kind(d), d.state, d.model, [
          ["CPU", pct(s.cpuUtilizationPct)],
          ["Memory", pct(s.memoryUtilizationPct)],
          [
            "Uplink traffic",
            rate(
              typeof s.uplink?.rxRateBps === "number" &&
                typeof s.uplink?.txRateBps === "number"
                ? s.uplink.rxRateBps + s.uplink.txRateBps
                : undefined,
            ),
          ],
        ]) +
        `<div class="equipment-context"><span><b>${data.clients.length}</b> direct clients</span><span><b>${data.descendants.length}</b> downstream devices</span><span><b>${data.downstream_clients.length}</b> downstream clients</span></div>` +
        (!data.clients_available
          ? '<p class="resource-notice">Client observations are unavailable. Counts do not establish that the device has no clients.</p>'
          : "") +
        (!data.statistics
          ? note(
              "Device statistics are unavailable. Ports and other reported details remain visible.",
            )
          : "") +
        `<div class="equipment-tabs" role="tablist" aria-label="Equipment views">${["ports", "clients", "equipment", "health", "activity"].map((t) => `<button role="tab" data-equipment-tab="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}</div><div data-equipment-content role="tabpanel"></div><footer class="equipment-footer">${e("Observed " + detailDate(data.checked_at))}${ui.role() === "admin" && d.state === "ONLINE" && d.supported === true ? '<button class="secondary" data-restart>Review device restart</button>' : ""}</footer>`;
      root
        .querySelector("[data-equipment-back]")!
        .addEventListener("click", () =>
          back ? back() : void openInventory(site),
        );
      root
        .querySelector("[data-equipment-refresh]")!
        .addEventListener("click", () => void load(true));
      root.querySelectorAll<HTMLElement>("[data-equipment-tab]").forEach(
        (b) =>
          (b.onclick = () => {
            tab = b.dataset.equipmentTab!;
            void drawTab();
          }),
      );
      root
        .querySelector("[data-restart]")
        ?.addEventListener("click", () => void reviewAction("RESTART"));
      void drawTab();
    }
    async function reviewAction(operation: string, port?: number) {
      const dialog = ui.dialog(
        "Review " +
          (operation === "RESTART" ? "device restart" : "PoE power cycle"),
        note("Checking current equipment and affected connections…"),
        { className: "wide" },
      );
      const body =
        dialog.querySelector(".dialog-body") ||
        dialog.querySelector("section") ||
        dialog;
      // ui.dialog uses .body; keep its close control intact.
      const content = document.createElement("div");
      content.className = "equipment-review";
      const loading = Array.from(
        dialog.querySelectorAll(".resource-note"),
      ).find((x: any) => x.textContent?.startsWith("Checking")) as
        | HTMLElement
        | undefined;
      if (loading) loading.replaceWith(content);
      else body.append(content);
      let review: Item;
      try {
        review = await ui.api(endpoint + "/review", "POST", {
          operation,
          ...(port ? { port } : {}),
        });
        if (!dialog.open) return;
      } catch (err) {
        if (dialog.open)
          content.innerHTML = `<p role="alert">${e((err as Error).message)}</p>`;
        return;
      }
      content.innerHTML =
        hero(
          "Confirm interruption",
          null,
          operation === "RESTART"
            ? "Restarting this device interrupts its network connections."
            : "Power will briefly stop on port " +
                port +
                ". Connected powered equipment will restart.",
          [
            ["Known clients", review.clients.length],
            ["Downstream devices", review.devices.length],
          ],
        ) +
        facts([
          ["Device", review.target],
          ["Site reference", review.site?.reference],
          ["Console ID", review.site?.console_id],
          ["Model", review.model],
          ["MAC address", review.mac],
          ["Port", review.port ?? "Entire device"],
          ["Review expires", detailDate(review.expires_at)],
        ]) +
        section(
          "Affected connections",
          `<ul>${[...review.devices, ...review.clients].map((r: Item) => `<li>${e(r.name || r.mac)}${r.ip ? " · " + e(r.ip) : ""}</li>`).join("")}</ul>`,
        ) +
        note(review.warning) +
        `<form><label>Type <strong>${e(review.target)}</strong> to confirm<input autocomplete="off" aria-label="Confirm device name" required></label><p data-action-status role="status"></p><div class="dialog-footer"><button type="button" class="secondary" data-cancel>Cancel</button><button type="submit" class="primary" disabled>Confirm ${operation === "RESTART" ? "restart" : "PoE cycle"}</button></div></form>`;
      const input = content.querySelector("input")!,
        button = content.querySelector<HTMLButtonElement>("[type=submit]")!,
        message = content.querySelector("[data-action-status]")!;
      input.oninput = () => (button.disabled = input.value !== review.target);
      content
        .querySelector("[data-cancel]")!
        .addEventListener("click", () => dialog.close());
      content.querySelector("form")!.onsubmit = async (ev) => {
        ev.preventDefault();
        button.disabled = true;
        input.disabled = true;
        message.textContent = "Submitting once…";
        try {
          const r = await ui.api(
            "/unifi/operations/" + review.id + "/execute",
            "POST",
            { confirmation: input.value },
          );
          if (!dialog.open) return;
          message.textContent =
            r.status +
            ": " +
            (r.result?.message || "Inspect the device before retrying.");
          button.remove();
          content.querySelector("[data-cancel]")!.textContent = "Close";
        } catch (err) {
          if (dialog.open) {
            message.textContent =
              (err as Error).message +
              " Close this review and inspect Activity before retrying.";
            button.remove();
          }
        }
      };
    }
    async function load(fresh = false) {
      const current = ++version;
      const refresh = root.querySelector<HTMLButtonElement>(
        "[data-equipment-refresh]",
      );
      if (refresh) {
        refresh.disabled = true;
        refresh.textContent = "Refreshing…";
      }
      try {
        const result = await (fresh ? ui.freshApi : ui.api)(endpoint);
        if (pane.open && version === current) {
          data = result;
          if (!data.ports.length && tab === "ports") tab = "clients";
          draw();
        }
      } catch (err) {
        if (pane.open && current === version) {
          if (!data)
            root.innerHTML =
              note((err as Error).message) +
              `<button class="secondary" data-load-retry>Try again</button>`;
          else {
            const n = document.createElement("p");
            n.className = "resource-notice";
            n.textContent =
              "Refresh failed. Showing the previous observations.";
            root.prepend(n);
          }
          root
            .querySelector("[data-load-retry]")
            ?.addEventListener("click", () => void load(true));
          if (refresh) {
            refresh.disabled = false;
            refresh.textContent = "Refresh observations";
          }
        }
      }
    }
    await load();
  }
  return { openInventory, openDevice };
}
