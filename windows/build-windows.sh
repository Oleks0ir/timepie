#!/bin/bash
# Builds a Windows (x64) TimePie you can zip up and send — runs fine on a Mac.
set -euo pipefail
cd "$(dirname "$0")"

[ -d node_modules ] || npm install

echo "› icon…"
node scripts/make-icon.js

echo "› packaging for Windows x64…"
rm -rf dist
npx @electron/packager . TimePie \
  --platform=win32 --arch=x64 \
  --out=dist --overwrite --asar \
  --icon=build/icon.ico \
  --app-copyright="Nikolai Kravchenko" \
  --win32metadata.CompanyName="TimePie" \
  --win32metadata.FileDescription="TimePie" \
  --win32metadata.ProductName="TimePie" \
  --ignore='^/(dist|scripts|node_modules)($|/)' --ignore='^/(build-windows\.sh|\.gitignore|package-lock\.json)$'

# The app has no runtime dependencies (Preact is vendored into src/), and only needs
# Chromium's English UI strings — this trims the download considerably.
find dist/TimePie-win32-x64/locales -type f ! -name 'en-US.pak' -delete

echo "› zipping…"
(cd dist && mv TimePie-win32-x64 TimePie && zip -qry TimePie-Windows.zip TimePie)

echo "✓ dist/TimePie-Windows.zip ($(du -h dist/TimePie-Windows.zip | cut -f1))"
echo "  send that zip; your friend unzips it and runs TimePie\\TimePie.exe"
