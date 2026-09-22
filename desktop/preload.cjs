"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld(
  "speckDesktop",
  Object.freeze({
    version: "0.2.0",
    readClipboard: () => ipcRenderer.invoke("speck:clipboard:read"),
    writeClipboard: (text) => ipcRenderer.invoke("speck:clipboard:write", text),
    onMacro: (callback) => {
      const listener = (_event, name) => callback(name);
      ipcRenderer.on("speck:macro", listener);
      return () => ipcRenderer.removeListener("speck:macro", listener);
    },
  }),
);
