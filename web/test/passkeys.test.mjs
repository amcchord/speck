import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encode, decode, creationOptions, requestOptions, serialize } from '../src/passkeys.ts';
test('base64url transports every byte without padding, including user handles', () => {
  const input = Uint8Array.from({ length: 256 }, (_, i) => i).buffer;
  assert.deepEqual(decode(encode(input)), input);
  assert(!/[+/=]/.test(encode(input)));
  const options = creationOptions({ challenge: 'AQID', user: { id: 'BAUG', name: 'Alex' }, excludeCredentials: [{ id: 'BwgJ', type: 'public-key' }] });
  assert.deepEqual([...new Uint8Array(options.challenge)], [1,2,3]);
  assert.deepEqual([...new Uint8Array(options.user.id)], [4,5,6]);
  assert.deepEqual([...new Uint8Array(options.excludeCredentials[0].id)], [7,8,9]);
  assert.equal(requestOptions({ challenge: 'AQID' }).allowCredentials.length, 0);
});
test('assertion serialization preserves authenticator bytes and discoverable user handle', () => {
  const data = new Uint8Array([251,255,254]).buffer;
  const r = serialize({ id: '-__-', rawId: data, type: 'public-key', getClientExtensionResults: () => ({}),
    response: { clientDataJSON: data, authenticatorData: data, signature: data, userHandle: data } });
  assert.equal(r.response.signature, '-__-'); assert.equal(r.response.userHandle, '-__-');
  assert.equal(r.rawId, r.id);
});
