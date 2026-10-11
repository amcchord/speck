/** Public inventory metadata only. Provider IDs are always scoped. */
import type { ResourceRef } from "./resource-navigation";
export type Item = Record<string, any>;
export type EntityKind =
  | "machine"
  | "infrastructure"
  | "equipment"
  | "port"
  | "client"
  | "lan-client"
  | "network"
  | "ip"
  | "site"
  | "connection"
  | "entity-lookup";
export type EntityRef = ResourceRef & { kind: EntityKind };
export type Entity = {
  ref: EntityRef;
  label: string;
  description: string;
  aliases?: string[];
};
export const entityLabels: Record<EntityKind, string> = {
  machine: "Machine",
  infrastructure: "Hypervisor / resource",
  equipment: "Equipment",
  port: "Port",
  client: "Client",
  "lan-client": "LAN client",
  network: "Network",
  ip: "IP address",
  site: "Site",
  connection: "Provider connection",
  "entity-lookup": "Matching entities",
};
export const entityKey = (ref: ResourceRef) =>
  JSON.stringify([
    ref.kind,
    ref.id,
    ref.connection || "",
    ref.site || "",
    ref.provider || "",
    ref.resourceKind || "",
  ]);
export const machineRef = (m: Item): EntityRef => ({
  kind: "machine",
  id: String(m.id),
});
export const providerRef = (r: Item): EntityRef => ({
  kind: "infrastructure",
  id: String(r.id),
  connection: r.connection_id,
  provider: r.provider,
  resourceKind: r.kind,
});
export const equipmentRef = (c: Item): EntityRef | null =>
  c.console_id && c.site_id && c.uplink_id
    ? {
        kind: "equipment",
        id: c.uplink_id,
        connection: c.console_id,
        site: c.site_id,
      }
    : null;
export const portRef = (c: Item): EntityRef | null => {
  const ref = equipmentRef(c),
    port = Number(c.port);
  return ref && Number.isSafeInteger(port) && port > 0
    ? { ...ref, kind: "port", resourceKind: String(port) }
    : null;
};
export const lanClientRef = (c: Item): EntityRef | null =>
  c.console_id && c.site_id && c.mac
    ? {
        kind: "lan-client",
        id: c.mac.toLowerCase(),
        connection: c.console_id,
        site: c.site_id,
      }
    : null;
export const networkRef = (c: Item): EntityRef | null =>
  c.console_id && c.site_id && (c.network_name || c.ssid)
    ? {
        kind: "network",
        id: c.network_name || c.ssid,
        connection: c.console_id,
        site: c.site_id,
        resourceKind: c.vlan == null ? undefined : String(c.vlan),
      }
    : null;
export function ipAddress(value: unknown): string | null {
  const text = String(value ?? "")
    .trim()
    .split("/")[0];
  if (
    /^(\d{1,3}\.){3}\d{1,3}$/.test(text) &&
    text.split(".").every((v) => Number(v) <= 255)
  )
    return text;
  if (!text.includes(":") || !/^[\da-f:.]+$/i.test(text)) return null;
  try {
    return new URL("http://[" + text + "]/").hostname.slice(1, -1);
  } catch {
    return null;
  }
}
export function ipRef(value: unknown, scope?: Item): EntityRef | null {
  const id = ipAddress(value);
  return id
    ? {
        kind: "ip",
        id,
        ...(scope?.console_id && scope?.site_id
          ? { connection: scope.console_id, site: scope.site_id }
          : {}),
      }
    : null;
}
export function sameNetwork(c: Item, ref: ResourceRef) {
  return (
    c.console_id === ref.connection &&
    c.site_id === ref.site &&
    (c.network_name || c.ssid) === ref.id &&
    (c.vlan == null ? undefined : String(c.vlan)) === ref.resourceKind
  );
}
export function resourceMachine(r: Item, machines: Item[]) {
  const matches = machines.filter((m) =>
    (m.resources || []).some(
      (v: Item) =>
        v.connection_id === r.connection_id &&
        v.provider === r.provider &&
        v.kind === r.kind &&
        String(v.id) === String(r.id),
    ),
  );
  return matches.length === 1 ? matches[0] : undefined;
}
export function hostRef(r: Item, machines: Item[]): EntityRef | null {
  if (r.provider !== "proxmox" || !r.connection_id || !r.node) return null;
  const host = {
    provider: "proxmox",
    connection_id: r.connection_id,
    kind: "node",
    id: r.node,
  };
  const m = resourceMachine(host, machines);
  return m ? machineRef(m) : providerRef(host);
}
export function machineAddresses(m: Item): string[] {
  return [
    ...new Set(
      [
        ...(m.addresses || []),
        ...(m.resources || []).flatMap((r: Item) => r.addresses || []),
        ...(m.telemetry?.network?.interfaces || []).flatMap((i: Item) =>
          (i.addrs || []).map((a: Item) => a.address),
        ),
        ...(m.lan || []).map((a: Item) => a.ip),
        ...(m.public || []).map((a: Item) => a.ip),
      ]
        .map(ipAddress)
        .filter((v): v is string => !!v),
    ),
  ];
}
export class EntityCatalog {
  private groups = new Map<string, Entity[]>();
  private names = new Map<string, Entity[]>();
  machines: Item[] = [];
  clear() {
    this.groups.clear();
    this.names.clear();
    this.machines = [];
  }
  replace(group: string, entities: Entity[]) {
    this.groups.delete(group);
    this.groups.set(group, entities);
    if (this.groups.size > 100)
      this.groups.delete(this.groups.keys().next().value!);
    this.names.clear();
    for (const rows of this.groups.values())
      for (const row of rows)
        for (const name of [row.label, ...(row.aliases || [])]) {
          if (!name || name.length < 3) continue;
          const key = name.trim().toLocaleLowerCase(),
            matches = this.names.get(key) || [];
          if (!matches.some((v) => entityKey(v.ref) === entityKey(row.ref)))
            matches.push(row);
          this.names.set(key, matches);
        }
  }
  matches(name: string): Entity[] {
    const rows = this.names.get(name.trim().toLocaleLowerCase()) || [];
    // Provider resource names which are already represented in Fleet open that machine.
    const normalized = rows.map((row) => {
      if (row.ref.kind !== "infrastructure") return row;
      const m = resourceMachine(
        {
          id: row.ref.id,
          connection_id: row.ref.connection,
          provider: row.ref.provider,
          kind: row.ref.resourceKind,
        },
        this.machines,
      );
      return m ? { ...row, ref: machineRef(m), label: m.label } : row;
    });
    return [
      ...new Map(normalized.map((row) => [entityKey(row.ref), row])).values(),
    ];
  }
  ingest(path: string, data: any) {
    const base = path.split("?")[0];
    if (base === "/fleet") {
      this.machines = data.machines || [];
      const rows: Entity[] = [];
      for (const m of this.machines) {
        rows.push({
          ref: machineRef(m),
          label: m.label,
          aliases: [m.hostname, ...(m.aliases || [])],
          description: [m.location, m.platform, m.id]
            .filter(Boolean)
            .join(" · "),
        });
        for (const c of m.clients || [])
          if (c.key)
            rows.push({
              ref: { kind: "client", id: c.key },
              label: c.name,
              description: "Customer membership",
            });
      }
      this.replace("fleet", rows);
    } else if (base === "/devices" || base === "/network/map") {
      this.replace(
        base,
        (Array.isArray(data) ? data : data.machines || []).map((m: Item) => ({
          ref: machineRef(m),
          label: m.label,
          aliases: [m.hostname],
          description: [m.platform, m.location, m.id]
            .filter(Boolean)
            .join(" · "),
        })),
      );
    } else if (base === "/infrastructure/inventory") {
      this.replace(
        base,
        (data.connections || []).flatMap((c: Item) => [
          {
            ref: { kind: "connection", id: c.id },
            label: c.name,
            description: c.provider,
          },
          ...(c.resources || []).map((r: Item) => ({
            ref: providerRef(r),
            label: r.name,
            description: [c.name, r.node, r.kind].filter(Boolean).join(" · "),
          })),
        ]),
      );
    } else if (base === "/unifi/sites") {
      this.replace(
        base,
        (data.sites || []).map((s: Item) => ({
          ref: { kind: "site", id: String(s.id), connection: s.console_id },
          label: s.name,
          description: "Network site",
        })),
      );
    } else if (
      base === "/unifi/equipment/index" ||
      /^\/unifi\/sites\/[^/]+\/[^/]+\/devices$/.test(base)
    ) {
      const parts = base.split("/");
      this.replace(
        base,
        (Array.isArray(data) ? data : data.devices || []).map((d: Item) => ({
          ref: {
            kind: "equipment",
            id: d.id,
            connection: d.console_id || decodeURIComponent(parts[3]),
            site: d.site_id || decodeURIComponent(parts[4]),
          },
          label: d.name,
          description: d.model || "Network equipment",
        })),
      );
    }
  }
}
