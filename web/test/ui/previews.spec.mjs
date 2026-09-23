import { test, expect } from '@playwright/test';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#DCECAB"/><text x="30" y="60" font-size="24">Saved desktop · test fixture</text></svg>';
async function open(page, handler) {
  await page.context().addCookies([{ name: 'speck-gallery', value: '1', url: 'http://127.0.0.1:8761' }]);
  await page.route(/\/api\/fleet(?:\?.*)?$/, async route => {
    const response = await route.fetch();
    await route.fulfill({ json: {machines: (await response.json()).machines.map(d => ({ ...d, preview: { enabled: true } })), connections: []} });
  });
  await page.route('**/api/devices/frontdesk/preview-status', handler);
  await page.route('**/api/devices/frontdesk/preview?*', route => route.fulfill({ contentType: 'image/svg+xml', body: svg }));
  await page.route('**/api/devices/frontdesk/preview-policy', route => route.fulfill({ json: { ok: true } }));
  await page.goto('/');
  await page.locator('[data-device="frontdesk"]').first().click();
}
const saved = { enabled: true, available: true, source: 'saved', state: 'offline', captured_at: 1790071200 };

test('saved preview remains timestamped and survives a failed refresh at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  let failure = false;
  await open(page, route => failure ? route.fulfill({ status: 503, json: {} }) : route.fulfill({ json: saved }));
  await expect(page.locator('.capture-time')).toContainText('Last saved');
  await expect(page.locator('.preview-status')).toContainText('Machine is offline');
  await expect(page.locator('.live-screen > img')).toBeVisible();
  failure = true;
  await expect(page.locator('.preview-status')).toContainText('Cannot refresh', { timeout: 15000 });
  await expect(page.locator('.live-screen > img')).toBeVisible();
  await expect(page.locator('.capture-time')).toContainText('Last saved');
  expect(await page.locator('.device-drawer').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
});

test('hung initial status times out and the next poll recovers', async ({ page }) => {
  let release, requests = 0;
  const gate = new Promise(resolve => { release = resolve; });
  await open(page, async route => {
    requests++;
    if (requests === 1) await gate;
    await route.fulfill({ json: saved }).catch(() => {});
  });
  await expect(page.locator('.live-screen')).toContainText('Preview unavailable', { timeout: 9500 });
  await expect(page.locator('.capture-time')).toContainText('Last saved', { timeout: 15000 });
  release();
});

test('disabling previews immediately hides the image and discards pending responses', async ({ page }) => {
  let delayed = false, release, requested;
  const gate = new Promise(resolve => { release = resolve; });
  const pending = new Promise(resolve => { requested = resolve; });
  await open(page, async route => {
    if (delayed) { requested(); await gate; }
    await route.fulfill({ json: saved }).catch(() => {});
  });
  await expect(page.locator('.live-screen > img')).toBeVisible();
  delayed = true;
  await pending;
  await page.locator('#preview-policy').uncheck();
  await expect(page.locator('.live-screen')).toContainText('Screen preview is off');
  release();
  await expect(page.locator('.live-screen > img')).toHaveCount(0);
  await expect(page.locator('#preview-policy')).not.toBeChecked();
});

test('no desktop explains recovery instead of waiting indefinitely', async ({ page }) => {
  await open(page, route => route.fulfill({ json: { enabled: true, available: false, state: 'no_desktop' } }));
  await expect(page.locator('.live-screen')).toContainText('No preview captured yet');
  await expect(page.locator('.preview-status')).toContainText('Sign in or reconnect and unlock');
  await page.getByText('About screen previews').click();
  await expect(page.locator('#preview-help')).toContainText('including when this page is closed');
});

test('open machine refreshes user, desktop and app without resetting its preview', async ({ page }) => {
  let refreshed = false;
  await page.context().addCookies([{ name: 'speck-gallery', value: '1', url: 'http://127.0.0.1:8761' }]);
  await page.route(/\/api\/fleet(?:\?.*)?$/, async route => {
    const response = await route.fetch();
    await route.fulfill({ json: {machines: (await response.json()).machines.map(d => ({ ...d, preview: { enabled: true },
      telemetry: {...d.telemetry,active_app:refreshed?{title:'Newly opened chart',process:'Chart.exe',user:'OFFICE\\Pat'}:null,
        logged_in_users:refreshed?[{user:'OFFICE\\Pat',state:'active'}]:[], desktop:{state:refreshed?'active':'no_session',sessions_available:true}} })), connections: []} });
  });
  await page.route('**/api/devices/frontdesk/preview-status', route => route.fulfill({json:saved}));
  await page.route('**/api/devices/frontdesk/preview?*', route => route.fulfill({contentType:'image/svg+xml',body:svg}));
  await page.goto('/'); await page.locator('[data-device="frontdesk"]').first().click();
  await expect(page.locator('.machine-user')).toContainText('No users signed in');
  await expect(page.locator('.capture-time')).toContainText('Last saved');
  await page.locator('.live-screen > img').evaluate(img=>img.dataset.testKeep='yes');
  refreshed = true;
  await expect(page.locator('.machine-user')).toContainText('OFFICE\\Pat',{timeout:20000});
  await expect(page.locator('.machine-desktop')).toContainText('Active');
  await expect(page.locator('.machine-foreground h3')).toHaveText('Newly opened chart');
  await expect(page.locator('[data-row="frontdesk"] .app-cell')).toHaveText('Newly opened chart');
  await expect(page.locator('.live-screen > img')).toHaveAttribute('data-test-keep','yes');
});
