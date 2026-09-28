import {
  escapeDetail as e,
  detailFacts as facts,
  detailDate,
  detailSection as section,
  capacity,
} from "./resource-story";
import { performanceCards, bindPerformance } from "./performance";
type Item = Record<string, any>;
export function portHistory(samples: Item[], port: number) {
  const rows = samples.map((s) => ({
    at: s.at,
    p: s.ports.find((p: Item) => p.port === port),
  }));
  const rate = (key: string) =>
    rows.map((r, i) => {
      const before = rows[i - 1],
        dt = before ? r.at - before.at : 0,
        a = r.p?.[key],
        b = before?.p?.[key];
      return [
        r.at,
        dt > 0 && dt <= 900 && a != null && b != null && a >= b
          ? (a - b) / dt
          : null,
      ];
    });
  return [
    {
      label: "Received · observed rate",
      unit: "bytes/s",
      points: rate("rx_bytes"),
    },
    {
      label: "Transmitted · observed rate",
      unit: "bytes/s",
      points: rate("tx_bytes"),
    },
    {
      label: "PoE power",
      unit: "W",
      points: rows.map((r) => [r.at, r.p?.poe_power ?? null]),
    },
    {
      label: "Negotiated link speed",
      unit: "Mbps",
      points: rows.map((r) => [r.at, r.p?.speed_mbps ?? null]),
    },
  ];
}
export function mountEquipmentHistory(
  ui: Item,
  endpoint: string,
  root: HTMLElement,
  initialPort?: number,
) {
  let hours = 24,
    port = initialPort,
    generation = 0;
  const load = async () => {
    const current = ++generation;
    root.innerHTML =
      '<p class="resource-note">Reading retained observations…</p>';
    try {
      const data = await ui.freshApi(endpoint + "/history?hours=" + hours);
      if (!root.isConnected || current !== generation) return;
      const samples: Item[] = data.samples || [],
        latest = samples.at(-1),
        ports: Item[] = latest?.ports || [];
      if (!ports.some((p) => p.port === port)) port = ports[0]?.port;
      const power = ports.filter((p) => p.poe_power != null),
        watts = power.reduce((v, p) => v + p.poe_power, 0);
      const changes: Item[] = [];
      for (let i = 1; i < samples.length; i++)
        for (const p of samples[i].ports) {
          const before = samples[i - 1].ports.find(
            (x: Item) => x.port === p.port,
          );
          if (
            before &&
            (before.state !== p.state || before.speed_mbps !== p.speed_mbps)
          )
            changes.push({
              at: samples[i].at,
              port: p.port,
              before,
              after: p,
              gap: samples[i].at - samples[i - 1].at > 900,
            });
        }
      const series:Item[] = port == null ? [] : portHistory(samples, port);
      series.slice(0,2).forEach((s:Item)=>s.emptyReason = samples.length < 2 ? 'Awaiting a second counter observation. Rates need two samples within 15 minutes.' : 'No comparable counters in this interval: a collection gap, counter reset, or missing measurement prevents a rate.');
      root.innerHTML =
        facts([
          ["Last observation", detailDate(latest?.at)],
          ["Retained samples", samples.length + " in " + hours + " hours"],
          [
            "Observed PoE total",
            power.length
              ? watts.toFixed(1) +
                " W across " +
                power.length +
                " reported ports"
              : null,
          ],
          [
            "Reported power budget",
            latest?.power_budget != null ? latest.power_budget + " W" : null,
          ],
          [
            "Continuous collection",
            data.collection.enabled
              ? "Every five minutes"
              : "Paused · observations saved when viewed",
          ],
        ]) +
        `<div class="toolbar"><label>Time range<select data-hours>${[1, 24, 168].map((n) => `<option value="${n}" ${n === hours ? "selected" : ""}>${n === 168 ? "7 days" : n + " hours"}</option>`).join("")}</select></label><label>Physical port<select data-history-port>${ports.map((p) => `<option value="${p.port}" ${p.port === port ? "selected" : ""}>Port ${p.port}</option>`).join("")}</select></label>${ui.role() === "admin" ? `<button class="secondary" data-collection>${data.collection.enabled ? "Pause" : "Enable"} continuous collection</button>` : ""}</div>` +
        (data.collection.last_error
          ? '<p class="resource-notice">' +
            e(data.collection.last_error) +
            "</p>"
          : "") +
        `<div class="performance-grid">${performanceCards(series)}</div>` +
        (!samples.length
          ? '<p class="resource-note">No observations in this interval. Refresh equipment to save a current observation, or enable five-minute collection.</p>'
          : "") +
        section(
          "Switch-wide counters",
          `<p class="resource-note">Cumulative counters since the device last reset them; these are not current traffic rates.</p><div class="table-wrap"><table><thead><tr><th>Port</th><th>Received</th><th>Sent</th><th>Errors RX / TX</th><th>Power</th></tr></thead><tbody>${[
            ...ports,
          ]
            .sort(
              (a, b) =>
                (b.rx_bytes || 0) +
                (b.tx_bytes || 0) -
                (a.rx_bytes || 0) -
                (a.tx_bytes || 0),
            )
            .map(
              (p) =>
                `<tr><td><button class="text-link" data-history-pick="${p.port}">Port ${p.port}</button></td><td>${e(capacity(p.rx_bytes))}</td><td>${e(capacity(p.tx_bytes))}</td><td>${e(p.rx_errors ?? "—")} / ${e(p.tx_errors ?? "—")}</td><td>${p.poe_power ?? "—"} W</td></tr>`,
            )
            .join("")}</tbody></table></div>`,
        ) +
        section(
          "Observed link changes",
          changes
            .slice(-100)
            .reverse()
            .map(
              (c) =>
                `<p><b>Port ${c.port}</b> · ${e(detailDate(c.at))}<br>${e(c.before.state)} / ${e(c.before.speed_mbps ?? "unknown")} Mbps → ${e(c.after.state)} / ${e(c.after.speed_mbps ?? "unknown")} Mbps${c.gap ? " · collection gap" : ""}</p>`,
            )
            .join("") ||
            '<p class="resource-note">No transitions in the retained observations. Events between samples are not observable.</p>',
        ) +
        `<p class="resource-note">${e(data.note)} Seven-day retention, at most 50,000 observations across the workspace. Rates require two readings at most 15 minutes apart; resets produce gaps.</p>`;
      bindPerformance(root, series);
      root.querySelector<HTMLSelectElement>("[data-hours]")!.onchange = (
        ev,
      ) => {
        hours = Number((ev.target as HTMLSelectElement).value);
        void load();
      };
      root.querySelector<HTMLSelectElement>("[data-history-port]")!.onchange = (
        ev,
      ) => {
        port = Number((ev.target as HTMLSelectElement).value);
        void load();
      };
      root.querySelectorAll<HTMLElement>("[data-history-pick]").forEach(
        (b) =>
          (b.onclick = () => {
            port = Number(b.dataset.historyPick);
            void load();
          }),
      );
      root.querySelector("[data-collection]")?.addEventListener("click", () => {
        const enabled = !data.collection.enabled;
        const pane = ui.dialog(
          enabled ? "Enable equipment history" : "Pause equipment history",
          `<p>${enabled ? "Read this equipment every five minutes and retain numerical observations for seven days. Limited to 20 devices across the workspace." : "Stop background reads for this equipment. Retained observations expire after seven days."}</p><button class="primary" data-confirm-history>Confirm</button>`,
        );
        pane.querySelector("[data-confirm-history]").onclick = async () => {
          try {
            await ui.api(endpoint + "/history", "PUT", { enabled });
            pane.close();
            void load();
          } catch (error) {
            ui.notify((error as Error).message, true);
          }
        };
      });
    } catch (error) {
      if (root.isConnected && generation === current)
        root.innerHTML =
          '<p class="resource-notice">History unavailable. ' +
          e((error as Error).message) +
          "</p>";
    }
  };
  void load();
}
