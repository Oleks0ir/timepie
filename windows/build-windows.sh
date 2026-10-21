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

echo "✓ dist/TimePie-Windows-Setup.exe ($(du -h dist/TimePie-Windows-Setup.exe | cut -f1))"
echo "  send that file; your friend runs it and follows the wizard"
