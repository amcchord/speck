import test from 'node:test';
import assert from 'node:assert/strict';
import { machinePresence } from '../src/presence.ts';
const app={title:'Example chart',process:'example.exe',user:'OFFICE\\Pat',observed_at:'2026-09-22T22:00:00Z'};
const now=Date.parse(app.observed_at)/1000;
test('a disconnected session remains signed in and its app is explicitly historical',()=>{
 const result=machinePresence({online:true,telemetry:{active_app:null,last_active_app:app,desktop:{state:'disconnected',sessions_available:true},logged_in_users:[{user:app.user,state:'disconnected'}]}},now+100);
 assert.equal(result.current,false);assert.equal(result.table,'Last: example.exe');
 assert.equal(result.userLabel,'OFFICE\\Pat (disconnected)');assert.equal(result.desktop,'Disconnected');
});
test('desktop and signed-in users do not depend on a foreground app',()=>{
 const result=machinePresence({online:true,telemetry:{desktop:{state:'active',sessions_available:true},logged_in_users:[{user:app.user,state:'active'}]}},now);
 assert.equal(result.desktop,'Active');assert.equal(result.title,'No app reported');assert.equal(result.userLabel,app.user);
});
test('offline or expired app observations are never labeled current',()=>{
 for(const [online,clock] of [[false,now],[true,now+80]]) {
  const result=machinePresence({online,telemetry:{active_app:app}},clock);
  assert.equal(result.current,false);assert.equal(result.table,'Last: example.exe');
 }
});
test('current app and older-agent fallback remain compatible',()=>{
 assert.equal(machinePresence({online:true,telemetry:{active_app:app}},now).table,'example.exe');
 assert.equal(machinePresence({online:true,telemetry:{active_app:{process:'legacy.exe',user:'Pat'}}},now).userLabel,'Pat');
});
