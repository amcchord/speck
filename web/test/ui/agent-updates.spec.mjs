import { test, expect } from '@playwright/test';

for (const width of [1440, 390]) {
  test(`admin pauses and resumes agent updates at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    await page.context().addCookies([{ name: 'speck-gallery', value: '1', url: 'http://127.0.0.1:8761' }]);
    let enabled = true;
    const writes = [];
    await page.route('**/api/agent-updates', async route => {
      if (route.request().method() === 'PUT') {
        enabled = route.request().postDataJSON().enabled;
        writes.push(enabled);
      }
      await route.fulfill({ json: { enabled, version: '0.3.1', devices: [{ label: 'Test machine', status: 'failed' }] } });
    });
    await page.goto('/#settings');
    const toggle = page.getByLabel('Automatically update agents');
    await expect(toggle).toBeChecked();
    const panel = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Automatic updates' }) });
    await expect(panel).toContainText('Published agent: 0.3.1');
    await expect(panel).toContainText('1 need attention');
    await toggle.uncheck();
    await page.getByRole('button', { name: 'Save update policy' }).click();
    await expect.poll(() => writes).toEqual([false]);
    await page.reload();
    await expect(toggle).not.toBeChecked();
    await toggle.check();
    await page.getByRole('button', { name: 'Save update policy' }).click();
    await expect.poll(() => writes).toEqual([false, true]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
