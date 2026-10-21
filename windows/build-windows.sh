#!/bin/bash
# Builds TimePie-Windows-Setup.exe (x64): an install wizard with a choice of folder,
# Start menu and desktop shortcuts, and an uninstaller. Installing over an older version
# removes it first; the data in %APPDATA%\TimePie is never touched.
set -euo pipefail
cd "$(dirname "$0")"

[ -d node_modules ] || npm install

echo "› icon…"
node scripts/make-icon.js

# The app has no runtime dependencies (Preact is vendored into src/), and only ships
# Chromium's English UI strings (electronLanguages in package.json).
echo "› building the installer…"
rm -rf dist
npx electron-builder --win --x64 --publish never

# The same app as a plain zip, for anyone who'd rather not install: unzip and run
# TimePie\TimePie.exe. Windows has no zip command, so its built-in bsdtar makes it
# there (PowerShell's zips use backslashes in their paths, which other unzippers mangle).
echo "› zipping…"
mv dist/win-unpacked dist/TimePie
if command -v zip >/dev/null; then
  (cd dist && zip -qry TimePie-Windows.zip TimePie)
else
  (cd dist && "$(cygpath -u "$SYSTEMROOT")/System32/tar.exe" -a -cf TimePie-Windows.zip TimePie)
fi

echo "✓ dist/TimePie-Windows-Setup.exe ($(du -h dist/TimePie-Windows-Setup.exe | cut -f1))"
echo "✓ dist/TimePie-Windows.zip ($(du -h dist/TimePie-Windows.zip | cut -f1))"
echo "  send either; your friend runs the setup, or unzips and runs TimePie\\TimePie.exe"
