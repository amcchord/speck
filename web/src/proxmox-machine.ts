import "./proxmox-machine.css";
import { openProviderConsole } from "./provider-console";
import { captureProviderPreview, downloadScreen } from "./provider-preview";
import {
  adapters,
  chartPoints,
  disks,
  duration,
  guestAddresses,
  list,
  number,
  object,
  percent,
  sparkline,
} from "./proxmox-model";
type Item = Record<string, any>;

/** The same Proxmox workspace is embedded in Fleet and the infrastructure dialog. */
export function mountProxmoxMachine(
  ui: Item,
  initial: Item,
  root: HTMLElement,
  action: (id: string, spec: Item, resource: Item) => void,
) {
  const { esc, bytes, date } = ui;
  let resource = initial,
    detail: Item = {},
    guest: Item = {},
    catalog: Item = {},
    tab = "overview",
    disposed = false;
  let preview: AbortController | null = null,
    previewImage = "",
    generation = 0,
    tabGeneration = 0;
  const base = `/infrastructure/connections/${resource.connection_id}`;
  const path = `${base}/resources/${resource.kind}/${encodeURIComponent(resource.id)}`;
  const alive = () => !disposed && root.isConnected;
  const find = (s: string) => root.querySelector<HTMLElement>(s)!;
  const bind = (s: string, fn: () => any) =>
    root.querySelectorAll<HTMLElement>(s).forEach((el) => (el.onclick = fn));
  const button = (
    key: string,
    text: string,
    primary = false,
    disabled = false,
  ) =>
    `<button type="button" class="${primary ? "primary" : "secondary"}" data-pve-${key} ${disabled ? "disabled" : ""}>${esc(text)}</button>`;
  const note = (text: string) => `<p class="pve-note">${esc(text)}</p>`;
  const facts = (rows: [string, any][]) =>
    `<dl class="pve-facts">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v ?? "Not reported")}</dd></div>`).join("")}</dl>`;
  const table = (head: string[], rows: any[][], empty: string) =>
    rows.length
      ? `<div class="pve-table"><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((v) => `<td>${esc(v ?? "—")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
      : note(empty);
  const section = (title: string, body: string) =>
    `<section class="pve-section"><h3>${esc(title)}</h3>${body}</section>`;
  const unavailable = (key: string) =>
    detail.availability?.[key]?.state === "unavailable"
      ? note(detail.availability[key].message)
      : "";
  const canScreen = () =>
    resource.kind === "qemu" &&
    detail.capabilities?.console?.available === true;
  const guestSection = (key: string) => guest.sections?.[key]?.data;
  const guestNotice = () =>
    guest.state === "loading"
      ? note("Reading guest information…")
      : guest.state !== "available"
        ? note(guest.message || "Guest information has not been reported.")
        : "";
  const read = (id: string, args: Item = {}) =>
    ui.api(
      `${base}/read/${id}?args=${encodeURIComponent(JSON.stringify(args))}&kind=${resource.kind}&resource_id=${encodeURIComponent(resource.id)}`,
    );

  const observer = new MutationObserver(() => {
    if (!root.isConnected) dispose();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  const owner = root.closest("dialog");
  const dispose = () => {
    disposed = true;
    generation++;
    tabGeneration++;
    preview?.abort();
    observer.disconnect();
    owner?.removeEventListener("close", dispose);
  };
  owner?.addEventListener("close", dispose);

  function actions() {
    const running = (detail.status?.status || resource.status) === "running";
    const allowed = Object.entries(catalog).filter(
      ([id, spec]: [string, any]) =>
        (spec.method !== "GET"
          ? ui.role() === "admin"
          : ["guest-command-result", "guest-file-read"].includes(id)) &&
        (!resource.template || id === "clone"),
    );
    const primary = allowed.filter(([id]) =>
      running ? ["shutdown", "reboot"].includes(id) : id === "start",
    );
    const rest = allowed.filter(([id]) => !primary.some(([key]) => key === id));
    const op = ([id, spec]: [string, any]) =>
      `<button type="button" class="secondary" data-pve-operation="${esc(id)}">${esc(spec.label)}</button>`;
    return `${resource.kind === "qemu" ? button("console", "Screen control", true, !canScreen()) : ""}${primary.map(op).join("")}${rest.length ? `<details class="pve-more"><summary>More actions</summary><div class="pve-action-menu">${rest.map(op).join("")}</div></details>` : ""}${resource.agent ? button("agent", "Open Speck agent") : ""}${button("refresh", "Refresh details")}`;
  }
  function bindActions() {
    root
      .querySelectorAll<HTMLElement>("[data-pve-operation]")
      .forEach(
        (el) =>
          (el.onclick = () =>
            action(
              el.dataset.pveOperation!,
              catalog[el.dataset.pveOperation!],
              resource,
            )),
      );
    bind("[data-pve-refresh]", () => load());
    bind("[data-pve-agent]", () => {
      owner?.close();
      ui.openDevice(resource.agent.id);
    });
    bind("[data-pve-console]", async () => {
      const pending = previewWork;
      preview?.abort();
      await pending;
      if (alive()) await openProviderConsole(ui, resource);
    });
  }
  let previewWork: Promise<void> | undefined;
  function capture() {
    if (preview || !canScreen()) return;
    const controller = new AbortController();
    preview = controller;
    const status = find("[data-pve-preview-status]");
    status.textContent = "Capturing a read-only screen preview…";
    const captureButton = find("[data-pve-capture]") as HTMLButtonElement;
    captureButton.disabled = true;
    previewWork = (async () => {
      try {
        const image = await captureProviderPreview(
          ui,
          resource,
          controller.signal,
        );
        if (!alive() || controller.signal.aborted) return;
        previewImage = image;
        const img = document.createElement("img");
        img.src = image;
        img.alt = `Screen preview of ${resource.name}`;
        find(".pve-preview-screen").replaceChildren(img);
        status.textContent = `Captured ${new Date().toLocaleTimeString()} · View only`;
        (find("[data-pve-download]") as HTMLButtonElement).disabled = false;
      } catch (e) {
        if (alive() && !controller.signal.aborted)
          status.textContent = (e as Error).message;
      } finally {
        preview = null;
        if (alive()) captureButton.disabled = !canScreen();
      }
    })();
  }
  function overview() {
    const status = detail.status || {},
      config = detail.configuration || {};
    const memoryTotal =
      status.maxmem ??
      resource.max_memory ??
      (number(config.memory) === null ? null : Number(config.memory) * 1048576);
    const memoryUsed = status.mem ?? resource.memory;
    const cpu = percent(status.cpu ?? resource.cpu),
      memory = percent(memoryUsed, memoryTotal);
    const meter = (label: string, p: number | null, caption: string) =>
      `<div class="pve-meter"><small>${esc(label)}</small><strong>${p === null ? "—" : p.toFixed(1) + "<em>%</em>"}</strong>${p === null ? "" : `<progress aria-label="${esc(label)} utilization" value="${p}" max="100"></progress>`}<small>${esc(caption)}</small></div>`;
    const os = object(guestSection("os"));
    const osName =
      os["pretty-name"] ||
      os.name ||
      (
        {
          win11: "Windows 11 / Server",
          win10: "Windows 10 / Server",
          l26: "Linux",
          other: "Other OS",
        } as Item
      )[config.ostype] ||
      config.ostype;
    const ips = guestAddresses(guestSection("network"));
    const cores =
      status.cpus ??
      (config.cores
        ? Number(config.cores) * Number(config.sockets || 1)
        : null);
    return `${unavailable("status")}<div class="pve-meters">${meter("CPU", cpu, cores ? `${cores} vCPUs · ${config.cpu || "Provider default"}` : "vCPU count not reported")}${meter("Memory", memory, memoryTotal == null ? "Capacity not reported" : `${memoryUsed == null ? "Not reported" : bytes(memoryUsed)} / ${bytes(memoryTotal)}`)}<div class="pve-meter"><small>Uptime</small><strong class="pve-uptime">${esc(duration(status.uptime))}</strong><small>${esc(status.qmpstatus || status.status || resource.status || "Unknown")}</small></div></div>${section(
      "Machine",
      facts([
        [
          "Operating system",
          osName ||
            (guest.state === "loading"
              ? "Reading guest agent…"
              : "Not reported"),
        ],
        ["IP addresses", ips.join(" · ") || "Not reported"],
        ["Host", resource.node],
        ["VM ID", resource.id],
        [
          "QEMU guest agent",
          guest.state === "available"
            ? "Responding"
            : detail.capabilities?.guest_agent
              ? "Enabled · awaiting guest data"
              : "Not enabled",
        ],
        [
          "Boot firmware",
          config.bios === "ovmf" ? "UEFI" : config.bios || "Provider default",
        ],
        [
          "Start at boot",
          config.onboot == null
            ? "Not reported"
            : Number(config.onboot)
              ? "Yes"
              : "No",
        ],
        [
          "Pool / tags",
          [resource.pool, config.tags?.replaceAll(";", " · ")]
            .filter(Boolean)
            .join(" · ") || "None",
        ],
      ]) + guestNotice(),
    )}${storage()}${section("Recent activity", tasks())}`;
  }
  function storage() {
    const config = detail.configuration || {},
      fs = list(guestSection("filesystems"));
    const mounts = fs
      .map((f) => {
        const used = f["used-bytes"],
          total = f["total-bytes"],
          p = percent(used, total);
        return `<div class="pve-filesystem"><div><b>${esc(f.mountpoint || f.name)}</b><span>${esc(f.type || "")}</span></div><span>${used == null ? "Not reported" : bytes(used)} / ${total == null ? "Not reported" : bytes(total)}</span>${p === null ? "" : `<progress aria-label="${esc(f.mountpoint || f.name)} usage" value="${p}" max="100"></progress>`}</div>`;
      })
      .join("");
    return section(
      "Storage",
      unavailable("configuration") +
        table(
          ["Device", "Capacity", "Storage", "Volume"],
          disks(config).map((d) => [
            d.key + (d.media === "CD/DVD" ? " · CD/DVD" : ""),
            d.size,
            d.storage,
            d.volume,
          ]),
          "No virtual disks reported.",
        ) +
        (mounts
          ? `<h4>Guest filesystems</h4>${mounts}`
          : note(
              "Guest filesystem usage is separate from virtual disk capacity; it requires a responding QEMU guest agent.",
            )),
    );
  }
  function tasks() {
    return (
      unavailable("recent_tasks") ||
      table(
        ["Task", "Result", "Started", "Duration"],
        list(detail.recent_tasks).map((t) => [
          String(t.type || "Task").replace(/^qm/, "VM "),
          t.status || (t.endtime ? "Finished" : "Running"),
          date(t.starttime),
          t.endtime ? duration(t.endtime - t.starttime) : "In progress",
        ]),
        "No recent tasks reported.",
      )
    );
  }
  function network() {
    const interfaces = list(guestSection("network"));
    return (
      section(
        "Virtual network adapters",
        unavailable("configuration") +
          table(
            ["Adapter", "Model", "MAC", "Bridge", "VLAN"],
            adapters(detail.configuration || {}).map((n) => [
              n.key,
              n.model,
              n.mac,
              n.bridge,
              n.vlan,
            ]),
            "No virtual network adapters reported.",
          ),
      ) +
      section(
        "Guest interfaces",
        guestNotice() +
          table(
            ["Interface", "MAC", "Addresses"],
            interfaces.map((n) => [
              n.name,
              n["hardware-address"],
              (n["ip-addresses"] || [])
                .map((ip: Item) => `${ip["ip-address"]}/${ip.prefix}`)
                .join(" · "),
            ]),
            "No guest interfaces reported.",
          ),
      )
    );
  }
  async function renderTab() {
    const current = ++tabGeneration;
    const body = find("[data-pve-content]");
    root
      .querySelector<HTMLElement>(".pve-preview")
      ?.toggleAttribute("hidden", tab !== "overview");
    root.querySelectorAll<HTMLElement>("[data-pve-tab]").forEach((el) => {
      el.setAttribute("aria-selected", String(el.dataset.pveTab === tab));
      el.tabIndex = el.dataset.pveTab === tab ? 0 : -1;
      el.classList.toggle("active", el.dataset.pveTab === tab);
    });
    if (tab === "overview") body.innerHTML = overview();
    else if (tab === "hardware")
      body.innerHTML =
        section(
          "Hardware",
          unavailable("configuration") +
            facts([
              ["CPU model", detail.configuration?.cpu],
              ["Cores per socket", detail.configuration?.cores],
              ["Sockets", detail.configuration?.sockets],
              [
                "Memory",
                detail.configuration?.memory == null
                  ? null
                  : bytes(Number(detail.configuration.memory) * 1048576),
              ],
              [
                "Machine type",
                detail.configuration?.machine || "Provider default",
              ],
              ["SCSI controller", detail.configuration?.scsihw],
              ["Boot order", detail.configuration?.boot],
              ["Description", detail.configuration?.description || "None"],
            ]),
        ) + storage();
    else if (tab === "network") body.innerHTML = network();
    else if (tab === "activity")
      body.innerHTML = section("Recent activity", tasks());
    else if (tab === "performance" || tab === "snapshots") {
      body.innerHTML = note(`Loading ${tab}…`);
      try {
        const result = await read(
          tab === "performance" ? "metrics" : "snapshots",
          tab === "performance" ? { timeframe: "hour" } : {},
        );
        if (!alive() || current !== tabGeneration) return;
        if (tab === "snapshots")
          body.innerHTML = section(
            "Snapshots",
            table(
              ["Snapshot", "Created", "Memory", "Description"],
              list(result)
                .filter((s) => s.name !== "current")
                .map((s) => [
                  s.name,
                  s.snaptime ? date(s.snaptime) : "Not reported",
                  s.vmstate ? "Included" : "Not included",
                  s.description || "—",
                ]),
              "No snapshots. Create one from More actions.",
            ),
          );
        else {
          const rows = list(result)
            .filter((r) => number(r.time) !== null)
            .sort((a, b) => a.time - b.time);
          const graph = (
            title: string,
            key: string,
            scale: number,
            format: (v: number) => string,
            max?: number,
          ) => {
            const points = chartPoints(rows, key, scale),
              path = sparkline(points, max),
              values = points.filter((v): v is number => v !== null);
            return `<article class="pve-chart"><h3>${esc(title)}</h3><strong>${values.length ? esc(format(values.at(-1)!)) : "Not reported"}</strong>${path ? `<svg viewBox="0 0 300 70" role="img" aria-label="${esc(title)} over the last hour"><path d="${path}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"/></svg><small>Peak ${esc(format(Math.max(...values)))}</small>` : note("Not enough samples for a chart.")}</article>`;
          };
          body.innerHTML = `<p class="pve-note">Last hour · Provider samples${rows.length ? ` · ${esc(date(rows[0].time))} – ${esc(date(rows.at(-1)!.time))}` : ""}</p><div class="pve-charts">${graph("CPU", "cpu", 100, (v) => v.toFixed(1) + "%", 100)}${graph("Memory", "mem", 1, bytes)}${graph("Network received", "netin", 1, (v) => bytes(v) + "/s")}${graph("Network sent", "netout", 1, (v) => bytes(v) + "/s")}${graph("Disk read", "diskread", 1, (v) => bytes(v) + "/s")}${graph("Disk write", "diskwrite", 1, (v) => bytes(v) + "/s")}</div>`;
        }
      } catch (e) {
        if (alive() && current === tabGeneration)
          body.innerHTML =
            note((e as Error).message) + button("retry-tab", "Try again");
        bind("[data-pve-retry-tab]", renderTab);
      }
    }
  }
  async function load() {
    const current = ++generation;
    tabGeneration++;
    preview?.abort();
    await previewWork;
    if (!alive() || current !== generation) return;
    root.innerHTML =
      '<p class="pve-note" role="status">Loading Proxmox machine…</p>';
    try {
      const results = await Promise.allSettled([
        ui.api(path),
        ui.api(`${base}/catalog?kind=${resource.kind}`),
      ]);
      if (!alive() || current !== generation) return;
      if (results[0].status === "rejected") throw results[0].reason;
      detail = results[0].value;
      catalog = results[1].status === "fulfilled" ? results[1].value : {};
      resource = { ...resource, ...detail.resource };
      guest = { state: "loading" };
      root.classList.add("pve-machine");
      root.innerHTML = `<div class="pve-heading"><p>${esc(resource.connection_name)} <span>›</span> ${esc(resource.node)} <span>›</span> ${resource.kind === "lxc" ? "Container" : "VM"} ${esc(resource.id)}</p><span class="pve-state">${esc(detail.status?.status || resource.status || "Unknown")}</span></div><div class="pve-controls">${actions()}</div>${resource.kind === "qemu" ? `<section class="pve-preview"><div class="pve-preview-screen">${note(canScreen() ? "Screen preview" : detail.capabilities?.console?.reason || "Screen access is unavailable.")}</div><div class="pve-preview-footer"><span data-pve-preview-status role="status">${esc(canScreen() ? "A snapshot of the VM display. No guest login required." : detail.capabilities?.console?.reason || "")}</span><div>${button("capture", "Refresh preview", false, !canScreen())}${button("download", "Save screenshot", false, true)}</div></div></section>` : ""}<div class="pve-tabs" role="tablist" aria-label="Proxmox machine views">${["overview", "hardware", "network", "performance", "snapshots", "activity"].map((t) => `<button type="button" role="tab" data-pve-tab="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}</div><div data-pve-content role="tabpanel"></div><footer class="pve-footer">${esc(detail.checked_at ? `Checked ${date(detail.checked_at)}` : "Proxmox inventory")} · ${esc(resource.agent ? "Speck endpoint linked" : "Managed through Proxmox")}</footer>`;
      bindActions();
      const tabs = [
        ...root.querySelectorAll<HTMLButtonElement>("[data-pve-tab]"),
      ];
      tabs.forEach((el, index) => {
        el.onclick = () => {
          tab = el.dataset.pveTab!;
          void renderTab();
        };
        el.onkeydown = (event) => {
          const offset =
            event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
          if (!offset) return;
          event.preventDefault();
          const next = tabs[(index + offset + tabs.length) % tabs.length];
          next.focus();
          next.click();
        };
      });
      bind("[data-pve-capture]", capture);
      bind("[data-pve-download]", () =>
        downloadScreen(previewImage, resource.name),
      );
      void renderTab();
      if (canScreen()) capture();
      let nextGuest: Item;
      if (
        resource.kind === "qemu" &&
        resource.status === "running" &&
        (detail.capabilities?.guest_agent ||
          !detail.capabilities?.guest_agent_config_known)
      ) {
        try {
          nextGuest = await ui.api(path + "/guest");
        } catch {
          nextGuest = {
            state: "unavailable",
            message:
              "Guest information is unavailable. Refresh details to try again.",
          };
        }
      } else
        nextGuest = {
          state: "unavailable",
          message:
            resource.kind === "lxc"
              ? "Container resources come from Proxmox configuration."
              : detail.capabilities?.guest_agent
                ? "Start the VM to read guest information."
                : "Enable and install the QEMU guest agent to report the operating system, IP addresses and filesystem usage.",
        };
      if (!alive() || current !== generation) return;
      guest = nextGuest;
      if (["overview", "network", "hardware"].includes(tab)) void renderTab();
    } catch (e) {
      if (!alive() || current !== generation) return;
      root.innerHTML = `<div class="infra-error" role="status">${esc((e as Error).message)}</div>${button("refresh", "Try again")}`;
      bind("[data-pve-refresh]", load);
    }
  }
  void load();
  return dispose;
}
