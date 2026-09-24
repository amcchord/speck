import { test, expect } from '@playwright/test';

// Phone and tablet layouts against the synthetic preview. See docs/ui-ux-audit-mobile.md.
const signIn = async (page, hash = 'fleet') => {
  await page.context().addCookies([{ name: 'speck-gallery', value: '1', url: 'http://127.0.0.1:8761' }]);
  await page.goto('/#' + hash);
  await expect(page.locator('#content')).not.toHaveAttribute('aria-busy', 'true');
};

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('tab bar, More sheet and compact header replace the sidebar', async ({ page }) => {
    await signIn(page);
    await expect(page.locator('aside')).toBeHidden();
    const bar = page.getByRole('navigation', { name: 'Primary navigation' });
    await expect(bar.getByRole('button')).toHaveText([/^Fleet$/, /^Alerts\s*1$/, /^Infra$/, /^Keys$/, /^More$/], { useInnerText: true });
    const box = await bar.boundingBox();
    expect(box.y + box.height).toBeCloseTo(844, 0);
    // Title and refresh share the first row; the description is left to wider screens.
    const title = await page.locator('.workspace > header h1').boundingBox();
    const refresh = await page.locator('#refresh').boundingBox();
    expect(Math.abs(title.y + title.height / 2 - (refresh.y + refresh.height / 2))).toBeLessThan(8);

    await bar.getByRole('button', { name: 'More' }).click();
    const sheet = page.getByRole('dialog', { name: 'All pages' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Recovery lab' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await sheet.getByRole('button', { name: 'Activity' }).click();
    await expect(sheet).toBeHidden();
    await expect(page).toHaveURL(/#activity$/);
    await expect(bar.getByRole('button', { name: 'More' })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.workspace > header p')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });

  test('tables become list rows and filters fold behind one button', async ({ page }) => {
    await signIn(page, 'jobs');
    const table = page.locator('.jobs-table');
    await expect(table.locator('thead')).toBeHidden();
    const row = table.locator('tbody tr').first();
    await expect(row.locator('.m-title')).toContainText('command');
    await expect(row.locator('.m-end .badge')).toHaveText('complete');
    expect((await row.boundingBox()).height).toBeLessThan(90);

    await page.goto('/#infrastructure');
    const toggle = page.locator('.m-filter-toggle');
    await expect(toggle).toHaveText('Filters');
    await expect(page.locator('#infra-provider')).toBeHidden();
    await expect(page.getByLabel('Search', { exact: true })).toBeVisible();
    await toggle.click();
    await page.locator('#infra-provider').selectOption('linode');
    await expect(toggle).toContainText('Filters1');
    await expect(page.locator('.infra-resource-table tbody tr:not(.m-group)')).toHaveCount(2);
  });

  test('dialogs rise as bottom sheets and secondary actions move behind More actions', async ({ page }) => {
    await signIn(page, 'alerts');
    await expect(page.locator('#monitor-defaults')).toBeHidden();
    await page.getByRole('button', { name: 'More actions' }).click();
    const actions = page.locator('dialog[open]');
    const box = await actions.boundingBox();
    expect(box.x).toBe(0);
    expect(box.width).toBe(390);
    expect(Math.round(box.y + box.height)).toBe(844);
    await actions.getByRole('button', { name: 'Monitoring policy' }).click();
    await expect(page.getByRole('dialog', { name: 'Monitoring policy' })).toBeVisible();
  });

  test('machine pane shows one line of identity with details on demand', async ({ page }) => {
    await signIn(page);
    await page.locator('[data-device="server"]').first().click();
    const brief = page.locator('.machine-brief');
    await expect(brief).toContainText('192.0.2.24');
    await expect(page.locator('.machine-inventory')).toBeHidden();
    // Tabs appear on the first screen instead of below the full identity block.
    expect((await page.locator('.device-drawer .tabs').boundingBox()).y).toBeLessThan(260);
    await page.locator('#machine-more').click();
    await expect(page.locator('.machine-inventory')).toBeVisible();
    await expect(page.locator('#machine-more')).toHaveAttribute('aria-expanded', 'true');
  });

  test('a stale response after leaving New VM is not reported as an error', async ({ page }) => {
    await page.route('**/api/infrastructure/inventory', (route) => route.fulfill({ json: { checked_at: 1790071200, connections: [
      { id: 'a1', name: 'AustinLand', provider: 'austinland', connector: true, status: 'connected', resources: [] },
    ] } }));
    await page.route('**/api/vms/options', async (route) => { await new Promise((r) => setTimeout(r, 1200)); await route.fulfill({ json: { os_options: [], nodes: [], presets: [] } }); });
    await signIn(page, 'infrastructure');
    await page.getByRole('button', { name: 'New VM' }).click();
    const loading = page.getByRole('dialog', { name: 'New VM' });
    await expect(loading).toBeVisible();
    await loading.getByRole('button', { name: 'Close' }).click();
    await page.goto('/#network');
    await page.waitForTimeout(1600);
    await expect(page.locator('.toast.error')).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'New VM' })).toHaveCount(0);
  });
});

test.describe('tablet portrait', () => {
  test.use({ viewport: { width: 834, height: 1194 }, hasTouch: true });

  test('a labelled rail frees room and Fleet uses list rows', async ({ page }) => {
    await signIn(page);
    const rail = await page.locator('aside').boundingBox();
    expect(rail.width).toBe(84);
    await expect(page.locator('aside [data-page="infrastructure"] .rail-label')).toHaveText('Infra');
    await expect(page.locator('.tabbar')).toBeHidden();
    await expect(page.locator('.fleet-table thead')).toBeHidden();
    const row = page.locator('#fleet-rows tr[data-row]').first();
    expect((await row.boundingBox()).height).toBeLessThan(80);
    // The whole selection cell toggles the checkbox without opening the machine.
    const cell = row.locator('td.select-cell');
    const box = await cell.boundingBox();
    await page.mouse.click(box.x + 4, box.y + 4);
    await expect(cell.locator('input')).toBeChecked();
    await expect(page.locator('#machine-details')).toHaveCount(0);
  });
});

test.describe('tablet landscape', () => {
  test.use({ viewport: { width: 1194, height: 834 }, hasTouch: true });

  test('every destination stays reachable and the selection column is not truncated', async ({ page }) => {
    await signIn(page);
    const downloads = await page.locator('aside [data-page="downloads"]').boundingBox();
    const account = await page.locator('aside .account').boundingBox();
    expect(downloads.y + downloads.height).toBeLessThanOrEqual(account.y);
    await expect(page.locator('.fleet-table thead')).toBeVisible();
    const cell = await page.locator('#fleet-rows td.select-cell').first().boundingBox();
    const box = await page.locator('#fleet-rows td.select-cell input').first().boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(cell.x + cell.width);
    expect(await page.locator('#fleet-rows td.select-cell').first().evaluate((el) => el.scrollWidth <= el.clientWidth)).toBeTruthy();
  });
});
