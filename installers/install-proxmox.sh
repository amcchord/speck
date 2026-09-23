#!/bin/sh
# Inspect before running as root. Enrollment JSON is read from stdin, not argv.
set -eu
[ "$(id -u)" = 0 ] || { echo 'Run as root' >&2; exit 1; }
[ -x /usr/bin/pvesh ] || { echo 'A Proxmox host is required' >&2; exit 1; }
[ ! -e /etc/speck-proxmox/agent.json ] || { echo 'Already enrolled; enrollment preserved' >&2; exit 1; }
: "${SPECK_SERVER:?Set SPECK_SERVER to your HTTPS Speck origin}"
case "$SPECK_SERVER" in https://*) ;; *) exit 1 ;; esac
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
curl --proto '=https' --fail --silent --show-error "$SPECK_SERVER/downloads/speck-proxmox-linux-amd64" -o "$stage/speck-proxmox-linux-amd64"
curl --proto '=https' --fail --silent --show-error "$SPECK_SERVER/downloads/PROXMOX-SHA256SUMS" -o "$stage/sums"
(cd "$stage" && sha256sum --check sums)
install -m 755 "$stage/speck-proxmox-linux-amd64" /usr/local/sbin/speck-proxmox
/usr/local/sbin/speck-proxmox enroll
curl --proto '=https' --fail --silent --show-error "$SPECK_SERVER/downloads/speck-proxmox.service" -o "$stage/service"
install -m 644 "$stage/service" /etc/systemd/system/speck-proxmox.service
systemctl daemon-reload
systemctl enable --now speck-proxmox
