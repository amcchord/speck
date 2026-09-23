"use strict";
// Run against the assembled, final signed/notarized release directory. Never
// publish metadata from a different build, or modify packages after this check.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const yaml = require("js-yaml");
const { version } = require("./package.json");
const directory = path.resolve(process.argv[2] || path.join(__dirname, "dist"));
const packages = ["win-x64.exe", "mac-arm64.dmg", "mac-arm64.zip", "mac-x64.dmg",
  "mac-x64.zip", "linux-amd64.deb", "linux-x86_64.AppImage"]
  .map(suffix => `Speck-Desktop-${version}-${suffix}`);
const indexed = new Set();
for (const filename of ["latest.yml", "latest-mac.yml", "latest-linux.yml"]) {
  const manifest = yaml.load(fs.readFileSync(path.join(directory, filename), "utf8"));
  assert.equal(manifest.version, version, `${filename}: stale release`);
  assert.ok(manifest.files?.length, `${filename}: empty files`);
  for (const file of manifest.files) {
    assert.ok(packages.includes(file.url), `${filename}: unexpected package ${file.url}`);
    const bytes = fs.readFileSync(path.join(directory, file.url));
    assert.equal(bytes.length, file.size, `${file.url}: wrong size`);
    assert.equal(crypto.createHash("sha512").update(bytes).digest("base64"), file.sha512,
      `${file.url}: package changed after metadata generation`);
    indexed.add(file.url);
  }
}
for (const filename of packages) assert.ok(indexed.has(filename), `${filename}: absent from update feed`);
const files = fs.readdirSync(directory).filter(name => packages.includes(name) ||
  name.endsWith(".blockmap") || /^latest.*\.yml$/.test(name)).sort();
fs.writeFileSync(path.join(directory, "SHA256SUMS"), files.map(name =>
  crypto.createHash("sha256").update(fs.readFileSync(path.join(directory, name))).digest("hex") +
  "  " + name + "\n").join(""));
console.log(`Verified ${packages.length} packages, all update manifests, and wrote SHA256SUMS.`);
