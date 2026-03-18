#!/bin/sh
set -euo pipefail

echo "== Xcode Cloud post-clone: starting =="
cd "$CI_PRIMARY_REPOSITORY_PATH"

echo "Node: $(node -v)"
echo "NPM:  $(npm -v)"

if [ -f package-lock.json ]; then
  npm ci --no-audit --no-fund
else
  npm install --no-audit --no-fund
fi

# Generate or refresh iOS native project from Expo config on macOS runner.
npx expo prebuild --platform ios --clean

if [ -d ios ]; then
  cd ios
  if [ -f Podfile ]; then
    pod install --repo-update
  fi
fi

echo "== Xcode Cloud post-clone: done =="

