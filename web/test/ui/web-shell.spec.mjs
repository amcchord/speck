import { test, expect } from '@playwright/test';

for (const width of [1440, 390, 320]) {
  test(`headless web shell at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 960 });
    await page.context().addCookies([{ name: 'speck-gallery', value: '1', url: 'http://127.0.0.1:8761' }]);
    const inputs = [], requests = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route(/\/api\/fleet(?:\?.*)?$/, async route => {
      const response = await route.fetch();
      const devices = (await response.json()).machines;
      const device = devices.find(d => d.platform === 'linux');
      device.id = 'headless'; device.label = 'LINUX-SERVER';
      device.remote_protocol = 'shell'; device.remote_configured = true;
      device.configured_remote_protocol = 'ssh'; device.remote_shell_available = true;
      await route.fulfill({ json: {machines: devices, connections: []} });
    });
    let counter = 0;
    await page.route('**/api/devices/headless/remote/sessions', async route => {
      requests.push(route.request().postDataJSON());
      await route.fulfill({ json: { id: `shell-${++counter}`, protocol: 'shell' } });
    });
    await page.route('**/api/remote/sessions/*', route => route.fulfill({ json: { ok: true } }));
    const sockets = [];
    await page.routeWebSocket('**/api/remote/sessions/*/ws', ws => {
      sockets.push(ws);
      ws.onMessage(data => inputs.push(JSON.parse(data)));
      ws.send(JSON.stringify({ type: 'ready' }));
      ws.send(Buffer.from('\x1b[32mConnected to LINUX-SERVER\x1b[0m\r\nroot@linux-server:~# uptime\r\n 14:32:08 up 12 days, 4:18, load average: 0.08, 0.04, 0.01\r\nroot@linux-server:~# '));
    });
    await page.goto('/#fleet');
    await page.locator('[data-screen="headless"]').click();
    await expect(page.locator('.shell-workspace')).toBeVisible();
    await expect(page.locator('#shell-status')).toHaveText('Connected');
    await expect(page.locator('#shell-startup')).toBeHidden();
    await expect(page.locator('#sound')).toHaveCount(0);
    await expect(page.locator('#mic')).toHaveCount(0);
    expect(requests[0].mode).toBe('shell');
    await expect.poll(() => inputs.some(i => i.type === 'ack')).toBeTruthy();
    await page.locator('.xterm-helper-textarea').pressSequentially('pwd');
    await page.locator('.xterm-helper-textarea').press('Enter');
    await expect.poll(() => inputs.filter(i => i.type === 'input').map(i => i.data).join('')).toContain('pwd\r');
    await page.locator('.xterm-helper-textarea').pressSequentially('café 漢字');
    await expect.poll(() => inputs.filter(i => i.type === 'input').map(i => i.data).join('')).toContain('café 漢字');
    await page.getByLabel('Screen reader support').check();
    await expect(page.locator('.xterm-accessibility')).toHaveCount(1);
    await page.getByLabel('Screen reader support').uncheck();
    await expect(page.locator('.xterm-accessibility')).toHaveCount(0);
    await page.locator('#shell-keys').selectOption('interrupt');
    await expect.poll(() => inputs.some(i => i.data === '\x03')).toBeTruthy();
    await page.locator('#shell-search').fill('no matching text');
    await expect(page.locator('#shell-match')).toHaveText('No match');
    await page.locator('#shell-search').fill('load average');
    await expect(page.locator('#shell-match')).toBeEmpty();
    await page.evaluate(() => {
      window.copiedTerminalText = '';
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        writeText: async text => { window.copiedTerminalText = text; },
        readText: async () => 'clipboard-proof café',
      } });
    });
    await page.locator('#shell-copy').click();
    await expect.poll(() => page.evaluate(() => window.copiedTerminalText)).toBe('load average');
    await page.locator('#shell-paste').click();
    await expect.poll(() => inputs.some(i => i.data?.includes('clipboard-proof café'))).toBeTruthy();
    if (width === 1440) {
      await page.locator('#shell-fullscreen').click();
      await expect(page.locator('#shell-fullscreen')).toHaveText('Exit full screen');
      await page.locator('#shell-fullscreen').click();
    }
    const initialSize = await page.locator('#shell-size').textContent();
    await page.locator('#shell-larger').click();
    await expect(page.locator('#shell-size')).not.toHaveText(initialSize);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const box = await page.locator('#shell-terminal').boundingBox();
    expect(box.height).toBeGreaterThan(200);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `../output/headless-webshell/${info.project.name}-${width}.png` });
    await page.locator('#shell-disconnect').click();
    await expect(page.locator('#shell-status')).toContainText('Disconnected');
    await expect(page.locator('#shell-paste')).toBeDisabled();
    await page.locator('#shell-reconnect').click();
    await expect(page.locator('#shell-status')).toHaveText('Connected');
    expect(sockets.length).toBe(2);
    await page.locator('.remote-back').click();
    await expect(page.locator('.shell-workspace')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('leaving during creation closes the late shell session', async ({ page }) => {
  await page.context().addCookies([{ name: 'speck-gallery', value: '1', url: 'http://127.0.0.1:8761' }]);
  await page.route(/\/api\/fleet(?:\?.*)?$/, async route => {
    const response = await route.fetch();
    const devices = (await response.json()).machines;
    devices[0].remote_protocol = 'shell'; devices[0].remote_configured = true;
    await route.fulfill({ json: {machines: devices, connections: []} });
  });
  let release;
  const pending = new Promise(resolve => release = resolve);
  await page.route('**/api/devices/frontdesk/remote/sessions', async route => {
    await pending;
    await route.fulfill({ json: { id: 'late-shell', protocol: 'shell' } });
  });
  let ended = false;
  await page.route('**/api/remote/sessions/late-shell', async route => { ended = route.request().method() === 'DELETE'; await route.fulfill({ json: { ok: true } }); });
  await page.goto('/#remote/frontdesk');
  await expect(page.locator('.shell-workspace')).toBeVisible();
  await page.locator('.remote-back').click();
  release();
  await expect.poll(() => ended).toBeTruthy();
  await expect(page.locator('.shell-workspace')).toHaveCount(0);
});
