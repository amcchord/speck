# Third-party components

Speck's original code is MIT licensed. Dependencies retain their own licenses.

- [Apache Guacamole](https://guacamole.apache.org/): Apache License 2.0.
  `guacamole-common-js` supplies the browser client. The separate `guacd` image
  includes additional upstream components under their respective licenses.
  [Configuration reference](https://guacamole.apache.org/doc/gug/configuring-guacamole.html).
- Go libraries: gorilla/websocket (BSD-2-Clause), kardianos/service (Zlib),
  gopsutil (BSD-3-Clause), and golang.org/x/sys (BSD-3-Clause).
- FastAPI (MIT), Starlette (BSD-3-Clause), Uvicorn (BSD-3-Clause), HTTPX (BSD-3-Clause),
  Argon2-cffi (MIT), Cryptography (Apache-2.0 or BSD-3-Clause), and their dependencies.
- Vite and TypeScript retain their upstream licenses.

Consult the pinned dependency lockfiles and installed package license files for
complete dependency details. No Slide software or private application source is
included in this repository. Speck calls the separately operated Slide API.
