#!/bin/bash
# Starts one Apple Silicon app and waits for its windows on the remote debugging port, then closes it.
# Usage: mac-check.sh "<product name>" "<window title to find>" ["<other page to find>"]
# Run right after the app is built: the next electron-builder run empties dist/mac-arm64.
set -uo pipefail
name="$1"; title="$2"; extra="${3:-}"
exe="dist/mac-arm64/$name.app/Contents/MacOS/$name"
found() { grep -q "$title" pages.json && { [ -z "$extra" ] || grep -q "$extra" pages.json; }; }
rm -f pages.json
"$exe" --remote-debugging-port=9223 &
pid=$!
for i in $(seq 1 40); do
    curl -s http://127.0.0.1:9223/json > pages.json || true
    if found; then break; fi
    sleep 1
done
cat pages.json
kill -9 $pid || true
sleep 2
found
