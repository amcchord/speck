"use strict";
const { ORIGIN, trusted } = require("./policy.cjs");

// Keep account selection in native chrome, outside page-controlled content.
function installPasskeys({ app, dialog, session, getWindow, platform }) {
  if (platform === "darwin") {
    app.configureWebAuthn({ touchID: {
      keychainAccessGroup: "7PTN7E8EDS.com.speckrmm.desktop.webauthn",
      promptReason: "sign in to $1",
    } });
  }
  session.on("select-webauthn-account", async (_event, details, callback) => {
    let selected;
    const win = getWindow();
    const frame = details.frame;
    const valid = () => win && !win.isDestroyed() && getWindow() === win &&
      frame && frame === win.webContents.mainFrame && trusted(frame.url) &&
      details.relyingPartyId === new URL(ORIGIN).hostname;
    try {
      if (!valid() || !details.accounts.length) return;
      const accounts = details.accounts.slice(0, 20);
      const result = await dialog.showMessageBox(win, {
        type: "question", title: "Sign in to Speck", message: "Choose your passkey",
        detail: "Sign in to " + new URL(ORIGIN).hostname,
        buttons: ["Cancel", ...accounts.map(a => a.name || a.displayName || "Speck account")],
        defaultId: 0, cancelId: 0, noLink: true,
      });
      if (valid() && result.response > 0) selected = accounts[result.response - 1]?.credentialId;
    } catch { /* Dismissal or window destruction cancels the request. */ }
    finally { callback(selected); }
  });
}
module.exports = { installPasskeys };
