import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

async function setup(page, role = 'admin') {
  await page.context().addCookies([{ name: 'speck-gallery', value: '1', url: 'http://127.0.0.1:8761' }]);
  await page.route('**/api/auth/me', r => r.fulfill({ json: { username: 'demo', csrf: 'preview-only', role } }));
  await page.route(/\/api\/fleet(?:\?.*)?$/, async route => {
    const original = await (await route.fetch({maxRetries:2})).json();
    const resource = { provider:'proxmox', kind:'qemu', connection_id:'c1', connection_name:'Clinic cluster', node:'pve-1', id:'101', name:'BYD-FRONTDESK', status:'running' };
    const machines = original.machines.map((m, i) => ({...m, has_endpoint_agent:true, has_speck_agent:true, site:'Demo Clinic', ...(i < 3 ? { resources:[{...resource,id:String(101+i),name:m.label}], identity_evidence:['Hardware UUID'] } : {}) }));
    machines.push({id:'host-1',label:'pve-1',has_endpoint_agent:false,has_speck_agent:true,agent_status:'Host agent online',kind:'node',state:'online',resources:[{...resource,kind:'node',id:'pve-1',name:'pve-1'}]});
    machines.push({id:'vm-only',label:'LAB-UBUNTU',has_endpoint_agent:false,has_speck_agent:false,agent_status:'No Speck agent',kind:'qemu',state:'running',resources:[{...resource,id:'201',name:'LAB-UBUNTU'}]});
    await route.fulfill({json:{...original,machines,connections:[{id:'c1',name:'Clinic cluster',status:'connected'}]}});
  });
  await page.route('**/api/network/map', r => r.fulfill({json:{machines:[
    {id:'frontdesk',label:'BYD-FRONTDESK',lan:[{ip:'192.0.2.24',source:'unifi_mac'}],public:[],dns:[]},
    {id:'server',label:'BYD-SERVER',lan:[{ip:'192.0.2.20',source:'unifi_mac'}],public:[{ip:'203.0.113.10',via:'unifi_nat'}],dns:[{fqdn:'portal.example-clinic.com'}]},
    {id:'pbx',label:'BYD-PBX',lan:[{ip:'192.0.2.30',source:'reported'}],public:[],dns:[]},
  ], checked_at:1790071200}}));
}

test('Home is the sign-in destination; exact relationships, search and machine navigation work', async ({page}) => {
  await setup(page);
  await page.goto('/');
  await expect(page.locator('h1')).toHaveText('Home');
  await expect(page.locator('.home-workspace')).toBeVisible();
  await page.locator('#home-query').pressSequentially('portal.example-clinic.com');
  await expect(page.locator('[data-home-machine]')).toHaveCount(1);
  await expect(page.locator('#home-relationship')).toContainText('BYD-SERVER');
  await expect(page.locator('#home-relationship')).toContainText('MAC matched');
  await expect(page.locator('#home-relationship')).toContainText('pve-1');
  await expect(page.locator('#home-relationship')).toContainText('Identity matched');
  await expect(page.locator('#home-query')).toBeFocused();
  await page.locator('#home-open-machine').click();
  await expect(page.locator('#machine-details')).toContainText('BYD-SERVER');
  await page.locator('#machine-details .close').click();
  await page.locator('[data-home-host]').click();
  await expect(page.locator('#machine-details')).toContainText('pve-1');
  await page.locator('#machine-details .close').click();
  await page.locator('#home-query').fill('');
  await page.getByRole('button',{name:'Without endpoint agent',exact:true}).click();
  await expect(page.locator('[data-home-machine]')).toHaveCount(2);
  await expect(page.locator('#home-relationship')).toContainText('No endpoint agent');
});

test('AI handoff and scheduling retain explicit review and never execute from Home', async ({page}) => {
  const writes=[];
  page.on('request', r => {if (r.method() !== 'GET') writes.push(r.url());});
  await setup(page);
  await page.goto('/#home');
  await page.locator('#home-query').fill('Check disk space on Linux');
  await page.locator('#home-ask').click();
  await page.locator('#home-plan-context').selectOption('platform:linux');
  await page.locator('#home-plan-continue').click();
  await expect(page.locator('#ai-prompt')).toHaveValue('Check disk space on Linux');
  await expect(page.getByRole('dialog',{name:'Ask Speck AI'})).toContainText('Linux shell');
  await page.getByRole('dialog',{name:'Ask Speck AI'}).locator('.close').click();
  await page.locator('#home-new-schedule').click();
  await expect(page.getByRole('dialog',{name:'New schedule'})).toBeVisible();
  await expect(page.locator('#schedule-review')).toBeVisible();
  expect(writes).toEqual([]);
});

test('network drill-down opens the selected machine and clears through search', async ({page}) => {
  await setup(page);
  await page.goto('/#home');
  await page.locator('#home-query').fill('portal.example-clinic.com');
  await page.locator('#home-open-network').click();
  await expect(page).toHaveURL(/#network$/);
  await expect(page.locator('#net-tab-reach')).toHaveAttribute('aria-selected','true');
  await expect(page.locator('#net-reach-q')).toHaveValue('BYD-SERVER');
  await expect(page.locator('#net-reach-rows tbody tr')).toHaveCount(1);
  await expect(page.locator('#net-reach-rows')).toContainText('portal.example-clinic.com');
  await page.locator('#net-reach-q').fill('');
  await expect(page.locator('#net-reach-rows tbody tr')).toHaveCount(3);
});

test('viewer gets a useful Home without operator requests or actions', async ({page}) => {
  const forbidden=[];
  page.on('request', r => { if (/\/api\/(network|schedules|ai)\//.test(r.url()) || r.url().endsWith('/api/schedules')) forbidden.push(r.url()); });
  await setup(page,'viewer');
  await page.goto('/');
  await expect(page.locator('.home-workspace')).toBeVisible();
  await expect(page.locator('#home-ask')).toHaveCount(0);
  await expect(page.locator('#home-new-schedule')).toHaveCount(0);
  await expect(page.locator('#home-relationship')).toContainText('Operator access required');
  expect(forbidden).toEqual([]);
});

test('partial failure remains visible and cannot masquerade as a healthy empty environment', async ({page}) => {
  await setup(page);
  await page.route('**/api/network/map', r => r.fulfill({status:503,json:{detail:'Unavailable'}}));
  await page.route('**/api/alerts?*', r => r.fulfill({status:503,json:{detail:'Unavailable'}}));
  await page.route('**/api/schedules', r => r.fulfill({status:503,json:{detail:'Unavailable'}}));
  await page.goto('/');
  await expect(page.locator('.home-notice')).toContainText('Could not load: Alerts, Network relationships, Schedules');
  await expect(page.locator('#home-relationship')).toContainText('Network unavailable');
  await expect(page.locator('.home-stat.attention strong')).toHaveText('—');
  await expect(page.locator('.home-stat.automation strong')).toHaveText('—');
  await expect(page.locator('[data-home-machine]')).not.toHaveCount(0);
});

test('empty inventory, unavailable inventory and unconfigured AI are distinct', async ({page}) => {
  await setup(page);
  await page.route('**/api/ai/settings', r => r.fulfill({json:{configured:false}}));
  await page.route(/\/api\/fleet(?:\?.*)?$/, r => r.fulfill({json:{machines:[],connections:[]}}));
  await page.goto('/');
  await expect(page.locator('#home-results')).toContainText('Connect your first systems');
  await expect(page.locator('.home-stat.agents strong')).toHaveText('0');
  await expect(page.locator('.home-ai-status')).toContainText('Connect OpenAI');
  await page.locator('#home-ask').click();
  await expect(page).toHaveURL(/#assistant$/);
  await page.route(/\/api\/fleet(?:\?.*)?$/, r => r.fulfill({status:503,json:{detail:'Unavailable'}}));
  await page.goto('/#home');
  await expect(page.locator('#home-results')).toContainText('Inventory unavailable');
  await expect(page.locator('.home-stat.agents strong')).toHaveText('—');
});

test('keyboard command returns to Home; stale Home responses do not replace another page', async ({page}) => {
  await setup(page);
  await page.goto('/#fleet');
  await expect(page.locator('#fleet-rows')).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(page.locator('#home-query')).toBeFocused();
  let release;
  await page.route('**/api/network/map', async r => {await new Promise(resolve => { release=resolve; }); await r.fulfill({json:{machines:[]}});});
  await page.locator('#refresh').click();
  await expect.poll(()=>Boolean(release)).toBeTruthy();
  await page.locator('aside [data-page="fleet"]').click();
  await expect(page.locator('#fleet-rows')).toBeVisible();
  release();
  await page.waitForTimeout(200);
  await expect(page.locator('#fleet-rows')).toBeVisible();
  await expect(page.locator('.home-workspace')).toHaveCount(0);
});

for (const width of [1440,834,390,320]) test(`connected Home fits and works at ${width}px`, async ({page},info) => {
  await page.setViewportSize({width,height:width<700?844:1080});
  await setup(page);
  await page.goto('/');
  await page.locator('#home-query').fill('BYD-SERVER');
  await expect(page.locator('#home-relationship')).toContainText('portal.example-clinic.com');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  expect(await page.locator('.home-workspace').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  const clipped = await page.locator('.home-workspace button, .home-workspace a').evaluateAll(nodes=>nodes.filter(el=>el.getBoundingClientRect().width && (el.scrollWidth>el.clientWidth+1 || el.scrollHeight>el.clientHeight+1)).map(el=>el.textContent));
  expect(clipped).toEqual([]);
  await page.locator('#home-query').fill('');
  await page.locator('[data-home-machine="server"]').click();
  if (process.env.SPECK_HOME_SCREENSHOTS && info.project.name==='chromium') {
    await fs.mkdir(process.env.SPECK_HOME_SCREENSHOTS,{recursive:true});
    await page.mouse.move(0, 0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({path:`${process.env.SPECK_HOME_SCREENSHOTS}/home-${width}.png`,fullPage:true});
  }
});
