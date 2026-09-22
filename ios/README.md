# Speck for iPhone and iPad

Native SwiftUI operator app for Windows and Linux fleets, using the same Speck
API and account permissions as the web console. Requires iOS / iPadOS 18 or later.

App Store Connect: **Speck RMM**, Apple ID `6814871051`.
Bundle ID: `com.speckrmm.ios`. Team: `7PTN7E8EDS`.

## Work from your phone

- Search and filter the fleet; inspect services, current app, storage and networking.
- Open screen control or SSH in a full-screen remote workspace. Run reviewed
  PowerShell/shell commands and follow their output in Jobs.
- See opted-in, short-lived screen previews; enable or disable capture per machine.
- Browse folders, verify downloaded files with SHA-256 and share through Files.
  Upload selected documents without overwriting existing files.
- Review update scans and selected installations. Run existing software/script
  templates against selected compatible machines, with a server-generated preview.
- Read and acknowledge alerts. Inspect recurring schedules.
- Start saved Slide recovery plans and read verification evidence. Restored machine
  identities remain separate from the originals.
- Draft scripts through the server's OpenAI integration; scripts require review
  before execution. The app never contains an OpenAI or Slide provider key.

Use the web console for enrollment, account/MFA administration, template/schedule
creation, recovery-plan editing, clone approval and stopping recovery resources.
Remote screen/SSH transport uses the existing web workspace inside an isolated
WKWebView; the inventory and management screens use native SwiftUI controls.

## Development

```sh
npm ci --prefix web
node ios/scripts/generate-assets.mjs
xcodegen generate --spec ios/project.yml
open ios/Speck.xcodeproj
```

The checked-in project is generated from `project.yml`. Asset generation consumes
the canonical vector icon and outlined wordmarks in `brand/`; do not fork the logo.

Run unit tests with an available iPhone simulator:

```sh
xcodebuild -project ios/Speck.xcodeproj -scheme Speck \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro' \
  -only-testing:SpeckTests test CODE_SIGNING_ALLOWED=NO
```

Debug builds accept `--sign-in-preview` to inspect the sign-in screen without clearing a saved session, and `--demo` to load the same synthetic dental-office fixtures
used by the web screenshot gallery. Demo mutations are rejected. Release builds
cannot activate demo mode. UI regression tests are provided in `SpeckUITests`;
interactive release qualification is recorded separately. For the dark appearance pass, set the
simulator to dark first (`xcrun simctl ui DEVICE_ID appearance dark`), run
`-only-testing:SpeckUITests/SpeckUITests/testDarkAppearance`, then restore light.
The standard pass uses `-skip-testing:SpeckUITests/SpeckUITests/testDarkAppearance`.
Always check the executed test count; an incomplete test identifier can select zero tests.

## Sessions and privacy

Sessions use the device-only Keychain. Passwords are never persisted. API requests
use HTTPS, the server's session cookie and CSRF token, reject redirects, and use
an ephemeral URLSession. Remote sessions use a separate, nonpersistent WebKit
data store. Screens are hidden in the app switcher; previews remain in memory.

The privacy manifest declares account identifiers, submitted content and operator
activity for app functionality, linked to the operator account. Speck includes no
advertising or tracking SDK. Microphone access is optional and requires permission.
See [iOS privacy](../docs/ios-privacy.md).

## Release

The **Speck testing** internal TestFlight group is configured with the account
holder. Automatic distribution is disabled so each build can be qualified first.
Release tooling reads the scoped App Store Connect key from AustinLand. Never
commit signing keys, profiles, credentials, live inventory or private screenshots.

Current qualification and TestFlight build: [iOS qualification](../docs/ios-quality.md).
