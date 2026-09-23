import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const now = Date.now() / 1000;
const job = { id: 'job-1', kind: 'command', status: 'unknown', actor: 'demo' };
const first = { id: 'alert-1', device_id: 'frontdesk', label: 'BYD-FRONTDESK', key: 'job:job-1', title: 'Command · completion unconfirmed', explanation: 'The agent did not report a final result. The operation may have run; check its effects before retrying.', resolution_hint: 'Mark reviewed closes this alert; it does not undo or retry the operation.', severity: 'warning', opened: now - 5400, job };
const fixtures = [first,
  { ...first, id: 'alert-2', title: 'Daily update inventory · did not start in time', explanation: 'The job expired while waiting for the agent to pick it up. Check connectivity before trying again.', opened: now - 7200, device_id: 'caller', label: 'BYD-CALLER', key: 'job:job-2', job: { ...job, id: 'job-2', status: 'expired' } },
  { ...first, id: 'alert-3', key: 'disk:C:\\', title: 'Disk C:\\ is 94% used', explanation: 'Usage exceeded the monitoring threshold for the configured duration.', device_id: 'server', label: 'BYD-SERVER', severity: 'critical', job: null, acknowledged: now - 300, ack_actor: 'demo' },
  { ...first, id: 'alert-4', title: 'Service Spooler is not running', key: 'service:Spooler', severity: 'critical', explanation: 'A watched service was stopped or missing in the latest valid inventory.', job: null },
  { ...first, id: 'alert-5', title: 'Health check · failed', key: 'job:job-5', explanation: 'The agent reported a failure. Review the output to identify what failed and whether any steps completed.', job: { ...job, id: 'job-5', status: 'failed' } },
];
async function setup(page, role = 'admin') {
  await page.context().addCookies([{ name: 'speck-gallery', value: '1', url: 'http://127.0.0.1:8761' }]);
  // Cookies are port independent; use the configured local preview for requests.
  let items = structuredClone(fixtures);
  const requests = [];
  await page.route('**/api/alerts**', async route => {
    const req = route.request(), url = new URL(req.url());
    requests.push({ path: url.pathname + url.search, method: req.method() });
    const id = url.pathname.split('/')[3];
    if (id) {
      const item = items.find(a => a.id === id);
      if (req.method() === 'POST') {
        if (req.postDataJSON().action === 'acknowledge') item.acknowledged = now;
        else item.resolved = now;
        return route.fulfill({ json: { ok: true } });
      }
      return route.fulfill({ json: { ...item, job: { ...item.job, script: 'Get-Service Spooler', result: { stderr: '<script>do not execute</script>', exit_code: 1 } } } });
    }
    let selected = items.filter(a => !url.searchParams.get('device_id') || a.device_id === url.searchParams.get('device_id'));
    if (url.searchParams.get('state') === 'resolved') selected = selected.filter(a => a.resolved);
    if (url.searchParams.get('state') === 'unacknowledged') selected = selected.filter(a => !a.acknowledged && !a.resolved);
    if (url.searchParams.get('state') === 'active') selected = selected.filter(a => !a.resolved);
    return route.fulfill({ json: { items: selected, counts: { active: items.filter(a => !a.resolved).length, unacknowledged: items.filter(a => !a.resolved && !a.acknowledged).length }, next_cursor: null } });
  });
  if (role === 'viewer') await page.route('**/api/auth/me', route => route.fulfill({ json: { username: 'viewer', role: 'viewer', csrf: 'synthetic' } }));
  return requests;
}
async function geometry(page, width) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  for (const dialog of await page.locator('dialog[open]').all()) {
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
  }
}
for (const width of [1440, 834, 390, 320]) {
  test(`compact alerts, evidence and filters at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 960 });
    await setup(page);
    await page.goto('/#alerts');
    await expect(page.locator('.alert-item')).toHaveCount(5);
    await geometry(page, width);
    if (width === 1440) {
      const firstRow = await page.locator('.alert-row').first().boundingBox();
      expect(firstRow.height).toBeLessThanOrEqual(84);
      expect(firstRow.y).toBeLessThan(300);
      expect((await page.locator('.alert-item').last().boundingBox()).y).toBeLessThan(750);
    }
    if (process.env.SPECK_UI_SCREENSHOTS && [1440, 390].includes(width)) {
      const folder = path.resolve(process.env.SPECK_UI_SCREENSHOTS);
      await fs.mkdir(folder, { recursive: true });
      await page.screenshot({ path: path.join(folder, `${info.project.name}-alerts-${width}.png`), fullPage: true });
    }
    await page.locator('#alert-details-0').click();
    await expect(page.locator('#alert-details-0')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#alert-evidence-0')).toContainText('The operation may have run');
    await expect(page.locator('#alert-job-0')).toContainText('<script>do not execute</script>');
    await expect(page.locator('#alert-job-0 script')).toHaveCount(0);
    await page.locator('#ack-0').click();
    await expect(page.locator('.alert-state').first()).toHaveText('Acknowledged');
    await page.locator('#alert-details-0').click();
    await page.locator('#resolve-0').click();
    await expect(page.locator('.alert-item')).toHaveCount(4);
    await page.locator('#alert-state').selectOption('resolved');
    await expect(page.locator('.alert-item')).toHaveCount(1);
    await expect(page.locator('[id^="fix-"]')).toHaveCount(0);
    await page.locator('#alert-machine').selectOption('server');
    await expect(page.getByText('No matching alerts', { exact: true })).toBeVisible();
    await geometry(page, width);
  });
}

for (const intent of ['diagnose', 'fix']) {
  test(`AI ${intent} scopes evidence and hands reviewed script to the correct terminal`, async ({ page }) => {
    await setup(page);
    const requests = [], jobs = [];
    await page.route('**/api/ai/assist', route => {
      requests.push(route.request().postDataJSON());
      return route.fulfill({ json: { summary: 'Check the service state before repair.', script: 'Get-Service Spooler', caution: 'Read-only check; no repair is justified yet.', verification: 'Confirm the service status.', request_id: 'ai-test' } });
    });
    await page.route('**/api/devices/*/jobs', route => { jobs.push(route.request().url()); return route.fulfill({ json: { id: 'test-job' } }); });
    await page.goto('/#alerts');
    await page.locator(`#${intent}-0`).click();
    await expect(page.locator('.ai-alert-context')).toContainText(first.title);
    await expect(page.locator('#ai-job-evidence')).not.toBeChecked();
    expect(requests).toHaveLength(0);
    await page.locator('#ai-ask').click();
    await expect(page.locator('#ai-use')).toBeVisible();
    expect(requests[0]).toMatchObject({ device_id: 'frontdesk', alert_id: 'alert-1', alert_intent: intent, include_health: true, include_job_evidence: false });
    expect(jobs).toHaveLength(0);
    await page.locator('#ai-job-evidence').check();
    await page.locator('#ai-ask').click();
    await expect(page.locator('#ai-use')).toBeVisible();
    expect(requests[1].include_job_evidence).toBe(true);
    await page.locator('#ai-use').click();
    await expect(page.locator('#script')).toHaveValue('Get-Service Spooler');
    await expect(page.locator('#execute')).toBeVisible();
    expect(jobs).toHaveLength(0);
    await page.locator('#execute').click();
    await expect.poll(() => jobs.length).toBe(1);
    expect(jobs[0]).toContain('/devices/frontdesk/jobs');
  });
}

test('viewer alerts have no AI or management actions', async ({ page }) => {
  await setup(page, 'viewer');
  await page.goto('/#alerts');
  await expect(page.locator('.alert-item')).toHaveCount(5);
  await expect(page.locator('[id^="diagnose-"], [id^="fix-"], #monitor-defaults')).toHaveCount(0);
  await page.locator('#alert-details-0').click();
  await expect(page.locator('#ack-0, #resolve-0')).toHaveCount(0);
});

test('unconfigured AI and provider failure stay actionable without running a command', async ({ page }) => {
  await setup(page);
  await page.route('**/api/ai/settings', route => route.fulfill({ json: { configured: false } }));
  await page.goto('/#alerts');
  await page.locator('#fix-0').click();
  await expect(page.locator('#ai-ask')).toBeDisabled();
  await expect(page.getByText('Connect OpenAI in Settings to use AI assistance.')).toBeVisible();
  await page.locator('dialog .close').click();
  await page.route('**/api/ai/settings', route => route.fulfill({ json: { configured: true } }));
  await page.route('**/api/ai/assist', route => route.fulfill({ status: 502, json: { detail: 'AI is temporarily unavailable' } }));
  await page.locator('#diagnose-0').click();
  await page.locator('#ai-ask').click();
  await expect(page.locator('.toast.error')).toContainText('AI is temporarily unavailable');
  await expect(page.locator('#ai-ask')).toBeEnabled();
  await expect(page.locator('#ai-result .working')).toHaveCount(0);
  await expect(page.locator('#ai-use')).toHaveCount(0);
});
