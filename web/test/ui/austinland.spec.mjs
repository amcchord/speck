import { test, expect } from '@playwright/test';
import fs from 'node:fs';

// Synthetic data only. Addresses use documentation-style values that never reach a real network.
const now = Date.now() / 1000;
const domains = [
  { domain: 'example-shop.com', status: 'ACTIVE', expires: '2027-02-01T00:00:00Z', renewAuto: true, locked: true, privacy: true, apex: ['5.5.5.10'], record_count: 6, zone_cached_at: now - 3600 },
  { domain: 'example-labs.dev', status: 'ACTIVE', expires: new Date(Date.now() + 20 * 86400e3).toISOString(), renewAuto: false, locked: false, privacy: true, apex: ['Parked'], record_count: 4, zone_cached_at: now - 86400 * 3 },
  { domain: 'example-notes.io', status: 'ACTIVE', expires: '2028-05-01T00:00:00Z', renewAuto: true, locked: true, privacy: false, apex: [], record_count: null, zone_cached_at: null },
];
const records = [
  { type: 'A', name: '@', data: '5.5.5.10', ttl: 600 },
  { type: 'A', name: 'www', data: '5.5.5.10', ttl: 600 },
  { type: 'CNAME', name: 'docs', data: 'example-shop.com', ttl: 3600 },
  { type: 'MX', name: '@', data: 'mail.example-shop.com', ttl: 3600, priority: 10 },
  { type: 'TXT', name: '@', data: 'v=spf1 include:_spf.example.net -all', ttl: 3600 },
  { type: 'NS', name: '@', data: 'ns1.domaincontrol.com', ttl: 3600 },
];
const pool = { gateway_name: 'Main office', console_id: 'console-1', pool: [
  { ip: '5.5.5.1', status: 'gateway', assigned_to: 'Gateway primary WAN address', lan_ip: null },
  { ip: '5.5.5.10', status: 'assigned', assigned_to: 'shop-web', lan_ip: '192.168.10.20' },
  { ip: '5.5.5.11', status: 'in_use', assigned_to: 'Jump host', lan_ip: null },
  { ip: '5.5.5.12', status: 'free', assigned_to: null, lan_ip: null },
  { ip: '5.5.5.13', status: 'free', assigned_to: null, lan_ip: null },
] };
const networkMap = {
  machines: [
    { id: 'proxmox:c1:qemu:101', label: 'shop-web', provider: 'proxmox', kind: 'qemu', state: 'running', lan: [{ ip: '192.168.10.20', source: 'unifi_mac' }], public: [{ ip: '5.5.5.10', via: 'unifi_nat', mapping: 'shop-web', lan_ip: '192.168.10.20' }], dns: [{ fqdn: 'example-shop.com', domain: 'example-shop.com', name: '@' }, { fqdn: 'www.example-shop.com', domain: 'example-shop.com', name: 'www' }] },
    { id: 'proxmox:c1:qemu:102', label: 'build-runner', provider: 'proxmox', kind: 'qemu', state: 'running', lan: [{ ip: '192.168.10.21', source: 'unifi_mac' }], public: [], dns: [] },
  ],
  ips: { '5.5.5.10': { machines: [{ id: 'proxmox:c1:qemu:101', label: 'shop-web' }], dns: ['example-shop.com', 'www.example-shop.com'], mapping: { lan_ip: '192.168.10.20' } }, '192.168.10.20': { machines: [{ id: 'proxmox:c1:qemu:101', label: 'shop-web' }], dns: [] }, '192.168.10.21': { machines: [{ id: 'proxmox:c1:qemu:102', label: 'build-runner' }], dns: [] } },
  clients_checked: true, client_error: null, zones_cached: 2, checked_at: now,
};
const entries = [
  { name: 'shop-openai', service: 'openai', kind: 'minted', project: 'shop', notes: 'OpenAI project speck-shop', meta: { project_id: 'proj_demo', service_account_id: 'svc_demo' }, created: now - 86400 * 9, updated: now - 86400 * 9, created_by: 'demo', origin: 'austinland', revealed: null, reveals: 0, secret_names: ['OPENAI_API_KEY'], hints: { OPENAI_API_KEY: 'sk-s…demo' } },
  { name: 'shop-database', service: 'postgres', kind: 'static', project: null, notes: 'Primary database', meta: {}, created: now - 86400 * 2, updated: now - 3600, created_by: 'demo', origin: 'speck', revealed: now - 600, reveals: 3, secret_names: ['DATABASE_URL', 'PGPASSWORD'], hints: { DATABASE_URL: 'post…/app', PGPASSWORD: '•••• (12 chars)' } },
  { name: 'labs-anthropic', service: 'anthropic', kind: 'shared', project: 'labs', notes: '', meta: {}, created: now - 86400, updated: now - 86400, created_by: 'demo', origin: 'speck', revealed: null, reveals: 0, secret_names: ['ANTHROPIC_API_KEY'], hints: { ANTHROPIC_API_KEY: 'sk-a…demo' } },
];
const services = [
  { service: 'openai', label: 'OpenAI', mode: 'mint', description: 'Mints a dedicated OpenAI project and service-account key per project.', secret_fields: ['OPENAI_ADMIN_KEY'], setting_fields: [], configured: true, hints: { OPENAI_ADMIN_KEY: 'sk-a…demo' }, settings: {}, updated: now - 86400, updated_by: 'demo', arbiter: true, last_check: { ok: true, detail: '4 projects visible to the admin key', checked_at: now - 120, latency_ms: 210 } },
  { service: 'anthropic', label: 'Anthropic', mode: 'shared', description: 'Hands out the shared Anthropic API key.', secret_fields: ['ANTHROPIC_API_KEY'], setting_fields: [], configured: true, hints: { ANTHROPIC_API_KEY: 'sk-a…demo' }, settings: {}, arbiter: true },
  { service: 'twilio', label: 'Twilio', mode: 'mint', description: 'Mints a named Twilio API key per project.', secret_fields: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'], setting_fields: [], configured: false, hints: {}, settings: {}, arbiter: true },
  { service: 'godaddy', label: 'GoDaddy DNS', mode: 'provider', description: 'Manages domains and DNS records.', secret_fields: ['GODADDY_API_KEY', 'GODADDY_API_SECRET'], setting_fields: [], configured: true, hints: { GODADDY_API_KEY: 'dL3Y…demo', GODADDY_API_SECRET: '5oSJ…demo' }, settings: {}, arbiter: false },
  { service: 'unifi', label: 'UniFi Site Manager', mode: 'provider', description: 'Reaches the gateway through the cloud connector.', secret_fields: ['UNIFI_API_KEY'], setting_fields: ['UNIFI_GATEWAY'], configured: true, hints: { UNIFI_API_KEY: 'etaZ…demo' }, settings: { UNIFI_GATEWAY: '192.168.10.1' }, arbiter: false },
];
const sshKeys = [
  { name: 'shop-deploy', type: 'ssh-ed25519', public_key: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDemoDemoDemoDemoDemoDemoDemoDemoDemoDemoDemo shop-deploy', comment: 'shop deploy', fingerprint: 'SHA256:demoFingerprintValue0000000000000000000000', has_private: true, purpose: 'CI deploys', created: now, created_by: 'demo', origin: 'speck', registered_as: null },
  { name: 'workstation', type: 'ssh-ed25519', public_key: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIWorkWorkWorkWorkWorkWorkWorkWorkWorkWorkWork demo@laptop', comment: 'demo@laptop', fingerprint: 'SHA256:workstationFingerprint000000000000000000000', has_private: false, purpose: 'Workstation public key', created: now, created_by: 'demo', origin: 'austinland', registered_as: 'workstation' },
];
const handoffs = [{ filename: 'LLMContextAccess-shop-web-example-shop.com.md', machine: 'shop-web', domain: 'example-shop.com', size: 6144, created: now - 86400 * 20, created_by: 'demo', origin: 'austinland' }];
const markdown = '# shop-web handoff\n\nSSH: root@5.5.5.10\n\n```\n-----BEGIN OPENSSH PRIVATE KEY-----\nsynthetic-private-key-material\n-----END OPENSSH PRIVATE KEY-----\n```\n';

async function setup(page) {
  await page.context().addCookies([{ name: 'speck-gallery', value: '1', url: 'http://127.0.0.1:8761' }]);
  const writes = [];
  let tokenList = [{ id: 't1', name: 'Claude Code', scopes: ['read', 'keys:read'], key_prefixes: ['shop'], owner: 'demo', created: now - 86400, expires: now + 86400 * 60, revoked: null, last_used: now - 300, last_ip: '203.0.113.9', uses: 42, active: true }];
  await page.route(/\/api\/(dns|unifi|network|keys|ssh|context|tokens)(\/|\?|$)/, async (route) => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname, method = req.method();
    if (method !== 'GET') writes.push({ method, path: path + url.search, body: req.postDataJSON?.() ?? null });
    const json = (data, status = 200) => route.fulfill({ status, json: data });
    if (path === '/api/dns/status') return json({ configured: true, domains: 3, zones_cached: 2, oldest_zone_at: now - 86400 * 3, domains_fetched_at: now - 7200, scan: { running: false } });
    if (path === '/api/dns/domains') return json({ fetched_at: now - 7200, domains });
    if (path === '/api/dns/search') return json({ results: url.searchParams.get('q').includes('mail') ? [{ domain: 'example-shop.com', fqdn: 'example-shop.com', type: 'MX', data: 'mail.example-shop.com' }] : [], truncated: false });
    if (/\/api\/dns\/domains\/[^/]+\/records$/.test(path) && method === 'GET') return json({ domain: 'example-shop.com', fetched_at: now - 3600, cached: true, records });
    if (path.startsWith('/api/dns/')) return json({ ok: true, records });
    if (path === '/api/unifi/status') return json({ configured: true, reachable: true, console: { id: 'console-1', name: 'Main office' } });
    if (path === '/api/unifi/pool') return json(pool);
    if (path === '/api/unifi/clients') return json([{ id: 'c1', name: 'shop-web', ip: '192.168.10.20', mac: 'bc:24:11:00:00:01', type: 'WIRED', connected_at: new Date(Date.now() - 7200e3).toISOString() }, { id: 'c2', name: 'Front desk printer', ip: '192.168.10.40', mac: '00:11:22:33:44:55', type: 'WIRELESS', connected_at: '' }]);
    if (path === '/api/unifi/consoles') return json([{ id: 'console-1', name: 'Main office', ip: '5.5.5.1', model: 'UniFi Dream Machine Pro Max', version: '5.0', state: 'connected', is_managed_gateway: true }, { id: 'console-2', name: 'Warehouse', ip: '5.5.6.1', model: 'UniFi Dream Machine Pro', version: '4.3', state: 'connected', is_managed_gateway: false }]);
    if (path.startsWith('/api/unifi/')) return json({ ok: true });
    if (path === '/api/network/map') return json(networkMap);
    if (path === '/api/keys' && method === 'GET') return json(entries);
    if (path === '/api/keys/services') return json(services);
    if (path.endsWith('/check')) return json({ service: 'godaddy', ok: true, detail: 'Domain API reachable (5 sample domains)', checked_at: now, latency_ms: 180 });
    if (path === '/api/keys/provision') return json({ created: true, entry: { ...entries[2], name: 'docs-openai', kind: 'minted', project: 'docs', notes: 'OpenAI project speck-docs', secrets: { OPENAI_API_KEY: 'sk-svcacct-synthetic-example' } } });
    if (path === '/api/keys/shop-database' && method === 'GET') return json({ ...entries[1], secrets: { DATABASE_URL: 'postgres://app:synthetic@db.example.test/app', PGPASSWORD: 'synthetic-pw' } });
    if (path.startsWith('/api/keys')) return json({ ok: true, revoked: [], entry: entries[1] });
    if (path === '/api/ssh/keys') return json(sshKeys);
    if (path.startsWith('/api/ssh/')) return json({ ok: true, name: 'new-key', public_key: sshKeys[0].public_key, private_key: '-----BEGIN OPENSSH PRIVATE KEY-----\nsynthetic\n-----END OPENSSH PRIVATE KEY-----' });
    if (path === '/api/context/files') return json(handoffs);
    if (path.startsWith('/api/context/files/')) return json({ filename: handoffs[0].filename, markdown });
    if (path === '/api/tokens/scopes') return json({ role: 'admin', scopes: { read: 'Read everything the creator can see', operate: 'Operator changes', admin: 'Administrator changes', 'keys:read': 'List and reveal vault entries', 'keys:write': 'Store and delete vault entries' } });
    if (path === '/api/tokens' && method === 'POST') {
      const body = req.postDataJSON();
      tokenList = [{ ...tokenList[0], id: 't2', name: body.name, scopes: body.scopes, key_prefixes: body.key_prefixes, last_used: null, uses: 0 }, ...tokenList];
      return json({ ...tokenList[0], token: 'speck_pat_syntheticTokenValueForScreenshotsOnly000000000', expires: now + body.expires_days * 86400 });
    }
    if (path === '/api/tokens') return json(tokenList);
    return json({ ok: true });
  });
  await page.route('**/api/openapi.json', (route) => route.fulfill({ json: { paths: {
    '/api/keys/provision': { post: { summary: 'Provision' } }, '/api/keys': { get: { summary: 'List Entries' } },
    '/api/dns/status': { get: { summary: 'Status' } }, '/api/dns/domains/{domain}/point': { post: { summary: 'Point' } },
    '/api/unifi/pool': { get: { summary: 'Pool' } }, '/api/fleet': { get: { summary: 'Inventory' } },
  } } }));
  return writes;
}

const shots = '../output/austinland';
fs.mkdirSync(shots, { recursive: true });
const noOverflow = async (page, width) => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

for (const width of [1440, 390]) {
  test(`network domains, record review and public IP mapping at ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 960 });
    const writes = await setup(page);
    await page.goto('/#network');
    await expect(page.getByRole('heading', { name: 'Network & DNS', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'example-shop.com', exact: true })).toBeVisible();
    await expect(page.locator('#net-domain-rows').getByText('shop-web')).toBeVisible();
    await expect(page.getByText('GoDaddy parking')).toBeVisible();
    await page.screenshot({ path: `${shots}/network-domains-${width}-${info.project.name}.png`, fullPage: width < 800 });
    await noOverflow(page, width);
    await page.getByLabel('Show').selectOption('expiring');
    await expect(page.getByRole('button', { name: 'example-labs.dev' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'example-shop.com', exact: true })).toHaveCount(0);
    await page.getByLabel('Show').selectOption('all');
    await page.getByLabel('Search', { exact: true }).fill('mail');
    await expect(page.getByText('Records matching “mail”')).toBeVisible();
    await page.getByLabel('Search', { exact: true }).fill('');
    await expect(page.getByText('Records matching “mail”')).toHaveCount(0);
    await page.getByRole('button', { name: 'example-shop.com', exact: true }).click();
    const pane = page.getByRole('dialog', { name: 'example-shop.com', exact: true });
    await expect(pane.getByText('v=spf1 include:_spf.example.net -all')).toBeVisible();
    await expect(pane.getByText('Reaches')).toBeVisible();
    await page.screenshot({ path: `${shots}/network-domain-pane-${width}-${info.project.name}.png` });
    await pane.getByRole('button', { name: 'Point a name' }).click();
    const point = page.getByRole('dialog', { name: 'Point a name at an IP' });
    await point.getByLabel('Name', { exact: true }).fill('shop');
    await point.getByLabel('IPv4 address').fill('5.5.5.12');
    await point.getByRole('button', { name: 'Review change' }).click();
    const review = page.getByRole('dialog', { name: 'Update DNS' });
    await expect(review.getByText('shop.example-shop.com')).toBeVisible();
    await expect(review.getByText('This creates a new A record.')).toBeVisible();
    await review.getByRole('button', { name: 'Update DNS' }).click();
    await expect.poll(() => writes.find((w) => w.path.endsWith('/point'))?.body).toEqual({ name: 'shop', ip: '5.5.5.12', ttl: 600 });
    await page.keyboard.press('Escape');
    await page.getByRole('tab', { name: /Public IPs/ }).click();
    await expect(page.locator('#net-body').getByText('Speck-managed', { exact: true })).toBeVisible();
    await expect(page.getByText('www.example-shop.com')).toBeVisible();
    await page.screenshot({ path: `${shots}/network-public-ips-${width}-${info.project.name}.png`, fullPage: width < 800 });
    await noOverflow(page, width);
    await page.getByRole('button', { name: 'Map to host' }).first().click();
    const map = page.getByRole('dialog', { name: 'Map 5.5.5.12' });
    await map.getByLabel('Machine').selectOption({ label: 'build-runner · 192.168.10.21' });
    await expect(map.getByLabel('Mapping name')).toHaveValue('build-runner');
    await map.getByRole('button', { name: 'Review change' }).click();
    const expose = page.getByRole('dialog', { name: 'Expose a host on a public IP' });
    await expect(expose.getByRole('button', { name: 'Create mapping' })).toBeDisabled();
    await expose.getByLabel('Type 5.5.5.12 to confirm').fill('5.5.5.12');
    await expose.getByRole('button', { name: 'Create mapping' }).click();
    await expect.poll(() => writes.find((w) => w.path === '/api/unifi/expose')?.body).toEqual({ public_ip: '5.5.5.12', lan_ip: '192.168.10.21', name: 'build-runner' });
    await page.getByRole('button', { name: 'Remove' }).click();
    const remove = page.getByRole('dialog', { name: 'Remove public IP mapping' });
    await expect(remove.getByText('2 DNS names still point here')).toBeVisible();
    await remove.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('tab', { name: 'Reachability' }).click();
    await expect(page.getByText('NAT · shop-web')).toBeVisible();
    await page.screenshot({ path: `${shots}/network-reachability-${width}-${info.project.name}.png` });
    await page.getByRole('tab', { name: 'LAN clients' }).click();
    await expect(page.getByText('Front desk printer')).toBeVisible();
    await page.getByRole('tab', { name: 'UniFi consoles' }).click();
    await expect(page.getByText('Managed gateway')).toBeVisible();
    await noOverflow(page, width);
  });

  test(`keys vault, reveal, edit and provisioning at ${width}`, async ({ page, context }, info) => {
    await page.setViewportSize({ width, height: 960 });
    if (info.project.name === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const writes = await setup(page);
    await page.goto('/#keys');
    await expect(page.getByRole('heading', { name: 'Keys', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^shop/ })).toBeVisible();
    await expect(page.getByText('Imported from AustinLand')).toBeVisible();
    await page.screenshot({ path: `${shots}/keys-vault-${width}-${info.project.name}.png`, fullPage: width < 800 });
    await noOverflow(page, width);
    await page.getByRole('button', { name: 'shop-database' }).click();
    const pane = page.getByRole('dialog', { name: 'shop-database', exact: true });
    await expect(pane.getByText('•••• (12 chars)')).toBeVisible();
    await expect(pane.getByText('synthetic-pw')).toHaveCount(0);
    await pane.getByRole('button', { name: 'Reveal values' }).click();
    await expect(pane.getByText('synthetic-pw')).toBeVisible();
    await page.screenshot({ path: `${shots}/keys-entry-revealed-${width}-${info.project.name}.png` });
    await pane.getByRole('button', { name: 'Hide values' }).click();
    await expect(pane.getByText('synthetic-pw')).toHaveCount(0);
    await pane.getByRole('button', { name: 'Edit' }).click();
    const edit = page.getByRole('dialog', { name: 'Edit shop-database' });
    await edit.getByText('Paste .env lines').click();
    await edit.locator('#keys-dotenv').fill('export PGUSER=app\nPGHOST="db.example.test"\n9BAD=x');
    await edit.getByRole('button', { name: 'Add these variables' }).click();
    await edit.getByLabel('Remove').first().check();
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect.poll(() => writes.find((w) => w.method === 'PUT')?.body).toEqual({ service: 'postgres', project: '', notes: 'Primary database', secrets: { DATABASE_URL: null, PGUSER: 'app', PGHOST: 'db.example.test' } });
    // Saving reopens the refreshed entry; close it to reach the toolbar underneath.
    await expect(page.getByRole('dialog', { name: 'Edit shop-database' })).toHaveCount(0);
    await page.getByRole('dialog', { name: 'shop-database', exact: true }).getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: 'Provision key' }).click();
    const provision = page.getByRole('dialog', { name: 'Provision a key for a project' });
    await expect(provision.getByRole('radio', { name: /Twilio/ })).toBeDisabled();
    await provision.getByRole('combobox', { name: 'Project' }).fill('docs');
    await page.screenshot({ path: `${shots}/keys-provision-${width}-${info.project.name}.png` });
    await provision.getByRole('button', { name: 'Provision' }).click();
    await expect.poll(() => writes.find((w) => w.path === '/api/keys/provision')?.body).toEqual({ service: 'openai', project: 'docs' });
    await expect(page.getByRole('dialog', { name: 'Key ready' }).getByText('OPENAI_API_KEY=sk-svcacct-synthetic-example')).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('tab', { name: 'Providers' }).click();
    await expect(page.getByText('4 projects visible to the admin key')).toBeVisible();
    await page.locator('#provider-godaddy').getByRole('button', { name: 'Check' }).click();
    await expect(page.getByText('Domain API reachable (5 sample domains)')).toBeVisible();
    await page.screenshot({ path: `${shots}/keys-providers-${width}-${info.project.name}.png`, fullPage: width < 800 });
    await page.locator('#provider-unifi').getByRole('button', { name: 'Replace credentials' }).click();
    const unifi = page.getByRole('dialog', { name: 'Replace UniFi Site Manager' });
    await expect(unifi.getByLabel('UNIFI_API_KEY')).toHaveAttribute('type', 'password');
    await unifi.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => writes.find((w) => w.path === '/api/keys/services/unifi')?.body).toEqual({ secrets: {}, settings: { UNIFI_GATEWAY: '192.168.10.1' } });
    await page.getByRole('tab', { name: /SSH keys/ }).click();
    await expect(page.getByText('Held in Speck')).toBeVisible();
    await page.getByRole('tab', { name: /Handoffs/ }).click();
    await page.getByRole('button', { name: 'shop-web' }).click();
    const handoff = page.getByRole('dialog', { name: 'shop-web · example-shop.com' });
    await expect(handoff.getByText('private key hidden')).toBeVisible();
    await expect(handoff.getByText('synthetic-private-key-material')).toHaveCount(0);
    await handoff.getByRole('button', { name: 'Show private key' }).click();
    await expect(handoff.getByText('synthetic-private-key-material')).toBeVisible();
    await noOverflow(page, width);
  });

  test(`API tokens, MCP setup and endpoint explorer at ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 960 });
    const writes = await setup(page);
    await page.goto('/#api');
    await expect(page.getByRole('heading', { name: 'API & agents', exact: true })).toBeVisible();
    await expect(page.getByText('claude mcp add --transport http speck')).toBeVisible();
    await expect(page.getByText('Vault limited to shop*')).toBeVisible();
    await page.screenshot({ path: `${shots}/api-${width}-${info.project.name}.png`, fullPage: width < 800 });
    await noOverflow(page, width);
    await page.getByRole('button', { name: 'Create API token' }).click();
    const create = page.getByRole('dialog', { name: 'Create an API token' });
    await create.getByLabel('Name', { exact: true }).fill('Build agent');
    await create.getByRole('checkbox', { name: /keys:read/ }).check();
    await create.getByLabel('Expires after').selectOption('30');
    await create.getByLabel('Vault name prefixes (optional)').fill('shop, labs');
    await create.getByRole('button', { name: 'Create token' }).click();
    await expect.poll(() => writes.find((w) => w.path === '/api/tokens')?.body).toEqual({ name: 'Build agent', scopes: ['read', 'keys:read'], expires_days: 30, key_prefixes: ['shop', 'labs'] });
    const shown = page.getByRole('dialog', { name: 'Token created' });
    await expect(shown.getByText('speck_pat_syntheticTokenValueForScreenshotsOnly000000000')).toBeVisible();
    await page.screenshot({ path: `${shots}/api-token-created-${width}-${info.project.name}.png` });
    await shown.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByText('Build agent')).toBeVisible();
    await page.getByLabel('Search', { exact: true }).fill('provision');
    await expect(page.getByText('/api/keys/provision')).toBeVisible();
    await expect(page.getByText('/api/unifi/pool')).toHaveCount(0);
    await noOverflow(page, width);
  });
}
