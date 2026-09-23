#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
(cd web && npm ci)
(cd web && npm run build)
for component in speck-agent speck-desktop; do
 (cd agent && go run github.com/tc-hib/go-winres@v0.3.3 make --in "../brand/windows/$component.json" --arch amd64 --out "cmd/$component/rsrc")
done
mkdir -p output/downloads
(cd agent && GOOS=windows GOARCH=amd64 go build -trimpath -ldflags='-s -w' -o ../output/downloads/speck-agent-windows-amd64.exe ./cmd/speck-agent)
(cd agent && GOOS=windows GOARCH=amd64 go build -trimpath -ldflags='-s -w -H windowsgui' -o ../output/downloads/speck-desktop-windows-amd64.exe ./cmd/speck-desktop)
for arch in amd64 arm64; do
 (cd agent && GOOS=linux GOARCH="$arch" go build -trimpath -ldflags='-s -w' -o "../output/downloads/speck-agent-linux-$arch" ./cmd/speck-agent)
done
(cd agent && GOOS=linux GOARCH=amd64 go build -trimpath -ldflags='-s -w' -o ../output/downloads/speck-proxmox-linux-amd64 ./cmd/speck-proxmox)
cp deploy/speck-proxmox.service output/downloads/
python3 - <<'HASH'
import hashlib
from pathlib import Path
root=Path('output/downloads')
name='speck-proxmox-linux-amd64'
(root/'PROXMOX-SHA256SUMS').write_text(hashlib.sha256((root/name).read_bytes()).hexdigest()+'  '+name+'\n')
HASH
cp installers/install-* output/downloads/
cp brand/assets/speck-icon.svg brand/assets/speck.ico output/downloads/
python3 - <<'PY'
import hashlib
from pathlib import Path
root=Path('output/downloads')
(root/'SHA256SUMS').write_text(''.join(hashlib.sha256(f.read_bytes()).hexdigest()+'  '+f.name+'\n' for f in sorted(root.iterdir()) if f.is_file() and f.name != 'SHA256SUMS'))
PY
