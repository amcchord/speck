#!/usr/bin/env bash
# Local equivalents of the core, browser and iOS GitHub checks.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

mode=${1:-core}
case "$mode" in core|ios|all) ;; *) echo "Usage: $0 [core|ios|all]" >&2; exit 2 ;; esac

if [[ "$mode" != ios ]]; then
  uv sync --locked
  uv run ruff check server
  uv run pytest -q
  if [[ "$(uname -s)" == Linux ]]; then
    (cd agent && GOWORK=off go test -race ./internal/agent)
  else
    # The managed endpoint runtime is Linux/Windows, not macOS.
    docker run --rm -v "$PWD/agent:/src" -w /src -e GOWORK=off golang:1.24 go test -race ./internal/agent
  fi
  GOWORK=off ./scripts/build.sh
  node --experimental-strip-types --test web/test/*.test.mjs
  npm run test:ui --prefix web
fi

if [[ "$mode" != core ]]; then
  [[ "$(uname -s)" == Darwin ]] || { echo "iOS checks require macOS and Xcode" >&2; exit 1; }
  mkdir -p output/local-checks
  xcrun simctl list devices available -j > output/local-checks/simulators.json
  choose_device() {
    python3 - "$1" <<'PY'
import json, sys
with open('output/local-checks/simulators.json') as source:
    data = json.load(source)
devices = [d for runtime, items in data['devices'].items() if 'iOS' in runtime
           for d in items if d['name'].startswith(sys.argv[1]) and d['isAvailable']]
devices.sort(key=lambda d: d['state'] != 'Booted')
if not devices:
    raise SystemExit('No available ' + sys.argv[1] + ' simulator')
print(devices[0]['udid'])
PY
  }
  phone=${SPECK_SIMULATOR_ID:-$(choose_device iPhone)}
  tablet=${SPECK_IPAD_SIMULATOR_ID:-$(choose_device iPad)}
  for device in "$phone" "$tablet"; do
    xcrun simctl bootstatus "$device" -b
  done
  xcodebuild -project ios/Speck.xcodeproj -scheme Speck \
    -derivedDataPath output/local-checks/DerivedData \
    -destination "platform=iOS Simulator,id=$phone" \
    -parallel-testing-enabled NO -only-testing:SpeckTests \
    test CODE_SIGNING_ALLOWED=NO
  xcodebuild -project ios/Speck.xcodeproj -scheme Speck \
    -derivedDataPath output/local-checks/DerivedData \
    -destination "platform=iOS Simulator,id=$tablet" \
    -parallel-testing-enabled NO \
    -only-testing:SpeckUITests/SpeckUITests/testSignInLayout \
    -collect-test-diagnostics never test CODE_SIGNING_ALLOWED=NO
fi

echo "Local $mode checks passed in ${SECONDS}s."
