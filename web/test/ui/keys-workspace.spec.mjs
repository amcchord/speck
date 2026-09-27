import {test, expect} from './fixtures.mjs';
import fs from 'node:fs';
const shots = '../output/keys-workspace/screenshots';
fs.mkdirSync(shots, {recursive:true});
const now = Date.now()/1000;
async function setup(page, count=3) {
  await page.context().addCookies([{name:'speck-gallery',value:'1',url:'http://127.0.0.1:8761'}]);
  const calls=[], links=[];
  const entries=Array.from({length:count},(_,i)=>({name:i?'clinic-key-'+String(i).padStart(3,'0'):'clinic-database',service:'postgres',kind:'static',project:'clinic',notes:'Production application credential',created:now-86400*9,updated:now-300,created_by:'demo',origin:'speck',revealed:null,reveals:0,secret_names:['DATABASE_URL'],hints:{DATABASE_URL:'••••'},system_count:0}));
  await page.route(/\/api\/(keys|ssh|context)(?:\/|\?|$)/, async route=>{
    const req=route.request(), url=new URL(req.url()), path=url.pathname;
    calls.push({path,method:req.method()});
    const json=data=>route.fulfill({json:data});
    if(path==='/api/keys/system-targets') return json([{id:'web-1',label:'Clinic web',description:'Speck endpoint'}]);
    if(path==='/api/keys/services') return json([{service:'postgres',label:'PostgreSQL',mode:'shared',configured:true,description:'Application database',hints:{},settings:{},secret_fields:[],setting_fields:[],updated:now-300,updated_by:'demo',events:[]}]);
    if(path==='/api/keys') return json(entries.map(e=>({...e,system_count:links.length,system_labels:links.map(l=>l.label)})));
    if(path==='/api/ssh/keys') return json([{name:'clinic-deploy',type:'ssh-ed25519',public_key:'ssh-ed25519 synthetic-public-key',fingerprint:'SHA256:abc123',has_private:true,purpose:'Deploy application',created:now-86400,created_by:'demo',origin:'speck',registration_checked:false}]);
    if(path==='/api/context/files') return json([{filename:'clinic.md',machine:'Clinic web',domain:'clinic.example.test',created:now-500,size:2345,origin:'speck',created_by:'demo'}]);
    if(path.endsWith('/details')) return json({entry:path.startsWith('/api/keys/')?entries[0]:undefined,systems:links,events:[{at:now-300,actor:'demo',action:'vault.updated'}],last_access:null});
    if(path.endsWith('/systems')) {
      if(req.method()==='POST') links.push({target_id:'web-1',label:'Clinic web',target:{id:'web-1',device_id:'web-1',label:'Clinic web'},source:'Recorded by administrator',note:req.postDataJSON().note,created:now,created_by:'demo'});
      else links.length=0;
      return json({ok:true});
    }
    if(path.endsWith('/private')) return json({private_key:'PRIVATE-SSH-CANARY'});
    if(path.startsWith('/api/context/files/')) return json({markdown:'# Clinic web\nHANDOFF-PRIVATE-CANARY'});
    return json({secrets:{DATABASE_URL:'VAULT-SECRET-CANARY'}});
  });
  return calls;
}
for(const width of [1440,768,390]) {
  test(`key inspectors, associations and search at ${width}`,async({page},info)=>{
    await page.setViewportSize({width,height:1000});
    const calls=await setup(page);
    await page.goto('/#keys');
    await page.getByRole('button',{name:'clinic-database',exact:true}).click();
    const pane=page.getByRole('dialog',{name:'clinic-database',exact:true});
    await expect(pane.getByRole('heading',{name:'Used by systems'})).toBeVisible();
    await expect(pane.getByText('No activity recorded in Speck yet.')).toHaveCount(0);
    expect(calls.filter(c=>c.path==='/api/keys/clinic-database')).toHaveLength(0);
    await pane.getByRole('button',{name:'Link system',exact:true}).click();
    const link=page.getByRole('dialog',{name:'Link a system'});
    await link.getByLabel('Usage note').fill('Database for the web service');
    await link.getByRole('button',{name:/Clinic web/}).click();
    await expect(pane.getByText('Database for the web service')).toBeVisible();
    await expect(pane.getByText('Recorded by administrator', {exact:false})).toBeVisible();
    await pane.locator('[data-key-metadata]').scrollIntoViewIfNeeded();
    await page.screenshot({path:`${shots}/key-relationships-${width}-${info.project.name}.png`});
    await pane.getByRole('button',{name:'Close',exact:true}).click();
    const before=calls.length;
    await page.getByLabel('Search',{exact:true}).fill('clinic web');
    await expect(page.locator('[data-entry]')).toHaveCount(3);
    expect(calls.length).toBe(before);
    await page.getByLabel('Search',{exact:true}).fill('no-such-key');
    await expect(page.getByText('No matching entries')).toBeVisible();
    await page.getByLabel('Search',{exact:true}).fill('');
    await page.getByRole('tab',{name:'Providers',exact:true}).click();
    await page.getByRole('button',{name:'PostgreSQL',exact:true}).click();
    await expect(page.getByRole('dialog').getByRole('heading',{name:'Related credentials'})).toBeVisible();
    await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
    await page.getByRole('tab',{name:/SSH keys/}).click();
    await page.getByLabel('Search',{exact:true}).fill('abc123');
    await page.getByRole('button',{name:'clinic-deploy',exact:true}).click();
    await expect(page.getByRole('dialog').getByText('SHA256:abc123')).toBeVisible();
    expect(calls.filter(c=>c.path.endsWith('/private'))).toHaveLength(0);
    await page.screenshot({path:`${shots}/ssh-detail-${width}-${info.project.name}.png`});
    await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
    await page.getByRole('tab',{name:/Handoffs/}).click();
    await page.getByRole('button',{name:'Clinic web',exact:true}).click();
    await expect(page.getByRole('button',{name:'Reveal handoff'})).toBeVisible();
    expect(calls.filter(c=>c.path==='/api/context/files/clinic.md')).toHaveLength(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
test('search limits large vault rendering and repeat visits reuse metadata',async({page})=>{
  const calls=await setup(page,500);
  await page.goto('/#keys');
  await expect(page.locator('[data-entry]')).toHaveCount(80);
  await page.getByLabel('Search',{exact:true}).fill('clinic 499');
  await expect(page.locator('[data-entry]')).toHaveCount(1);
  expect(calls.filter(c=>c.path==='/api/keys')).toHaveLength(1);
  await page.goto('/#activity');
  await expect(page.getByRole('heading',{name:'Activity',exact:true})).toBeVisible();
  await page.goto('/#keys');
  await expect(page.locator('[data-entry]')).toHaveCount(1);
  expect(calls.filter(c=>c.path==='/api/keys')).toHaveLength(1);
});
test('explicit handoff and SSH reveals expire and clear their DOM',async({page})=>{
  await setup(page); await page.clock.install(); await page.goto('/#keys');
  await page.getByRole('tab',{name:/Handoffs/}).click();
  await page.getByRole('button',{name:'Clinic web',exact:true}).click();
  await page.getByRole('button',{name:'Reveal handoff'}).click();
  await expect(page.getByText('HANDOFF-PRIVATE-CANARY',{exact:false})).toBeVisible();
  await page.clock.runFor(91000);
  await expect(page.getByText('HANDOFF-PRIVATE-CANARY',{exact:false})).toHaveCount(0);
  await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('tab',{name:/SSH keys/}).click();
  await page.getByRole('button',{name:'clinic-deploy',exact:true}).click();
  await page.getByRole('button',{name:'Reveal private key'}).click();
  await expect(page.getByText('PRIVATE-SSH-CANARY')).toBeVisible();
  await page.clock.runFor(91000);
  await expect(page.getByText('PRIVATE-SSH-CANARY')).toHaveCount(0);
});
test('closing a key while reveal is in flight discards the late secret', async ({page})=>{
  await setup(page); const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  let release, started=false;
  const gate=new Promise(resolve=>release=resolve);
  await page.route('**/api/keys/clinic-database', async route=>{
    started=true; await gate; await route.fulfill({json:{secrets:{DATABASE_URL:'LATE-SECRET-CANARY'}}});
  });
  await page.goto('/#keys');
  await page.getByRole('button',{name:'clinic-database',exact:true}).click();
  await page.getByRole('button',{name:'Reveal values',exact:true}).click();
  await expect.poll(()=>started).toBe(true);
  await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
  release();
  await page.getByRole('tab',{name:'Providers',exact:true}).click();
  await expect(page.getByRole('button',{name:'PostgreSQL',exact:true})).toBeVisible();
  expect(errors).toEqual([]);
  await expect(page.getByText('LATE-SECRET-CANARY')).toHaveCount(0);
});
