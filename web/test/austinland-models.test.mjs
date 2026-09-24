import { test } from "node:test";
import assert from "node:assert/strict";
import { dotenv, groupEntries, parseDotenv, validSecretName } from "../src/vault-model.ts";
import { expiresWithin, fqdn, parseRecordValues, relative } from "../src/network-model.ts";
import { endpointGroups, snippets } from "../src/api-model.ts";

test(".env parsing accepts export, quotes and escapes, and reports invalid names", () => {
  const { values, invalid } = parseDotenv(`# comment\nexport A=1\nB="two words"\nC='single'\nD="line\\nbreak"\n9BAD=x\nnot a pair\n`);
  assert.deepEqual(values, { A: "1", B: "two words", C: "single", D: "line\nbreak" });
  assert.deepEqual(invalid, ["9BAD", "not a pair"]);
});

test(".env output round-trips through the parser", () => {
  const values = { URL: "postgres://u@h:5432/db", NOTE: 'has "quotes" and spaces', KEY: "-----BEGIN-----\nabc\n-----END-----" };
  const text = dotenv(values);
  assert.match(text, /^KEY="-----BEGIN-----\\nabc\\n-----END-----"$/m);
  assert.match(text, /^URL=postgres:\/\/u@h:5432\/db$/m);
  assert.deepEqual(parseDotenv(text).values, values);
});

test("vault entries group by project, then by known project prefix", () => {
  const groups = groupEntries([
    { name: "lucea-openai", project: "lucea", service: "openai", kind: "minted" },
    { name: "lucea-production", project: null, service: "custom", kind: "static" },
    { name: "lucea-world-db", project: null, service: "custom", kind: "static" },
    { name: "misc", project: null, service: "custom", kind: "static" },
    { name: "Alpha-anthropic", project: "Alpha", service: "anthropic", kind: "shared" },
  ]);
  assert.deepEqual(groups.map(([g, items]) => [g, items.map((e) => e.name)]), [
    ["Alpha", ["Alpha-anthropic"]],
    ["lucea", ["lucea-openai", "lucea-production", "lucea-world-db"]],
    ["Other credentials", ["misc"]],
  ]);
  assert.equal(validSecretName("OPENAI_API_KEY"), true);
  assert.equal(validSecretName("1BAD"), false);
});

test("network helpers describe times, values and names", () => {
  const now = 1_000_000;
  assert.equal(relative(null, now), "never");
  assert.equal(relative(now - 30, now), "just now");
  assert.equal(relative(now - 600, now), "10 min ago");
  assert.equal(relative(now - 7200, now), "2 h ago");
  assert.equal(relative(now + 3 * 86400, now), "in 3 days");
  assert.deepEqual(parseRecordValues(" 1.1.1.1 \n\n2.2.2.2\r\n"), ["1.1.1.1", "2.2.2.2"]);
  assert.equal(fqdn("example.com", "@"), "example.com");
  assert.equal(fqdn("example.com", "www"), "www.example.com");
  assert.equal(expiresWithin("2026-01-10T00:00:00Z", 30, Date.parse("2026-01-01T00:00:00Z")), true);
  assert.equal(expiresWithin("2026-06-10T00:00:00Z", 30, Date.parse("2026-01-01T00:00:00Z")), false);
  assert.equal(expiresWithin(undefined, 30), false);
});

test("API helpers build setup snippets and grouped endpoint lists", () => {
  const s = snippets("https://speck.example", "speck_pat_x");
  assert.equal(s.mcp, 'claude mcp add --transport http speck https://speck.example/mcp --header "Authorization: Bearer speck_pat_x"');
  assert.match(s.env, /SPECK_TOKEN=speck_pat_x/);
  const schema = { paths: {
    "/api/keys": { get: { summary: "List Entries" }, post: { summary: "x" } },
    "/api/keys/{name}": { get: { description: "Reveal\nmore" }, parameters: [] },
    "/api/dns/domains": { get: { summary: "List Domains" } },
    "/api/zeta": { get: { summary: "Z" } },
  } };
  const groups = endpointGroups(schema);
  assert.deepEqual(groups.map(([g]) => g), ["keys", "dns", "zeta"]);
  assert.deepEqual(groups[0][1].map((o) => o.method + " " + o.path + " " + o.summary), ["GET /api/keys List Entries", "POST /api/keys x", "GET /api/keys/{name} Reveal"]);
  assert.deepEqual(endpointGroups(schema, "domains").map(([g]) => g), ["dns"]);
});

test("audit event codes read as plain language", async () => {
  const { eventLabel } = await import("../src/activity-model.ts");
  assert.equal(eventLabel("session.login"), "Signed in");
  assert.equal(eventLabel("api_token.revoked"), "API token revoked");
  assert.equal(eventLabel("dns.scan.started"), "DNS scan started");
  assert.equal(eventLabel("infrastructure.submitted"), "Infrastructure submitted");
  assert.equal(eventLabel("account.created"), "Account created");
  assert.equal(eventLabel("vault.provider.saved"), "Vault provider saved");
});
