const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { installUpdates } = require("../updates.cjs");

function setup() {
  const app = Object.assign(new EventEmitter(), { getVersion: () => "0.2.3" });
  const updater = new EventEmitter(), timers = [], dialogs = [], installs = [];
  let checks = 0, response = 0;
  updater.checkForUpdates = async () => { checks++; updater.emit("update-not-available"); };
  updater.quitAndInstall = (...args) => installs.push(args);
  const api = installUpdates({ app, autoUpdater: updater, getWindow: () => null,
    dialog: { showMessageBox: async options => { dialogs.push(options); return { response }; } },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return 1; },
    setInterval: (fn, ms) => { timers.push({ fn, ms }); return 2; },
    clearTimeout() {}, clearInterval() {},
  });
  return { api, updater, timers, dialogs, installs, checks: () => checks,
    choose: value => { response = value; } };
}

test("automatic checks download stable releases and defer installation until normal quit", async () => {
  const r = setup();
  assert.equal(r.updater.autoDownload, true);
  assert.equal(r.updater.autoInstallOnAppQuit, true);
  assert.equal(r.updater.allowPrerelease, false);
  assert.equal(r.updater.allowDowngrade, false);
  assert.equal(r.updater.disableWebInstaller, true);
  assert.deepEqual(r.timers.map(t => t.ms), [30000, 21600000]);
  r.timers[0].fn(); await r.api.check();
  assert.equal(r.checks(), 1);
  r.updater.emit("update-downloaded", { version: "0.2.4" });
  await r.api.check();
  assert.equal(r.checks(), 1);
  assert.equal(r.dialogs.length, 0);
  assert.equal(r.installs.length, 0);
});

test("manual restart is explicitly chosen and Later preserves the running session", async () => {
  const r = setup(); r.updater.emit("update-downloaded", { version: "0.2.4" });
  await r.api.manualCheck();
  assert.equal(r.installs.length, 0);
  assert.match(r.dialogs[0].detail, /remote sessions/);
  assert.equal(r.dialogs[0].defaultId, 0);
  r.choose(1); await r.api.manualCheck();
  assert.deepEqual(r.installs, [[false, true]]);
});

test("offline errors are silent in background and recover on the next check", async () => {
  const r = setup();
  r.updater.checkForUpdates = async () => { throw new Error("offline"); };
  await r.api.check(); assert.equal(r.api.getState().state, "error");
  assert.equal(r.dialogs.length, 0);
  await r.api.manualCheck(); assert.match(r.dialogs[0].message, /Could not/);
  r.updater.checkForUpdates = async () => { r.updater.emit("update-not-available"); };
  await r.api.manualCheck(); assert.match(r.dialogs[1].message, /0.2.3 is up to date/);
});

test("download errors never enable installation and a manual check does not wait on the download", async () => {
  const r = setup(); let rejectDownload;
  r.updater.checkForUpdates = async () => {
    r.updater.emit("update-available", { version: "0.2.4" });
    return { downloadPromise: new Promise((_, reject) => { rejectDownload = reject; }) };
  };
  await r.api.manualCheck(); assert.match(r.dialogs[0].message, /Downloading/);
  rejectDownload(new Error("checksum mismatch"));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(r.api.getState().state, "error"); assert.equal(r.installs.length, 0);
});

test("overlapping checks share one request and duplicate dialogs are suppressed", async () => {
  const r = setup(); let complete, count = 0;
  r.updater.checkForUpdates = () => { count++; return new Promise(resolve => { complete = resolve; }); };
  const first = r.api.manualCheck(), second = r.api.manualCheck(), background = r.api.check();
  await new Promise(resolve => setImmediate(resolve)); assert.equal(count, 1);
  r.updater.emit("update-not-available"); complete();
  await Promise.all([first, second, background]); assert.equal(r.dialogs.length, 1);
});
