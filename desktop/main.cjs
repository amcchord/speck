"use strict";
const {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  clipboard,
  dialog,
  shell,
} = require("electron");
const path = require("node:path");
const { ORIGIN, trusted, destination, remotePage } = require("./policy.cjs");
let window = null,
  pendingURL = null;
app.setName("Speck Desktop");
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("open-url", (event, url) => {
    event.preventDefault();
    openLink(url);
  });
  app.on("second-instance", (_event, argv) => {
    const link = argv.find((v) => v.startsWith("speck:"));
    if (link) openLink(link);
    else focus();
  });
  app.whenReady().then(createWindow);
}
function focus() {
  if (window) {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }
}
function openLink(value) {
  const url = destination(value);
  if (!url) return;
  pendingURL = url;
  if (window) {
    void window.loadURL(url);
    focus();
  }
}
function validSender(event) {
  return (
    !!window &&
    !window.isDestroyed() &&
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame &&
    remotePage(event.senderFrame.url) &&
    window.isFocused()
  );
}
ipcMain.handle("speck:clipboard:read", (event) => {
  if (!validSender(event))
    throw new Error(
      "Clipboard is available only in the active Speck remote workspace",
    );
  return clipboard.readText().slice(0, 65536);
});
ipcMain.handle("speck:clipboard:write", (event, text) => {
  if (!validSender(event) || typeof text !== "string" || text.length > 65536)
    throw new Error("Clipboard request rejected");
  clipboard.writeText(text);
  return true;
});
function macro(name) {
  if (window && remotePage(window.webContents.getURL()))
    window.webContents.send("speck:macro", name);
}
function createWindow() {
  if (process.defaultApp) {
    app.setAsDefaultProtocolClient("speck", process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  } else app.setAsDefaultProtocolClient("speck");
  const launch = process.argv.find((v) => v.startsWith("speck:"));
  if (launch) pendingURL = destination(launch);
  window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 760,
    minHeight: 520,
    backgroundColor: "#192e24",
    title: "Speck Desktop",
    icon: path.join(__dirname, "assets/speck-icon-256.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      partition: "persist:speck",
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://github.com/amcchord/speck/"))
      void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!trusted(url)) event.preventDefault();
  });
  window.webContents.on("will-redirect", (event, url) => {
    if (!trusted(url)) event.preventDefault();
  });
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  window.webContents.session.setPermissionCheckHandler(
    (webContents, permission, origin) =>
      trusted(origin) &&
      webContents === window?.webContents &&
      ["media", "fullscreen", "clipboard-sanitized-write"].includes(permission),
  );
  window.webContents.session.setPermissionRequestHandler(
    async (webContents, permission, callback, details) => {
      if (
        !window ||
        webContents !== window.webContents ||
        !trusted(details.requestingUrl)
      ) {
        callback(false);
        return;
      }
      if (
        permission === "fullscreen" ||
        permission === "clipboard-sanitized-write"
      ) {
        callback(true);
        return;
      }
      if (
        permission === "media" &&
        remotePage(webContents.getURL()) &&
        details.mediaTypes?.every((t) => t === "audio")
      ) {
        const choice = await dialog.showMessageBox(window, {
          type: "question",
          title: "Microphone for this session",
          message: "Send microphone audio to the remote machine?",
          buttons: ["Cancel", "Enable microphone"],
          defaultId: 0,
          cancelId: 0,
        });
        callback(choice.response === 1);
        return;
      }
      callback(false);
    },
  );
  const menu = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
    {
      label: "Session",
      submenu: [
        {
          label: "Fleet",
          accelerator: "CmdOrCtrl+Shift+H",
          click: () => window.loadURL(ORIGIN + "/#fleet"),
        },
        {
          label: "Full screen",
          accelerator: "F11",
          click: () => window.setFullScreen(!window.isFullScreen()),
        },
        { type: "separator" },
        {
          label: "Send Ctrl + Alt + Del",
          accelerator: "CmdOrCtrl+Alt+End",
          click: () => macro("cad"),
        },
        {
          label: "Send Windows + R",
          accelerator: "CmdOrCtrl+Shift+R",
          click: () => macro("run"),
        },
        {
          label: "Send Alt + Tab",
          accelerator: "CmdOrCtrl+Shift+Tab",
          click: () => macro("alt-tab"),
        },
        { label: "Task manager", click: () => macro("task") },
        { type: "separator" },
        { role: "close" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [{ role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Speck on GitHub",
          click: () => shell.openExternal("https://github.com/amcchord/speck/"),
        },
        {
          label: "About Speck Desktop",
          click: () =>
            dialog.showMessageBox(window, {
              message: "Speck Desktop " + app.getVersion(),
              detail:
                "A LITTLE LIGHTWEIGHT RMM\nShared clipboard, remote key shortcuts and a dedicated workspace.",
            }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menu));
  window.on("closed", () => {
    window = null;
  });
  void window.loadURL(pendingURL || ORIGIN);
}
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (!window) createWindow();
  else focus();
});
