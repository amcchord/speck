# Deployment

The supplied deployment targets a dedicated Debian 13 server with Python 3,
Docker and Caddy. A 2-vCPU / 4-GB host is sufficient for a small lab; remote
sessions increase CPU and bandwidth use. Speck runs as an unprivileged system
account. Endpoint agents run as SYSTEM/root to provide administration.

Build with `./scripts/build.sh`. Copy `server/speck`, `web/dist`, and
`output/downloads` to the paths in `deploy/speck.service`. Install the pinned
Python packages from `deploy/requirements.txt` in `/opt/speck/.venv`.

Create `/etc/speck/server.env` (root:root, mode 600) with:

```text
SPECK_DATA_DIR=/var/lib/speck
SPECK_ORIGIN=https://your-domain.example
SPECK_ADMIN_USERNAME=admin
SPECK_BOOTSTRAP_PASSWORD=<unique random password>
SPECK_ENCRYPTION_KEY=<unique random key>
SPECK_WEB_DIR=/opt/speck/web
SPECK_DOWNLOAD_DIR=/opt/speck/downloads
```

The service account must own `/var/lib/speck` (mode 700). Application code and
binaries should be owned by root and read-only to the service account.
Run exactly one application worker: the gateway's short-lived remote sessions
are held in that process. The SQLite store and recovery journal are durable.

Run the gateway using the pinned image digest from `scripts/deploy.py`:

```sh
docker run -d --name speck-guacd --restart unless-stopped --network host \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,size=256m \
  --tmpfs /home/guacd:rw,noexec,nosuid,size=16m,uid=1000,gid=1000 \
  --cap-drop ALL --security-opt no-new-privileges --memory 1g \
  guacamole/guacd:1.6.0 -b 127.0.0.1
```

The writable temporary home is required by FreeRDP. It is discarded when the
container is replaced. The control plane supplies credentials per session.

Adapt the Caddy domain, validate its configuration, then start the service and
reload Caddy. Confirm `/health` is reachable over HTTPS. The dedicated-host
firewall allows inbound 22/80/443; adapt SSH access for your network. The optional
`scripts/provision_linode.py` and `scripts/deploy.py` use a local AustinLand vault
and are not required for manual deployment.

## Local release checks

Use the local checks as the primary release gate and retain GitHub Actions as a
secondary check. From the repository root:

```sh
./scripts/check-local.sh core  # backend, Linux agent, all agent builds, web and browsers
./scripts/check-local.sh ios   # iPhone unit tests and iPad sign-in layout
./scripts/check-local.sh all   # both groups, sequentially
```

Core checks need uv, Node.js, npm and Go; macOS also needs Docker to execute Linux
agent tests. Install the Chromium/WebKit Playwright browsers once with
`cd web && npx playwright install chromium webkit` after `npm ci`. iOS checks need
Xcode and available iPhone/iPad simulators. They prefer already-booted simulators,
wait for readiness and disable parallel simulator clones. Set
`SPECK_SIMULATOR_ID` / `SPECK_IPAD_SIMULATOR_ID` to select particular devices.
Derived data remains under ignored `output/local-checks/`.

Run the groups relevant to the change. Record source revision, test results and
any host/runner differences. A hosted simulator launch failure is distinct from a
test assertion failure; local success does not make the hosted run successful.
Required GitHub branch checks still apply. The scripts validate/build only and do
not deploy, publish agent releases or contact production.

## Enroll a device

Create an enrollment in the console. Download and inspect the appropriate
installer from `/downloads/`, then execute it as Administrator/root. Supply your
server URL and the one-use token when prompted. For Linux, set `SPECK_SERVER`;
for Windows, pass `-Server`. Installers verify agent binaries against the HTTPS
SHA-256 manifest. Authenticode signing is not included in this initial release.

Linux installs `SpeckAgent.service` and a desktop autostart helper. Windows
installs `SpeckAgent` and an unprivileged logon task. The helper starts at the
next sign-in. Headless servers need no helper. Agents 0.3.1 and later automatically install signed releases while idle. Admins
can pause this in Settings → Automatic updates. Older agents require one installer
upgrade to bootstrap the updater; existing enrollment is preserved. See
[agent releases and rollback](operations/agent-updates.md).

## Back up the server

Protect `/var/lib/speck` and `/etc/speck/server.env`. Use SQLite's backup API for
a live database copy, or stop the service before copying its database, WAL and
transfer files. Keep the encryption key in a separate protected backup. Restore
the same key with the database; generating a replacement key will make stored
credentials and plan/job payloads unreadable.

A restart deliberately marks in-flight commands unknown and recovery runs as
needing attention. Review provider resources before rerunning writes. Reconnect
remote sessions after restarting the server.

## Read-only checks

```sh
systemctl status speck caddy
curl --fail https://your-domain.example/health
ss -lntp                 # application and guacd must bind 127.0.0.1
journalctl -u speck -n 30
docker logs --tail 30 speck-guacd
```

Avoid logging request bodies, enrollment tokens, private keys, or complete
provider responses. Native RDP uses a private IP reported by the endpoint;
connect to the LAN or recovery VPN before using it.
