# Desktop updates

Speck Desktop 0.2.3 adds native updates for Windows NSIS, macOS Intel/Apple silicon,
and Linux AppImage/deb. The application checks the public Speck GitHub release
feed 30 seconds after launch and every six hours. Stable updates download in the
background, with SHA-512 verification, and install on normal quit. The app never
automatically restarts an active remote session. **Help → Check for updates**
reports current/download/error state and offers an explicit restart when ready.
Offline failures are retried on the next check. Prereleases and downgrades are
disabled. The server and remote web content cannot change the update feed.

Existing 0.2.2 and older installations require one installer upgrade to get the
updater. Account/session storage is preserved. After that, no repeated installer
download is needed. A .deb installation can request the normal administrator
authorization; AppImages must be writable by their owner. Windows releases are
currently unsigned, so Windows verification relies on HTTPS and release checksums.
macOS releases retain Developer ID signatures, provisioning and Apple notarization.

The web interface is loaded from the server on launch/navigation independently
of the native app. Managed endpoint agents have their own signed update system;
see [agent updates](agent-updates.md).

## Publish a desktop release

1. Fetch `origin/main`, ensure it is an ancestor, reconcile any newer deployed
   source, and coordinate a single release owner. Increment `desktop/package.json`
   and its lockfile. Run `npm ci --prefix desktop` and `npm test --prefix desktop`.
2. Build Windows and Linux through the Desktop clients workflow (or equivalent
   native builders). Preserve installers, `latest.yml`, `latest-linux.yml` and
   blockmaps. CI Mac artifacts are unsigned and must not be published.
3. Build both Mac architectures locally using the required Developer ID profile
   and notarization credentials. Let electron-builder notarize/staple the app
   **before** producing ZIPs, blockmaps and `latest-mac.yml`. Retain both Mac
   architectures in that manifest; do not overwrite it with a single-arch build.
4. Assemble all seven packages, three update manifests and blockmaps in one
   directory. Run `node desktop/verify-release.cjs /absolute/release/directory`.
   It verifies final file sizes/digests and writes `SHA256SUMS`. Verify Mac signing,
   stapling and Gatekeeper. Qualify the packaged updater against the feed.
5. Upload all files to a **draft** GitHub release tagged `v<desktop version>` at
   the exact source commit. Publish only once the complete release is verified.
   Draft and prerelease artifacts are not offered by the installed updater.
6. Update the Downloads page only after release URLs are live. Verify served
   assets and keep the prior static web tree for rollback.

Never mutate a published package without regenerating its metadata. To withdraw
a broken release, remove it from the latest stable channel and publish a higher
fixed version. Automatic downgrades are disabled; use an explicit installer for
an operator-selected rollback. Retain the previous packages and application data.

Native update tests cover background behavior, explicit restart, concurrency,
offline recovery and failed downloads. These are distinct from full install and
relaunch acceptance on each supported OS.
