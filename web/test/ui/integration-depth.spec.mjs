import {test,expect} from './fixtures.mjs';
async function login(page){await page.context().addCookies([{name:'speck-gallery',value:'1',url:'http://127.0.0.1:8761'}]);}
for(const width of [1440,834,390])test(`equipment relationships and reviewed PoE at ${width}px`,async({page},info)=>{
 await page.setViewportSize({width,height:1000});await login(page);
 const errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()!=='GET')writes.push(r.url())});
 await page.goto('/#network');await page.getByRole('button',{name:'Inspect Main office',exact:true}).click();
 await page.getByRole('button',{name:'Explore network equipment',exact:true}).click();
 let pane=page.locator('.resource-flyout');await expect(pane).toContainText('Office switch');
 await pane.getByPlaceholder('Name, address, MAC or model').fill('192.0.2.2');await expect(pane.locator('[data-equipment]')).toHaveCount(1);
 await pane.locator('[data-equipment]').click();await expect(pane.locator('[data-port]')).toHaveCount(24);
 await pane.getByRole('button',{name:'Port 4, UP, PoE on',exact:true}).click();
 await expect(pane.locator('.port-detail')).toContainText('6.2 W');await expect(pane.locator('.port-detail')).toContainText('Lobby access point');
 await page.screenshot({path:info.outputPath(`switch-${width}.png`),fullPage:true});
 await pane.locator('[data-hop="ap-1"]').click();await expect(pane.locator('.dialog-head')).toContainText('Lobby access point');
 await pane.getByRole('tab',{name:'Clients',exact:true}).click();await expect(pane).toContainText('Guest laptop');
 await pane.getByRole('tab',{name:'Health',exact:true}).click();await expect(pane).toContainText('802.11ax');
 await pane.getByRole('tab',{name:'Equipment',exact:true}).click();await pane.locator('[data-hop="switch-1"]').click();
 await pane.getByRole('button',{name:'Port 4, UP, PoE on',exact:true}).click();
 await page.route('**/api/unifi/sites/*/*/devices/*/review',route=>route.fulfill({json:{id:'review-one',target:'Office switch',model:'USW Pro',mac:'02:00:00:00:10:01',port:4,clients:[{name:'Guest laptop',ip:'192.0.2.32'}],devices:[{name:'Lobby access point'}],expires_at:Date.now()/1000+120,warning:'Known connections only. Other equipment may lose connectivity.'}}));
 await pane.getByRole('button',{name:'Review PoE power cycle'}).click();const review=page.getByRole('dialog',{name:'Review PoE power cycle',exact:true});
 await expect(review).toContainText('Guest laptop');await expect(review.getByRole('button',{name:'Confirm PoE cycle'})).toBeDisabled();
 await review.getByRole('textbox',{name:'Confirm device name'}).fill('wrong');await expect(review.getByRole('button',{name:'Confirm PoE cycle'})).toBeDisabled();
 await review.getByRole('textbox',{name:'Confirm device name'}).fill('Office switch');await expect(review.getByRole('button',{name:'Confirm PoE cycle'})).toBeEnabled();
 await page.screenshot({path:info.outputPath(`review-${width}.png`),fullPage:true});
 await review.getByRole('button',{name:'Cancel',exact:true}).click();
 expect(writes).toHaveLength(1);expect(writes[0]).toMatch(/\/review$/);expect(errors).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
});

test('machine uplink uses scoped MAC evidence and repeat equipment navigation is cached',async({page})=>{
 await login(page);let reads=0;
 await page.route('**/api/network/map',async route=>{const response=await route.fetch();const data=await response.json();data.machines.push({id:'frontdesk',label:'Reception',lan:[{ip:'192.0.2.24'}],dns:[],public:[],network_clients:[{console_id:'console-1',site_id:'site-1',uplink_id:'switch-1',uplink_name:'Office switch',port:5}]});await route.fulfill({json:data});});
 page.on('request',r=>{if(r.url().endsWith('/devices/switch-1'))reads++});
 await page.goto('/#fleet');await page.locator('[data-device="frontdesk"]').first().click();await page.locator('[data-machine-uplink]').click();
 const pane=page.locator('.resource-flyout');await expect(pane.locator('[data-port="5"]')).toHaveAttribute('aria-pressed','true');
 await pane.getByRole('tab',{name:'Equipment',exact:true}).click();await pane.locator('[data-hop="ap-1"]').click();await pane.getByRole('tab',{name:'Equipment',exact:true}).click();await pane.locator('[data-hop="switch-1"]').click();
 await expect(pane.locator('[data-port]')).toHaveCount(24);expect(reads).toBe(1);
});

test('Linode attachments open detailed flyouts with linked boot devices',async({page},info)=>{
 await login(page);await page.goto('/#infrastructure');await page.getByRole('button',{name:'shop-storefront',exact:true}).click();
 const pane=page.locator('.resource-flyout');await expect(pane).toContainText('Instance disks');
 await pane.getByRole('button',{name:/Production boot/}).click();await expect(pane).toContainText('linode/grub2');await pane.locator('[data-boot-id="11"]').click();await expect(pane).toContainText('Allocated capacity');await expect(pane).toContainText('ext4');
 await page.screenshot({path:info.outputPath('cloud-disk.png'),fullPage:true});
});

test('submitted network operations display durable receipt without claiming recovery',async({page})=>{
 await login(page);let writes=0;
 await page.route('**/api/unifi/sites/*/*/devices/*/review',r=>r.fulfill({json:{id:'once',target:'Office switch',clients:[],devices:[],warning:'Connections may be interrupted.',expires_at:Date.now()/1000+120}}));
 await page.route('**/api/unifi/operations/once/execute',r=>{writes++;return r.fulfill({json:{id:'once',status:'submitted',result:{message:'UniFi accepted the request. Refresh device observations to check the outcome.'}}})});
 await page.goto('/#network');await page.getByRole('button',{name:'Inspect Main office',exact:true}).click();await page.getByRole('button',{name:'Explore network equipment'}).click();await page.locator('[data-equipment]').filter({hasText:'Office switch'}).click();
 await page.getByRole('button',{name:'Review device restart'}).click();const review=page.getByRole('dialog',{name:'Review device restart',exact:true});await review.getByRole('textbox',{name:'Confirm device name'}).fill('Office switch');await review.getByRole('button',{name:'Confirm restart',exact:true}).click();
 await expect(review).toContainText('submitted: UniFi accepted');await expect(review.getByRole('button',{name:'Confirm restart',exact:true})).toHaveCount(0);expect(writes).toBe(1);
});

test('Slide protection history and snapshots keep provider context',async({page})=>{
 await login(page);await page.goto('/#slide');await page.locator('[data-slide-detail]').first().click();
 const pane=page.locator('.resource-flyout');await expect(pane).toContainText('Backup jobs');
 await pane.locator('[data-provider-section="snapshot"] [data-provider-row]').first().click();
 await expect(pane).toContainText('Filesystem verification');await expect(pane).toContainText('passed');await expect(pane).toContainText('Slide (Settings)');
});

test('device observations survive optional telemetry loss and late responses',async({page})=>{
 await login(page);await page.route('**/api/unifi/sites/*/*/devices/switch-1',async r=>{const response=await r.fetch();const data=await response.json();data.statistics=null;data.clients_available=false;data.clients=[];await r.fulfill({json:data});});
 await page.goto('/#network');await page.getByRole('button',{name:'Inspect Main office',exact:true}).click();await page.getByRole('button',{name:'Explore network equipment'}).click();await page.locator('[data-equipment]').filter({hasText:'Office switch'}).click();
 const pane=page.locator('.resource-flyout');await expect(pane).toContainText('Client observations are unavailable');await expect(pane.locator('[data-port]')).toHaveCount(24);await expect(pane).toContainText('Device statistics are unavailable');
});

test('Proxmox host storage, bridges and activity are inspectable',async({page})=>{
 await login(page);
 const host={id:'node-a',name:'Test hypervisor',node:'node-a',kind:'node',provider:'proxmox',connection_id:'c1',connection_name:'Example cluster',status:'online'};
 await page.route('**/api/infrastructure/inventory',r=>r.fulfill({json:{connections:[{id:'c1',name:'Example cluster',provider:'proxmox',status:'connected',resources:[host]}]}}));
 await page.route('**/api/infrastructure/connections/c1/resources/node/node-a',r=>r.fulfill({json:{resource:host,status:{memory:{total:68719476736,used:1000000000}},storage:[{storage:'local-zfs',type:'zfspool',content:'images,rootdir',total:1000000000000,used:1000000000,active:1,enabled:1,shared:0}],network:[{iface:'vmbr0',type:'bridge',cidr:'192.0.2.10/24',bridge_ports:'eno1',active:1}],recent_tasks:[{type:'vzdump',id:'101',user:'demo@pam',status:'OK',upid:'UPID:node-a:demo',starttime:1790532000,endtime:1790532015}]}}));
 await page.goto('/#infrastructure');await page.getByRole('button',{name:'Test hypervisor',exact:true}).click();let pane=page.locator('.resource-flyout');
 await pane.locator('[data-host-detail="storage"]').click();await expect(pane).toContainText('images,rootdir');await pane.getByRole('button',{name:'← Back to host'}).click();
 await pane.locator('[data-host-detail="network"]').click();await expect(pane).toContainText('Bridge ports');await expect(pane).toContainText('eno1');await pane.getByRole('button',{name:'← Back to host'}).click();
 await pane.locator('[data-host-detail="recent_tasks"]').click();await expect(pane).toContainText('UPID:node-a:demo');await expect(pane).toContainText('demo@pam');
});
