import test from 'node:test';
import assert from 'node:assert/strict';
import {infrastructureStory,relatedResources,technicalFields,capacity,slideStory} from '../src/resource-story.ts';
test('cloud capacity uses provider MiB values and preserves disabled backup protection',()=>{
  const html=infrastructureStory({provider:'linode',kind:'instance',name:'Compute'}, {configuration:{specs:{vcpus:16,memory:32768,disk:655360},backups:{enabled:false}}});
  assert.match(html,/32 GB/);assert.match(html,/640 GB/);assert.match(html,/Disabled/);assert.doesNotMatch(html,/\{"/);
  assert.equal(capacity(0),'0 B');assert.equal(capacity(undefined),'Not reported');
});
test('host relationships remain scoped to the explicit connection and node',()=>{
  const host={provider:'proxmox',kind:'node',connection_id:'one',node:'pve-1'};
  const rows=[{provider:'proxmox',connection_id:'one',node:'pve-1',kind:'qemu',id:'101'},{provider:'proxmox',connection_id:'two',node:'pve-1',kind:'qemu',id:'102'},{provider:'proxmox',connection_id:'one',node:'pve-2',kind:'qemu',id:'103'}];
  assert.deepEqual(relatedResources(host,rows),[rows[0]]);
});
test('technical fields recursively hide credentials and escape provider-controlled markup',()=>{
  const html=technicalFields({nested:{api_token:'do-not-show',hostname:'<img onerror=alert(1)>'},zero:0,flag:false});
  assert.doesNotMatch(html,/do-not-show|<img/);assert.match(html,/Hidden/);assert.match(html,/&lt;img/);assert.match(html,/>No</);assert.match(html,/>0</);
});
test('Slide verification and relationship IDs remain explicit without inventing protection health',()=>{
  const html=slideStory('snapshot',{snapshot_id:'s1',agent_id:'a1',verify_boot_status:'failed'});
  assert.match(html,/Boot verification/);assert.match(html,/failed/);assert.match(html,/data-resource-id="a1"/);assert.doesNotMatch(html,/Healthy|Verified/);
});
