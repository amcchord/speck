import {test,expect} from './fixtures.mjs';
test.setTimeout(30000);
const inspect=ref=>'#fleet?inspect='+encodeURIComponent(JSON.stringify(ref));
async function login(page){
 await page.context().addCookies([{name:'speck-gallery',value:'1',url:'http://127.0.0.1:8761'}]);
 await page.route('**/api/auth/me',r=>r.fulfill({json:{username:'demo',csrf:'preview-only',role:'admin'}}));
}
async function fleet(page){
 await page.route('**/api/fleet?*',async r=>{
  const response=await r.fetch(),data=await response.json();
  const m=data.machines.find(m=>m.id==='frontdesk');
  m.clients=[{key:'customer/one',name:'Example customer'}];m.client_name='Example customer';
  const resource={id:'pve-1',name:'pve-1',node:'pve-1',connection_id:'c1',connection_name:'Example cluster',provider:'proxmox',kind:'node',status:'online'};
  m.resources=[{...resource,id:'101',kind:'qemu',name:m.label,client:m.clients[0]}];m.resource=m.resources[0];m.location='Example cluster · pve-1';
  data.machines.push({id:'host-one',label:'pve-1',hostname:'pve-1',kind:'node',provider:'proxmox',resources:[resource],resource,has_endpoint_agent:false,has_speck_agent:true,clients:[],platform:'linux',state:'online'});
  await r.fulfill({json:data});
 });
}
for(const width of [1440,390])test(`client, machine, hypervisor and IP use shared navigation at ${width}px`,async({page},info)=>{
 await login(page);await fleet(page);await page.setViewportSize({width,height:1000});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/#fleet');
 const row=page.locator('tr[data-row="frontdesk"]');
 await row.locator('[data-entity-kind="client"]').click();
 let pane=page.locator('dialog.device-drawer[open]');
 await expect(pane).toContainText('Customer · Client membership');await expect(pane).toContainText('BYD-FRONTDESK');
 await pane.locator('[data-entity-kind="machine"]').first().click();
 await expect(page.locator('#machine-details')).toContainText('BYD-FRONTDESK');
 if(width<600)await page.locator('#machine-more').click();
 await page.locator('#machine-details .machine-inventory [data-entity-kind="machine"]').click();
 await expect(page.locator('#machine-details')).toHaveAttribute('aria-label','Machine details: pve-1');
 await page.goBack();await expect(page.locator('#machine-details')).toContainText('BYD-FRONTDESK');
 if(width<600 && await page.locator('#machine-more').getAttribute('aria-expanded')==='false')await page.locator('#machine-more').click();
 const ip=page.locator('#machine-details .machine-address a');await expect(ip).toBeVisible();await ip.click();
 pane=page.locator('dialog.device-drawer[open]');await expect(pane).toContainText('IP address');await expect(pane).toContainText('Reporting machines');
 await page.reload();await expect(page.locator('dialog.device-drawer[open]')).toContainText('Reporting machines');
 await page.screenshot({path:info.outputPath(`ip-${width}.png`),fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);expect(errors).toEqual([]);
});

test('LAN client links preserve site, VLAN and selected equipment port',async({page},info)=>{
 await login(page);const ref={kind:'lan-client',id:'02:00:00:00:20:01',connection:'console-1',site:'site-1'};
 const c={name:'Example workstation',mac:ref.id,console_id:ref.connection,site_id:ref.site,network_name:'Office & staff',vlan:0,ip:'192.0.2.30',uplink_id:'switch-1',uplink_name:'Office switch',port:4,state:'online',type:'WIRED'};
 await page.route('**/api/unifi/sites/console-1/site-1/clients',r=>r.fulfill({json:{clients:[c]}}));
 await page.goto('/#network?inspect='+encodeURIComponent(JSON.stringify(ref)));
 let pane=page.locator('dialog.device-drawer[open]');await expect(pane).toContainText(c.name);
 await pane.locator('[data-entity-kind="network"]').first().click();await expect(pane).toContainText('Observed membership');
 await expect(pane).toContainText(c.name);await page.reload();await expect(pane).toContainText(c.name);
 await pane.locator('[data-entity-kind="port"]').first().click();await expect(pane.locator('[data-port="4"]')).toHaveAttribute('aria-pressed','true');
 await page.reload();await expect(pane.locator('[data-port="4"]')).toHaveAttribute('aria-pressed','true');
 await page.goBack();await expect(pane).toContainText('Observed membership');
 await page.screenshot({path:info.outputPath('network.png'),fullPage:true});
});

test('scoped IP keeps repeated private addresses in different sites separate',async({page})=>{
 await login(page);
 const clients=[{name:'Local system',ip:'10.0.0.10',mac:'00:01',console_id:'c',site_id:'s'},{name:'Other site system',ip:'10.0.0.10',mac:'00:02',console_id:'c',site_id:'elsewhere'}];
 await page.route('**/api/unifi/sites/c/s/clients',r=>r.fulfill({json:{clients}}));
 await page.route('**/api/network/map',r=>r.fulfill({json:{machines:clients.map((c,i)=>({id:'m'+i,label:c.name,lan:[{ip:c.ip}],network_clients:[c]})),ips:{}}}));
 await page.goto(inspect({kind:'ip',id:'10.0.0.10',connection:'c',site:'s'}));
 const pane=page.locator('dialog.device-drawer[open]');await expect(pane).toContainText('Local system');await expect(pane).not.toContainText('Other site system');
});

test('duplicate hostnames offer a choice and late lookup failures keep Retry',async({page})=>{
 await login(page);
 await page.route('**/api/fleet?*',r=>r.fulfill({json:{machines:[{id:'one',label:'DUPLICATE',platform:'windows',location:'Site A'},{id:'two',label:'DUPLICATE',platform:'linux',location:'Site B'}],connections:[]}}));
 await page.goto(inspect({kind:'entity-lookup',id:'DUPLICATE'}));const pane=page.locator('dialog.device-drawer[open]');
 await expect(pane.locator('[data-entity-kind="machine"]')).toHaveCount(2);await expect(pane).toContainText('Site A');await expect(pane).toContainText('Site B');
 await page.route('**/api/unifi/sites/c/s/clients',r=>r.fulfill({status:503,json:{detail:'Provider unavailable'}}));
 await page.goto(inspect({kind:'network',id:'Office',connection:'c',site:'s'}));await expect(pane.getByRole('button',{name:'Try again'})).toBeVisible();
});

test('viewer IP inspection avoids privileged network requests',async({page})=>{
 await login(page);await page.route('**/api/auth/me',r=>r.fulfill({json:{username:'viewer',csrf:'preview-only',role:'viewer'}}));
 const reads=[];page.on('request',r=>{if(/\/api\/(network|unifi)/.test(r.url()))reads.push(r.url());});
 await page.goto(inspect({kind:'ip',id:'192.0.2.10'}));
 await expect(page.locator('dialog.device-drawer[open]')).toContainText('LAN observations require network access');expect(reads).toEqual([]);
});

test('structured names link safely while commands, credentials and edits stay untouched',async({page})=>{
 await login(page);
 await page.route('**/api/fleet?*',async r=>{const response=await r.fetch(),data=await response.json();data.machines.find(m=>m.id==='frontdesk').hostname='ENTITY-UNIQUE';await r.fulfill({json:data});});
 await page.goto('/#fleet');await expect(page.locator('[data-device="frontdesk"]').first()).toBeVisible();
 await page.evaluate(()=>{
  const sample=document.createElement('section');sample.id='entity-test-facts';sample.innerHTML='<dl><dt>Hostname</dt><dd>ENTITY-UNIQUE</dd><dt>Script</dt><dd><code>ENTITY-UNIQUE</code></dd><dt>Secret</dt><dd class="keys-secret">ENTITY-UNIQUE</dd><dt>Edit</dt><dd contenteditable>ENTITY-UNIQUE</dd></dl>';
  document.querySelector('#content').append(sample);
 });
 await expect(page.locator('#entity-test-facts a[data-entity-kind="machine"]')).toHaveCount(1);
 await expect(page.locator('#entity-test-facts code a,#entity-test-facts .keys-secret a,#entity-test-facts [contenteditable] a')).toHaveCount(0);
 await page.locator('#entity-test-facts a').focus();await page.keyboard.press('Enter');await expect(page.locator('#machine-details')).toContainText('BYD-FRONTDESK');
 await page.locator('#machine-details').getByRole('button',{name:'← Back',exact:true}).click();await expect(page.locator('#machine-details')).toHaveCount(0);
});

test('a late machine response cannot replace the next inspector',async({page})=>{
 await login(page);let release,waiting=false;
 const gate=new Promise(r=>release=r);
 await page.goto('/#network');
 await page.route('**/api/fleet?compact=true',async r=>{waiting=true;await gate;const response=await r.fetch();await r.fulfill({response});});
 await page.evaluate(hash=>{location.hash=hash},'#network?inspect='+encodeURIComponent(JSON.stringify({kind:'machine',id:'frontdesk'})));
 await expect.poll(()=>waiting).toBe(true);
 await page.evaluate(hash=>{location.hash=hash},'#network?inspect='+encodeURIComponent(JSON.stringify({kind:'equipment',id:'switch-1',connection:'console-1',site:'site-1'})));
 await expect(page.locator('[data-port="4"]')).toBeVisible();release();
 await expect.poll(()=>page.locator('#machine-details').count()).toBe(0);
 await expect(page.locator('dialog.device-drawer[open] .dialog-head')).toContainText('Office switch');
});

test('a missing physical port does not silently select another port',async({page})=>{
 await login(page);
 await page.goto('/#network?inspect='+encodeURIComponent(JSON.stringify({kind:'equipment',id:'switch-1',connection:'console-1',site:'site-1',tab:'ports:99'})));
 const pane=page.locator('dialog.device-drawer[open]');await expect(pane).toContainText('Port 99 is not reported');await expect(pane.locator('[data-port][aria-pressed="true"]')).toHaveCount(0);
 await pane.locator('[data-port="4"]').click();await expect(pane.locator('[data-port="4"]')).toHaveAttribute('aria-pressed','true');
});
