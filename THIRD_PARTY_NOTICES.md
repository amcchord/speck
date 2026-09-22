# Third-party components

Speck's original code is MIT licensed. Dependencies retain their own licenses.

- [Apache Guacamole](https://guacamole.apache.org/): Apache License 2.0.
  `guacamole-common-js` supplies the browser client. The separate `guacd` image
  includes additional upstream components under their respective licenses.
  [Configuration reference](https://guacamole.apache.org/doc/gug/configuring-guacamole.html).
- Go libraries: gorilla/websocket (BSD-2-Clause), kardianos/service (Zlib),
  gopsutil (BSD-3-Clause), and golang.org/x/sys (BSD-3-Clause).
- FastAPI (MIT), Starlette (BSD-3-Clause), Uvicorn (BSD-3-Clause), HTTPX (BSD-3-Clause),
  Argon2-cffi (MIT), PyOTP (MIT), Cryptography (Apache-2.0 or BSD-3-Clause), and their dependencies.
- Vite and TypeScript retain their upstream licenses.

Consult the pinned dependency lockfiles and installed package license files for
complete dependency details. No Slide software or private application source is
included in this repository. Speck calls the separately operated Slide API.

## Inter

Inter 4.1 by Rasmus Andersson, SIL Open Font License 1.1. The self-hosted variable
font and license are in `brand/fonts/`. Speck's outlined wordmark derives from
Inter at weight 650 / optical size 32; its SVGs contain paths and need no font.
Source: https://github.com/rsms/inter/tree/v4.1

## Build tooling

Windows resources are built with go-winres 0.3.3 (0BSD) and its dependencies.
SVG exports use @resvg/resvg-js 2.6.2 (MPL-2.0). These are build tools, not agent
or console runtime dependencies. Original Speck marks and interface icons are
covered by this repository's MIT license.

## Desktop client and screen previews

Electron (MIT) includes Chromium, Node.js and their upstream notices; packaged
clients include those notices. electron-builder is MIT licensed. Screen previews
use kbinani/screenshot (MIT), jezek/xgb (BSD-3-Clause), lxn/win (BSD-3-Clause),
gen2brain/shm (BSD-2-Clause) and godbus/dbus (BSD-2-Clause). Consult the versions
in `desktop/package-lock.json` and `agent/go.sum`.
