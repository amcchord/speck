const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function runtime(platform = 'darwin') {
  const handlers = new Map(), ipcMain = new EventEmitter(), windows = [];
  ipcMain.handle = (name, handler) => handlers.set(name, handler);
  const app = Object.assign(new EventEmitter(), {
    configureWebAuthn() {}, setName() {}, requestSingleInstanceLock: () => true,
    whenReady: () => ({ then: (fn) => fn() }), isReady: () => true,
    setAsDefaultProtocolClient() {}, getVersion: () => '0.2.1', quit() {},
  });
  class Window extends EventEmitter {
    constructor() {
      super(); this.focused = true; this.fullscreen = false;
      this.webContents = Object.assign(new EventEmitter(), {
        mainFrame: { url: 'https://speckrmm.com/#remote/' + 'a'.repeat(32) },
        session: Object.assign(new EventEmitter(), { setPermissionCheckHandler() {}, setPermissionRequestHandler() {} }),
        setWindowOpenHandler() {}, getURL: () => this.webContents.mainFrame.url,
        send: (...args) => this.messages.push(args), copy: () => this.messages.push(['local-copy']),
      });
      this.messages = []; windows.push(this);
    }
    isDestroyed() { return false; }
    isFocused() { return this.focused; }
    isMinimized() { return false; }
    show() {} focus() { this.focused = true; }
    loadURL(url) { this.loaded = url; return Promise.resolve(); }
    isFullScreen() { return this.fullscreen; }
    setFullScreen(value) { this.fullscreen = value; }
  }
  const clipboard = {
    readText: async () => 'café ' + 'x'.repeat(70000),
    writeText: async (text) => { clipboard.written = text; },
  };
  const electron = { app, BrowserWindow: Window, ipcMain, clipboard,
    Menu: { buildFromTemplate: v => v, setApplicationMenu() {} },
    dialog: {}, shell: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../main.cjs'), 'utf8'), {
    require: name => name === 'electron' ? electron : name.startsWith('./') ? require(path.join(__dirname, '..', name)) : require(name),
    __dirname: path.join(__dirname, '..'), process: { platform, argv: ['speck'] },
  });
  const win = windows[0];
  const event = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
  return { handlers, ipcMain, app, windows, win, event, clipboard };
}

test('clipboard awaits Electron async APIs and enforces bounds', async () => {
  const r = runtime();
  const result = await r.handlers.get('speck:clipboard:read')(r.event);
  assert.equal(result.length, 65536); assert(result.startsWith('café'));
  await r.handlers.get('speck:clipboard:write')(r.event, 'round trip');
  assert.equal(r.clipboard.written, 'round trip');
  await assert.rejects(r.handlers.get('speck:clipboard:write')(r.event, 'x'.repeat(65537)));
});

test('clipboard read rechecks focus after the OS promise resolves', async () => {
  const r = runtime();
  r.clipboard.readText = async () => { r.win.focused = false; return 'private'; };
  await assert.rejects(r.handlers.get('speck:clipboard:read')(r.event), /lost focus/);
  await assert.rejects(r.handlers.get('speck:clipboard:write')(r.event, 'text'));
});

test('subframes and other origins cannot access native capabilities', async () => {
  const r = runtime();
  await assert.rejects(r.handlers.get('speck:clipboard:read')({ ...r.event, senderFrame: { url: r.event.senderFrame.url } }));
  r.event.senderFrame.url = 'https://example.com/#remote/' + 'a'.repeat(32);
  assert.throws(() => r.handlers.get('speck:fullscreen:toggle')(r.event));
});

for (const platform of ['darwin', 'win32', 'linux']) {
  test(platform + ' edit shortcut goes remote only with remote canvas focus', () => {
    const r = runtime(platform); let prevented = 0;
    const event = { preventDefault: () => prevented++ };
    const input = { key: 'v', type: 'keyDown', meta: platform === 'darwin', control: platform !== 'darwin' };
    r.win.webContents.emit('before-input-event', event, input);
    assert.equal(prevented, 0);
    r.ipcMain.emit('speck:input-focus', r.event, true);
    r.win.webContents.emit('before-input-event', event, input);
    assert.equal(prevented, 1);
    assert.deepEqual(r.win.messages.at(-1), ['speck:edit', 'paste']);
    r.ipcMain.emit('speck:input-focus', r.event, false);
    r.win.webContents.emit('before-input-event', event, input);
    assert.equal(prevented, 1);
  });
}

test('native fullscreen uses the window and broadcasts actual state', () => {
  const r = runtime();
  r.handlers.get('speck:fullscreen:toggle')(r.event);
  assert.equal(r.win.fullscreen, true);
  r.win.emit('enter-full-screen');
  assert.deepEqual(r.win.messages.at(-1), ['speck:fullscreen', true]);
  assert.equal(r.handlers.get('speck:fullscreen:get')(r.event), true);
});

test('a deep link reopens a closed macOS window', () => {
  const r = runtime(); r.win.emit('closed');
  r.app.emit('open-url', { preventDefault() {} }, 'speck://connect/' + 'b'.repeat(32));
  assert.equal(r.windows.length, 2);
  assert.equal(r.windows[1].loaded, 'https://speckrmm.com/#remote/' + 'b'.repeat(32));
});

test('browser handoff rejects subframes, unfocused windows and arbitrary link payloads', async () => {
  const r = runtime();
  const open = r.handlers.get('speck:passkey-browser');
  await assert.rejects(open(r.event, 'https://evil.test'));
  await assert.rejects(open({ ...r.event, senderFrame: { url: r.event.senderFrame.url } }, 'a'.repeat(43)));
  r.win.focused = false;
  await assert.rejects(open(r.event, 'a'.repeat(43)));
});
