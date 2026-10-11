import {test,expect} from './fixtures.mjs';
import {mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const evidence=fileURLToPath(new URL('../../../output/ui-ux-polish/network/',import.meta.url));
mkdirSync(evidence,{recursive:true});
async function login(page){await page.context().addCookies([{name:'speck-gallery',value:'1',url:test.info().project.use.baseURL || 'http://127.0.0.1:8761'}]);}
async function capture(page,label,width){await page.screenshot({path:`${evidence}/after-${label}-${width}-${test.info().project.name}.png`});}

for(const width of [1440,834,390,320])test(`network and infrastructure polished drill-down at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:960});await login(page);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/#infrastructure');await expect(page.locator('.infra-result-bar')).toContainText('10 of 10 resources');
  await capture(page,'infrastructure',width);
  await page.getByRole('tab',{name:'Connections',exact:true}).click();await capture(page,'connections',width);
  await page.getByRole('button',{name:'Example cloud',exact:true}).click();
  await page.getByRole('button',{name:'Browse resources',exact:true}).click();
  await expect(page.locator('#infra-tab-resources')).toHaveAttribute('aria-selected','true');
  await expect(page.locator('[data-infra-scope="l1"]')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.infra-result-bar')).toContainText('2 of 10 resources');
  const scope=await page.locator('[data-infra-scope="l1"]').boundingBox(),strip=await page.locator('.infra-scope-list').boundingBox();
  expect(scope.x).toBeGreaterThanOrEqual(strip.x-1);expect(scope.x+scope.width).toBeLessThanOrEqual(strip.x+strip.width+1);
  await capture(page,'cloud-scope',width);
  await page.getByRole('button',{name:'Clear filters',exact:true}).click();
  await expect(page.locator('.infra-result-bar')).toContainText('10 of 10 resources');
  await expect.poll(()=>page.locator('.infra-scope-list').evaluate(el=>el.scrollLeft)).toBe(0);
  await page.getByRole('button',{name:'shop-storefront',exact:true}).click();
  const pane=page.locator('.resource-flyout');
  await expect(pane.locator('[data-provider-section="disks"] [data-provider-row]')).toHaveCount(1);
  await capture(page,'cloud',width);
  await pane.getByRole('searchbox',{name:'Search instance disks',exact:true}).fill('no matching attachment');
  await expect(pane.locator('[data-provider-section="disks"]')).toContainText('No loaded records match');
  await capture(page,'attachment-search',width);
  await pane.getByRole('searchbox',{name:'Search instance disks',exact:true}).fill('');
  await pane.getByRole('button',{name:/Production boot/}).click();
  await pane.locator('[data-boot-id="11"]').click();await expect(pane).toContainText('Allocated capacity');
  await capture(page,'disk',width);
  await page.keyboard.press('Escape');
  await page.goto('/#network');await expect(page.locator('[data-site-detail]')).toHaveCount(4);
  await expect(page.getByText('Connected sites',{exact:true})).toBeVisible();
  await capture(page,'sites',width);
  await page.getByRole('button',{name:'Inspect Main office',exact:true}).click();await capture(page,'site-detail',width);
  await page.getByRole('button',{name:'Explore network equipment',exact:true}).click();
  await pane.getByRole('searchbox',{name:'Find equipment',exact:true}).fill('Office switch');
  await pane.locator('[data-equipment]').click();await expect(pane.locator('[data-port]')).toHaveCount(24);
  const first=pane.locator('[data-port="1"]');await first.focus();await first.press('ArrowRight');
  await expect(pane.locator('[data-port="2"]')).toBeFocused();await expect(pane.locator('[data-port="2"]')).toHaveAttribute('aria-pressed','true');
  await pane.locator('[data-port="2"]').press('End');await expect(pane.locator('[data-port="24"]')).toBeFocused();
  if(width<=400){const box=await pane.locator('[data-port="24"]').boundingBox();expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);}
  await pane.locator('.resource-body').evaluate(el=>el.scrollTop=0);await capture(page,'ports',width);
  await pane.getByRole('button',{name:'View port details',exact:false}).click();await expect(pane.locator('.port-detail')).toBeFocused();
  await capture(page,'port-detail',width);
  await pane.getByRole('button',{name:'← Equipment inventory',exact:true}).click();
  await expect(pane.getByRole('searchbox',{name:'Find equipment',exact:true})).toHaveValue('Office switch');await expect(pane.locator('[data-equipment]')).toHaveCount(1);
  await pane.getByRole('searchbox',{name:'Find equipment',exact:true}).fill('missing');await pane.getByRole('button',{name:'Clear filters',exact:true}).click();await expect(pane.locator('[data-equipment]')).toHaveCount(2);
  await capture(page,'equipment',width);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  expect(errors).toEqual([]);
});

test('optional connector failure preserves inventory and can retry',async({page})=>{
  await login(page);let fail=true;
  await page.route('**/api/infrastructure/connectors',route=>fail?route.fulfill({status:503,json:{detail:'Connector status unavailable'}}):route.continue());
  await page.goto('/#infrastructure');await expect(page.locator('.infra-result-bar')).toContainText('10 of 10 resources');
  await expect(page.getByText('Host connector status could not be refreshed.',{exact:false})).toBeVisible();
  await capture(page,'connector-error',1440);fail=false;await page.getByRole('button',{name:'Retry connector status',exact:true}).click();
  await expect(page.getByRole('button',{name:'Retry connector status',exact:true})).toHaveCount(0);
});

test('late Activity failure cannot replace the selected resource workspace',async({page})=>{
  await login(page);let release;const gate=new Promise(resolve=>release=resolve);
  await page.route('**/api/infrastructure/operations',async route=>{await gate;await route.fulfill({status:503,json:{detail:'Receipt store unavailable'}});});
  await page.goto('/#infrastructure');await page.getByRole('tab',{name:'Activity',exact:true}).click();
  await expect(page.locator('#infra-body')).toContainText('Loading infrastructure activity');
  await page.getByRole('tab',{name:/Resources/}).click();release();
  await expect(page.locator('.infra-landscape')).toBeVisible();await expect(page.locator('#infra-tab-resources')).toHaveAttribute('aria-selected','true');
  await page.getByRole('tab',{name:'Activity',exact:true}).click();await expect(page.getByRole('heading',{name:'Activity unavailable',exact:true})).toBeVisible();
  await capture(page,'activity-error',1440);
});

test('site errors retry without fabricated zero health and console errors stay scoped',async({page})=>{
  await login(page);let fail=true;
  await page.route('**/api/unifi/sites',route=>fail?route.fulfill({status:503,json:{detail:'Provider unavailable'}}):route.continue());
  await page.goto('/#network');await expect(page.getByRole('heading',{name:'Site health unavailable',exact:true})).toBeVisible();
  await expect(page.locator('.net-insights')).toHaveCount(0);await capture(page,'site-error',1440);
  fail=false;await page.getByRole('button',{name:'Try again',exact:true}).click();await expect(page.locator('[data-site-detail]')).toHaveCount(4);
  let release;const gate=new Promise(resolve=>release=resolve);
  await page.route('**/api/unifi/consoles',async route=>{await gate;await route.fulfill({status:503,json:{detail:'Console unavailable'}});});
  await page.getByRole('tab',{name:'UniFi consoles',exact:true}).click();await page.getByRole('tab',{name:'Sites & health',exact:true}).click();release();
  await expect(page.locator('[data-site-detail]')).toHaveCount(4);await expect(page.getByRole('heading',{name:'Consoles unavailable',exact:true})).toHaveCount(0);
});

test('empty console and LAN client filters have useful recovery actions',async({page})=>{
  await page.setViewportSize({width:320,height:960});await login(page);
  await page.route('**/api/unifi/consoles',r=>r.fulfill({json:[]}));
  await page.goto('/#network?view=consoles');await expect(page.getByRole('heading',{name:'No UniFi consoles reported',exact:true})).toBeVisible();await capture(page,'console-empty',320);
  await page.getByRole('tab',{name:'LAN clients',exact:true}).click();
  await page.getByRole('searchbox',{name:'Search',exact:true}).fill('no matching client');await expect(page.getByRole('heading',{name:'No matching clients',exact:true})).toBeVisible();await capture(page,'client-empty',320);
  await page.getByRole('button',{name:'Show all clients',exact:true}).click();await expect(page.locator('[data-client-detail]')).toHaveCount(5);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});
