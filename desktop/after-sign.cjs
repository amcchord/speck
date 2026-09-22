"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
// A signed Mac app claiming a keychain access group must carry an Apple profile.
// Notarization alone accepts the bundle but macOS refuses to launch it.
module.exports = async function afterSign(context) {
  if (context.electronPlatformName !== "darwin") return;
  if (process.env.CSC_IDENTITY_AUTO_DISCOVERY === "false") return;
  const app = path.join(context.appOutDir, context.packager.appInfo.productFilename + ".app");
  const signature = spawnSync("/usr/bin/codesign", ["-dv", "--verbose=2", app], { encoding: "utf8" });
  // electron-builder ad-hoc signs arm64 CI bundles even with identity discovery
  // disabled. Those explicitly unsigned test artifacts are never release assets.
  if (signature.status === 0 && /Signature=adhoc/.test(signature.stderr)) return;
  const profile = path.join(app, "Contents", "embedded.provisionprofile");
  if (!fs.existsSync(profile)) throw new Error(
    "Speck passkeys require an embedded Developer ID provisioning profile. " +
    "Build with --config.mac.provisioningProfile=/absolute/path/SpeckDesktop.provisionprofile. " +
    "See docs/passkeys.md before distributing this app.");
};
