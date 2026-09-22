#!/usr/bin/env python3
"""Build immutable agent assets and an Ed25519-signed release offer.

The signing key stays on the operator host. Supply a file containing its base64
32-byte private seed, or use --vault for the local AustinLand release key.
"""
import argparse
import base64
import hashlib
import json
import re
import shutil
import time
import urllib.request
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', required=True)
    parser.add_argument('--downloads', type=Path, default=Path('output/downloads'))
    keys = parser.add_mutually_exclusive_group(required=True)
    keys.add_argument('--key-file', type=Path)
    keys.add_argument('--vault', action='store_true')
    args = parser.parse_args()
    if not re.fullmatch(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)', args.version):
        parser.error('Version must contain three numeric components')
    if args.vault:
        with urllib.request.urlopen('http://127.0.0.1:8472/api/keys/speck-agent-release-signing') as response:
            seed = json.load(response)['secrets']['PRIVATE_KEY_BASE64']
    else:
        seed = args.key_file.read_text().strip()
    key = Ed25519PrivateKey.from_private_bytes(base64.b64decode(seed, validate=True))
    release = {'version': args.version, 'releases': {}}
    root = args.downloads / 'agent-releases'
    destination = root / args.version
    destination.mkdir(parents=True, exist_ok=True)
    for platform, arch, names in [
        ('linux', 'amd64', ['speck-agent-linux-amd64']),
        ('linux', 'arm64', ['speck-agent-linux-arm64']),
        ('windows', 'amd64', ['speck-agent-windows-amd64.exe', 'speck-desktop-windows-amd64.exe']),
    ]:
        files = []
        for name in names:
            source, target = args.downloads / name, destination / name
            data = source.read_bytes()
            if target.exists() and target.read_bytes() != data:
                raise SystemExit('Refusing to overwrite immutable agent release: ' + name)
            if not target.exists():
                shutil.copyfile(source, target)
            files.append({'name': name, 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
        now = int(time.time())
        payload = json.dumps({'version': args.version, 'platform': platform, 'arch': arch,
                              'published_at': now, 'expires_at': now + 30 * 86400, 'files': files},
                             sort_keys=True, separators=(',', ':')).encode()
        release['releases'][platform + '-' + arch] = {
            'payload': base64.b64encode(payload).decode(),
            'signature': base64.b64encode(key.sign(payload)).decode(),
        }
    output = json.dumps(release, indent=2) + '\n'
    (destination / 'release.json').write_text(output)
    temporary = root / '.current.json'
    temporary.write_text(output)
    temporary.replace(root / 'current.json')
    print('Signed agent release ' + args.version + ' for Linux amd64/arm64 and Windows amd64.')


if __name__ == '__main__':
    main()
