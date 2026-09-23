import { test, expect } from '@playwright/test';

async function signIn(page, transform = d => d, role = 'admin') {
  await page.context().addCookies([{ name: 'speck-gallery', value: '1', url: 'http://127.0.0.1:8761' }]);
  await page.route('**/api/auth/me', route => route.fulfill({ json: { username: 'demo', csrf: 'preview-only', role } }));
  await page.route(/\/api\/fleet(?:\?.*)?$/, async route => {
    const response = await route.fetch();
    await route.fulfill({ json: {machines: (await response.json()).machines.map(transform), connections: []} });
  });
  await page.goto('/');
  await page.locator('[data-device="frontdesk"]').first().click();
  await expect(page.locator('.machine-facts')).toBeVisible();
}
async function frameFits(page) {
  const frame = page.locator('.live-screen');
  const box = await frame.boundingBox();
  expect(Math.abs(box.width / box.height - 16 / 9)).toBeLessThan(.01);
  expect(await frame.evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBeTruthy();
}
for (const width of [1440, 834, 760, 390, 320]) {
  test(`machine essentials, actions and preview fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    await signIn(page);
    await expect(page.locator('.dialog-head')).toContainText('BYD-FRONTDESK');
    await expect(page.locator('.dialog-head')).toContainText('Online');
    await expect(page.locator('.machine-address')).toHaveText('192.0.2.24');
    await expect(page.locator('.machine-facts')).toContainText('Windows 11 Pro');
    await frameFits(page);
    const metrics = await page.locator('.meters').boundingBox();
    const storage = await page.locator('.machine-storage').boundingBox();
    const inventory = await page.locator(".machine-inventory").boundingBox();
    expect(metrics.y - inventory.height).toBeLessThan(400);
    expect(storage.y + storage.height - inventory.height).toBeLessThan(650);
    if (width > 700) {
      const frame = await page.locator('.live-screen').boundingBox();
      expect(metrics.x).toBeGreaterThan(frame.x + frame.width);
    }
    expect(await page.locator('.device-drawer').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
    await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: async value => { window.copiedIP = value; } }, configurable: true }); });
    await page.getByRole('button', { name: 'Copy IP address' }).click();
    expect(await page.evaluate(() => window.copiedIP)).toBe('192.0.2.24');
    await page.locator('#drawer-terminal').click();
    await expect(page.locator('[data-tab="terminal"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#script')).toBeVisible();
    await page.locator('[data-tab="overview"]').click();
    await page.locator('#device-edit').click();
    await expect(page.locator('dialog:modal')).toBeVisible();
    await page.locator('dialog:modal .close').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('.device-drawer')).toHaveCount(0);
    await expect(page.locator('[data-device="frontdesk"]').first()).toBeFocused();
  });
}

test('preview preserves its shape through loading, waiting, errors, image and policy off', async ({ page }) => {
  let state = 'loading', release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/devices/frontdesk/preview-status', async route => {
    if (state === 'loading') await gate;
    if (state === 'error') return route.fulfill({ status: 503, json: { detail: 'Unavailable' } });
    return route.fulfill({ json: { available: state === 'image', captured_at: 1790071200 } });
  });
  await page.route('**/api/devices/frontdesk/preview?*', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#DCECAB"/></svg>' }));
  await page.route('**/api/devices/frontdesk/preview-policy', route => route.fulfill({ json: { ok: true } }));
  await signIn(page, d => ({ ...d, preview: { enabled: true } }));
  await expect(page.locator('.live-screen .loading-state')).toBeVisible();
  await frameFits(page);
  state = 'waiting'; release();
  await expect(page.locator('.live-screen')).toContainText('No preview captured yet');
  await frameFits(page);
  for (const next of ['error', 'image']) {
    state = next;
    await page.locator('[data-tab="overview"]').click();
    if (next === 'error') {
      await expect(page.locator('.live-screen')).toContainText('Preview unavailable');
      await expect(page.locator('.meters')).toBeVisible();
    } else {
      await expect(page.locator('.live-screen > img')).toBeVisible();
      expect(await page.locator('.live-screen > img').evaluate(el => getComputedStyle(el).objectFit)).toBe('contain');
    }
    await frameFits(page);
  }
  await page.locator('#preview-policy').uncheck();
  await expect(page.locator('.live-screen')).toContainText('Screen preview is off');
  await expect(page.locator('.live-screen > img')).toHaveCount(0);
  await frameFits(page);
});

test('offline and missing telemetry remain explicit, including IPv6-only machines', async ({ page }) => {
  await signIn(page, d => ({ ...d, online: false, telemetry: { network: { interfaces: [{ addrs: [{ address: '::1/128' }, { address: 'fe80::1/64' }, { address: '2001:db8::24/64' }] }] } } }));
  await expect(page.locator('.dialog-head')).toContainText('Offline');
  await expect(page.locator('.machine-address')).toHaveText('2001:db8::24');
  await expect(page.locator('#drawer-screen')).toBeDisabled();
  await expect(page.locator('.telemetry-note')).toContainText('last report');
  await expect(page.locator('.meters strong')).toHaveText(['—', '—']);
  await expect(page.locator('.meters progress')).toHaveCount(0);
  await expect(page.locator('.machine-storage')).toContainText('No storage reported');
});

for (const mode of ['viewer', 'archived', 'review']) {
  test(`${mode} keeps machine facts and existing management restrictions`, async ({ page }) => {
    await signIn(page, d => ({ ...d, archived: mode === 'archived', approved: mode !== 'review' }), mode === 'viewer' ? 'viewer' : 'admin');
    await expect(page.locator('.machine-address')).toHaveText('192.0.2.24');
    await expect(page.locator('#drawer-screen, #drawer-terminal, #drawer-ai')).toHaveCount(0);
    if (mode !== 'review') {
      await expect(page.locator('#device-edit, #preview-policy')).toHaveCount(0);
      await expect(page.locator('[data-tab]')).toHaveCount(1);
    } else {
      await expect(page.locator('#preview-policy')).toBeDisabled();
      await expect(page.locator('#detail > .callout')).toContainText('approve it');
    }
  });
}

test('long names and zero utilization remain readable, and switching rows replaces the summary', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 960 });
  await signIn(page, d => d.id === 'frontdesk' ? {
    ...d, label: 'BYD-FRONTDESK · restored cloud recovery verification machine',
    telemetry: { ...d.telemetry, cpu_percent: 0, memory: { usedPercent: 0, used: 0, total: 1024 ** 3 },
      network: { interfaces: [
        { flags: ['up'], addrs: [{ address: '127.0.0.1/8' }, { address: '169.254.1.1/16' }] },
        { flags: [], addrs: [{ address: '192.0.2.99/24' }] },
        { flags: ['up'], addrs: [{ address: '192.0.2.25/24' }] },
      ] },
      active_app: { title: 'A very long document title with details that should wrap within the machine pane', user: 'EXAMPLE\\reception-operator', process: 'DocumentViewer.exe' },
    },
  } : d);
  await expect(page.locator('.machine-address')).toHaveText('192.0.2.25');
  await expect(page.locator('.meters strong')).toHaveText(['0.0%', '0%']);
  expect(await page.locator('.device-drawer').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.locator('[data-device="pbx"]').first().click();
  await expect(page.locator('.device-drawer')).toHaveCount(1);
  await expect(page.locator('.dialog-head')).toContainText('BYD-PBX');
  await expect(page.locator('.machine-facts')).toContainText('Debian GNU/Linux');
  await expect(page.locator('#drawer-screen')).toContainText('Open SSH');
  await expect(page.locator('#drawer-terminal')).toContainText('Shell');
});
