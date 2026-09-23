import { test, expect } from '@playwright/test';

async function setup(page) {
  await page.context().addCookies([{name:'speck-gallery',value:'1',url:'http://127.0.0.1:8761'}]);
  let prefs;
  await page.route('**/api/fleet/preferences', async route => {
    if (route.request().method()==='PUT') prefs=route.request().postDataJSON();
    if (!prefs) prefs=await (await route.fetch()).json();
    await route.fulfill({json:prefs});
  });
  await page.route(/\/api\/fleet(?:\?.*)?$/, async route => {
    const result=await (await route.fetch()).json();
    const endpoint={...result.machines[0],has_endpoint_agent:true,has_speck_agent:true,client_name:'Zen Clinic',location:'Cluster · Host B',state:'running',kind:'qemu',identity_evidence:['Hardware UUID'],resources:[{id:'101',name:'BYD-FRONTDESK',provider:'proxmox',kind:'qemu',connection_id:'cluster',connection_name:'Cluster',node:'Host B'}]};
    const provider={id:'provider-102',label:'Agentless VM',hostname:'Agentless VM',has_endpoint_agent:false,has_speck_agent:false,approved:null,online:true,state:'running',platform:'unknown',client_name:'Alpha Clinic',location:'Cluster · Host A',kind:'qemu',provider:'proxmox',telemetry:{},resources:[{...endpoint.resources[0],id:'102',name:'Agentless VM'}]};
    await route.fulfill({json:{machines:[endpoint,provider],connections:[]}});
  });
  await page.goto('/');
  await expect(page.locator('#fleet-rows tr')).toHaveCount(2);
}

test('all machines share fleet, clients sort, coverage filters and highlights', async ({page}) => {
  await setup(page);
  await expect(page.locator('[data-row="provider-102"] [data-select]')).toBeDisabled();
  await page.getByRole('button',{name:'Client',exact:true}).click();
  await expect(page.locator('#fleet-rows tr').first()).toHaveAttribute('data-row','provider-102');
  await page.getByRole('button',{name:'Client ↑',exact:true}).click();
  await expect(page.locator('#fleet-rows tr').first()).toHaveAttribute('data-row','frontdesk');
  await page.locator('#fleet-highlight').check();
  await expect(page.locator('[data-row="frontdesk"]')).toHaveClass(/agent-highlight/);
  await page.getByLabel('Filter Speck agent').selectOption('missing');
  await expect(page.locator('#fleet-rows tr')).toHaveCount(1);
  await expect(page.locator('#fleet-rows')).toContainText('Agentless VM');
  await page.getByLabel('Filter Speck agent').selectOption('installed');
  await expect(page.locator('#fleet-rows tr')).toHaveCount(1);
  await expect(page.locator('#fleet-rows')).toContainText('Zen Clinic');
});

test('column visibility, order, width and sorting survive reload', async ({page}) => {
  await setup(page);
  await page.getByRole('button',{name:'Columns',exact:true}).click();
  await page.locator('[data-column-toggle="app"]').uncheck();
  await page.locator('[data-column-toggle="provider"]').check();
  await page.getByLabel('Client width',{exact:true}).fill('220');
  await page.getByRole('button',{name:'Move Client up',exact:true}).click();
  await page.getByRole('button',{name:'Save columns',exact:true}).click();
  await expect(page.locator('th[data-column="app"]')).toHaveCount(0);
  await expect(page.locator('th[data-column="client"]')).toHaveCSS('width','220px');
  await page.reload();
  await expect(page.locator('th[data-column="app"]')).toHaveCount(0);
  await expect(page.locator('th[data-column="provider"]')).toHaveCount(1);
  await expect(page.locator('th[data-column]').nth(1)).toHaveAttribute('data-column','client');
});

test('provider-only and merged machines use the same drawer and provider controls', async ({page}) => {
  await setup(page);
  await page.route('**/api/infrastructure/connections/cluster/resources/qemu/102',r=>r.fulfill({json:{resource:{},configuration:{cores:2}}}));
  await page.route('**/api/infrastructure/connections/cluster/catalog?kind=qemu',r=>r.fulfill({json:{}}));
  await page.locator('[data-row="provider-102"] .machine-name').click();
  await expect(page.locator('#machine-details')).toContainText('Alpha Clinic');
  await expect(page.locator('#machine-details')).toContainText('No Speck agent');
  await expect(page.locator('#machine-details #drawer-terminal')).toHaveCount(0);
  await page.getByRole('button',{name:'proxmox · qemu 102'}).click();
  await expect(page.locator('dialog.infra-dialog').getByRole('button',{name:'Screen control'})).toBeVisible();
  await page.locator('dialog.infra-dialog .close').click();
  await page.locator('[data-row="frontdesk"] .machine-name').click();
  await expect(page.locator('#machine-details')).toContainText('Joined by Hardware UUID');
  await expect(page.locator('#drawer-terminal')).toBeVisible();
});

for (const width of [390,834,1440]) test(`custom columns fit at ${width}px`,async ({page},info)=>{
  await page.setViewportSize({width,height:960}); await setup(page);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({path:info.outputPath(`unified-${width}.png`),fullPage:true});
  await page.getByRole('button',{name:'Columns',exact:true}).click();
  expect(await page.locator('.columns-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBeTruthy();
});
