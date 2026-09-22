const {test}=require('node:test');const assert=require('node:assert/strict');
const {trusted,destination,remotePage}=require('../policy.cjs');
const id='a'.repeat(32);
test('deep links carry only a machine identity to the fixed HTTPS origin',()=>{assert.equal(destination('speck://connect/'+id),'https://speckrmm.com/#remote/'+id);for(const bad of ['speck://connect/'+id+'?token=secret','speck://evil/'+id,'speck://connect/../../etc/passwd','speck://user@connect/'+id,'https://speckrmm.com/#fleet','speck://connect/'+id+'#extra'])assert.equal(destination(bad),null);});
test('native capabilities require the exact remote origin and workspace route',()=>{assert(trusted('https://speckrmm.com/#fleet'));assert(remotePage('https://speckrmm.com/#remote/'+id));for(const bad of ['https://speckrmm.com.evil.test/#remote/'+id,'http://speckrmm.com/#remote/'+id,'https://speckrmm.com/#fleet','file:///tmp/index.html'])assert.equal(remotePage(bad),false);});
