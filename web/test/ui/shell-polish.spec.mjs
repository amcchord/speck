import {test,expect} from './fixtures.mjs';

const signin=async page=>page.context().addCookies([{name:'speck-gallery',value:'1',url:'http://127.0.0.1:8761'}]);
for(const width of [390,320]){
 test(`phone headers keep titles and controls readable with partial sources at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});await signin(page);
  for(const route of ['home','slide','workspaces']){
   await page.goto('/#'+route);
   await expect(page.locator('#content')).not.toHaveAttribute('aria-busy','true');
   const h=await page.locator('h1').boundingBox(),search=await page.locator('#workspace-search').boundingBox();
   expect(h.width).toBeGreaterThanOrEqual(110);expect(h.height).toBeLessThan(100);
   expect(Math.abs(search.y-h.y)).toBeLessThan(40);
   const freshness=await page.locator('#page-freshness').boundingBox();
   if(freshness?.height)expect(freshness.y).toBeGreaterThanOrEqual(h.y+h.height);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
 });
 test(`machine sticky tabs follow a wrapped identity header at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:700});await signin(page);
  await page.goto('/#fleet');
  await page.locator('[data-device="frontdesk"]').first().click();
  const pane=page.locator('dialog.device-drawer');
  await expect(pane.locator('[data-tab="network"]')).toBeVisible();
  await pane.locator('[data-tab="network"]').click();
  await pane.evaluate(el=>el.scrollTop=650);
  await expect.poll(()=>pane.evaluate(el=>Math.round(parseFloat(el.style.getPropertyValue('--pane-head'))))).toBeGreaterThan(50);
  const head=await pane.locator('.dialog-head').boundingBox(),tabs=await pane.locator('.tabs').boundingBox();
  expect(tabs.y).toBeGreaterThanOrEqual(head.y+head.height-1);
  await expect(pane.locator('[data-tab="network"]')).toHaveAttribute('aria-pressed','true');
 });
}

test('settings preserve independent sections when optional sources fail and recover',async({page})=>{
 await signin(page);let fail=true;
 for(const path of ['slide/connection','agent-updates','integrations/tokens'])await page.route('**/api/'+path,async route=>{
  if(fail)return route.fulfill({status:503,json:{detail:'Temporary provider outage'}});
  return route.continue();
 });
 await page.goto('/#settings');
 await expect(page.getByRole('button',{name:'Manage access'})).toBeVisible();
 await expect(page.locator('#remote-client')).toBeVisible();
 await expect(page.locator('#save-slide')).toBeDisabled();
 await expect(page.locator('.settings-error')).toHaveCount(2);
 await page.getByRole('button',{name:'Endpoint agent policy',exact:true}).click();
 await expect(page.getByRole('button',{name:'Endpoint agent policy',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('#enrollment')).toBeVisible();
 await page.getByRole('button',{name:'All settings',exact:true}).click();
 fail=false;
 await page.getByRole('button',{name:'Retry connection'}).click();
 await expect(page.locator('.settings-error')).toHaveCount(0);
 await expect(page.locator('#save-slide')).toBeEnabled();
 await expect(page.getByLabel('Automatically update agents')).toBeVisible();
});
