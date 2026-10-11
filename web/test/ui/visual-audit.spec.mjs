import { test, expect } from './fixtures.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';

const instruction = (...args) => args.map(arg => `${String(arg).length}.${arg}`).join(',') + ';';
async function syntheticRemote(page) {
  let socket;
  const stats = { audio_bytes: 0 };
  await page.context().addCookies([{ name: 'speck-gallery', value: '1', url: 'http://127.0.0.1:8761' }]);
  await page.route('**/api/devices/frontdesk/remote/sessions', route => route.fulfill({ json: { id: 'preview', protocol: 'rdp' } }));
  await page.route('**/api/remote/sessions/preview/stats', route => route.fulfill({ json: stats }));
  // Guacamole appends "?" even when connect() receives no parameters. Keep the
  // real socket completely mocked, including that empty query string. Install
  // before the document loads; hash navigation cannot install the mock later.
  await page.routeWebSocket(/\/api\/remote\/sessions\/preview\/ws(?:\?.*)?$/, ws => { socket = ws; });
  await page.goto('/#remote/frontdesk');
  await expect.poll(() => socket?.url()).toMatch(/\/api\/remote\/sessions\/preview\/ws\?$/);
  await expect(page.locator('#remote-status')).toHaveText('Waiting for session…');
  return { socket, stats };
}

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
      const overflow = await page.evaluate(expectedWidth => [...document.querySelectorAll('body,main,main *')].filter(el => {const r=el.getBoundingClientRect();return r.width>0&&(r.right>expectedWidth||el.scrollWidth>el.clientWidth+1);}).slice(0,12).map(el=>({tag:el.tagName,id:el.id,class:el.className,right:el.getBoundingClientRect().right,width:el.clientWidth,scroll:el.scrollWidth})),width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth),JSON.stringify(overflow)).toBeLessThanOrEqual(width);
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
      await page.goto('/#fleet');
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
      for (const route of ['home', 'fleet', 'alerts', 'schedules', 'patches', 'software', 'assistant', 'recovery', 'slide', 'activity', 'jobs', 'downloads', 'settings', 'account']) {
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
      // A synthetic session proves layout only; no gateway or real endpoint is contacted.
      await syntheticRemote(page);
      await expect(page.locator('#remote-keyboard')).toBeVisible();
      await geometry(page);
      await capture(page, info, 'remote-workspace');
      await page.locator('#remote-keyboard').click();
      await expect(page.locator('#send-text')).toBeVisible();
      await geometry(page);
      await capture(page, info, 'remote-keyboard');
    });

    test('remote toolbar stays stable across connection status transitions', async ({ page }, info) => {
      const { socket, stats } = await syntheticRemote(page);
      const controls = page.locator('.remote-controls');
      const bounds = async () => controls.evaluate(el => {
        const elements = [el, el.querySelector('#remote-keyboard'), el.querySelector('#mic')];
        return elements.map(element => {
          const { x, y, width, height } = element.getBoundingClientRect();
          return { x, y, width, height };
        });
      });
      const waiting = await bounds();
      if (width <= 600) {
        const title = await page.locator('.remote-title').boundingBox();
        expect(title.width).toBeGreaterThanOrEqual(width - 25);
        expect(await page.locator('.remote-title h1').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
      }
      await capture(page, info, 'remote-waiting');
      socket.send(instruction('size', 0, 800, 600) + instruction('rect', 0, 0, 0, 800, 600) + instruction('cfill', 15, 0, 247, 250, 243, 255) + instruction('rect', 0, 0, 0, 800, 70) + instruction('cfill', 15, 0, 43, 67, 55, 255) + instruction('rect', 0, 50, 110, 700, 90) + instruction('cfill', 15, 0, 220, 231, 217, 255) + instruction('sync', 1));
      await expect(page.locator('#remote-status')).toHaveText('Connected');
      const connected = await bounds();
      await expect(page.locator('#remote-status')).toHaveText('Connected · Audio idle');
      const idle = await bounds();
      stats.audio_bytes = 32768;
      await expect(page.locator('#remote-status')).toHaveText('Connected · 32 KB audio received');
      const audio = await bounds();
      await capture(page, info, 'remote-connected');
      const error = 'Synthetic remote connection error: the test gateway rejected this session. No real endpoint or gateway was contacted. Reconnect after checking the synthetic connection settings.';
      // Guacamole follows onerror synchronously with disconnect states. Observe
      // the real error assignment before that transition without changing it.
      await page.locator('#remote-status').evaluate((el, error) => {
        const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
        Object.defineProperty(el, 'textContent', {
          get() { return descriptor.get.call(this); },
          set(value) {
            descriptor.set.call(this, value);
            if (value === error) window.remoteErrorBounds = [...document.querySelectorAll('.remote-controls, #remote-keyboard, #mic')].map(element => {
              const { x, y, width, height } = element.getBoundingClientRect();
              return { x, y, width, height };
            });
          },
        });
      }, error);
      socket.send(instruction('error', error, 519));
      await expect(page.locator('#remote-status')).toHaveText('Disconnected');
      await expect(page.locator('#remote-startup')).toContainText(error);
      expect(await page.locator('#remote-startup strong').evaluate(el => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
      const failed = await page.evaluate(() => window.remoteErrorBounds);
      expect(failed).toHaveLength(waiting.length);
      const disconnected = await bounds();
      for (const state of [connected, idle, audio, failed, disconnected]) for (let i = 0; i < waiting.length; i++) {
        for (const property of ['x', 'y', 'width', 'height']) expect(Math.abs(state[i][property] - waiting[i][property]), `${width}px ${property} of remote control ${i}`).toBeLessThanOrEqual(1);
      }
      await geometry(page);
      await capture(page, info, 'remote-disconnected');
      await page.locator('#remote-keyboard').click();
      await expect(page.locator('#send-text')).toBeVisible();
      await expect(page.locator('#mic')).toBeEnabled();
    });
  });
}
