"use strict";
const fs = require("node:fs");
const path = require("node:path");
// A signed Mac app claiming a keychain access group must carry an Apple profile.
// Notarization alone accepts the bundle but macOS refuses to launch it.
module.exports = async function afterSign(context) {
  if (context.electronPlatformName !== "darwin") return;
  const profile = path.join(context.appOutDir,
    context.packager.appInfo.productFilename + ".app", "Contents", "embedded.provisionprofile");
  if (!fs.existsSync(profile)) throw new Error(
    "Speck passkeys require an embedded Developer ID provisioning profile. " +
    "Build with --config.mac.provisioningProfile=/absolute/path/SpeckDesktop.provisionprofile. " +
    "See docs/passkeys.md before distributing this app.");
};
