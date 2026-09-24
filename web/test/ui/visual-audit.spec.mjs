import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

// These checks use only the synthetic preview server, including its rejected writes.
// Measurements catch overflow, mixed control sizing and the full-width masthead bug.
for (const width of [1440, 834, 760, 390, 320]) {
  test.describe(`${width}px`, () => {
    test.beforeEach(async ({ page }) => { page.setDefaultTimeout(10000); });
    test.use({ viewport: { width, height: 960 }, hasTouch: width <= 834 });
    const capture = async (page, info, name) => {
      if (!process.env.SPECK_UI_SCREENSHOTS) return;
      const dir = path.resolve(process.env.SPECK_UI_SCREENSHOTS, info.project.name, String(width));
      await fs.mkdir(dir, { recursive: true });
      await page.screenshot({ path: path.join(dir, name + '.png'), fullPage: true });
    };
    const geometry = async (page) => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      const dialogs = page.locator('dialog[open]');
      for (const dialog of await dialogs.all()) {
        const box = await dialog.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(-1);
        expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
        expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
      }
      const clipped = await page.locator('button.primary, button.secondary, a.primary, a.secondary').evaluateAll(elements => elements.filter(el => el.getBoundingClientRect().width && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)).map(el => el.textContent));
      expect(clipped).toEqual([]);
    };
    const signIn = async (page) => {
      await page.context().addCookies([{ name: 'speck-gallery', value: '1', url: 'http://127.0.0.1:8761' }]);
      await page.goto('/');
      await expect(page.locator('#fleet-rows tr')).not.toHaveCount(0);
    };
    const go = async (page, route) => {
      await page.goto('/#' + route);
      await expect(page.locator('#content')).toBeVisible();
      await expect(page.locator('#content')).not.toHaveAttribute('aria-busy', 'true');
      await expect(page.locator('.load-error, .toast.error')).toHaveCount(0);
    };
    const close = async (page) => { await page.locator('dialog[open]').last().locator('.close').first().click(); };

    test('sign-in, public downloads and shared control alignment', async ({ page }, info) => {
      await page.goto('/');
      await expect(page.locator('#login')).toBeVisible();
      const masthead = await page.locator('.login-brand').boundingBox();
      if (width <= 1000) { expect(masthead.x).toBe(0); expect(masthead.width).toBe(width); }
      for (const control of await page.locator('#login button:visible').all()) {
        const box = await control.boundingBox();
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(await control.evaluate(el => getComputedStyle(el).justifyContent)).toBe('center');
      }
      await geometry(page);
      await capture(page, info, 'signin');
      await page.locator('.login-downloads').click();
      await expect(page.locator('.download-card')).toHaveCount(3);
      await geometry(page);
      await capture(page, info, 'public-downloads');
    });

    test('every page and machine panel fits the viewport', async ({ page }, info) => {
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await signIn(page);
      for (const route of ['fleet', 'alerts', 'schedules', 'patches', 'software', 'assistant', 'recovery', 'slide', 'activity', 'jobs', 'downloads', 'settings', 'account']) {
        await go(page, route);
        await geometry(page);
        await capture(page, info, route);
      }
      await go(page, 'fleet');
      const search = page.locator('#fleet-search');
      const searchPadding = await search.evaluate(el => parseFloat(getComputedStyle(el).paddingLeft));
      const icon = await page.locator('.search-field > .icon').boundingBox();
      const field = await search.boundingBox();
      expect(searchPadding).toBeGreaterThanOrEqual(icon.x + icon.width - field.x + 5);
      await page.locator('[data-device="frontdesk"]').first().click();
      for (const tab of ['overview', 'services', 'network', 'terminal', 'files', 'patches', 'remote']) {
        await page.locator(`[data-tab="${tab}"]`).click();
        await expect(page.locator('#device-body .speck-loading')).toHaveCount(0);
        await geometry(page);
        await capture(page, info, 'machine-' + tab);
      }
      expect(errors).toEqual([]);
    });

    test('dialogs, forms, selection, empty and error states', async ({ page }, info) => {
      await signIn(page);
      for (const [route, selector, name] of [
        ['fleet', '#add', 'enrollment'], ['alerts', '#monitor-defaults', 'monitoring'],
        ['schedules', '#new-schedule', 'schedule-editor'], ['software', '#new-template', 'template-editor'],
        ['software', '[data-deploy]', 'template-deploy'], ['recovery', '#new-plan', 'recovery-plan'],
        ['account', '#account-add', 'new-account'], ['account', '[id^="passkey-rename-"]', 'rename-passkey'],
      ]) {
        await go(page, route);
        const target = page.locator(selector).first();
        // Phones keep secondary page actions behind "More actions".
        if (!(await target.isVisible()) && await page.locator('#page-more').isVisible()) {
          const label = (await target.textContent()).trim();
          await page.locator('#page-more').click();
          await page.locator('dialog[open] .action-list button', { hasText: label }).click();
        } else await target.click();
        await expect(page.locator('dialog[open]')).toBeVisible();
        await geometry(page);
        await capture(page, info, name);
        await close(page);
      }
      await go(page, 'fleet');
      await page.locator('[data-select="frontdesk"]').check();
      await expect(page.locator('#bulk-actions')).toContainText('1 selected');
      await geometry(page);
      await capture(page, info, 'bulk-selection');
      await page.locator('#fleet-search').fill('no-such-machine');
      await expect(page.locator('#fleet-rows')).toContainText('No matching machines');
      await geometry(page);
      await capture(page, info, 'empty-fleet');
      await go(page, 'assistant');
      await page.locator('#assistant-task').fill('Preview only');
      await page.locator('#assistant-start').click();
      await page.locator('#ai-ask').click();
      await expect(page.locator('.toast.error')).toBeVisible();
      await expect(page.locator('#ai-result .working')).toHaveCount(0);
      await geometry(page);
      await capture(page, info, 'error');
    });

    test('remote workspace controls and keyboard remain usable', async ({ page }, info) => {
      await signIn(page);
      // A synthetic session proves layout only; no gateway or real endpoint is contacted.
      await page.route('**/api/devices/frontdesk/remote/sessions', route => route.fulfill({ json: { id: 'preview', protocol: 'rdp' } }));
      await page.routeWebSocket('**/api/remote/sessions/preview/ws', () => {});
      await page.goto('/#remote/frontdesk');
      await expect(page.locator('#remote-keyboard')).toBeVisible();
      await geometry(page);
      await capture(page, info, 'remote-workspace');
      await page.locator('#remote-keyboard').click();
      await expect(page.locator('#send-text')).toBeVisible();
      await geometry(page);
      await capture(page, info, 'remote-keyboard');
    });
  });
}
