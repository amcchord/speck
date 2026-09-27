import {test,expect} from './fixtures.mjs';
async function login(page){await page.context().addCookies([{name:'speck-gallery',value:'1',url:'http://127.0.0.1:8761'}]);}
for(const width of [1440,834,390]) test(`sites, scoped client evidence and activity at ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height:1000});await login(page);const errors=[],writes=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()!=='GET')writes.push(r.url())});
 await page.goto('/#network');await expect(page.locator('.site-map')).toBeVisible();
 await expect(page.locator('.site-pin')).toHaveCount(3);
 const map=await page.locator('.map-canvas').boundingBox();for(const marker of await page.locator('.site-pin').all()){const b=await marker.boundingBox();expect(b.x).toBeGreaterThan(map.x);expect(b.y).toBeGreaterThan(map.y);expect(b.x+b.width).toBeLessThan(map.x+map.width);expect(b.y+b.height).toBeLessThan(map.y+map.height);}
 await page.screenshot({path:info.outputPath(`sites-${width}.png`),fullPage:true});
 await page.locator('[data-site-detail="1"]').click();
 let pane=page.locator('.resource-flyout');await expect(pane).toContainText('WAN & connectivity');
 await pane.getByRole('button',{name:'Explore LAN clients'}).click();
 await expect(page.locator('#net-client-site')).not.toHaveValue('');
 await expect(page.locator('#net-client-rows')).toContainText('Mbps link');
 await page.locator('[data-client-detail]').first().click();
 await expect(pane).toContainText('Switch port');await expect(pane).toContainText('Current receive rate');
 await expect(pane).toContainText('Private IP addresses can repeat across sites.');
 await expect(pane.locator('[data-network-machine]')).toHaveCount(0);
 await page.keyboard.press('Escape');if(width<=760)await page.locator('.m-filter-toggle').click();await page.locator('#net-client-link').selectOption('WIRELESS');
 await expect(page.locator('#net-client-rows')).toContainText('Front desk printer');
 await page.screenshot({path:info.outputPath(`clients-${width}.png`),fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 await page.evaluate(()=>location.hash='infrastructure');
 await expect(page.locator('.infra-landscape')).toBeVisible();
 await page.screenshot({path:info.outputPath(`estate-${width}.png`),fullPage:true});
 await page.getByRole('tab',{name:'Connections',exact:true}).click();
 await page.locator('[data-connection-detail]').first().click();await expect(pane).toContainText('Resources');await page.keyboard.press('Escape');
 await page.getByRole('tab',{name:'Activity',exact:true}).click();await page.locator('[data-receipt]').first().click();
 await expect(pane).toContainText('build-runner');await expect(pane.getByRole('button',{name:'Inspect target'})).toBeVisible();
 await page.keyboard.press('Escape');await page.evaluate(()=>location.hash='activity');
 await page.locator('[data-audit-event]').first().click();await expect(pane).toContainText('Event ID');
 expect(errors).toEqual([]);expect(writes).toEqual([]);
});

test('provider history keeps details available and offers real ranges',async({page},info)=>{
 await login(page);
 await page.route('**/api/infrastructure/connections/l1/resources/instance/9001',r=>r.fulfill({json:{resource:{id:'9001',kind:'instance',provider:'linode',name:'shop-storefront',connection_id:'l1'},configuration:{status:'running',region:'us-east',specs:{vcpus:4,memory:8192,disk:163840},ipv4:['198.51.100.40']}}}));
 await page.goto('/#infrastructure');await page.getByRole('button',{name:'shop-storefront',exact:true}).click();
 const pane=page.locator('.resource-flyout');await expect(pane.locator('.performance-card')).toHaveCount(4);
 await expect(pane).toContainText('Mbit/s');await expect(pane).toContainText('blocks/s');
 await pane.locator('[data-history]').selectOption('hour');
 await expect(pane.locator('.chart-line')).toHaveCount(4);
 await page.screenshot({path:info.outputPath('performance.png'),fullPage:true});
 await page.route('**/api/infrastructure/**/metrics?*',r=>r.fulfill({status:502,json:{detail:'offline'}}));
 await pane.locator('[data-performance-refresh]').click();await expect(pane).toContainText('Performance history is unavailable');await expect(pane).toContainText('8 GB');
});

for(const platform of ['windows','linux']) for(const width of [1440,390]) test(`embedded ${platform} terminal at ${width}px is duplex and closes with drawer`,async({page},info)=>{
 await page.setViewportSize({width,height:1000});await login(page);const inputs=[],closed=[];
 await page.route(/\/api\/fleet(?:\?.*)?$/,async route=>{const response=await route.fetch();const data=await response.json();data.machines[0].platform=platform;data.machines[0].remote_shell_available=true;await route.fulfill({json:data});});
 await page.route('**/api/devices/frontdesk/remote/sessions',r=>r.fulfill({json:{id:'embedded',protocol:'shell'}}));
 await page.route('**/api/remote/sessions/embedded',r=>{if(r.request().method()==='DELETE')closed.push(true);return r.fulfill({json:{ok:true}});});
 await page.routeWebSocket('**/api/remote/sessions/embedded/ws',ws=>{ws.onMessage(m=>inputs.push(JSON.parse(m)));ws.send(JSON.stringify({type:'ready'}));ws.send(Buffer.from('PS C:\\> '));});
 await page.goto('/#fleet');await page.locator('[data-device="frontdesk"]').first().click();await page.locator('#drawer-terminal').click();
 await expect(page.locator('.shell-embedded')).toBeVisible();await expect(page.locator('#shell-status')).toHaveText('Connected');
 await page.locator('.xterm-helper-textarea').pressSequentially('pwd');await page.locator('.xterm-helper-textarea').press('Enter');
 await expect.poll(()=>inputs.filter(i=>i.type==='input').map(i=>i.data).join('')).toContain('pwd\r');
 await page.screenshot({path:info.outputPath('embedded-'+platform+'-'+width+'.png'),fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 await page.locator('.xterm-helper-textarea').press('Escape');await expect(page.locator('#machine-details')).toBeVisible();
 await page.locator('#machine-details .close').first().click();await expect.poll(()=>closed.length).toBe(1);
 await expect(page.locator('.shell-embedded')).toHaveCount(0);
});

 test('site map remains useful when tiles fail and other network data is slow',async({page})=>{
 await login(page);
 await page.route('https://tile.openstreetmap.org/**',r=>r.abort());
 let release;const gate=new Promise(resolve=>release=resolve);
 await page.route('**/api/dns/status',async r=>{await gate;await r.continue();});
 await page.goto('/#network',{waitUntil:'domcontentloaded'});
 await expect(page.locator('.site-pin')).toHaveCount(3);
 await expect(page.locator('[data-map-note]')).toContainText('Base map unavailable');
 await page.getByRole('button',{name:'Inspect Main office',exact:true}).click();
 await expect(page.locator('.resource-flyout')).toContainText('WAN & connectivity');
 release();
 });
