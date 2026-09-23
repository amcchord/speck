import { test, expect } from '@playwright/test';

async function setup(page, {wide=false, viewer=false}={}) {
  await page.context().addCookies([{name:'speck-gallery',value:'1',url:'http://127.0.0.1:8761'}]);
  let prefs;
  const saved=[];
  await page.route('**/api/fleet/preferences',async route=>{
    if (!prefs) {
      prefs=await (await route.fetch()).json();
      if(!wide) prefs.visible=['name','status','client','cpu','memory','location'];
    }
    if(route.request().method()==='PUT') {prefs=route.request().postDataJSON();saved.push(structuredClone(prefs));}
    await route.fulfill({json:prefs});
  });
  if(viewer) await page.route('**/api/auth/me',async route=>{
    const me=await(await route.fetch()).json();await route.fulfill({json:{...me,role:'viewer'}});
  });
  await page.route(/\/api\/fleet(?:\?.*)?$/,async route=>{
    const data=await(await route.fetch()).json(), original=data.machines[0];
    const machines=[['alpha','Alpha', 'Zen Clinic',12,'windows','running'],['beta','Beta','Alpha Clinic',65,'linux','offline'],['gamma','Gamma','North Clinic',32,'windows','running']].map(([id,label,client_name,cpu,platform,state])=>({...original,id,label,hostname:label,client_name,platform,state,online:state==='running',has_endpoint_agent:true,has_speck_agent:id!=='beta',telemetry:{...original.telemetry,cpu_percent:cpu}}));
    await route.fulfill({json:{machines,connections:[]}});
  });
  await page.goto('/');await expect(page.locator('#fleet-rows tr')).toHaveCount(3);
  return {saved,getPrefs:()=>prefs};
}
const keys=page=>page.locator('th[data-column]').evaluateAll(items=>items.map(el=>el.dataset.column));
async function drag(page,from,to,after=false) {
  const start=await page.locator(`[data-sort-column="${from}"]`).boundingBox();
  const end=await page.locator(`th[data-column="${to}"]`).boundingBox();
  await page.mouse.move(start.x+start.width/2,start.y+start.height/2);await page.mouse.down();
  await page.mouse.move(end.x+(after?end.width-3:3),end.y+end.height/2,{steps:8});
  await expect(page.locator('.fleet-header-drag')).toBeVisible();await page.mouse.up();
}
for(const width of [1440,390,320]) test(`compact toolbar, filter chips and View at ${width}px`,async({page},info)=>{
  await page.setViewportSize({width,height:800});await setup(page);
  await expect(page.locator('.fleet-toolbar > button')).toHaveCount(2);
  await expect(page.locator('#fleet-filters-panel')).toBeHidden();
  await expect(page.locator('#fleet-sort')).toBeHidden();
  await page.screenshot({path:info.outputPath(`toolbar-${width}.png`),fullPage:true});
  await page.getByRole('button',{name:'Filters',exact:true}).click();
  await page.getByLabel('Filter status',{exact:true}).selectOption('offline');
  await page.getByLabel('Filter operating system').selectOption('linux');
  await expect(page.locator('#fleet-rows tr')).toHaveCount(1);
  await expect(page.locator('#fleet-filter-count')).toHaveText('2');
  const popup=await page.locator('#fleet-filters-panel').boundingBox();
  expect(popup.x).toBeGreaterThanOrEqual(0);expect(popup.x+popup.width).toBeLessThanOrEqual(width);
  await page.screenshot({path:info.outputPath(`filters-${width}.png`),fullPage:true});
  await page.keyboard.press('Escape');await expect(page.locator('#fleet-filters-panel')).toBeHidden();
  await page.getByRole('button',{name:'Remove Offline filter',exact:true}).click();
  await page.getByRole('button',{name:'Remove Linux filter',exact:true}).click();
  await expect(page.locator('#fleet-rows tr')).toHaveCount(3);
  await expect(page.locator('#fleet-filter-chips')).toBeHidden();
  await page.getByRole('button',{name:'View',exact:true}).click();
  await page.getByLabel('Sort machines').selectOption('cpu');
  await expect(page.locator('#fleet-rows tr').first()).toHaveAttribute('data-row','beta');
  await page.getByLabel('Sort direction').selectOption('asc');
  await expect(page.locator('#fleet-rows tr').first()).toHaveAttribute('data-row','alpha');
  await page.getByLabel('Highlight agents',{exact:true}).check();
  await expect(page.locator('[data-row="alpha"]')).toHaveClass(/agent-highlight/);
  await page.getByLabel('Screen previews',{exact:true}).check();
  await expect(page.locator('#fleet-view-panel')).toBeVisible();
  await page.screenshot({path:info.outputPath(`view-${width}.png`),fullPage:true});
  await page.getByRole('button',{name:'Columns',exact:true}).click();
  await expect(page.locator('.columns-dialog')).toBeVisible();
  await expect(page.locator('#fleet-view-panel')).toBeHidden();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(page.getByRole('button',{name:'View',exact:true})).toBeFocused();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

test('header clicks and Enter sort both directions and persist',async({page})=>{
  const state=await setup(page);
  const client=page.locator('[data-sort-column="client"]');
  await client.click();await expect(page.locator('#fleet-rows tr').first()).toHaveAttribute('data-row','beta');
  await expect(page.locator('th[data-column="client"]')).toHaveAttribute('aria-sort','ascending');
  await client.press('Enter');await expect(page.locator('#fleet-rows tr').first()).toHaveAttribute('data-row','alpha');
  await expect(page.locator('th[data-column="client"]')).toHaveAttribute('aria-sort','descending');
  await expect.poll(()=>state.getPrefs().direction).toBe('desc');
  await page.reload();await expect(page.locator('th[data-column="client"]')).toHaveAttribute('aria-sort','descending');
});

test('header dragging moves cells, preserves hidden slots and selection, and saves',async({page},info)=>{
  await page.setViewportSize({width:1440,height:960});const state=await setup(page);
  const original=[...state.getPrefs().order];
  await page.locator('[data-row="alpha"] [data-select]').check();
  await page.getByLabel('Search devices').fill('a');
  await drag(page,'client','name');
  await expect.poll(()=>keys(page)).toEqual(['client','name','status','location','cpu','memory']);
  await expect(page.locator('#fleet-rows tr').first().locator('[data-column]').first()).toHaveAttribute('data-column','client');
  await expect(page.locator('th[data-column="name"]')).toHaveAttribute('aria-sort','ascending');
  await expect(page.locator('[data-row="alpha"] [data-select]')).toBeChecked();
  await expect(page.getByLabel('Search devices')).toHaveValue('a');
  await drag(page,'client','memory',true);
  await expect.poll(()=>keys(page)).toEqual(['name','status','location','cpu','memory','client']);
  await expect.poll(()=>state.saved.length).toBe(2);
  expect(state.getPrefs().order.indexOf('agent')).toBe(original.indexOf('agent'));
  await page.reload();await expect.poll(()=>keys(page)).toEqual(['name','status','location','cpu','memory','client']);
  await page.screenshot({path:info.outputPath('headers-reordered.png'),fullPage:true});
});

test('keyboard reorder and Escape cancellation do not change sorting',async({page})=>{
  await page.setViewportSize({width:1440,height:960});const state=await setup(page);
  const button=page.locator('[data-sort-column="client"]');await button.focus();await button.press('Alt+ArrowLeft');
  await expect.poll(()=>keys(page)).toEqual(['name','client','status','location','cpu','memory']);
  await expect(button).toBeFocused();
  await expect(page.locator('#fleet-column-status')).toContainText('position 2');
  const start=await button.boundingBox(),end=await page.locator('[data-sort-column="memory"]').boundingBox();
  await page.mouse.move(start.x+20,start.y+20);await page.mouse.down();await page.mouse.move(end.x+20,end.y+20,{steps:8});
  await page.keyboard.press('Escape');await page.mouse.up();
  await expect(page.locator('.fleet-header-drag')).toHaveCount(0);
  await expect.poll(()=>keys(page)).toEqual(['name','client','status','location','cpu','memory']);
  await expect(page.locator('th[data-column="name"]')).toHaveAttribute('aria-sort','ascending');
  expect(state.saved).toHaveLength(1);
});

test('header drag scrolls horizontally and navigation cancels safely',async({page})=>{
  await page.setViewportSize({width:1000,height:800});await setup(page,{wide:true});
  const wrap=page.locator('.fleet-table-wrap'),bounds=await wrap.boundingBox();
  const start=await page.locator('[data-sort-column="status"]').boundingBox();
  await page.mouse.move(start.x+20,start.y+20);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width-3,start.y+20,{steps:8});
  await expect.poll(()=>wrap.evaluate(el=>el.scrollLeft+el.clientWidth>=el.scrollWidth-1)).toBeTruthy();
  await page.mouse.up();
  await expect(page.locator('th[data-column]').last()).toHaveAttribute('data-column','status');
  await expect(page.locator('th[data-column="name"]')).toHaveAttribute('aria-sort','ascending');
  const last=await page.locator('[data-sort-column="status"]').boundingBox();
  await page.mouse.move(last.x+20,last.y+20);await page.mouse.down();await page.mouse.move(last.x-80,last.y+20,{steps:5});
  await page.evaluate(()=>location.hash='#alerts');
  await expect(page.locator('.fleet-header-drag')).toHaveCount(0);await page.mouse.up();
});

test('viewer has sorting and columns but no preview toggle',async({page})=>{
  await setup(page,{viewer:true});await page.getByRole('button',{name:'View',exact:true}).click();
  await expect(page.locator('#fleet-previews')).toHaveCount(0);
  await expect(page.getByLabel('Sort machines')).toBeVisible();
  await expect(page.getByRole('button',{name:'Columns',exact:true})).toBeVisible();
});

test('visible Speck agents only switch persists across reloads and navigation',async({page})=>{
  const state=await setup(page);
  const toggle=page.getByRole('switch',{name:'Speck agents only',exact:true});
  await expect(toggle).toBeVisible();await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(page.locator('#fleet-rows tr')).toHaveCount(2);
  await expect(page.locator('#fleet-filter-chips')).toBeHidden();
  await expect.poll(()=>state.getPrefs().agent_filter).toBe('installed');
  await page.reload();
  await expect(toggle).toBeChecked();await expect(page.locator('#fleet-rows tr')).toHaveCount(2);
  await page.locator('[data-page="alerts"]').click();await page.locator('[data-page="fleet"]').click();
  await expect(toggle).toBeChecked();await expect(page.locator('#fleet-rows tr')).toHaveCount(2);
  await page.getByRole('button',{name:'Filters',exact:true}).click();
  await page.getByLabel('Filter Speck agent').selectOption('missing');
  await expect(toggle).not.toBeChecked();await expect(page.locator('#fleet-rows tr')).toHaveCount(1);
  await page.keyboard.press('Escape');await toggle.check();await toggle.uncheck();
  await expect.poll(()=>state.getPrefs().agent_filter).toBe('all');
  await page.reload();await expect(toggle).not.toBeChecked();await expect(page.locator('#fleet-rows tr')).toHaveCount(3);
});
