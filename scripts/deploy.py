#!/usr/bin/env python3
"""Deploy an already-built Speck release to its dedicated Linode.

Uses AustinLand's vault in memory. Does not print or copy credentials into source.
"""
import json
import os
import subprocess
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
HOST = os.environ.get('SPECK_SSH_HOST', '')
if not HOST and (ROOT / 'output/deployment.json').exists():
    deployment = json.loads((ROOT / 'output/deployment.json').read_text())
    address = deployment.get('ipv4')
    HOST = 'root@' + (address[0] if isinstance(address, list) else address)


def ssh(script, data=None):
    r = subprocess.run(['ssh', HOST, script], input=data, capture_output=True)
    if r.returncode:
        raise RuntimeError('Remote deployment command failed: ' + r.stderr.decode()[-1500:])
    return r.stdout.decode()


def main():
    if not HOST:
        raise SystemExit('Set SPECK_SSH_HOST to your dedicated server SSH destination')
    secret = json.load(urllib.request.urlopen('http://127.0.0.1:8472/api/keys/speck-rmm'))['secrets']
    ssh('id speck >/dev/null 2>&1 || useradd --system --home /var/lib/speck --shell /usr/sbin/nologin speck; install -d -m 755 /opt/speck /opt/speck/server /opt/speck/web /opt/speck/downloads; install -d -m 700 /etc/speck; install -d -o speck -g speck -m 700 /var/lib/speck')
    for source, target in [('server/speck/', '/opt/speck/server/speck/'), ('web/dist/', '/opt/speck/web/'), ('output/downloads/', '/opt/speck/downloads/')]:
        subprocess.run(['rsync', '-az', '--exclude=__pycache__', str(ROOT/source) + '/', HOST+':'+target], check=True)
    for source, target in [('deploy/requirements.txt','/opt/speck/requirements.txt'),('deploy/speck.service','/etc/systemd/system/speck.service'),('deploy/Caddyfile','/etc/caddy/Caddyfile'),('deploy/nftables.conf','/etc/nftables.conf')]:
        ssh('cat > '+target, (ROOT/source).read_bytes())
    env = {'SPECK_DATA_DIR':'/var/lib/speck','SPECK_ORIGIN':'https://speckrmm.com','SPECK_ENCRYPTION_KEY':secret['ENCRYPTION_KEY'],
           'SPECK_ADMIN_USERNAME':secret['ADMIN_USERNAME'],'SPECK_BOOTSTRAP_PASSWORD':secret['ADMIN_PASSWORD'],
           'SPECK_WEB_DIR':'/opt/speck/web','SPECK_DOWNLOAD_DIR':'/opt/speck/downloads'}
    ssh('umask 077; cat > /etc/speck/server.env', ''.join(k+'='+v+'\n' for k,v in env.items()).encode())
    setup = '''set -eu
python3 -m venv /opt/speck/.venv
/opt/speck/.venv/bin/pip install -q -r /opt/speck/requirements.txt
chown -R root:root /opt/speck
chmod -R a+rX /opt/speck
if ! docker container inspect speck-guacd >/dev/null 2>&1; then
 docker run -d --name speck-guacd --restart unless-stopped --network host --read-only --tmpfs /tmp:rw,noexec,nosuid,size=256m --tmpfs /home/guacd:rw,noexec,nosuid,size=16m,uid=1000,gid=1000 --cap-drop ALL --security-opt no-new-privileges --memory 1g guacamole/guacd@sha256:8974eaa9ba32f713daf311e7cc8cd7e4cdfba1edea39eed75524e78ef4b08f4f -b 127.0.0.1 >/dev/null
fi
systemctl daemon-reload
systemctl enable --now speck
systemctl restart speck
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
nft -c -f /etc/nftables.conf
nft -f /etc/nftables.conf
systemctl enable nftables
printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin prohibit-password\n' > /etc/ssh/sshd_config.d/00-speck.conf
sshd -t
systemctl reload ssh
'''
    print(ssh('bash -s', setup.encode()))
    print('Speck deployed; verify HTTPS, service health, and endpoint enrollment.')


if __name__ == '__main__':
    main()
