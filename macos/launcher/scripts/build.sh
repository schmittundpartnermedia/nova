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

swift "$ROOT/macos/launcher/scripts/generate-app-icon.swift" "$ICONSET"
for png in "$ICONSET"/*.png; do
  sips -s format png "$png" --out "$png" >/dev/null
done
xattr -cr "$ICONSET" >/dev/null 2>&1 || true
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
  "$SRC"/MailConsent.swift \
  "$SRC"/AppDelegate.swift \
  "$SRC"/main.swift \
  -framework AppKit \
  -framework ApplicationServices \
  -framework WebKit \
  -framework AVFoundation \
  -framework Speech \
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
