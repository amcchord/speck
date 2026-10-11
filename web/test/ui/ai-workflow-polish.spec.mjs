import { test, expect } from './fixtures.mjs';
import fs from 'node:fs/promises';
import ts from 'typescript';

const folder = new URL('../../../output/ui-ux-polish/workspaces/ai/', import.meta.url).pathname;
const screenSource = ts.transpileModule(await fs.readFile(new URL('../../src/screen-assistant.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const remoteInputSource = ts.transpileModule(await fs.readFile(new URL('../../src/remote-input.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const answer = { summary: 'Review the recorded service state.', script: 'Get-Service Spooler', caution: 'Read-only inspection; verify the correct machine.', verification: 'Confirm fresh service status.', request_id: 'synthetic-ai' };
async function setup(page, info, width = 1440) {
  await page.setViewportSize({ width, height: width < 600 ? 844 : 960 });
  await page.context().addCookies([{ name: 'speck-gallery', value: '1', url: info.project.use.baseURL || 'http://127.0.0.1:8761' }]);
  await page.route('**/api/ai/settings', r => r.fulfill({ json: { configured: true, model: 'Synthetic fixture' } }));
  // These fixtures never open an endpoint, submit a command, or reach a provider.
  await page.route(/\/api\/(?:devices\/[^/]+\/(?:jobs|remote\/sessions)|remote\/sessions)(?:\/|$)/, r => r.fulfill({ status: 409, json: { detail: 'Endpoint operations disabled in this fixture' } }));
}
async function capture(page, info, name) {
  await fs.mkdir(folder, { recursive: true });
  await page.screenshot({ path: folder + `${info.project.name}-${name}.png`, fullPage: !(await page.locator('dialog[open]').count()) });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
  for (const d of await page.locator('dialog[open]').all()) expect(await d.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
}
async function terminal(page, id = 'frontdesk') {
  await page.goto('/#fleet');
  await page.locator(`[data-device="${id}"].machine-name`).click();
  await page.locator('[data-tab="scripts"]').click();
  await expect(page.locator('#terminal-ai')).toBeVisible();
}
// Run the production controller with an in-memory display/input adapter. Network
// calls remain Playwright fixtures; no Guacamole or endpoint session is created.
async function screenHarness(page, platform = 'windows', waitForReady = true) {
  await page.route('**/ai-screen-fixture.js', r => r.fulfill({ contentType: 'text/javascript', body: screenSource }));
  await page.route('**/remote-input', r => r.fulfill({ contentType: 'text/javascript', body: remoteInputSource }));
  await page.goto('/#fleet');
  await page.evaluate(async platform => {
    const { openScreenAssistant } = await import('/ai-screen-fixture.js');
    const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 600;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#f7faf3'; ctx.fillRect(0, 0, 800, 600);
    ctx.fillStyle = '#2b4337'; ctx.fillRect(0, 0, 800, 70); ctx.font = '24px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText('Synthetic application · Connection settings', 25, 45);
    ctx.fillStyle = '#26362b'; ctx.font = '20px sans-serif'; ctx.fillText('Server connection', 50, 130);
    ctx.strokeStyle = '#9aa99c'; ctx.strokeRect(50, 160, 700, 65); ctx.fillText('lab.example.invalid', 70, 201);
    ctx.fillStyle = '#315741'; ctx.fillRect(50, 265, 175, 50); ctx.fillStyle = '#fff'; ctx.fillText('Review changes', 63, 297);
    const state = window.screenFixture = { active: true, captures: 0, mouse: [], keys: [], canvas };
    const client = { getDisplay: () => ({ flatten: () => { state.captures++; return canvas; } }), sendMouseState: s => { if (state.inputFailure) throw new Error('Synthetic disconnected input'); state.mouse.push(s); } };
    const ui = { esc: escape,
      api: async (path, method = 'GET', body, signal) => {
        const r = await fetch('/api' + path, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json' }, signal });
        const result = await r.json(); if (!r.ok) throw new Error(result.detail); return result;
      },
      dialog: (title, html) => {
        const d = document.createElement('dialog'); d.setAttribute('aria-label', title);
        d.innerHTML = `<div class="dialog-head"><h2>${title}</h2><button class="close" aria-label="Close">×</button></div>${html}`;
        document.body.append(d); d.showModal(); d.querySelector('.close').onclick = () => d.close(); d.onclose = () => d.remove(); return d;
      },
    };
    let currentClient = client;
    state.open = (id = 'synthetic-screen') => openScreenAssistant(ui, { id, label: 'Synthetic lab screen', platform }, currentClient, keys => state.keys.push(keys), () => state.active);
    state.newSession = () => { currentClient = { ...client }; state.open(); };
    state.open();
  }, platform);
  if (waitForReady) await expect(page.locator('#screen-ai-step')).toBeEnabled();
}

for (const width of [1440, 390, 320]) test(`AI script context is opt-in and requests/results fit at ${width}px`, async ({ page }, info) => {
  await setup(page, info, width); const requests = [];
  await page.route('**/api/ai/assist', r => { requests.push(r.request().postDataJSON()); return r.fulfill({ json: answer }); });
  await terminal(page); await page.locator('#script').fill('Write-Output "synthetic sensitive draft"');
  await page.locator('#terminal-ai').click(); await expect(page.locator('#ai-existing-script')).not.toBeChecked();
  await expect(page.locator('#ai-health')).toBeChecked(); await page.locator('#ai-prompt').fill('Inspect this service safely');
  await capture(page, info, `script-context-${width}`);
  await page.locator('#ai-ask').click(); await expect(page.locator('#ai-use')).toBeVisible();
  expect(requests[0]).toMatchObject({ device_id: 'frontdesk', platform: 'windows', script: '', include_health: true });
  await page.locator('#ai-use').scrollIntoViewIfNeeded();
  await capture(page, info, `script-review-${width}`);
  await page.locator('#ai-existing-script').check(); await expect(page.locator('#ai-use')).toHaveCount(0);
  await page.locator('#ai-health').uncheck(); await page.locator('#ai-ask').click(); await expect(page.locator('#ai-use')).toBeVisible();
  expect(requests[1]).toMatchObject({ script: 'Write-Output "synthetic sensitive draft"', include_health: false });
  await page.locator('#ai-use').click(); await expect(page.locator('#script')).toHaveValue(answer.script);
  await expect(page.locator('.ai-command-context')).toContainText(answer.caution);
  await expect(page.locator('.ai-command-context')).toContainText(answer.verification);
  await expect(page.locator('.ai-command-context')).toHaveCount(1);
});

test('settings/provider failure preserves script intent and retries in place', async ({ page }, info) => {
  await setup(page, info, 390); let settingsFails = true, providerFails = true, requests = 0;
  await page.route('**/api/ai/settings', r => r.fulfill(settingsFails ? { status: 503, json: { detail: 'Synthetic settings outage' } } : { json: { configured: true } }));
  await page.route('**/api/ai/assist', r => { requests++; return r.fulfill(providerFails ? { status: 502, json: { detail: 'Synthetic provider outage' } } : { json: answer }); });
  await terminal(page); await page.locator('#terminal-ai').click(); await page.locator('#ai-prompt').fill('Inspect without changing service state');
  await expect(page.locator('#ai-ask')).toBeDisabled(); await capture(page, info, 'script-settings-error-phone');
  settingsFails = false; await page.locator('[data-ai-connection-retry]').click(); await expect(page.locator('#ai-ask')).toBeEnabled();
  await page.locator('#ai-prompt').fill(' '); await page.locator('#ai-ask').click(); expect(requests).toBe(0);
  await page.locator('#ai-prompt').fill('Inspect without changing service state'); await page.locator('#ai-health').uncheck();
  await page.locator('#ai-ask').click(); await expect(page.locator('#ai-result')).toContainText('Synthetic provider outage');
  await expect(page.locator('#ai-prompt')).toHaveValue('Inspect without changing service state'); await expect(page.locator('#ai-health')).not.toBeChecked();
  await expect(page.locator('#ai-ask')).toBeEnabled(); await expect(page.locator('#ai-use')).toHaveCount(0);
  await capture(page, info, 'script-provider-error-phone'); providerFails = false;
  await page.locator('#ai-ask').click(); await expect(page.locator('#ai-use')).toBeVisible();
  await page.locator('#ai-prompt').fill('A different task'); await expect(page.locator('#ai-use')).toHaveCount(0);
});

test('assistant page retains Linux task and stopped/closed requests never restore old results', async ({ page }, info) => {
  await setup(page, info); let finish, requests = [];
  await page.route('**/api/ai/assist', async r => { requests.push(r.request().postDataJSON()); await new Promise(resolve => finish = resolve); await r.fulfill({ json: { ...answer, script: 'systemctl --failed' } }).catch(() => {}); });
  await page.goto('/#assistant'); await page.locator('#assistant-platform').selectOption('linux');
  await page.locator('#assistant-task').fill('Check failed Linux services'); await capture(page, info, 'assistant-linux-desktop');
  await page.locator('#assistant-start').click(); await expect(page.locator('#ai-prompt')).toHaveValue('Check failed Linux services');
  await page.locator('#ai-ask').click(); await expect.poll(() => requests.length).toBe(1);
  await expect(page.locator('#ai-prompt')).toBeDisabled(); await expect(page.locator('#ai-ask')).toBeDisabled();
  await page.locator('#ai-cancel').click(); finish(); await expect(page.locator('#ai-result')).toContainText('Stopped waiting');
  await page.waitForTimeout(100); await expect(page.locator('#ai-use')).toHaveCount(0);
  expect(requests[0]).toMatchObject({ platform: 'linux', device_id: null });
  await page.getByRole('dialog', { name: 'Ask Speck AI' }).getByRole('button', { name: 'Close' }).click();
  await page.goto('/#fleet'); await page.goto('/#assistant');
  await expect(page.locator('#assistant-platform')).toHaveValue('linux'); await expect(page.locator('#assistant-task')).toHaveValue('Check failed Linux services');
  await page.locator('#assistant-platform').selectOption('windows'); await page.locator('#assistant-start').click();
  await page.locator('#ai-ask').click(); await expect.poll(() => requests.length).toBe(2);
  await page.getByRole('dialog', { name: 'Ask Speck AI' }).getByRole('button', { name: 'Close' }).click(); finish();
  await page.waitForTimeout(100); await expect(page.locator('#ai-use')).toHaveCount(0); expect(requests[1].platform).toBe('windows');
});

test('archived target handoff retains the reviewed draft and never fills another machine', async ({ page }, info) => {
  await setup(page, info); let archived = false;
  await page.route('**/api/alerts**', r => r.fulfill({ json: { counts: { active: 1, unacknowledged: 1 }, items: [{ id: 'synthetic-retired-alert', device_id: 'frontdesk', label: 'Synthetic front desk', key: 'service:Spooler', title: 'Synthetic service review', severity: 'warning', opened: Date.now() / 1000 }], next_cursor: null } }));
  await page.route('**/api/devices', async r => { const response = await r.fetch(); const machines = await response.json(); return r.fulfill({ json: machines.map(d => d.id === 'frontdesk' ? { ...d, archived } : d) }); });
  await page.route('**/api/fleet?compact**', async r => { const response = await r.fetch(); const data = await response.json(); return r.fulfill({ json: { ...data, machines: data.machines.map(d => d.id === 'frontdesk' ? { ...d, archived } : d) } }); });
  await page.route('**/api/ai/assist', r => { archived = true; return r.fulfill({ json: answer }); });
  await page.goto('/#alerts'); await page.locator('#diagnose-0').click(); await page.locator('#ai-ask').click(); await expect(page.locator('#ai-use')).toBeVisible();
  await page.locator('#ai-use').click(); await expect(page.locator('[data-ai-handoff-error]')).toContainText('draft is retained');
  await expect(page.locator('#ai-use')).toBeEnabled(); await expect(page.locator('#ai-result')).toContainText(answer.script);
  await expect(page.locator('#script')).toHaveCount(0); await capture(page, info, 'script-target-unavailable-desktop');
});

for (const width of [1440, 390, 320]) test(`screen steps retain redacted applied history and block repeat Apply at ${width}px`, async ({ page }, info) => {
  await setup(page, info, width); const asks = [], receipts = [];
  const actions = [{ type: 'click', x: 65, y: 180, button: 'left' }, { type: 'type', text: 'synthetic-secret' }, { type: 'keypress', keys: ['CTRL', 'A'] }];
  await page.route('**/api/ai/assist', r => { asks.push(r.request().postDataJSON()); return r.fulfill({ json: { summary: 'Review the server field, then enter the approved value.', request_id: 'screen-' + asks.length, actions } }); });
  await page.route('**/api/ai/actions/applied', r => { receipts.push(r.request().postDataJSON()); return r.fulfill({ json: { ok: true } }); });
  await screenHarness(page); expect(await page.evaluate(() => window.screenFixture.captures)).toBe(0);
  await page.locator('#screen-ai-prompt').fill('Navigate to server connection settings'); await capture(page, info, `screen-task-${width}`);
  await page.locator('#screen-ai-step').click(); await expect(page.locator('#apply-screen-step')).toBeVisible();
  expect(await page.evaluate(() => window.screenFixture.mouse.length)).toBe(0);
  await page.locator('.ai-shared-screen summary').click(); await page.locator('#apply-screen-step').scrollIntoViewIfNeeded(); await capture(page, info, `screen-step-review-${width}`);
  await page.locator('#apply-screen-step').evaluate(el => { el.click(); el.click(); });
  await expect(page.locator('[data-screen-outcome]')).toContainText('Step applied and recorded');
  expect(receipts).toHaveLength(1); expect(receipts[0]).toMatchObject({ device_id: 'synthetic-screen', actions: ['click', 'type', 'keypress'] });
  expect(await page.evaluate(() => window.screenFixture.mouse.length)).toBe(3);
  expect(await page.evaluate(() => window.screenFixture.keys.at(-1))).toEqual([0xffe3, 65]);
  await expect(page.locator('#apply-screen-step')).toBeDisabled(); await capture(page, info, `screen-applied-${width}`);
  await page.locator('.ai-shared-history summary').click(); await page.locator('[data-screen-history]').scrollIntoViewIfNeeded();
  await capture(page, info, `screen-history-${width}`);
  await page.locator('#screen-ai-step').click(); await expect.poll(() => asks.length).toBe(2);
  expect(asks[1].prompt).toBe(asks[0].prompt); expect(asks[1].previous_steps).toHaveLength(1);
  expect(asks[1].previous_steps[0]).toContain('Typed 16 characters'); expect(asks[1].previous_steps.join()).not.toContain('synthetic-secret');
  await page.locator('#screen-ai-prompt').fill('A changed task for this session'); await expect(page.locator('#apply-screen-step')).toHaveCount(0);
  await page.locator('#screen-ai-step').click(); await expect.poll(() => asks.length).toBe(3); expect(asks[2].previous_steps).toEqual([]);
  await page.getByRole('dialog', { name: 'Screen assistant' }).getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('.remote-ai-dialog')).toHaveCount(0);
  await page.evaluate(() => window.screenFixture.open()); await expect(page.locator('#screen-ai-step')).toBeEnabled();
  await expect(page.locator('#screen-ai-prompt')).toHaveValue('A changed task for this session');
});

test('changed/expired screen and disconnected session never send proposed input', async ({ page }, info) => {
  await setup(page, info); let nextID = 0;
  await page.route('**/api/ai/assist', r => r.fulfill({ json: { summary: 'Review a left click.', request_id: 'fresh-' + nextID++, actions: [{ type: 'click', x: 60, y: 180 }] } }));
  await screenHarness(page); await page.locator('#screen-ai-prompt').fill('Review a connection setting');
  await page.locator('#screen-ai-step').click(); await expect(page.locator('#apply-screen-step')).toBeVisible();
  await page.evaluate(() => window.screenFixture.canvas.getContext('2d').fillRect(10, 10, 20, 20));
  await page.locator('#apply-screen-step').click(); await expect(page.locator('[data-screen-outcome]')).toContainText('screen changed');
  expect(await page.evaluate(() => window.screenFixture.mouse.length)).toBe(0); await capture(page, info, 'screen-changed-desktop');
  await page.locator('#screen-ai-step').click(); await expect(page.locator('#apply-screen-step')).toBeEnabled();
  await page.evaluate(() => window.screenFixture.active = false); await page.locator('#apply-screen-step').click();
  await expect(page.locator('[data-screen-outcome]')).toContainText('no longer connected'); expect(await page.evaluate(() => window.screenFixture.mouse.length)).toBe(0);
});

test('screen receipt failure cannot replay input and history excludes typed text', async ({ page }, info) => {
  await setup(page, info, 390); const asks = [];
  await page.route('**/api/ai/assist', r => { asks.push(r.request().postDataJSON()); return r.fulfill({ json: { summary: 'Type a reviewed value.', request_id: 'receipt-failure', actions: [{ type: 'type', text: '敏感 synthetic' }] } }); });
  await page.route('**/api/ai/actions/applied', r => r.fulfill({ status: 503, json: { detail: 'Synthetic receipt outage' } }));
  await screenHarness(page, 'linux'); await page.locator('#screen-ai-prompt').fill('Review input on a Linux display');
  await page.locator('#screen-ai-step').click(); await page.locator('#apply-screen-step').click();
  await expect(page.locator('[data-screen-outcome]')).toContainText('Input was sent'); await expect(page.locator('#apply-screen-step')).toBeDisabled();
  const count = await page.evaluate(() => window.screenFixture.keys.length); expect(count).toBe(12);
  await page.locator('#apply-screen-step').evaluate(el => el.click()); expect(await page.evaluate(() => window.screenFixture.keys.length)).toBe(count);
  await capture(page, info, 'screen-receipt-error-phone');
  await page.locator('#screen-ai-step').click(); await expect.poll(() => asks.length).toBe(2);
  expect(asks[1].previous_steps[0]).toContain('Typed 12 characters'); expect(asks[1].previous_steps[0]).not.toContain('敏感');
});

test('screen cancellation and close discard late responses without capturing another screen', async ({ page }, info) => {
  await setup(page, info); let finish, asks = 0;
  await page.route('**/api/ai/assist', async r => { asks++; await new Promise(resolve => finish = resolve); await r.fulfill({ json: { summary: 'Late step', request_id: 'late', actions: [{ type: 'click', x: 1, y: 1 }] } }).catch(() => {}); });
  await screenHarness(page); await page.locator('#screen-ai-prompt').fill('Inspect without losing the task'); await page.locator('#screen-ai-step').click();
  await expect.poll(() => asks).toBe(1); await expect(page.locator('#screen-ai-explain')).toBeDisabled(); await expect(page.locator('#screen-ai-step')).toBeDisabled();
  await expect(page.locator('#screen-ai-prompt')).toBeDisabled(); await capture(page, info, 'screen-loading-desktop');
  await page.locator('#screen-ai-cancel').click(); finish(); await page.waitForTimeout(100);
  await expect(page.locator('#apply-screen-step')).toHaveCount(0); await expect(page.locator('#screen-ai-result')).toContainText('Stopped waiting');
  expect(await page.evaluate(() => window.screenFixture.captures)).toBe(1);
  await page.locator('#screen-ai-step').click(); await expect.poll(() => asks).toBe(2);
  await page.getByRole('dialog', { name: 'Screen assistant' }).getByRole('button', { name: 'Close' }).click(); finish();
  await page.waitForTimeout(100); await expect(page.locator('#apply-screen-step')).toHaveCount(0);
  expect(await page.evaluate(() => window.screenFixture.mouse.length)).toBe(0);
});

test('invalid whole action batches and manual observations never partially apply', async ({ page }, info) => {
  await setup(page, info); let actions = [];
  await page.route('**/api/ai/assist', r => r.fulfill({ json: { summary: 'Synthetic validation proposal', request_id: 'validation', actions } }));
  await screenHarness(page); await page.locator('#screen-ai-prompt').fill('Validate one reviewed screen action');
  const invalid = [
    [{ type: 'click', x: 1, y: 1 }, { type: 'keypress', keys: ['F99'] }],
    [{ type: 'click', x: 800, y: 0 }], [{ type: 'click', x: 1.5, y: 0 }], [{ type: 'click', x: true, y: 0 }],
    [{ type: 'double_click', x: 1, y: 1, button: 'right' }], [{ type: 'scroll', x: 1, y: 1, scroll_x: 10, scroll_y: 0 }],
    [{ type: 'type', text: 'x'.repeat(2001) }], [{ type: 'keypress', keys: ['é'] }], [{ type: 'click', x: 1, y: 1, extra: 'unknown' }],
    Array.from({ length: 6 }, () => ({ type: 'click', x: 1, y: 1 })),
  ];
  for (const batch of invalid) {
    actions = batch; await page.locator('#screen-ai-step').click(); await expect(page.locator('#screen-ai-result [role="alert"]')).toBeVisible();
    await expect(page.locator('#apply-screen-step')).toHaveCount(0); await expect(page.locator('#screen-ai-step')).toBeEnabled();
  }
  actions = [{ type: 'click', x: 1, y: 1 }, { type: 'wait' }]; await page.locator('#screen-ai-step').click();
  await expect(page.locator('#screen-ai-result')).toContainText('Use manual control'); await expect(page.locator('#apply-screen-step')).toHaveCount(0);
  expect(await page.evaluate(() => window.screenFixture.mouse.length)).toBe(0); expect(await page.evaluate(() => window.screenFixture.keys.length)).toBe(0);
  await capture(page, info, 'screen-manual-observation-desktop');
});

test('screen connection failure/unconfigured AI stays retryable and sends no screenshot', async ({ page }, info) => {
  await setup(page, info, 390); let fail = true, configured = false, asks = 0;
  await page.route('**/api/ai/settings', r => r.fulfill(fail ? { status: 503, json: { detail: 'Synthetic AI connection outage' } } : { json: { configured } }));
  await page.route('**/api/ai/assist', r => { asks++; return r.fulfill({ json: { summary: 'Connection settings are shown.', verification: 'Read the server name.', caution: 'Inspect before making changes.' } }); });
  await screenHarness(page, 'windows', false); await expect(page.locator('[data-screen-retry]')).toBeVisible();
  await page.locator('#screen-ai-prompt').fill('Explain connection settings'); await capture(page, info, 'screen-settings-error-phone');
  await expect(page.locator('#screen-ai-step')).toBeDisabled(); expect(await page.evaluate(() => window.screenFixture.captures)).toBe(0);
  fail = false; await page.locator('[data-screen-retry]').click(); await expect(page.locator('[data-screen-config]')).toContainText('Connect OpenAI');
  await expect(page.locator('#screen-ai-step')).toBeDisabled(); expect(asks).toBe(0);
  await page.getByRole('dialog', { name: 'Screen assistant' }).getByRole('button', { name: 'Close' }).click(); await expect(page.locator('.remote-ai-dialog')).toHaveCount(0);
  configured = true; await page.evaluate(() => window.screenFixture.open()); await expect(page.locator('#screen-ai-explain')).toBeEnabled();
  await expect(page.locator('#screen-ai-prompt')).toHaveValue('Explain connection settings'); await page.locator('#screen-ai-explain').click();
  await expect(page.locator('#screen-ai-result')).toContainText('Connection settings are shown.'); await expect(page.locator('#apply-screen-step')).toHaveCount(0);
  expect(await page.evaluate(() => window.screenFixture.keys.length)).toBe(0); await capture(page, info, 'screen-explanation-phone');
});

test('screen history is bounded and discarded when the device or client changes', async ({ page }, info) => {
  await setup(page, info); const asks = [];
  await page.route('**/api/ai/assist', r => { asks.push(r.request().postDataJSON()); return r.fulfill({ json: { summary: 'Move the pointer to inspect the setting.', request_id: 'history-' + asks.length, actions: [{ type: 'move', x: asks.length, y: 30 }] } }); });
  await page.route('**/api/ai/actions/applied', r => r.fulfill({ json: { ok: true } }));
  await screenHarness(page); await page.locator('#screen-ai-prompt').fill('Inspect the original task');
  for (let i = 0; i < 6; i++) {
    await page.locator('#screen-ai-step').click(); await expect(page.locator('#apply-screen-step')).toBeEnabled(); await page.locator('#apply-screen-step').click();
    await expect(page.locator('[data-screen-outcome]')).toContainText('Step applied and recorded');
  }
  await page.locator('#screen-ai-step').click(); await expect.poll(() => asks.length).toBe(7);
  expect(asks[6].previous_steps).toHaveLength(5); expect(asks[6].previous_steps[0]).toContain('(2, 30)');
  expect(asks.every(a => a.prompt === 'Inspect the original task')).toBeTruthy();
  expect(await page.evaluate(() => window.screenFixture.captures)).toBe(13); // seven explicit requests plus six Apply freshness checks
  await page.getByRole('dialog', { name: 'Screen assistant' }).getByRole('button', { name: 'Close' }).click(); await expect(page.locator('.remote-ai-dialog')).toHaveCount(0);
  await page.evaluate(() => window.screenFixture.open('different-synthetic-device')); await expect(page.locator('#screen-ai-step')).toBeEnabled();
  await expect(page.locator('#screen-ai-prompt')).toHaveValue(''); await expect(page.locator('.ai-shared-history')).toHaveCount(0);
  await page.locator('#screen-ai-prompt').fill('A new device task'); await page.locator('#screen-ai-step').click(); await expect.poll(() => asks.length).toBe(8);
  expect(asks[7]).toMatchObject({ device_id: 'different-synthetic-device', previous_steps: [] });
  await page.getByRole('dialog', { name: 'Screen assistant' }).getByRole('button', { name: 'Close' }).click(); await expect(page.locator('.remote-ai-dialog')).toHaveCount(0);
  await page.evaluate(() => window.screenFixture.newSession()); await expect(page.locator('#screen-ai-step')).toBeEnabled();
  await expect(page.locator('#screen-ai-prompt')).toHaveValue(''); await expect(page.locator('.ai-shared-history')).toHaveCount(0);
});

test('expired proposal and input transport failure cannot be replayed', async ({ page }, info) => {
  await setup(page, info); let receipts = 0;
  await page.route('**/api/ai/assist', r => r.fulfill({ json: { summary: 'A single reviewed click.', request_id: 'input-failure', actions: [{ type: 'click', x: 1, y: 1 }] } }));
  await page.route('**/api/ai/actions/applied', r => { receipts++; return r.fulfill({ json: { ok: true } }); });
  await screenHarness(page); await page.locator('#screen-ai-prompt').fill('Review this one navigation step'); await page.locator('#screen-ai-step').click();
  await expect(page.locator('#apply-screen-step')).toBeVisible(); await page.evaluate(() => { window.originalNow = Date.now; Date.now = () => window.originalNow() + 121000; });
  await page.locator('#apply-screen-step').click(); await expect(page.locator('[data-screen-outcome]')).toContainText('expired');
  await page.evaluate(() => Date.now = window.originalNow); expect(await page.evaluate(() => window.screenFixture.mouse.length)).toBe(0);
  await page.locator('#screen-ai-step').click(); await expect(page.locator('#apply-screen-step')).toBeEnabled(); await page.evaluate(() => window.screenFixture.inputFailure = true);
  await page.locator('#apply-screen-step').click(); await expect(page.locator('[data-screen-outcome]')).toContainText('Input may have been sent');
  await expect(page.locator('#apply-screen-step')).toBeDisabled(); await page.locator('#apply-screen-step').evaluate(el => el.click());
  expect(receipts).toBe(0); await expect(page.locator('.ai-shared-history')).toHaveCount(0); await capture(page, info, 'screen-input-unconfirmed-desktop');
});

test('stopping an uncertain receipt allows a fresh request but never repeats input', async ({ page }, info) => {
  await setup(page, info); let finish, asks = [];
  await page.route('**/api/ai/assist', r => { asks.push(r.request().postDataJSON()); return r.fulfill({ json: { summary: 'A single reviewed click.', request_id: 'receipt-wait', actions: [{ type: 'click', x: 1, y: 1 }] } }); });
  await page.route('**/api/ai/actions/applied', async r => { await new Promise(resolve => finish = resolve); await r.fulfill({ json: { ok: true } }).catch(() => {}); });
  await screenHarness(page); await page.locator('#screen-ai-prompt').fill('Review the original navigation task'); await page.locator('#screen-ai-step').click(); await page.locator('#apply-screen-step').click();
  await expect(page.getByRole('button', { name: 'Stop waiting for receipt' })).toBeVisible(); await expect(page.locator('[data-screen-outcome]')).toContainText('Input sent');
  await page.getByRole('button', { name: 'Stop waiting for receipt' }).click(); finish(); await page.waitForTimeout(100);
  await expect(page.locator('[data-screen-outcome]')).toContainText('Input was sent'); await expect(page.locator('#apply-screen-step')).toBeDisabled();
  expect(await page.evaluate(() => window.screenFixture.mouse.length)).toBe(3); await page.locator('#screen-ai-step').click();
  await expect.poll(() => asks.length).toBe(2); expect(asks[1].previous_steps).toHaveLength(1); expect(await page.evaluate(() => window.screenFixture.mouse.length)).toBe(3);
});

test('reviewed input adapter maps newline/tab/unicode and exact mouse/wheel actions', async ({ page }, info) => {
  await setup(page, info);
  const actions = [{ type: 'move', x: 20, y: 30 }, { type: 'double_click', x: 25, y: 35 }, { type: 'scroll', x: 40, y: 45, scroll_y: -2000 }, { type: 'type', text: 'x\r\n\t😀' }, { type: 'keypress', keys: ['SHIFT', 'A'] }];
  await page.route('**/api/ai/assist', r => r.fulfill({ json: { summary: 'Synthetic reviewed adapter inputs.', request_id: 'adapter-keys', actions } }));
  await page.route('**/api/ai/actions/applied', r => r.fulfill({ json: { ok: true } }));
  await screenHarness(page); await page.locator('#screen-ai-prompt').fill('Review synthetic input mapping'); await page.locator('#screen-ai-step').click();
  await page.locator('#apply-screen-step').click(); await expect(page.locator('[data-screen-outcome]')).toContainText('Step applied and recorded');
  expect(await page.evaluate(() => window.screenFixture.keys)).toEqual([[120], [0xff0d], [0xff09], [0x0101f600], [0xffe1, 65]]);
  const mouse = await page.evaluate(() => window.screenFixture.mouse);
  expect(mouse.filter(m => m.left)).toHaveLength(2); expect(mouse.filter(m => m.up)).toHaveLength(25); expect(mouse.filter(m => m.right || m.middle || m.down)).toHaveLength(0);
  expect(mouse[0]).toMatchObject({ x: 20, y: 30, left: false });
});
