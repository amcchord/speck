import test from 'node:test';
import assert from 'node:assert/strict';
import {createReadCache, readPolicy} from '../src/read-cache.ts';

test('cache allowlist excludes credentials, live operation reads and fresh preflights',()=>{
  for(const path of ['/keys','/vault/entries/1','/auth/me','/devices/1/preview','/ai/settings','/infrastructure/connections/c/read/power','/dns/domains/example.com/records','/fleet?refresh=true']) assert.equal(readPolicy(path),null,path);
  for(const path of ['/unifi/sites','/unifi/sites/console/site/clients','/infrastructure/connections/c/resources/instance/1/metrics?timeframe=day','/fleet','/network/map','/slide/inventory?resource=restore%2Fvirt','/infrastructure/connections/c/resources/node/pve-1']) assert.ok(readPolicy(path)>0,path);
});
test('fresh reads reuse isolated values and stale reads return immediately while one refresh runs',async()=>{
  let time=0,calls=0,resolve;
  const cache=createReadCache(async()=>{calls++; if(calls===1)return {value:1}; return new Promise(r=>resolve=r);},()=>time);
  const first=await cache.read('/fleet');first.value=99;
  assert.deepEqual(await cache.read('/fleet'),{value:1});assert.equal(calls,1);
  time=16000;
  assert.deepEqual(await cache.read('/fleet'),{value:1});
  assert.deepEqual(await cache.read('/fleet'),{value:1});assert.equal(calls,2);
  resolve({value:2});await new Promise(r=>setImmediate(r));
  assert.deepEqual(await cache.read('/fleet'),{value:2});assert.equal(cache.state('/fleet').pending,false);
});
test('failed refresh retains a labeled usable snapshot, but hard expiry requires a network result',async()=>{
  let time=0,fail=false;
  const cache=createReadCache(async()=>{if(fail)throw new Error('offline');return [1];},()=>time);
  await cache.read('/fleet');fail=true;time=16000;
  assert.deepEqual(await cache.read('/fleet'),[1]);await new Promise(r=>setImmediate(r));
  assert.equal(cache.state('/fleet').failed,true);
  time=301000;await assert.rejects(cache.read('/fleet'),/offline/);cache.clear();
});
test('sign-out or mutation invalidation prevents late reads repopulating the next session',async()=>{
  let resolve;
  const cache=createReadCache(()=>new Promise(r=>resolve=r));
  const pending=cache.read('/fleet');await Promise.resolve();cache.clear();resolve({private:'old session'});await assert.rejects(pending,{name:'AbortError'});
  assert.equal(cache.peek('/fleet'),undefined);
});
test('one canceled consumer does not cancel another consumer of the shared request',async()=>{
  let resolve,calls=0;
  const cache=createReadCache(()=>{calls++;return new Promise(r=>resolve=r);});
  const controller=new AbortController();
  const first=cache.read('/fleet',{signal:controller.signal});
  const second=cache.read('/fleet');controller.abort();await assert.rejects(first,{name:'AbortError'});
  resolve([1]);assert.deepEqual(await second,[1]);assert.equal(calls,1);cache.clear();
});
test('explicit refresh waits for current data instead of serving the prior snapshot',async()=>{
  let calls=0;const cache=createReadCache(async()=>++calls);
  assert.equal(await cache.read('/fleet'),1);
  assert.equal(await cache.read('/fleet',{fresh:true}),2);cache.clear();
});
