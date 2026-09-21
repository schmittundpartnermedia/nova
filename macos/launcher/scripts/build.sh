#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SRC="$ROOT/macos/launcher/Sources"
RES="$ROOT/macos/launcher/Resources"
BUILD="$ROOT/macos/build"
APP="$BUILD/NOVA.app"
ICONSET="$RES/AppIcon.iconset"
IDENTITY_HINT="${NOVA_CODESIGN_IDENTITY:-}"

echo "NOVA.app bauen in $APP"

mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" "$ICONSET"

if [[ ! -f "$ICONSET/icon_512x512@2x.png" ]]; then
  python3 "$ROOT/macos/launcher/scripts/generate-placeholder-icon.py" "$ICONSET"
fi

if [[ ! -f "$ICONSET/icon_16x16.png" ]]; then
  sips -z 16 16 "$ICONSET/icon_512x512@2x.png" --out "$ICONSET/icon_16x16.png" >/dev/null
  sips -z 32 32 "$ICONSET/icon_512x512@2x.png" --out "$ICONSET/icon_16x16@2x.png" >/dev/null
  sips -z 32 32 "$ICONSET/icon_512x512@2x.png" --out "$ICONSET/icon_32x32.png" >/dev/null
  sips -z 64 64 "$ICONSET/icon_512x512@2x.png" --out "$ICONSET/icon_32x32@2x.png" >/dev/null
  sips -z 128 128 "$ICONSET/icon_512x512@2x.png" --out "$ICONSET/icon_128x128.png" >/dev/null
  sips -z 256 256 "$ICONSET/icon_512x512@2x.png" --out "$ICONSET/icon_128x128@2x.png" >/dev/null
  sips -z 256 256 "$ICONSET/icon_512x512@2x.png" --out "$ICONSET/icon_256x256.png" >/dev/null
  sips -z 512 512 "$ICONSET/icon_512x512@2x.png" --out "$ICONSET/icon_256x256@2x.png" >/dev/null
  sips -z 512 512 "$ICONSET/icon_512x512@2x.png" --out "$ICONSET/icon_512x512.png" >/dev/null
fi

iconutil -c icns "$ICONSET" -o "$RES/AppIcon.icns"

SDK="$(xcrun --show-sdk-path)"
swiftc -O \
  -target arm64-apple-macos13 \
  -sdk "$SDK" \
  -o "$APP/Contents/MacOS/NOVA" \
  "$SRC"/LaunchConfig.swift \
  "$SRC"/Logging.swift \
  "$SRC"/ProcessControl.swift \
  "$SRC"/HealthMonitor.swift \
  "$SRC"/ProcessSupervisor.swift \
  "$SRC"/Windows.swift \
  "$SRC"/AppDelegate.swift \
  "$SRC"/main.swift \
  -framework AppKit \
  -framework WebKit \
  -framework Foundation

cp "$RES/Info.plist" "$APP/Contents/Info.plist"
cp "$RES/LaunchConfig.plist" "$APP/Contents/Resources/LaunchConfig.plist"
cp "$RES/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"
printf 'APPLNOVA' > "$APP/Contents/PkgInfo"

IDENTITY="$IDENTITY_HINT"
if [[ -z "$IDENTITY" ]]; then
  IDENTITY="$(/usr/bin/security find-identity -v -p codesigning | sed -nE 's/^[[:space:]]*[0-9]+\)[[:space:]]+[A-F0-9]+[[:space:]]+"((Apple Development|Developer ID Application): [^"]+)"/\1/p' | head -n 1)"
fi
if [[ -z "$IDENTITY" ]]; then
  echo "Keine gültige Apple-Development-Identity gefunden." >&2
  exit 1
fi

echo "Signiere mit: $IDENTITY"
codesign --force --sign "$IDENTITY" --identifier io.elevum.nova --timestamp=none --entitlements "$RES/NOVA.entitlements" "$APP"
codesign --verify --verbose=2 "$APP"
echo "Fertig: $APP"
