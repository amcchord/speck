import test from 'node:test';
import assert from 'node:assert/strict';
import {EntityCatalog,entityKey,hostRef,ipAddress,ipRef,lanClientRef,networkRef,sameNetwork,portRef,resourceMachine} from '../src/entity-model.ts';
const resource = (connection='one',kind='node',id='pve')=>({provider:'proxmox',connection_id:connection,kind,id,name:id,node:'pve'});
test('canonical hosts and machines require exact provider, connection, kind and ID',()=>{
 const machines=[{id:'a',resources:[resource()]},{id:'b',resources:[resource('two')]}];
 assert.equal(resourceMachine(resource(),machines).id,'a');
 assert.deepEqual(hostRef(resource('two','qemu','100'),machines),{kind:'machine',id:'b'});
 assert.equal(resourceMachine({...resource(),provider:'other'},machines),undefined);
 assert.equal(resourceMachine(resource(),[...machines,{id:'copy',resources:[resource()]}]),undefined);
});
test('names provide disambiguation and never join original and recovery-copy identities',()=>{
 const c=new EntityCatalog();c.ingest('/fleet?compact=true',{machines:[{id:'original',label:'HOST',hostname:'same',resources:[resource()]},{id:'clone',label:'HOST',hostname:'same',resources:[resource('two')]}]});
 assert.equal(c.matches('host').length,2);assert.equal(c.matches('same').length,2);
 c.ingest('/infrastructure/inventory',{connections:[{id:'one',name:'Cluster',provider:'proxmox',resources:[resource()]}]});
 assert.equal(c.matches('pve')[0].ref.id,'original');
 c.clear();assert.equal(c.matches('HOST').length,0);assert.deepEqual(c.machines,[]);
});
test('network names, clients and ports preserve their site scope and VLAN zero',()=>{
 const client={console_id:'c',site_id:'s',network_name:'Default',vlan:0,mac:'AA:BB:CC:00:11:22',uplink_id:'sw',port:4};
 const ref=networkRef(client);assert.equal(ref.resourceKind,'0');assert.ok(sameNetwork(client,ref));
 assert.ok(!sameNetwork({...client,site_id:'elsewhere'},ref));assert.ok(!sameNetwork({...client,vlan:undefined},ref));
 assert.notEqual(entityKey(lanClientRef(client)),entityKey(lanClientRef({...client,site_id:'other'})));
 assert.equal(portRef(client).resourceKind,'4');assert.equal(portRef({...client,port:0}),null);assert.equal(portRef({...client,port:1.5}),null);
 assert.equal(networkRef({...client,console_id:undefined}),null);
});
test('IP references validate IPv4 and IPv6 and never become machine references',()=>{
 assert.equal(ipAddress('192.0.2.10/24'),'192.0.2.10');assert.equal(ipAddress('999.0.0.1'),null);
 assert.equal(ipAddress('2001:0db8::1'),'2001:db8::1');assert.equal(ipAddress('bad:address'),null);
 assert.equal(ipRef('10.0.0.1').kind,'ip');assert.deepEqual(ipRef('10.0.0.1',{console_id:'c',site_id:'s'}),{kind:'ip',id:'10.0.0.1',connection:'c',site:'s'});
});
