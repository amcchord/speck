const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { installPasskeys } = require('../passkeys.cjs');

function setup(platform = 'darwin') {
  const session = new EventEmitter();
  const frame = { url: 'https://speckrmm.com/#signin' };
  const win = { isDestroyed: () => false, webContents: { mainFrame: frame } };
  let configured; let response = 1; let during = () => {};
  installPasskeys({ app: { configureWebAuthn: v => configured = v },
    dialog: { showMessageBox: async () => { during(); return { response }; } },
    session, getWindow: () => win, platform });
  const select = session.listeners('select-webauthn-account')[0];
  const details = { frame, relyingPartyId: 'speckrmm.com', accounts: [{ credentialId: 'key-one', name: 'Alex' }] };
  const calls = [];
  return { configured, frame, details, calls,
    choose: () => select({}, details, v => calls.push(v)),
    cancel: () => response = 0, navigate: () => during = () => frame.url = 'https://evil.test' };
}
test('macOS configures its signed keychain group; other platforms keep system WebAuthn', () => {
  assert.equal(setup().configured.touchID.keychainAccessGroup, '7PTN7E8EDS.com.speckrmm.desktop.webauthn');
  assert.equal(setup('win32').configured, undefined);
  assert.equal(setup('linux').configured, undefined);
});
test('native account chooser returns only the explicitly selected credential', async () => {
  const r = setup(); await r.choose(); assert.deepEqual(r.calls, ['key-one']);
  r.cancel(); await r.choose(); assert.deepEqual(r.calls, ['key-one', undefined]);
});
test('wrong origins, RPs, subframes and navigation cannot receive a credential choice', async () => {
  for (const alter of [r => r.frame.url = 'https://evil.test', r => r.details.relyingPartyId = 'evil.test',
    r => r.details.frame = { url: r.frame.url }, r => r.navigate()]) {
    const r = setup(); alter(r); await r.choose(); assert.deepEqual(r.calls, [undefined]);
  }
});
