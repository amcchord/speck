import { test, expect } from './fixtures.mjs';
import fs from 'node:fs/promises';
const screenshots = new URL('../../../output/ui-ux-polish/workspaces/', import.meta.url).pathname;
async function setup(page, info) {
  await page.context().addCookies([{ name: 'speck-gallery', value: '1', url: info.project.use.baseURL || 'http://127.0.0.1:8761' }]);
}
async function capture(page, info, name) {
  await fs.mkdir(screenshots, { recursive: true });
  await page.screenshot({ path: screenshots + `${info.project.name}-${name}.png`, fullPage: !(await page.locator("dialog[open]").count()) });
}
for (const width of [1440, 834, 390, 320]) test(`customer review and runbook forms fit and retain exact selections at ${width}px`, async ({ page }, info) => {
  await setup(page, info); await page.setViewportSize({ width, height: 960 });
  await page.goto('/#workspaces?workspace=example-workspace');
  await expect(page.getByRole('navigation', { name: 'Customer workspaces' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Example customer', exact: true })).toHaveAttribute('aria-current', 'page');
  await capture(page, info, `customer-${width}`);
  await page.getByRole('button', { name: 'Review associations', exact: true }).click();
  await expect(page.locator('[data-association-count]')).toHaveText('1 resources selected · 1 pinned');
  const unselected = page.locator('[data-association="1"]');
  await expect(page.locator('[data-pin="1"]')).toBeDisabled();
  await unselected.check(); await page.locator('[data-pin="1"]').check();
  await expect(page.locator('[data-association-count]')).toHaveText('2 resources selected · 2 pinned');
  await unselected.uncheck(); await expect(page.locator('[data-pin="1"]')).not.toBeChecked();
  await expect(page.locator('[data-pin="1"]')).toBeDisabled();
  expect(await page.getByRole('dialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
  await capture(page, info, `associations-${width}`);
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('link', { name: 'All workspaces', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Unassigned machines', exact: true })).toBeVisible();
  await page.goto('/#maintenance'); await expect(page.locator('[data-routine]')).toHaveCount(4);
  await capture(page, info, `maintenance-${width}`);
  await page.getByRole('button', { name: 'Create a reviewed runbook' }).click();
  await expect(page.getByRole('dialog', { name: 'Create reviewed runbook' })).toBeVisible();
  await expect(page.locator('[data-runbook-selection]')).toContainText('eligible windows targets');
  expect(await page.getByRole('dialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
  await capture(page, info, `runbook-${width}`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});
test('unknown customer workspace never silently presents global evidence', async ({ page }, info) => {
  await setup(page, info); await page.goto('/#workspaces?workspace=removed-workspace');
  await expect(page.getByRole('heading', { name: 'Workspace unavailable' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Daily operational queue' })).toHaveCount(0);
  await page.getByRole('link', { name: 'All workspaces', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Daily operational queue' })).toBeVisible();
  await capture(page, info, 'customer-all-workspaces');
});
test('maintenance keeps routines usable when runbook history fails', async ({ page }, info) => {
  await setup(page, info);
  await page.route('**/api/maintenance/runs', r => r.fulfill({ status: 503, json: { detail: 'History unavailable' } }));
  await page.goto('/#maintenance'); await expect(page.locator('[data-routine]')).toHaveCount(4);
  await expect(page.locator('.maintenance-workspace')).toContainText('Unavailable: Runbook progress');
  await expect(page.getByRole('link', { name: 'Daily update inventory →', exact: true })).toBeVisible();
  await expect(page.locator('.maintenance-workspace')).toContainText('Runbook progress could not be loaded.');
  await capture(page, info, 'maintenance-partial-failure');
});
test('runbook review validates targets, matches platform and blocks duplicate previews', async ({ page }, info) => {
  await setup(page, info);
  await page.route('**/api/templates', r => r.fulfill({ json: [
    { id: 'windows-review', name: 'Windows reviewed change', platform: 'windows', revision: 1, parameters: [] },
    { id: 'linux-review', name: 'Linux reviewed change', platform: 'linux', revision: 2, parameters: [] },
  ] }));
  let previews = 0;
  await page.route('**/api/batches/preview', async r => { previews++; await new Promise(resolve => setTimeout(resolve, 150)); await r.fulfill({ json: { targets: [{ label: 'Selected lab machine', script: 'Read-only synthetic preview' }] } }); });
  await page.goto('/#maintenance'); await page.getByRole('button', { name: 'Create a reviewed runbook' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Synthetic reviewed runbook');
  await page.getByRole('button', { name: 'Review exact runbook' }).click();
  await expect(page.locator('[data-runbook-error]')).toHaveText('Select at least one eligible machine for this runbook.');
  expect(previews).toBe(0);
  await page.locator('[data-runbook-target="frontdesk"]').check();
  await page.locator('[data-runbook-template]').selectOption('linux-review');
  await expect(page.locator('[data-runbook-target="frontdesk"]')).toBeDisabled();
  await expect(page.locator('[data-runbook-target="frontdesk"]')).not.toBeChecked();
  await page.locator('[data-runbook-target="pbx"]').check();
  await page.getByRole('button', { name: 'Review exact runbook' }).click();
  await expect(page.getByRole('button', { name: 'Review exact runbook' })).toBeDisabled();
  await expect(page.getByRole('dialog', { name: 'Confirm reusable runbook' })).toBeVisible();
  expect(previews).toBe(3); await capture(page, info, 'runbook-exact-review');
});
test('empty template library explains how to finish a runbook', async ({ page }, info) => {
  await setup(page, info); await page.route('**/api/templates', r => r.fulfill({ json: [] }));
  await page.goto('/#maintenance'); await page.getByRole('button', { name: 'Create a reviewed runbook' }).click();
  await expect(page.getByRole('button', { name: 'Review exact runbook' })).toBeDisabled();
  await expect(page.getByRole('dialog')).toContainText('Add a template in Software & scripts');
  await capture(page, info, 'runbook-empty-templates');
});
test('patch bulk selection exposes hidden selections and disables empty actions', async ({ page }, info) => {
  await setup(page, info); await page.goto('/#patches');
  await expect(page.locator('#patch-scan')).toBeDisabled(); await expect(page.locator('#patch-schedule')).toBeDisabled();
  await page.locator('[data-patch-target="frontdesk"]').check();
  await expect(page.locator('#patch-selection-count')).toHaveText('1 selected');
  await page.locator('[data-list-controls] summary').click();
  await page.getByRole('searchbox', { name: 'Search patches', exact: true }).fill('PBX');
  await expect(page.locator('#patch-selection-count')).toHaveText('1 selected · 1 outside this view');
  await expect(page.locator('#patch-scan')).toBeEnabled();
  await page.locator('#patch-select-all').check();
  await expect(page.locator('#patch-selection-count')).toHaveText('3 selected · 1 outside this view');
  await capture(page, info, 'patch-selection');
});
test('AI settings failure leaves remote preferences usable and retries independently', async ({ page }, info) => {
  await setup(page, info); let available = false;
  await page.route('**/api/ai/settings', r => available ? r.fulfill({ json: { configured: true, model: 'synthetic-model' } }) : r.fulfill({ status: 503, json: { detail: 'AI temporarily unavailable' } }));
  await page.goto('/#settings');
  await expect(page.locator('[data-ai-settings]')).toContainText('AI settings unavailable.');
  await expect(page.locator('#remote-client')).toBeVisible(); await page.locator('#remote-client').selectOption('desktop');
  expect(await page.evaluate(() => localStorage.getItem('speck-remote-client'))).toBe('desktop');
  await capture(page, info, 'settings-partial-failure');
  available = true; await page.getByRole('button', { name: 'Retry AI settings' }).click();
  await expect(page.locator('#ai-model')).toHaveValue('synthetic-model'); await expect(page.locator('#remote-client')).toHaveValue('desktop');
});
test('retrying AI configuration preserves the operator permission boundary', async ({ page }, info) => {
  await setup(page, info);
  await page.route('**/api/auth/me', r => r.fulfill({ json: { username: 'operator', csrf: 'preview-only', role: 'operator' } }));
  let available = false, writes = 0;
  await page.route('**/api/ai/settings', r => {
    if (r.request().method() !== 'GET') writes++;
    return available ? r.fulfill({ json: { configured: true, model: 'synthetic-model' } }) : r.fulfill({ status: 503, json: { detail: 'AI temporarily unavailable' } });
  });
  await page.goto('/#settings'); await expect(page.getByRole('button', { name: 'Retry AI settings' })).toBeVisible();
  available = true; await page.getByRole('button', { name: 'Retry AI settings' }).click();
  await expect(page.locator('#ai-model')).toHaveValue('synthetic-model');
  await expect(page.getByRole('button', { name: 'Save AI settings' })).toBeDisabled();
  await expect(page.locator('[data-ai-settings]')).toContainText('Administrator access is required');
  expect(writes).toBe(0);
});
test('empty backup calendar explains the scope of missing evidence', async ({ page }, info) => {
  await setup(page, info);
  await page.route('**/api/slide/coverage*', r => r.fulfill({ json: { backup: { rows: [], partial: false }, snapshot: { rows: [], partial: false }, note: 'Synthetic bounded history' } }));
  await page.goto('/#slide'); await page.getByRole('button', { name: 'Explore recovery-point calendar' }).click();
  await expect(page.locator('.resource-flyout')).toContainText('No snapshot dates in returned evidence');
  await expect(page.locator('.resource-flyout')).toContainText('does not establish a missed backup');
  await capture(page, info, 'backup-calendar-empty');
});
test('in-progress recovery run remains inspectable before any report exists', async ({ page }, info) => {
  await setup(page, info); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/recovery/runs', async r => {
    const rows = await (await r.fetch()).json();
    await r.fulfill({ json: rows.map(run => ({ ...run, report: null, status: 'running', phase: 'restoring' })) });
  });
  const ref = encodeURIComponent(JSON.stringify({ kind: 'recovery-run', id: 'demo-run' }));
  await page.goto('/#recovery?inspect=' + ref);
  await expect(page.locator('.resource-flyout')).toContainText('Not completed');
  await expect(page.locator('.resource-flyout')).toContainText('Not verified');
  expect(errors).toEqual([]); await capture(page, info, 'recovery-run-awaiting-proof');
});
