import {
  rememberResource,
  registerResource,
  resourceHref,
  type ResourceRef,
} from "./resource-navigation";
import { addressLink, entities, entityLink } from "./entity-links";
import {
  entityLabels,
  machineRef,
  machineAddresses,
  equipmentRef,
  portRef,
  lanClientRef,
  networkRef,
  sameNetwork,
  ipAddress,
  type Item,
  type EntityRef,
} from "./entity-model";
import {
  detailHero as hero,
  detailFacts as facts,
  detailSection as section,
  escapeDetail as e,
} from "./resource-story";
const note = (text: string) => `<p class="resource-note">${e(text)}</p>`;
const row = (
  ref: EntityRef | null,
  label: string,
  description: string,
  state = "",
) =>
  `<div class="entity-row"><span>${entityLink(ref, label)}<small>${e(description)}</small></span><small>${e(state)}</small></div>`;
const sitePath = (ref: ResourceRef) =>
  "/unifi/sites/" +
  encodeURIComponent(ref.connection || "") +
  "/" +
  encodeURIComponent(ref.site || "");
export const networkContext = (c: Item) =>
  `<div class="entity-context">${entityLink(networkRef(c), c.network_name || c.ssid || "Network not reported")}${entityLink(equipmentRef(c), c.uplink_name || (c.uplink_id ? "Network equipment" : "Uplink not reported"))}${c.port ? entityLink(portRef(c), "Port " + c.port) : ""}${c.site_id && c.console_id ? entityLink({ kind: "site", id: c.site_id, connection: c.console_id }, "Network site") : ""}</div>`;
export function createEntityInspectors(ui: Item) {
  function pane(
    ref: EntityRef,
    title: string,
    load: (root: HTMLElement, pane: HTMLDialogElement) => Promise<void>,
  ) {
    rememberResource(ref, () => pane(ref, title, load));
    const p = ui.flyout(title, note("Loading current relationships…"), {
      tone: ["client", "entity-lookup"].includes(ref.kind)
        ? "agents"
        : "network",
      subtitle: entityLabels[ref.kind],
    });
    const root = p.querySelector(".resource-body") as HTMLElement;
    void load(root, p).catch((err: Error) => {
      if (!p.open) return;
      root.innerHTML =
        note(err.message) +
        '<button class="secondary" data-entity-retry>Try again</button>';
      root.querySelector("button")!.onclick = () => pane(ref, title, load);
    });
  }
  function machineRows(machines: Item[]) {
    return machines
      .map((m) =>
        row(
          machineRef(m),
          m.label,
          [m.platform, m.location, ...machineAddresses(m)]
            .filter(Boolean)
            .join(" · "),
          m.stale
            ? "Stale inventory"
            : m.state || (m.online ? "Online" : "Offline"),
        ),
      )
      .join("");
  }
  function clientRows(clients: Item[]) {
    return clients
      .map(
        (c) =>
          `<div class="entity-row"><span>${entityLink(lanClientRef(c), c.name || c.mac)}<small>${addressLink(c.ip, c)} · ${e(c.mac)}</small>${networkContext(c)}</span><small>${e(c.state === "online" ? "Recently seen" : "Previously reported")}</small></div>`,
      )
      .join("");
  }
  function boundedList(
    root: HTMLElement,
    items: Item[],
    render: (rows: Item[]) => string,
    empty: string,
  ) {
    root.innerHTML =
      '<label class="entity-filter">Filter related entities<input type="search" placeholder="Name, address or location"></label><p data-entity-count role="status"></p><div class="entity-list" data-entity-list></div><button class="secondary" data-entity-more>Show more</button>';
    let limit = 50;
    const input = root.querySelector("input")!;
    const draw = () => {
      const terms = input.value
        .toLocaleLowerCase()
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      const visible = items.filter((m) =>
        terms.every((q) =>
          [m.label, m.name, m.location, m.ip, m.mac, ...machineAddresses(m)]
            .filter(Boolean)
            .join(" ")
            .toLocaleLowerCase()
            .includes(q),
        ),
      );
      root.querySelector("[data-entity-list]")!.innerHTML = visible.length
        ? render(visible.slice(0, limit))
        : note(empty);
      root.querySelector("[data-entity-count]")!.textContent =
        `${Math.min(limit, visible.length)} of ${visible.length} related entities`;
      (root.querySelector("[data-entity-more]") as HTMLElement).hidden =
        visible.length <= limit;
    };
    input.oninput = () => {
      limit = 50;
      draw();
    };
    root.querySelector<HTMLButtonElement>("[data-entity-more]")!.onclick =
      () => {
        limit += 50;
        draw();
      };
    draw();
  }
  registerResource("client", (ref) =>
    pane(ref as EntityRef, "Client", async (root, p) => {
      const result = await ui.api("/fleet?compact=true");
      if (!p.open) return;
      const machines = (result.machines || []).filter((m: Item) =>
        (m.clients || []).some((c: Item) => c.key === ref.id),
      );
      const client = machines
        .flatMap((m: Item) => m.clients || [])
        .find((c: Item) => c.key === ref.id);
      p.querySelector(".dialog-head h2")!.firstChild!.textContent =
        client?.name || "Client no longer reported";
      const providers = [
        ...new Map<string, Item>(
          machines.flatMap((m: Item) =>
            (m.resources || [])
              .filter((r: Item) => r.client?.key === ref.id)
              .map((r: Item) => [r.connection_id, r]),
          ),
        ).values(),
      ];
      root.innerHTML =
        hero(
          "Customer · Client membership",
          null,
          "Machines explicitly assigned to this client by a connected provider. Customer membership and LAN observations are separate concepts.",
          [
            ["Machines", machines.length],
            [
              "Membership conflicts",
              machines.filter((m: Item) => m.client_conflict).length,
            ],
          ],
        ) +
        section(
          "Provider connections",
          providers
            .map((r) =>
              row(
                { kind: "connection", id: r.connection_id },
                r.connection_name || r.provider,
                r.provider,
              ),
            )
            .join("") || note("No current provider membership."),
        ) +
        section("Machines", "<div data-entity-members></div>");
      boundedList(
        root.querySelector("[data-entity-members]")!,
        machines,
        machineRows,
        "No machines report this client membership.",
      );
    }),
  );
  registerResource("network", (ref) =>
    pane(ref as EntityRef, ref.id, async (root, p) => {
      if (!ref.connection || !ref.site)
        throw new Error("A network link needs its console and site.");
      const data = await ui.api(sitePath(ref) + "/clients");
      if (!p.open) return;
      const clients = (data.clients || data).filter((c: Item) =>
        sameNetwork(c, ref),
      );
      root.innerHTML =
        hero(
          "Network · Observed membership",
          null,
          "Clients reporting this network in this exact console and site. This is observed membership, not a complete inventory of configured subnets or VLANs.",
          [
            ["Observed clients", clients.length],
            ["VLAN", ref.resourceKind ?? "Not reported"],
          ],
        ) +
        `<div class="entity-context">${entityLink({ kind: "site", id: ref.site, connection: ref.connection }, "Open network site")}</div>` +
        (data.truncated
          ? note(
              "The provider limited this client inventory. Counts describe the returned observations.",
            )
          : "") +
        section("LAN clients", "<div data-entity-members></div>");
      boundedList(
        root.querySelector("[data-entity-members]")!,
        clients,
        clientRows,
        "No current observations for this network and VLAN.",
      );
    }),
  );
  registerResource("ip", (ref) =>
    pane(ref as EntityRef, ref.id, async (root, p) => {
      const ip = ipAddress(ref.id);
      if (!ip)
        throw new Error("This address is not a valid IPv4 or IPv6 address.");
      if (!!ref.connection !== !!ref.site)
        throw new Error("An address scope needs both its console and site.");
      const canNetwork = ui.role() !== "viewer";
      const sources = await Promise.allSettled([
        ui.api("/fleet?compact=true"),
        canNetwork ? ui.api("/network/map") : Promise.resolve(null),
        canNetwork
          ? ui.api(ref.site ? sitePath(ref) + "/clients" : "/unifi/clients")
          : Promise.resolve(null),
      ]);
      if (!p.open) return;
      const value = (i: number) =>
        sources[i].status === "fulfilled"
          ? (sources[i] as PromiseFulfilledResult<any>).value
          : null;
      const fleet = value(0)?.machines || [],
        map = value(1),
        observed = value(2),
        clients = (observed?.clients || observed || []).filter(
          (c: Item) =>
            ipAddress(c.ip) === ip &&
            (!ref.site ||
              (c.console_id === ref.connection && c.site_id === ref.site)),
        );
      const reports = new Map<string, Item>();
      for (const m of [...fleet, ...(map?.machines || [])]) {
        const reportsIP = machineAddresses(m).includes(ip);
        const scoped =
          !ref.site ||
          (m.network_clients || []).some(
            (c: Item) =>
              c.console_id === ref.connection &&
              c.site_id === ref.site &&
              ipAddress(c.ip) === ip,
          );
        if (reportsIP && scoped)
          reports.set(m.id, { ...reports.get(m.id), ...m });
      }
      const info = !ref.site ? map?.ips?.[ip] : null;
      root.innerHTML =
        hero(
          "Network · IP address",
          null,
          ref.site
            ? "Address observations within this console and site. An IP address does not establish machine identity."
            : "Reporting resources from loaded inventory. Private addresses may repeat across networks; no ownership is inferred.",
          [
            ["Machines reporting", reports.size],
            ["LAN observations", clients.length],
          ],
        ) +
        (sources.some((s) => s.status === "rejected")
          ? note(
              "Some relationship sources are unavailable. The available evidence is shown; missing results do not establish that an address is unused.",
            )
          : "") +
        (ref.site
          ? `<div class="entity-context">${entityLink({ kind: "site", id: ref.site, connection: ref.connection }, "Open network site")}</div>`
          : "") +
        section(
          "Address context",
          facts([
            ["Address", ip],
            [
              "Scope",
              ref.site
                ? "Console " + ref.connection + " · Site " + ref.site
                : "All reporting machines; LAN observations from the managed gateway",
            ],
            [
              "DNS names",
              info?.dns?.length ? info.dns : "No loaded DNS evidence",
            ],
          ]),
        ) +
        (info?.mapping
          ? section(
              "Gateway mapping",
              `<p>${addressLink(info.mapping.public_ip || ip)} → ${addressLink(info.mapping.lan_ip)}</p>`,
            )
          : "") +
        section("Reporting machines", "<div data-entity-machines></div>") +
        section("LAN clients", "<div data-entity-clients></div>");
      boundedList(
        root.querySelector("[data-entity-machines]")!,
        [...reports.values()],
        machineRows,
        "No machine in the available scoped evidence reports this address.",
      );
      boundedList(
        root.querySelector("[data-entity-clients]")!,
        clients,
        clientRows,
        canNetwork
          ? "No matching LAN observations in the loaded scope."
          : "LAN observations require network access.",
      );
    }),
  );
  registerResource("entity-lookup", (ref) =>
    pane(ref as EntityRef, ref.id, async (root, p) => {
      await ui.api("/fleet?compact=true");
      if (!p.open) return;
      const matches = entities.matches(ref.id);
      root.innerHTML =
        hero(
          "Matching entities",
          null,
          "This name appears on multiple resources. Choose the exact system and source to inspect.",
        ) +
        matches
          .map((m) =>
            row(m.ref, m.label, m.description, entityLabels[m.ref.kind]),
          )
          .join("") +
        (!matches.length
          ? note("No matching entities remain in the loaded inventory.")
          : "");
    }),
  );
  registerResource("port", (ref) => {
    if (
      !ref.connection ||
      !ref.site ||
      !/^\d+$/.test(ref.resourceKind || "") ||
      Number(ref.resourceKind) < 1
    )
      throw new Error(
        "A port link needs its equipment, console, site and port number.",
      );
    history.replaceState(
      history.state,
      "",
      resourceHref(location.hash.slice(1), {
        ...ref,
        kind: "equipment",
        tab: "ports:" + ref.resourceKind,
        resourceKind: undefined,
      }),
    );
    return ui.openEquipment(
      { console_id: ref.connection, site_id: ref.site },
      ref.id,
      Number(ref.resourceKind),
    );
  });
}
