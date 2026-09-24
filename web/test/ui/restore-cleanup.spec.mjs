import { test, expect } from '@playwright/test';

async function setup(page, { role = 'admin', connected = true } = {}) {
  await page.context().addCookies([{ name: 'speck-gallery', value: '1', url: 'http://127.0.0.1:8761' }]);
  await page.route('**/api/auth/me', route => route.fulfill({ json: { username: 'demo', csrf: 'preview-only', role } }));
  await page.route('**/api/slide/connection', route => route.fulfill({ json: { connected } }));
  const calls = [];
  let archived = false;
  await page.route(/\/api\/fleet(?:\?.*)?$/, async route => {
    calls.push(route.request().url().includes('refresh=true') ? 'refresh' : 'inventory');
    const value = await (await route.fetch()).json();
    const original = value.machines[0];
    const clone = { ...original, id: 'removed-clone', label: 'Deleted test VM', online: false, approved: false };
    await route.fulfill({ json: { ...value, machines: archived ? [original] : [original, clone] } });
  });
  await page.goto('/');
  await expect(page.locator('[data-row="removed-clone"]')).toBeVisible();
  await expect(page.locator('#refresh')).toBeEnabled();
  return { calls, archive: () => { archived = true; } };
}

test('explicit Refresh awaits cleanup and removes the archived clone in the same refresh', async ({ page }) => {
  const state = await setup(page, { role: 'operator' });
  let finish;
  await page.route('**/api/slide/restored-devices/sync', async route => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers()['x-csrf-token']).toBe('preview-only');
    state.calls.push('cleanup');
    await new Promise(resolve => { finish = resolve; });
    state.archive();
    await route.fulfill({ json: { linked: [], archived: ['removed-clone'], pending: [], errors: [] } });
  });
  await page.locator('#refresh').click();
  await expect.poll(() => state.calls).toEqual(['inventory', 'cleanup']);
  await expect(page.locator('#refresh')).toBeDisabled();
  await expect(page.locator('[data-row="removed-clone"]')).toBeVisible();
  finish();
  await expect(page.locator('[data-row="removed-clone"]')).toHaveCount(0);
  expect(state.calls).toEqual(['inventory', 'cleanup', 'refresh']);
  await expect(page.locator('#fleet-rows tr')).toHaveCount(1);
  await expect(page.locator('.toast')).toContainText('1 removed Slide restore(s) archived');
  await expect(page.locator('#refresh')).toBeEnabled();
});

for (const status of [409, 502]) {
  test(`cleanup HTTP ${status} still refreshes Fleet and explains the failure`, async ({ page }) => {
    const state = await setup(page);
    await page.route('**/api/slide/restored-devices/sync', route => route.fulfill({ status, json: { detail: 'Unavailable' } }));
    await page.locator('#refresh').click();
    await expect.poll(() => state.calls).toEqual(['inventory', 'refresh']);
    await expect(page.locator('.toast.error')).toContainText('Slide cleanup could not be checked');
    await expect(page.locator('[data-row="removed-clone"]')).toBeVisible();
    await expect(page.locator('#refresh')).toBeEnabled();
  });
}

test('pending confirmations stay visible with feedback', async ({ page }) => {
  await setup(page);
  await page.route('**/api/slide/restored-devices/sync', route => route.fulfill({ json: { linked: [], archived: [], pending: ['removed-clone'], errors: [] } }));
  await page.locator('#refresh').click();
  await expect(page.locator('.toast')).toContainText('1 awaiting confirmation');
  await expect(page.locator('[data-row="removed-clone"]')).toBeVisible();
  await expect(page.locator('#refresh')).toBeEnabled();
});

for (const options of [{ role: 'viewer' }, { connected: false }]) {
  test(`refresh without cleanup for ${JSON.stringify(options)}`, async ({ page }) => {
    let cleanupCalls = 0;
    await page.route('**/api/slide/restored-devices/sync', route => { cleanupCalls++; return route.fulfill({ json: {} }); });
    const state = await setup(page, options);
    await page.locator('#refresh').click();
    await expect.poll(() => state.calls).toEqual(['inventory', 'refresh']);
    await expect(page.locator('#refresh')).toBeEnabled();
    expect(cleanupCalls).toBe(0);
  });
}

test('background polling and navigation never trigger cleanup', async ({ page }) => {
  await page.clock.install();
  let cleanupCalls = 0;
  await page.route('**/api/slide/restored-devices/sync', route => { cleanupCalls++; return route.fulfill({ json: {} }); });
  const state = await setup(page);
  await page.clock.fastForward(16000);
  await expect.poll(() => state.calls.length).toBe(2);
  await page.locator('[data-page="alerts"]:visible').click();
  await expect(page.locator('h1')).toHaveText('Alerts');
  await page.locator('[data-page="fleet"]:visible').click();
  await expect(page.locator('#refresh')).toBeEnabled();
  await expect.poll(() => state.calls.length).toBe(3);
  expect(cleanupCalls).toBe(0);
});
