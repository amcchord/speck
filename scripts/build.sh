#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
(cd web && npm ci && npm run build)
mkdir -p output/downloads
(cd agent && GOOS=windows GOARCH=amd64 go build -trimpath -ldflags='-s -w' -o ../output/downloads/speck-agent-windows-amd64.exe ./cmd/speck-agent)
(cd agent && GOOS=windows GOARCH=amd64 go build -trimpath -ldflags='-s -w -H windowsgui' -o ../output/downloads/speck-desktop-windows-amd64.exe ./cmd/speck-desktop)
for arch in amd64 arm64; do
 (cd agent && GOOS=linux GOARCH="$arch" go build -trimpath -ldflags='-s -w' -o "../output/downloads/speck-agent-linux-$arch" ./cmd/speck-agent)
done
cp installers/install-* output/downloads/
python3 - <<'PY'
import hashlib
from pathlib import Path
root=Path('output/downloads')
(root/'SHA256SUMS').write_text(''.join(hashlib.sha256(f.read_bytes()).hexdigest()+'  '+f.name+'\n' for f in sorted(root.iterdir()) if f.name != 'SHA256SUMS'))
PY
