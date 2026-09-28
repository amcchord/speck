# Entity navigation

Unretouched Chromium desktop and WebKit phone captures of the actual built
console using synthetic inventory. No production data, credentials or private
session content. Dimensions and hashes are in [manifest.json](manifest.json).
Fixed panes retain their viewport position in full-page captures.

- [IP relationships, desktop](ip-desktop.png)
- [IP relationships, phone](ip-phone.png)
- [Network → client → equipment → port](network.png)

[Concepts, behavior and limits](../../operations/entity-navigation.md).
Reproduce after building with `npm run test:ui --prefix web -- entity-navigation.spec.mjs`.
