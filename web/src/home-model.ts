/** Relationships are projections of server evidence, never joins by name or IP. */
type Item = Record<string, any>;
export type Relationship = {
  machine: Item;
  network: Item | undefined;
  hosts: { key: string; name: string; connection: string; machineId?: string }[];
  resources: Item[];
  linked: boolean;
  conflict: boolean;
  stale: boolean;
  searchable: string;
};

export function relationships(machines: Item[], network: Item[] = []): Relationship[] {
  const byId = new Map(network.map(n => [n.id, n]));
  const hostIds = new Map<string, string>();
  for (const m of machines) for (const r of m.resources || []) {
    if (r.provider === "proxmox" && r.kind === "node") hostIds.set(JSON.stringify([r.connection_id, r.node || r.id]), m.id);
  }
  return machines.filter(m => !m.archived).map(machine => {
    const net = byId.get(machine.id);
    const resources: Item[] = machine.resources || [];
    const hosts = resources.filter(r => r.provider === "proxmox" && r.kind !== "node" && r.node).map(r => {
      const key = JSON.stringify([r.connection_id, r.node]);
      return { key, name: String(r.node), connection: String(r.connection_name || "Proxmox"), machineId: hostIds.get(key) };
    }).filter((h, i, all) => all.findIndex(other => other.key === h.key) === i);
    const conflict = Boolean(machine.identity_issues?.length);
    const linked = !conflict && Boolean((machine.has_endpoint_agent ?? true) && resources.length && machine.identity_evidence?.length);
    return {
      machine, network: net, hosts, resources, linked, conflict,
      stale: Boolean(machine.stale || resources.some(r => r.stale)),
      searchable: [machine.label, machine.hostname, machine.site, machine.client_name, machine.platform,
        ...(machine.aliases || []), ...(machine.tags || []), ...(machine.addresses || []),
        ...resources.flatMap(r => [r.name, r.node, r.connection_name, r.provider, ...(r.addresses || [])]),
        ...(net?.lan || []).map((n: Item) => n.ip), ...(net?.public || []).map((n: Item) => n.ip),
        ...(net?.dns || []).map((n: Item) => n.fqdn),
      ].filter(Boolean).join(" ").toLocaleLowerCase(),
    };
  }).sort((a, b) => Number(b.linked) - Number(a.linked) || a.machine.label.localeCompare(b.machine.label, undefined, { numeric: true }));
}

export function matchingRelationships(rows: Relationship[], query: string, filter = "all") {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter(r => words.every(word => r.searchable.includes(word)) && (
    filter === "all" || (filter === "linked" && r.linked) ||
    (filter === "missing" && r.machine.has_endpoint_agent === false) ||
    (filter === "review" && (r.conflict || r.stale))
  ));
}

export function networkEvidence(row: Relationship) {
  if (row.network?.lan?.some((n: Item) => n.source === "unifi_mac")) return "MAC matched";
  if (row.network?.public?.some((n: Item) => n.via === "unifi_nat")) return "NAT mapping";
  return "No UniFi link";
}
