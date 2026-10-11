import test from 'node:test';
import assert from 'node:assert/strict';
import {serviceStartup} from '../src/inspection-model.ts';
import {readPolicy} from '../src/read-cache.ts';

test('Windows startup codes are human-readable and missing values stay unknown',()=>{
 assert.equal(serviceStartup(2,'windows'),'Automatic');assert.equal(serviceStartup(3,'windows'),'Manual / on demand');assert.equal(serviceStartup(undefined,'windows'),'Startup not reported');assert.equal(serviceStartup('enabled','linux'),'enabled');
});
test('compact inventory shares the bounded session-cache policy without caching forced reads',()=>{
 assert.equal(readPolicy('/fleet?compact=true'),15000);assert.equal(readPolicy('/fleet?compact=true&refresh=true'),null);assert.equal(readPolicy('/devices/id/inspection'),null);
});
