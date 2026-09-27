import {test,expect} from './fixtures.mjs';

async function signIn(page){
  await page.context().addCookies([{name:'speck-gallery',value:'1',url:'http://127.0.0.1:8761'}]);
  await page.route('**/api/auth/me',r=>r.fulfill({json:{username:'demo',csrf:'preview-only',role:'admin'}}));
}
test('Home remains useful while network waits and command search preserves its workspace',async({page})=>{
  await signIn(page);let release;const gate=new Promise(r=>release=r);
  await page.route('**/api/network/map',async route=>{await gate;await route.fulfill({json:{machines:[],ips:{}}});});
  await page.goto('/#home');await expect(page.locator('#home-query')).toBeVisible();
  await expect(page.locator('[data-home-machine]').first()).toBeVisible();
  await page.locator('#home-query').fill('frontdesk');release();
  await expect(page.locator('#home-query')).toHaveValue('frontdesk');
  await page.goto('/#fleet');await page.locator('#fleet-search').fill('frontdesk');
  await page.keyboard.press('Control+k');const palette=page.getByRole('dialog',{name:'Find in Speck'});
  await expect(palette).toBeVisible();await palette.locator('input').fill('frontdesk');
  await expect(palette.getByRole('option').first()).toContainText('BYD-FRONTDESK');
  await palette.locator('input').press('Enter');await expect(page.locator('#machine-details')).toContainText('BYD-FRONTDESK');
  await expect(page.locator('#fleet-search')).toHaveValue('frontdesk');
  const copied=page.url();await page.reload();await expect(page.locator('#machine-details')).toContainText('BYD-FRONTDESK');expect(page.url()).toBe(copied);
});

for(const width of [1440,390])test(`read-only file and process workbenches at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:1000});await signIn(page);const writes=[];
  await page.route('**/api/devices/frontdesk/inspections',r=>r.fulfill({json:[{kind:'processes',job_id:'inspect-1',collected:Date.now()/1000,report:{rows:[{pid:42,name:'Example worker',memory_bytes:1024,cpu_seconds:10}],scope:'Windows test report',limit:250}}]}));
  await page.route('**/api/devices/frontdesk/jobs',r=>{writes.push(r.request().postDataJSON());return r.fulfill({json:{id:'files-1'}});});
  await page.route('**/api/jobs/files-1',r=>r.fulfill({json:{id:'files-1',status:'complete',result:{path:'C:\\ProgramData',entries:[{name:'Example',path:'C:\\ProgramData\\Example',directory:true,size:0,modified:'2026-09-27T12:00:00Z'},{name:'notes.txt',path:'C:\\ProgramData\\notes.txt',directory:false,size:40,modified:'2026-09-27T12:00:00Z'}]}}}));
  await page.goto('/#fleet');await page.locator('[data-device="frontdesk"]').first().click();
  await page.locator('[data-tab="inventory"]').click();await expect(page.locator('[data-inspection-report]')).toContainText('Example worker');
  await page.locator('[data-inspection-row]').click();await expect(page.getByRole('dialog',{name:'Example worker'})).toContainText('Lifetime CPU time');await page.getByRole('dialog',{name:'Example worker'}).getByRole('button',{name:'Close',exact:true}).click();
  await page.locator('[data-tab="files"]').click();expect(writes).toHaveLength(0);await page.locator('#browse').click();
  await expect(page.locator('[data-file-list]')).toContainText('notes.txt');expect(writes).toEqual([{kind:'files.list',payload:{path:'C:\\ProgramData'},timeout:60}]);
  await expect(page.locator('[data-file-crumbs]')).toContainText('ProgramData');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

test('DNS record inspection separates cached configuration and explicit resolution',async({page})=>{
  await signIn(page);let checks=0;
  await page.route('**/api/dns/domains/example.test/records?cached=true',r=>r.fulfill({json:{fetched_at:Date.now()/1000,records:[{type:'CNAME',name:'www',data:'origin.example.test',ttl:600},{type:'A',name:'origin',data:'192.0.2.20',ttl:600}]}}));
  await page.route('**/api/dns/domains/example.test/record-history?*',r=>r.fulfill({json:[]}));
  await page.route('**/api/dns/domains/example.test/resolve',r=>{checks++;return r.fulfill({json:{outcome:'resolved',addresses:['192.0.2.20'],checked_at:Date.now()/1000,duration_ms:10}});});
  const ref=encodeURIComponent(JSON.stringify({kind:'dns-record',id:'www',connection:'example.test',resourceKind:'CNAME'}));
  await page.goto('/#network?inspect='+ref);const pane=page.getByRole('dialog',{name:'www.example.test'});
  await expect(pane).toContainText('origin.example.test');await expect(pane).toContainText('Cached provider configuration');expect(checks).toBe(0);
  await pane.getByRole('button',{name:'Resolve from Speck server'}).click();await expect(pane.locator('[data-record-resolution]')).toContainText('resolved');expect(checks).toBe(1);
});
