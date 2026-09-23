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

async function openColumns(page) {
  if (!await page.locator('#fleet-view-panel').isVisible()) await page.getByRole('button',{name:'View',exact:true}).click();
  await page.getByRole('button',{name:'Columns',exact:true}).click();
}

test('all machines share fleet, clients sort, coverage filters and highlights', async ({page}) => {
  await setup(page);
  await expect(page.locator('[data-row="provider-102"] [data-select]')).toBeDisabled();
  await page.getByRole('button',{name:'Client',exact:true}).click();
  await expect(page.locator('#fleet-rows tr').first()).toHaveAttribute('data-row','provider-102');
  await page.getByRole('button',{name:'Client',exact:true}).click();
  await expect(page.locator('#fleet-rows tr').first()).toHaveAttribute('data-row','frontdesk');
  await page.getByRole('button',{name:'View',exact:true}).click();
  await page.locator('#fleet-highlight').check();
  await expect(page.locator('[data-row="frontdesk"]')).toHaveClass(/agent-highlight/);
  await page.getByRole('button',{name:'Filters',exact:true}).click();
  await page.getByLabel('Filter Speck agent').selectOption('missing');
  await expect(page.locator('#fleet-rows tr')).toHaveCount(1);
  await expect(page.locator('#fleet-rows')).toContainText('Agentless VM');
  await page.getByLabel('Filter Speck agent').selectOption('installed');
  await expect(page.locator('#fleet-rows tr')).toHaveCount(1);
  await expect(page.locator('#fleet-rows')).toContainText('Zen Clinic');
});

test('column visibility, order, width and sorting survive reload', async ({page}) => {
  await setup(page);
  await openColumns(page);
  await page.locator('[data-column-toggle="app"]').uncheck();
  await page.locator('[data-column-toggle="provider"]').check();
  await page.getByLabel('Adjust widths').check();
  await page.getByLabel('Client width',{exact:true}).fill('220');
  await page.getByRole('button',{name:'Reorder Client',exact:true}).focus();
  await page.keyboard.press('ArrowUp');
  await page.getByRole('button',{name:'Save columns',exact:true}).click();
  await expect(page.locator('th[data-column="app"]')).toHaveCount(0);
  await expect(page.locator('th[data-column="client"]')).toHaveCSS('width','220px');
  await page.reload();
  await expect(page.locator('th[data-column="app"]')).toHaveCount(0);
  await expect(page.locator('th[data-column="provider"]')).toHaveCount(1);
  await expect(page.locator('th[data-column]').nth(1)).toHaveAttribute('data-column','client');
});

test('provider-only and merged machines use the same drawer and provider controls', async ({page}, info) => {
  await setup(page);
  await page.route('**/api/infrastructure/connections/cluster/resources/qemu/102',r=>r.fulfill({json:{resource:{},configuration:{cores:2}}}));
  await page.route('**/api/infrastructure/connections/cluster/catalog?kind=qemu',r=>r.fulfill({json:{}}));
  await page.locator('[data-row="provider-102"] .machine-name').click();
  await expect(page.locator('#machine-details')).toContainText('Alpha Clinic');
  await expect(page.locator('#machine-details')).toContainText('No Speck agent');
  await expect(page.locator('#machine-details #drawer-terminal')).toHaveCount(0);
  const heading = await page.locator('#machine-details .dialog-head h2').boundingBox();
  const client = await page.locator('.machine-inventory dl').boundingBox();
  expect(Math.abs(heading.x - client.x)).toBeLessThan(1);
  await page.getByRole('button',{name:'proxmox · qemu 102'}).click();
  await expect(page.getByRole('button',{name:'Open provider console'})).toBeVisible();
  await page.locator('dialog.infra-dialog .close').click();
  await page.locator('[data-row="frontdesk"] .machine-name').click();
  await expect(page.locator('#machine-details')).toContainText('Joined by Hardware UUID');
  await expect(page.locator('#drawer-terminal')).toBeVisible();
  const providerButton = await page.locator('[data-machine-resource]').boundingBox();
  const facts = await page.locator('.machine-facts').boundingBox();
  expect(Math.abs(providerButton.x - facts.x)).toBeLessThan(1);
  await page.screenshot({path:info.outputPath('machine-flyout.png')});
});

for (const width of [320,390,834,1440]) test(`custom columns fit at ${width}px`,async ({page},info)=>{
  const height = width <= 390 ? 640 : 960;
  await page.setViewportSize({width,height}); await setup(page);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({path:info.outputPath(`unified-${width}.png`),fullPage:true});
  await openColumns(page);
  expect(await page.locator('.columns-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBeTruthy();
  for (const widths of [false, true]) {
    await page.getByLabel('Adjust widths').setChecked(widths);
    expect(await page.locator('.columns-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBeTruthy();
    const save = await page.getByRole('button',{name:'Save columns',exact:true}).boundingBox();
    expect(save.y + save.height).toBeLessThan(height);
    await page.locator('.columns-list').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expect(page.locator('[data-column-toggle="preview"]')).toBeInViewport();
    await expect(page.getByRole('button',{name:'Save columns',exact:true})).toBeInViewport();
    await page.locator('.columns-list').evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({path:info.outputPath(`columns-${width}${widths ? '-widths' : ''}.png`)});
  }
});

async function dragColumn(page, key, targetKey, after = false) {
  const handle = page.locator(`[data-column-handle="${key}"]`);
  await handle.scrollIntoViewIfNeeded();
  const start = await handle.boundingBox();
  const end = await page.locator(`[data-column-key="${targetKey}"]`).boundingBox();
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2, end.y + (after ? end.height - 4 : 4), {steps: 8});
  await expect(page.locator('.column-drag-preview')).toBeVisible();
  await page.mouse.up();
}

test('drag handles reorder upward and downward, save, and retain the required machine column', async ({page}) => {
  await setup(page);
  await openColumns(page);
  await expect(page.locator('[data-column-toggle="name"]')).toBeDisabled();
  await dragColumn(page, 'location', 'status');
  await expect(page.locator('[data-column-key]').nth(1)).toHaveAttribute('data-column-key', 'location');
  await expect(page.getByRole('button',{name:'Reorder Location / host',exact:true})).toBeFocused();
  await expect(page.locator('.columns-announcement')).toContainText('position 2');
  await dragColumn(page, 'location', 'app', true);
  await expect(page.locator('[data-column-key]').nth(5)).toHaveAttribute('data-column-key', 'location');
  await page.getByRole('button',{name:'Save columns',exact:true}).click();
  await expect(page.getByRole('button',{name:'View',exact:true})).toBeFocused();
  await page.reload();
  await expect(page.locator('th[data-column]').nth(5)).toHaveAttribute('data-column', 'location');
});

test('drag autoscroll reaches the end of a short viewport and Escape cancels a drag', async ({page}) => {
  await page.setViewportSize({width:390,height:640});
  await setup(page);
  await openColumns(page);
  const handle = await page.locator('[data-column-handle="status"]').boundingBox();
  const list = await page.locator('.columns-list').boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, list.y + list.height - 2, {steps:8});
  await expect.poll(() => page.locator('.columns-list').evaluate(el => el.scrollTop + el.clientHeight >= el.scrollHeight - 1)).toBeTruthy();
  await page.mouse.up();
  await expect(page.locator('[data-column-key]').last()).toHaveAttribute('data-column-key', 'status');
  const last = await page.locator('[data-column-handle="status"]').boundingBox();
  await page.mouse.move(last.x + 12, last.y + 12);
  await page.mouse.down();
  await page.mouse.move(last.x + 12, last.y - 60, {steps:4});
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('.columns-dialog')).toBeVisible();
  await expect(page.locator('.column-drag-preview')).toHaveCount(0);
  await expect(page.locator('[data-column-key]').last()).toHaveAttribute('data-column-key', 'status');
});

test('cancel discards drafts; reset restores only columns and widths', async ({page}) => {
  await setup(page);
  await page.getByRole('button',{name:'Client',exact:true}).click();
  await page.getByRole('button',{name:'View',exact:true}).click();
  await page.locator('#fleet-highlight').check();
  await openColumns(page);
  await page.locator('[data-column-toggle="app"]').uncheck();
  await page.getByRole('button',{name:'Reorder Client',exact:true}).focus();
  await page.keyboard.press('Home');
  await expect(page.locator('[data-column-key]').first()).toHaveAttribute('data-column-key', 'client');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(page.locator('th[data-column="app"]')).toHaveCount(1);
  await expect(page.locator('th[data-column]').first()).toHaveAttribute('data-column', 'name');
  await openColumns(page);
  await page.getByLabel('Adjust widths').check();
  await page.getByLabel('Client width',{exact:true}).fill('400');
  await page.getByRole('button',{name:'Reset defaults',exact:true}).click();
  await expect(page.getByLabel('Client width',{exact:true})).toHaveValue('170');
  await page.getByRole('button',{name:'Save columns',exact:true}).click();
  await expect(page.locator('th[data-column="client"]')).toHaveAttribute('aria-sort','ascending');
  await expect(page.locator('#fleet-highlight')).toBeChecked();
});

test('touch dragging uses the handle while the list remains scrollable', async ({browser, browserName, baseURL}) => {
  test.skip(browserName !== 'chromium', 'Real touch gestures use the Chromium input protocol.');
  const context = await browser.newContext({viewport:{width:390,height:640},hasTouch:true,baseURL});
  try {
    const page = await context.newPage();
    await setup(page);
    await openColumns(page);
    const input = await context.newCDPSession(page);
    const handle = await page.locator('[data-column-handle="client"]').boundingBox();
    const target = await page.locator('[data-column-key="name"]').boundingBox();
    const x = handle.x + handle.width / 2;
    const y = handle.y + handle.height / 2;
    await input.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for (let step=1; step<=8; step++) await input.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+(target.y+4-y)*step/8}]});
    await expect(page.locator('.column-drag-preview')).toBeVisible();
    await input.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await expect(page.locator('[data-column-key]').first()).toHaveAttribute('data-column-key','client');
    const list = await page.locator('.columns-list').boundingBox();
    await input.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:250,y:list.y+list.height-30}]});
    for (let step=1; step<=8; step++) await input.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:250,y:list.y+list.height-30-step*18}]});
    await input.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await expect.poll(() => page.locator('.columns-list').evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
    await expect(page.locator('.column-drag-preview')).toHaveCount(0);
  } finally { await context.close(); }
});
