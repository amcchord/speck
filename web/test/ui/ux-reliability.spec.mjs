import {test,expect} from './fixtures.mjs';
async function signIn(page){await page.context().addCookies([{name:'speck-gallery',value:'1',url:'http://127.0.0.1:8761'}]);}
for(const width of [1440,390,320]) test(`customer context and new workspaces remain usable at ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height:960});await signIn(page);await page.goto('/#workspaces');
 await page.getByRole('link',{name:'Example customer',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Pinned resources',exact:true})).toBeVisible();
 await page.getByRole('link',{name:'BYD-FRONTDESK →',exact:true}).click();await expect(page.locator('#machine-details')).toBeVisible();
 expect(page.url()).toContain('workspace=example-workspace');await page.reload();await expect(page.locator('#machine-details')).toBeVisible();
 await page.locator('#machine-details .close').click();await expect(page).not.toHaveURL(/inspect=/);
 await page.getByRole('button',{name:'Review associations',exact:true}).click();
 await page.getByRole('searchbox',{name:'Search resource associations',exact:true}).fill('frontdesk');
 await expect(page.locator('[data-association-list] .association-row:visible')).toHaveCount(2);
 await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 await page.screenshot({path:info.outputPath('customer-'+width+'.png'),fullPage:true});
 await page.goto('/#maintenance');await expect(page.locator('[data-routine]')).toHaveCount(4);await page.locator('[data-routine="inspection.software"]').click();
 await expect(page.locator('#schedule-operation')).toHaveValue('inspection.software');await expect(page.locator('#schedule-policy')).toHaveValue('eligible');
 expect(await page.getByRole('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBeTruthy();
 await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();await page.goto('/#quality');await expect(page.locator('#content')).toContainText('≤ 200 ms');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});
test('workspace exact associations require explicit confirmation and persist on reload',async({page})=>{
 await signIn(page);let saved=null;
 await page.route('**/api/workspaces',route=>{if(route.request().method()==='POST'){saved=route.request().postDataJSON();return route.fulfill({json:{id:'reviewed',revision:1}});}return route.fulfill({json:saved?[{...saved,id:'reviewed',revision:1,updated:Date.now()/1000}]:[]});});
 await page.goto('/#workspaces');await page.getByRole('button',{name:'Create customer / site workspace'}).click();expect(saved).toBeNull();
 await page.getByLabel('Customer / site name').fill('Reviewed example');await page.locator('[data-association="0"]').check();await page.locator('[data-pin="0"]').check();expect(saved).toBeNull();
 await page.getByRole('button',{name:'Confirm reviewed associations'}).click();await expect(page.getByRole('link',{name:'Reviewed example',exact:true})).toBeVisible();expect(saved.confirmed).toBe(true);expect(saved.associations).toHaveLength(1);
 await page.reload();await expect(page.getByRole('heading',{name:'Pinned resources'})).toBeVisible();
});
test('return navigation preserves customer context without implying global lists are scoped',async({page})=>{
 await signIn(page);await page.goto('/#workspaces?workspace=example-workspace');await page.locator('aside [data-page="fleet"]').click();await expect(page).toHaveURL(/workspace=example-workspace/);await expect(page.locator('.workspace-context')).toContainText('global inventory');
 await page.getByRole('link',{name:'Return to customer workspace →'}).click();await expect(page.getByRole('heading',{name:'Pinned resources'})).toBeVisible();
});
test('coverage source failure retains useful protected-system inventory',async({page})=>{
 await signIn(page);await page.route('**/api/slide/connection',r=>r.fulfill({json:{connected:true}}));await page.route('**/api/slide/coverage*',r=>r.fulfill({status:503,json:{detail:'Provider unavailable'}}));await page.goto('/#slide');
 await expect(page.locator('#backup-coverage')).toContainText('Coverage unavailable');await expect(page.locator('[data-coverage-agent]').first()).toBeVisible();await page.locator('[data-coverage-agent]').first().click();await expect(page.locator('.resource-flyout')).toContainText('Backup agent version');
});
test('equipment filter survives reload and distinguishes unknown from offline',async({page})=>{
 await signIn(page);await page.route('**/api/unifi/sites/console-1/site-1/devices',r=>r.fulfill({json:{devices:[{id:'offline',name:'Offline switch',state:'OFFLINE',features:['switching'],interfaces:{}},{id:'unknown',name:'Unreported switch',state:'UNKNOWN',features:['switching'],interfaces:{}}]}}));
 const ref=encodeURIComponent(JSON.stringify({kind:'equipment-list',id:'site-1',connection:'console-1',tab:'offline:all'}));await page.goto('/#network?inspect='+ref);
 await expect(page.locator('[data-equipment-status]')).toHaveValue('offline');await expect(page.locator('[data-equipment-list]')).toContainText('Offline switch');await expect(page.locator('[data-equipment-list]')).not.toContainText('Unreported switch');
 await page.reload();await expect(page.locator('[data-equipment-status]')).toHaveValue('offline');await page.locator('[data-equipment-status]').selectOption('unknown');await expect(page.locator('[data-equipment-list]')).toContainText('Unreported switch');
});
