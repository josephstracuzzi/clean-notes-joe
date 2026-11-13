#!/bin/bash
# Signs one app ad hoc and zips it for both Macs: "<name> <version> Mac Apple Silicon.zip" and "... Mac Intel.zip"
# Usage: mac-zip.sh "<product name>" (run after electron-builder --mac dir --x64 --arm64)
set -euo pipefail
name="$1"
for pair in "mac-arm64:Apple Silicon" "mac:Intel"; do
    dir="${pair%%:*}"; label="${pair#*:}"
    app="dist/$dir/$name.app"
    codesign --force --deep --sign - "$app"
    codesign --verify --deep --strict "$app"
    ditto -c -k --sequesterRsrc --keepParent "$app" "dist/$name $VERSION Mac $label.zip"
done
ls -la dist/*.zip
