#!/bin/bash
# Assembles a real double-clickable TimePie.app — no Xcode required.
set -euo pipefail

cd "$(dirname "$0")"

CONFIG="${1:-release}"
APP="TimePie.app"
BUNDLE_ID="com.nikolaikravchenko.timepie"

echo "› building ($CONFIG)…"
swift build -c "$CONFIG"

BIN="$(swift build -c "$CONFIG" --show-bin-path)/TimePie"

echo "› assembling ${APP}…"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/TimePie"

# Generated from Downloads/logo.png by iconutil; see the AppIcon.iconset folder.
if [ -f AppIcon.icns ]; then
  cp AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
else
  echo "  (no AppIcon.icns — app will use the default icon)"
fi

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>            <string>TimePie</string>
    <key>CFBundleDisplayName</key>     <string>TimePie</string>
    <key>CFBundleExecutable</key>      <string>TimePie</string>
    <key>CFBundleIconFile</key>        <string>AppIcon</string>
    <key>CFBundleIdentifier</key>      <string>$BUNDLE_ID</string>
    <key>CFBundlePackageType</key>     <string>APPL</string>
    <key>CFBundleShortVersionString</key> <string>1.7.0</string>
    <key>CFBundleVersion</key>         <string>10</string>
    <key>LSMinimumSystemVersion</key>  <string>14.0</string>
    <key>NSHighResolutionCapable</key> <true/>
    <key>NSPrincipalClass</key>        <string>NSApplication</string>
    <key>LSApplicationCategoryType</key> <string>public.app-category.productivity</string>
</dict>
</plist>
PLIST

# Ad-hoc signature — enough for the app to run on this machine.
codesign --force --sign - "$APP" >/dev/null 2>&1 || echo "  (codesign skipped)"

echo "✓ $APP"
echo "  run:     open $APP"
echo "  install: cp -R $APP /Applications/"
