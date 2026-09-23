type Item = Record<string, any>;
export const number = (value: unknown): number | null =>
  value !== null &&
  value !== undefined &&
  value !== "" &&
  Number.isFinite(Number(value))
    ? Number(value)
    : null;
export const list = (value: any): Item[] =>
  Array.isArray(value?.result)
    ? value.result
    : Array.isArray(value)
      ? value
      : [];
export const object = (value: any): Item =>
  value?.result && !Array.isArray(value.result) ? value.result : value || {};
export const percent = (value: unknown, total: unknown = 1) => {
  const n = number(value),
    t = number(total);
  return n === null || t === null || t <= 0
    ? null
    : Math.max(0, Math.min(100, (n / t) * 100));
};
export function properties(value: unknown): Item {
  if (typeof value !== "string") return {};
  return Object.fromEntries(
    value.split(",").map((part, i) => {
      const equals = part.indexOf("=");
      return equals < 0
        ? [i === 0 ? "value" : part, i === 0 ? part : "1"]
        : [part.slice(0, equals), part.slice(equals + 1)];
    }),
  );
}
export function disks(config: Item): Item[] {
  return Object.entries(config)
    .filter(([key]) =>
      /^(scsi|sata|virtio|ide|efidisk|tpmstate|mp)\d+$|^rootfs$/.test(key),
    )
    .map(([key, raw]) => {
      const props = properties(raw),
        volume = String(raw).split(",")[0];
      return {
        key,
        volume,
        size: props.size || "Not reported",
        media: props.media === "cdrom" ? "CD/DVD" : "Disk",
        storage: volume.split(":")[0],
      };
    });
}
export function adapters(config: Item): Item[] {
  return Object.entries(config)
    .filter(([key]) => /^net\d+$/.test(key))
    .map(([key, raw]) => {
      const props = properties(raw),
        model = Object.keys(props).find((k) =>
          /^[\da-f]{2}(:[\da-f]{2}){5}$/i.test(props[k]),
        );
      return {
        key,
        model: model || props.type || "Network",
        mac: props.hwaddr || (model ? props[model] : "—"),
        bridge: props.bridge || "—",
        vlan: props.tag || "Untagged",
        address: props.ip || "",
      };
    });
}
export function guestAddresses(network: any): string[] {
  return list(network)
    .flatMap((n) => n["ip-addresses"] || [])
    .map((n) => String(n["ip-address"] || ""))
    .filter(
      (a) =>
        a && a !== "::1" && !a.startsWith("127.") && !a.startsWith("fe80:"),
    );
}
export function duration(value: unknown): string {
  const n = number(value);
  if (n === null) return "Not reported";
  if (n < 60) return `${Math.floor(n)}s`;
  if (n < 3600) return `${Math.floor(n / 60)}m`;
  return `${Math.floor(n / 86400) ? Math.floor(n / 86400) + "d " : ""}${Math.floor(n / 3600) % 24}h ${Math.floor(n / 60) % 60}m`;
}
export function chartPoints(
  rows: Item[],
  key: string,
  scale = 1,
): (number | null)[] {
  return rows.map((r) => {
    const n = number(r[key]);
    return n === null ? null : n * scale;
  });
}
export function sparkline(values: (number | null)[], maximum?: number): string {
  const valid = values.filter(
    (n): n is number => n !== null && Number.isFinite(n),
  );
  if (valid.length < 2) return "";
  const max = Math.max(maximum || 0, ...valid, 1);
  let pen = false;
  return values
    .map((n, i) => {
      if (n === null || !Number.isFinite(n)) {
        pen = false;
        return "";
      }
      const p = `${pen ? "L" : "M"}${((i / Math.max(1, values.length - 1)) * 300).toFixed(1)},${(64 - (Math.max(0, n) / max) * 60).toFixed(1)}`;
      pen = true;
      return p;
    })
    .join(" ");
}
