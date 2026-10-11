import {test,expect} from './fixtures.mjs';
const signin=page=>page.context().addCookies([{name:'speck-gallery',value:'1',url:'http://127.0.0.1:8761'}]);
const schema={paths:{'/api/whoami':{get:{summary:'Current API identity'}}}};
const open=async page=>{await signin(page);await page.goto('/#api');await expect(page.locator('#api-new-token')).toBeVisible();};

test('searching a pending schema retains loading and tokens',async({page})=>{
 let release;const pending=new Promise(r=>release=r);
 await page.route('**/api/openapi.json',async route=>{await pending;await route.fulfill({json:schema});});
 await open(page);await expect(page.locator('#api-endpoints')).toContainText('Loading schema');
 await page.locator('#api-endpoint-q').fill('whoami');
 await expect(page.locator('#api-endpoints')).toContainText('Loading schema');
 await expect(page.locator('#api-endpoints')).not.toContainText('unavailable');
 release();await expect(page.locator('.api-endpoint')).toContainText('/api/whoami');
});
for(const invalid of ['http','shape'])test(`schema ${invalid} failure retains tokens and retries`,async({page})=>{
 let fail=true;
 await page.route('**/api/openapi.json',route=>route.fulfill(fail?(invalid==='http'?{status:503,json:{detail:'Unavailable'}}:{json:{detail:'Invalid schema'}}):{json:schema}));
 await open(page);await expect(page.getByRole('button',{name:'Retry schema'})).toBeVisible();
 await expect(page.locator('#api-endpoints')).toContainText(invalid==='http'?'HTTP 503':'incomplete');
 await expect(page.locator('#api-tokens')).toBeVisible();fail=false;
 await page.getByRole('button',{name:'Retry schema'}).click();
 await expect(page.locator('.api-endpoint')).toContainText('/api/whoami');
});
test('endpoint empty search clears and refocuses the search',async({page})=>{
 await page.route('**/api/openapi.json',r=>r.fulfill({json:schema}));await open(page);
 await expect(page.locator('.api-endpoint')).toHaveCount(1);await page.locator('#api-endpoint-q').fill('no-such-route');
 await page.getByRole('button',{name:'Clear search'}).click();await expect(page.locator('#api-endpoint-q')).toBeFocused();
 await expect(page.locator('.api-endpoint')).toHaveCount(1);
});
test('Try explains network failure, releases the button and retries',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));let fail=true;
 await page.route('**/api/openapi.json',r=>r.fulfill({json:schema}));
 await page.route('**/api/whoami',r=>fail?r.abort():r.fulfill({status:403,json:{detail:'Forbidden'}}));
 await open(page);await page.locator('.api-group summary').click();await page.getByRole('button',{name:'Try',exact:true}).click();
 await expect(page.locator('.api-request-error')).toContainText('Could not read');
 await expect(page.getByRole('button',{name:'Try',exact:true})).toBeEnabled();fail=false;
 await page.getByRole('button',{name:'Try',exact:true}).click();await expect(page.locator('dialog[open]')).toContainText('HTTP 403');
 await expect(page.locator('.api-request-error')).toHaveCount(0);expect(errors).toEqual([]);
});
test('late endpoint response cannot open a dialog after navigating away',async({page})=>{
 let release,started;const pending=new Promise(r=>release=r),request=new Promise(r=>started=r);
 await page.route('**/api/openapi.json',r=>r.fulfill({json:schema}));
 await page.route('**/api/whoami',async r=>{started();await pending;await r.fulfill({json:{role:'admin'}});});
 await open(page);await page.locator('.api-group summary').click();await page.getByRole('button',{name:'Try',exact:true}).click();await request;
 await expect(page.getByRole('button',{name:'Reading…'})).toBeDisabled();
 await page.evaluate(()=>location.hash='fleet');await expect(page.locator('h1')).toHaveText('Fleet');release();
 await page.waitForTimeout(300);await expect(page.locator('dialog[open]')).toHaveCount(0);
});
for(const width of [834,1024])test(`tablet headers separate status from controls at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:1000});await signin(page);
 for(const route of ['patches','home','fleet','infrastructure']){
  await page.goto('/#'+route);await expect(page.locator('#content')).not.toHaveAttribute('aria-busy','true');
  const title=await page.locator('h1').boundingBox(),actions=await page.locator('.header-actions').boundingBox(),summary=await page.locator('.fleet-summary').boundingBox();
  expect(title.height).toBeLessThan(85);expect(title.width).toBeGreaterThan(170);
  if(summary?.height){expect(summary.y).toBeGreaterThanOrEqual(Math.max(title.y+title.height,actions.y+actions.height)-1);expect(summary.width).toBeGreaterThan(650);}
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 }
});
