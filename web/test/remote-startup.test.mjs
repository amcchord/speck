import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasVisiblePixels, watchRemoteStartup, useReliableImageDecoder } from '../src/remote-startup.ts';

function harness(t, canRecover = true) {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const calls = { wake: 0, recover: 0, show: 0, stalled: 0 };
  const state = { visible: true, ready: false };
  const startup = watchRemoteStartup({
    visible: () => state.visible, ready: () => state.ready, canRecover,
    ...Object.fromEntries(Object.keys(calls).map(key => [key, () => calls[key]++])),
  });
  const advance = (ms) => { for (let n = 0; n < ms; n += 500) t.mock.timers.tick(500); };
  return { calls, state, startup, advance };
}
test('connection is not screen readiness; first visible frame stops all recovery', t => {
  const h = harness(t);
  h.advance(20000);
  assert.deepEqual(h.calls, { wake: 0, recover: 0, show: 0, stalled: 0 });
  h.startup.connected(); h.advance(500);
  assert.equal(h.calls.show, 0);
  h.state.ready = true; h.advance(500); h.advance(60000);
  assert.deepEqual(h.calls, { wake: 0, recover: 0, show: 1, stalled: 0 });
});
test('a black first frame receives one wake then one bounded reconnect', t => {
  const h = harness(t);
  h.startup.connected(); h.advance(2000);
  assert.equal(h.calls.wake, 1); assert.equal(h.calls.recover, 0);
  h.advance(60000);
  assert.deepEqual(h.calls, { wake: 1, recover: 1, show: 0, stalled: 0 });
});
test('second attempt stops with operator controls rather than looping', t => {
  const h = harness(t, false); h.startup.connected(); h.advance(60000);
  assert.deepEqual(h.calls, { wake: 1, recover: 0, show: 0, stalled: 1 });
});
test('background tabs do not consume the recovery budget', t => {
  const h = harness(t); h.startup.connected(); h.state.visible = false; h.advance(120000);
  assert.deepEqual(h.calls, { wake: 0, recover: 0, show: 0, stalled: 0 });
  h.state.ready = true; h.advance(500);
  assert.equal(h.calls.show, 1);
});
test('operator input prevents automatic pointer moves and reconnects', t => {
  const h = harness(t); h.startup.connected(); h.startup.interacted(); h.advance(60000);
  assert.deepEqual(h.calls, { wake: 0, recover: 0, show: 0, stalled: 1 });
});
test('leaving before the first screen cancels pending recovery', t => {
  const h = harness(t); h.startup.connected(); h.advance(500); h.startup.stop(); h.startup.stop();
  h.advance(60000);
  assert.deepEqual(h.calls, { wake: 0, recover: 0, show: 0, stalled: 0 });
});
test('transparent, black, and isolated noise pixels are not a visible desktop', () => {
  assert.equal(hasVisiblePixels(new Uint8ClampedArray(32 * 18 * 4)), false);
  assert.equal(hasVisiblePixels([0,0,0,255, 255,255,255,0, 1,1,1,255]), false);
  assert.equal(hasVisiblePixels([255,255,255,255]), false);
  assert.equal(hasVisiblePixels(Array(4).fill([64,48,32,255]).flat()), true);
});
test('Safari/iOS use the ordered Image decoder without invoking ImageBitmap', () => {
  for (const ua of ['AppleWebKit/605.1 Safari/605.1', 'AppleWebKit/605.1 CriOS/140 Mobile']) {
    let reader, actual;
    const display = { drawStream: () => { throw new Error('ImageBitmap path'); }, draw: (...args) => actual = args };
    const Guac = { DataURIReader: function(stream, type) {
      assert.equal(stream, 'stream'); assert.equal(type, 'image/png'); reader = this;
      this.getURI = () => 'data:image/png;base64,pixels';
    } };
    useReliableImageDecoder(display, Guac, ua);
    display.drawStream('layer', 10, 20, 'stream', 'image/png');
    assert.equal(actual, undefined);
    reader.onend();
    assert.deepEqual(actual, ['layer', 10, 20, 'data:image/png;base64,pixels']);
  }
});
test('Chromium and native clients retain their existing decoder', () => {
  const drawStream = () => {};
  const display = { drawStream };
  useReliableImageDecoder(display, {}, 'AppleWebKit/537.36 Chrome/140 Safari/537.36');
  assert.equal(display.drawStream, drawStream);
});
