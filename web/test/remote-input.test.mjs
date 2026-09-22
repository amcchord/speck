import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remoteTextKeys } from '../src/remote-input.ts';

test('multiline remote commands use Return and preserve literal quotes', () => {
  const text = "printf 'ready'\r\n\tdate\n";
  const keys = remoteTextKeys(text);
  assert.equal(keys.filter(k => k === 0xff0d).length, 2);
  assert.equal(keys.filter(k => k === 0xff09).length, 1);
  assert.ok(keys.includes(39));
  assert.ok(!keys.includes(13) && !keys.includes(10));
});
test('Unicode uses one X11 Unicode keysym per code point', () => {
  assert.deepEqual(remoteTextKeys('é✓🙂'), [233, 0x01002713, 0x0101f642]);
});
test('remote keyboard bounds a single submission', () => {
  assert.equal(remoteTextKeys('x'.repeat(9000)).length, 8192);
  assert.deepEqual(remoteTextKeys(''), []);
  assert.equal(remoteTextKeys('x'.repeat(8191) + '🙂').at(-1), 0x0101f642);
});
