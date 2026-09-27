import {test,expect} from './fixtures.mjs';

const cloud={id:'101',kind:'instance',name:'Example cloud',provider:'linode',connection_id:'cloud',connection_name:'Example account',node:'us-east',status:'running',management:'provider_only',addresses:['192.0.2.50']};
const host={id:'pve-1',kind:'node',name:'pve-1',provider:'proxmox',connection_id:'cluster',connection_name:'Example cluster',node:'pve-1',status:'online',management:'host_agent',max_memory:68719476736};
const guest={...host,id:'102',kind:'qemu',name:'Example guest',status:'running',management:'provider_only'};
const detail={resource:cloud,configuration:{label:'Example cloud',status:'running',region:'us-east',type:'g6-dedicated-16',ipv4:['192.0.2.50'],ipv6:'2001:db8::50',specs:{memory:32768,disk:655360,vcpus:16,transfer:7000},backups:{enabled:true,last_successful:'2026-09-27T03:00:00',schedule:{day:'Monday',window:'W2'}},image:'linode/ubuntu24.04',watchdog_enabled:true,disk_encryption:'enabled'},backups:{automatic:[{id:'b1',status:'successful',created:'2026-09-27T03:00:00Z',type:'daily'}]}};
async function setup(page,{delay=0}={}) {
  const counts={inventory:0,detail:0,writes:0};
  await page.context().addCookies([{name:'speck-gallery',value:'1',url:'http://127.0.0.1:8761'}]);
  await page.route('**/api/infrastructure/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    if(request.method()!=='GET') { counts.writes++; return route.fulfill({json:{status:'submitted',result:{id:'test'}}}); }
    if(path.endsWith('/inventory')) { counts.inventory++; if(delay)await new Promise(r=>setTimeout(r,delay));return route.fulfill({json:{connections:[{id:'cloud',name:'Example account',provider:'linode',status:'connected',resources:[cloud]},{id:'cluster',name:'Example cluster',provider:'proxmox',status:'connected',resources:[host,guest]}],checked_at:1790120000}}); }
    if(path.endsWith('/connectors'))return route.fulfill({json:[]});
    if(path.endsWith('/catalog'))return route.fulfill({json:{reboot:{label:'Reboot',method:'POST',danger:true,fields:[]},delete:{label:'Delete instance',method:'DELETE',danger:true,fields:[]}}});
    if(path.endsWith('/explore'))return route.fulfill({json:{sections:{},checked_at:1790120000}});
    if(path.endsWith('/metrics'))return route.fulfill({json:{series:[]}});
    if(path.includes('/resources/')) { counts.detail++; if(delay)await new Promise(r=>setTimeout(r,delay));return route.fulfill({json:path.endsWith('pve-1') ? {resource:host,status:{cpu:0.04,memory:{total:68719476736,used:34359738368},cpuinfo:{cpus:16,model:'Example CPU'},uptime:86400},storage:[{storage:'local-zfs',total:1099511627776,used:536870912000,active:1,type:'zfspool'}],network:[{iface:'vmbr0',cidr:'192.0.2.10/24',type:'bridge',bridge_ports:'eno1'}]} : detail}); }
    return route.fulfill({json:[]});
  });
  await page.route('**/api/slide/inventory?*',route=>{
    const kind=new URL(route.request().url()).searchParams.get('resource');
    return route.fulfill({json:kind==='device' ? [{device_id:'d1',display_name:'Example appliance',hardware_model_name:'Slide 400',serial_number:'DEMO-001',storage_total_bytes:1099511627776,storage_used_bytes:536870912000,status:'online'}] : kind==='snapshot' ? [{snapshot_id:'s1',name:'Morning recovery point',agent_id:'a1',device_id:'d1',status:'complete',verify_boot_status:'passed',size_bytes:2147483648,created_at:'2026-09-27T03:00:00Z'}] : [{agent_id:'a1',device_id:'d1',display_name:'Example protected host',hostname:'demo-host',os:'linux',os_version:'24.04',agent_version:'1.2.8',last_backup:'2026-09-27T03:00:00Z',addresses:[{ips:['192.0.2.24'],mac:'02:00:00:00:00:01'}]}]});
  });
  return counts;
}
for(const width of [1440,834,390]) test(`cloud, host and Slide details share a readable flyout at ${width}px`,async({page},info)=>{
  await page.setViewportSize({width,height:1000});const counts=await setup(page);
  await page.goto('/#infrastructure');
  const open=page.getByRole('button',{name:'Example cloud',exact:true});
  await open.click();
  const pane=page.locator('dialog.resource-flyout');
  await expect(pane).toHaveCount(1);await expect(pane).toContainText('32 GB');await expect(pane).toContainText('640 GB');
  await expect(pane.getByRole('heading',{name:'Backup protection'})).toBeVisible();
  await expect(pane.locator('.resource-technical')).not.toHaveAttribute('open','');
  await expect(pane.getByRole('button',{name:'Delete instance',exact:true})).toBeHidden();
  await pane.getByRole('button',{name:'Reboot',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Reboot',exact:true}).getByLabel('Type Example cloud to confirm')).toBeVisible();
  await page.keyboard.press('Escape');await expect(pane).toBeVisible();expect(counts.writes).toBe(0);
  await pane.evaluate(el=>el.querySelector('.resource-body').scrollTo(0,0));
  expect(await pane.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath(`cloud-${width}.png`),fullPage:true});
  await page.keyboard.press('Escape');await expect(pane).toHaveCount(0);await expect(open).toBeFocused();
  await page.getByRole('button',{name:'pve-1',exact:true}).click();
  await expect(pane).toContainText('64 GB');await expect(pane).toContainText('Example guest');await expect(pane).toContainText('local-zfs');
  await page.keyboard.press('Escape');
  await page.evaluate(()=>location.hash='slide');await page.locator('[data-slide-detail]').first().click();
  await expect(pane).toContainText('Backup agent version');await expect(pane).toContainText('192.0.2.24');await expect(pane.locator('pre')).toHaveCount(0);
  await pane.locator('[data-slide-related="device"]').click();await expect(pane).toHaveCount(1);await expect(pane).toContainText('Example appliance');await expect(pane).toContainText('1 TB');
  await expect(pane.locator('[data-slide-protected]')).toContainText('Example protected host');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({path:info.outputPath(`slide-${width}.png`),fullPage:true});
  await page.keyboard.press('Escape');
  await page.getByLabel('Slide resource type').selectOption('snapshot');await page.locator('[data-slide-detail]').first().click();
  await expect(pane).toContainText('Boot verification');await expect(pane).toContainText('passed');
});

test('repeat navigation and reopening details are immediate while providers are slow',async({page})=>{
  const counts=await setup(page,{delay:1600});
  await page.goto('/#infrastructure');await page.getByRole('button',{name:'Example cloud',exact:true}).click();
  await expect(page.locator('.resource-flyout h2')).toContainText('Example cloud',{timeout:500});
  await expect(page.locator('.resource-flyout')).toContainText('32 GB');await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Example cloud',exact:true}).click();
  await expect(page.locator('.resource-flyout')).toContainText('32 GB',{timeout:700});expect(counts.detail).toBe(1);
  await page.keyboard.press('Escape');
  await page.evaluate(()=>location.hash='home');await expect(page.locator('.home-workspace')).toBeVisible();
  await page.evaluate(()=>location.hash='infrastructure');await expect(page.getByRole('button',{name:'Example cloud',exact:true})).toBeVisible({timeout:700});expect(counts.inventory).toBe(1);
  // Explicit refresh must reach the source again.
  await page.getByRole('button',{name:'Refresh',exact:true}).click();await expect(page.getByRole('button',{name:'Example cloud',exact:true})).toBeVisible();expect(counts.inventory).toBe(2);
});

test('stale reads render promptly, expose a failed background refresh and preserve available data',async({page})=>{
  await setup(page);await page.goto('/#infrastructure');await expect(page.getByRole('button',{name:'Example cloud',exact:true})).toBeVisible();
  await page.clock.setFixedTime(new Date(Date.now()+35000));
  await page.route('**/api/infrastructure/inventory',async route=>{await new Promise(r=>setTimeout(r,900));await route.fulfill({status:503,json:{detail:'Unavailable'}});});
  await page.evaluate(()=>location.hash='home');await expect(page.locator('.home-workspace')).toBeVisible();
  await page.evaluate(()=>location.hash='infrastructure');await expect(page.getByRole('button',{name:'Example cloud',exact:true})).toBeVisible({timeout:700});
  await expect(page.locator('#page-freshness')).toContainText('refresh failed');await expect(page.getByRole('button',{name:'Example cloud',exact:true})).toBeVisible();
});

test('late provider details cannot replace a different flyout',async({page})=>{
  await setup(page,{delay:1000});await page.goto('/#infrastructure');
  await page.getByRole('button',{name:'Example cloud',exact:true}).click();await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'pve-1',exact:true}).click();
  await expect(page.locator('.resource-flyout')).toContainText('64 GB');await expect(page.locator('.resource-flyout h2')).toContainText('pve-1');
  await expect(page.locator('.resource-flyout')).not.toContainText('Cloud instance');
});

test('network objects use the same inspector without performing mapping changes',async({page})=>{
  await setup(page);
  await page.route('**/api/unifi/pool',r=>r.fulfill({json:{gateway_name:'Example gateway',pool:[{ip:'203.0.113.20',status:'assigned',assigned_to:'Demo mapping',lan_ip:'192.0.2.24'}]}}));
  await page.route('**/api/unifi/clients',r=>r.fulfill({json:[{name:'Example client',ip:'192.0.2.24',mac:'02:00:00:00:00:01',type:'WIRED'}]}));
  await page.route('**/api/unifi/consoles',r=>r.fulfill({json:[{name:'Example gateway',model:'Cloud Gateway',version:'1.2.3',state:'connected',ip:'192.0.2.1',is_managed_gateway:true}]}));
  const writes=[];page.on('request',r=>{if(r.method()!=='GET')writes.push(r.url());});
  await page.goto('/#network');await page.locator('#net-tab-ips').click();await page.locator('[data-ip-detail]').first().click();
  const pane=page.locator('.resource-flyout');await expect(pane).toContainText('Routing');await expect(pane).toContainText('192.0.2.24');await page.keyboard.press('Escape');
  await page.locator('#net-tab-clients').click();await page.getByRole('button',{name:'Example client',exact:true}).click();await expect(pane).toContainText('Wired');await expect(pane).toContainText('02:00:00:00:00:01');await page.keyboard.press('Escape');
  await page.locator('#net-tab-consoles').click();await page.getByRole('button',{name:'Example gateway',exact:true}).click();await expect(pane).toContainText('Managed by Speck');expect(writes).toEqual([]);
});

test('Fleet provider hosts show capacity and hosted guests instead of an empty pane',async({page})=>{
  await setup(page);
  await page.route(/\/api\/fleet(?:\?.*)?$/,r=>r.fulfill({json:{connections:[],machines:[{id:'host-1',label:'pve-1',kind:'node',has_endpoint_agent:false,has_speck_agent:true,agent_status:'Host agent online',state:'online',resources:[host]},{id:'guest-1',label:'Example guest',kind:'qemu',has_endpoint_agent:false,has_speck_agent:false,resources:[guest]}]}}));
  await page.goto('/#fleet');await page.locator('#fleet-rows .machine-name[data-device="host-1"]').click();
  const pane=page.locator('#machine-details');await expect(pane).toContainText('64 GB');await expect(pane).toContainText('Hosted guests');await expect(pane).toContainText('Example guest');
});

test('sign-out removes open resource details and does not reuse prior-session inventory',async({page})=>{
  const counts=await setup(page);await page.goto('/#infrastructure');await page.getByRole('button',{name:'Example cloud',exact:true}).click();
  await expect(page.locator('.resource-flyout')).toContainText('32 GB');
  await page.locator('#logout').click();await expect(page.locator('#login')).toBeVisible();await expect(page.locator('.resource-flyout')).toHaveCount(0);
  await page.route('**/api/auth/login',r=>r.fulfill({json:{username:'next-user',csrf:'next-session',role:'admin'}}));
  await page.locator('#username').fill('next-user');await page.locator('#password').fill('demo');await page.locator('#login button[type=submit]').click();
  await expect(page.locator('.home-workspace')).toBeVisible();
  await page.evaluate(()=>location.hash='infrastructure');await expect(page.getByRole('button',{name:'Example cloud',exact:true})).toBeVisible();expect(counts.inventory).toBe(2);
});
