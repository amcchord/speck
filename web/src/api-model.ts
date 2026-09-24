// Pure helpers for the API page, kept free of DOM and CSS for unit tests.
type Operation = { method: string; path: string; summary: string };

export function snippets(origin: string, token: string) {
  return {
    env: `export SPECK_URL=${origin}\nexport SPECK_TOKEN=${token}`,
    mcp: `claude mcp add --transport http speck ${origin}/mcp --header "Authorization: Bearer ${token}"`,
    curl: `curl -s -H "Authorization: Bearer ${token}" ${origin}/api/whoami`,
    dropin: `curl -s ${origin}/speck.md > SPECK.md`,
  };
}

/** OpenAPI paths grouped by their first segment after /api, filtered by a free-text query. */
export function endpointGroups(schema: { paths?: Record<string, Record<string, { summary?: string; description?: string }>> }, query = "") {
  const needle = query.trim().toLowerCase();
  const groups = new Map<string, Operation[]>();
  for (const [path, methods] of Object.entries(schema.paths || {})) {
    for (const [method, spec] of Object.entries(methods)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
      const summary = (spec.summary || spec.description || "").split("\n")[0];
      const op = { method: method.toUpperCase(), path, summary };
      if (needle && !`${op.method} ${path} ${summary}`.toLowerCase().includes(needle)) continue;
      const group = path.replace(/^\/api\/?/, "").split("/")[0] || "root";
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push(op);
    }
  }
  const order = ["overview", "search", "whoami", "keys", "dns", "unifi", "network", "ssh", "context", "fleet", "devices", "jobs", "infrastructure"];
  return [...groups.entries()]
    .map(([g, ops]) => [g, ops.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))] as [string, Operation[]])
    .sort(([a], [b]) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) || a.localeCompare(b));
}
