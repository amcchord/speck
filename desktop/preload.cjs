"use strict";
const { contextBridge, ipcRenderer } = require("electron");
const subscribe = (channel, callback) => {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
const reportFocus = () => ipcRenderer.send("speck:input-focus",
  document.activeElement?.id === "remote-display");
window.addEventListener("DOMContentLoaded", () => {
  document.addEventListener("focusin", reportFocus);
  document.addEventListener("focusout", () => queueMicrotask(reportFocus));
});
contextBridge.exposeInMainWorld(
  "speckDesktop",
  Object.freeze({
    version: "0.2.1",
    readClipboard: () => ipcRenderer.invoke("speck:clipboard:read"),
    writeClipboard: (text) => ipcRenderer.invoke("speck:clipboard:write", text),
    onMacro: (callback) => subscribe("speck:macro", callback),
    onEdit: (callback) => subscribe("speck:edit", callback),
    getFullscreen: () => ipcRenderer.invoke("speck:fullscreen:get"),
    toggleFullscreen: () => ipcRenderer.invoke("speck:fullscreen:toggle"),
    onFullscreen: (callback) => subscribe("speck:fullscreen", callback),
  }),
);
