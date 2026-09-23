"use strict";

// Native updates are owned by the main process. Remote web content cannot choose
// a feed or request an installation. The packaged app-update.yml pins the feed.
function installUpdates({ app, autoUpdater, dialog, getWindow, onState = () => {},
  setTimeout: later = setTimeout, setInterval: every = setInterval,
  clearTimeout: cancelLater = clearTimeout, clearInterval: cancelEvery = clearInterval }) {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.disableWebInstaller = true;
  let state = "idle", version = "", pending = null, showing = false;
  function status(value, info) {
    state = value;
    if (info?.version) version = info.version;
    onState({ state, version });
  }
  function message(options) {
    const parent = getWindow();
    return parent && !parent.isDestroyed()
      ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options);
  }
  autoUpdater.on("checking-for-update", () => status("checking"));
  autoUpdater.on("update-available", info => status("downloading", info));
  autoUpdater.on("update-not-available", () => status("current"));
  autoUpdater.on("update-downloaded", info => status("ready", info));
  // Errors are expected while offline. Keep running and retry at the next check;
  // explicit checks below show a useful error without exposing internal URLs.
  autoUpdater.on("error", () => status("error"));

  function check() {
    if (state === "ready" || state === "downloading") return Promise.resolve();
    if (!pending) {
      pending = Promise.resolve().then(() => autoUpdater.checkForUpdates())
        .then(result => {
          if (result?.downloadPromise) void result.downloadPromise.catch(() => status("error"));
        }).catch(() => status("error")).finally(() => { pending = null; });
    }
    return pending;
  }
  async function manualCheck() {
    if (showing) return;
    showing = true;
    try {
      if (state !== "ready" && state !== "downloading") await check();
      if (state === "ready") {
        const choice = await message({ type: "info", title: "Speck Desktop update",
          message: `Speck Desktop ${version} is ready to install`,
          detail: "It will install when you quit Speck. Restarting now closes any remote sessions.",
          buttons: ["Later", "Restart and install"], defaultId: 0, cancelId: 0 });
        if (choice.response === 1) autoUpdater.quitAndInstall(false, true);
      } else {
        const details = {
          current: [`Speck Desktop ${app.getVersion()} is up to date`, "Updates are checked automatically and installed when you quit."],
          downloading: [`Downloading Speck Desktop ${version}`, "You can keep working. The update will install when you quit after the download finishes."],
          error: ["Could not check or download the update", "Check your internet connection and try again. Speck will also retry automatically."],
        };
        const [title, detail] = details[state] || ["Update check unavailable", "Try again later from Help → Check for updates."];
        await message({ type: state === "error" ? "warning" : "info",
          title: "Speck Desktop updates", message: title, detail, buttons: ["OK"] });
      }
    } finally { showing = false; }
  }
  const startup = later(() => { void check(); }, 30_000);
  const recurring = every(() => { void check(); }, 6 * 60 * 60 * 1000);
  startup.unref?.(); recurring.unref?.();
  app.once("will-quit", () => { cancelLater(startup); cancelEvery(recurring); });
  return { check, manualCheck, getState: () => ({ state, version }) };
}

module.exports = { installUpdates };
