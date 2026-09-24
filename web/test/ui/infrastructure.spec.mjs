import { test, expect } from '@playwright/test';
const connection={id:'c1',name:'Example cluster',provider:'proxmox',connector:true,status:'connected',resources:[{id:'101',kind:'qemu',name:'Clinic server',management:'provider_only',status:'running',connection_id:'c1',connection_name:'Example cluster',provider:'proxmox',node:'pve-2',addresses:[],max_memory:8589934592}]};
async function setup(page){
 await page.context().addCookies([{name:'speck-gallery',value:'1',url:'http://127.0.0.1:8761'}]);
 await page.route('**/api/infrastructure/**',async route=>{
  const url=new URL(route.request().url());
  let data={};
  if(url.pathname.endsWith('/inventory'))data={connections:[connection,{id:'c2',name:'Offline cluster',provider:'proxmox',connector:true,status:'unavailable',error:'No Proxmox agent is online for this cluster',resources:[]}],checked_at:1790120000};
  else if(url.pathname.endsWith('/connectors'))data=[{id:'agent1',connection_id:'c1',hostname:'pve-1',version:'0.1.0',online:true,last_seen:1790120000}];
  else if(url.pathname.endsWith('/catalog'))data={reboot:{label:'Reboot',method:'POST',danger:true,fields:[]}};
  else if(url.pathname.includes('/resources/'))data={resource:connection.resources[0],status:{status:'running',maxmem:8589934592,mem:2147483648},configuration:{cores:4,memory:8192},recent_tasks:[]};
  else if(url.pathname.endsWith('/actions'))data={status:'submitted',result:'UPID:example'};
  else if(url.pathname.endsWith('/operations'))data=[];
  await route.fulfill({json:data});
 });
}
for(const width of [1440,390]){
 test(`infrastructure inventory, details and confirmed action at ${width}`,async({page})=>{
  await page.setViewportSize({width,height:960});await setup(page);await page.goto('/#infrastructure');
  await expect(page.getByRole('heading',{name:'Infrastructure',exact:true})).toBeVisible();
  await expect(page.getByText('Offline cluster is unavailable.')).toBeVisible();
  await page.getByLabel('Search',{exact:true}).fill('no match');await expect(page.getByText('No matching resources')).toBeVisible();
  await page.getByLabel('Search',{exact:true}).fill('Clinic');
  await expect(page.getByText('Proxmox only',{exact:true})).toBeVisible();
  await page.screenshot({path:`../output/infrastructure/inventory-${width}-${test.info().project.name}.png`,fullPage:true});
  await page.getByRole('button',{name:'Clinic server',exact:true}).click();
  await expect(page.getByText('2.0 GB / 8.0 GB',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Screen control',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Reboot',exact:true}).click();
  const d=page.getByRole('dialog',{name:'Reboot',exact:true});
  await expect(d.getByText('This changes a live resource', {exact:false})).toBeVisible();
  await d.getByLabel('Type Clinic server to confirm').fill('Clinic server');
  const request=page.waitForRequest(r=>r.url().endsWith('/actions'));
  await d.getByRole('button',{name:'Reboot',exact:true}).click();
  const body=(await request).postDataJSON();expect(body.confirmation).toBe('Clinic server');expect(body.resource_id).toBe('101');
  await expect(d.getByRole('heading',{name:'submitted'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 });
 test(`infrastructure connections and enrollment form at ${width}`,async({page})=>{
  await page.setViewportSize({width,height:960});await setup(page);await page.goto('/#infrastructure');
  await page.getByRole('tab',{name:'Connections',exact:true}).click();
  await expect(page.getByText('Agent 0.1.0',{exact:false})).toBeVisible();
  // Phones keep secondary page actions behind "More actions".
  if(width<=760){await page.getByRole('button',{name:'More actions',exact:true}).click();await page.locator('dialog[open]').getByRole('button',{name:'Add connection',exact:true}).click();}
  else await page.getByRole('button',{name:'Add connection',exact:true}).click();
  await expect(page.getByLabel('Use outbound agent')).toBeChecked();
  await expect(page.getByLabel('API origin',{exact:true})).toBeHidden();
  await page.getByRole('combobox',{name:'Provider',exact:true}).selectOption('linode');
  await expect(page.getByLabel('API origin',{exact:true})).toHaveValue('https://api.linode.com');
  await expect(page.getByLabel('API token / bridge credential')).toHaveAttribute('type','password');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 });
}
