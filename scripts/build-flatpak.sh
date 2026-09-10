#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 DaveTheGameDev
# Builds Lumo Desktop and packages it as a Flatpak bundle (LumoDesktop.flatpak) for
# personal/self-distributed installation. Not a Flathub submission workflow.
#
# Usage: scripts/build-flatpak.sh [--no-bundle]
#   --no-bundle   build and --user --install the Flatpak but skip creating the .flatpak bundle

set -euo pipefail

NO_BUNDLE=0
for arg in "$@"; do
  case "$arg" in
    --no-bundle)
      NO_BUNDLE=1
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Usage: $0 [--no-bundle]" >&2
      exit 1
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

APP_ID="io.github.davethegamedev.LumoDesktop"
MANIFEST="flatpak/${APP_ID}.yml"
BUILD_DIR="build-dir"
REPO_DIR="repo"
BUNDLE="LumoDesktop.flatpak"

echo "==> Installing npm dependencies"
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

echo "==> Packaging the Electron app with @electron/packager"
# Ignore flatpak-builder output and repo-only files so they aren't copied into the
# packaged app (otherwise the second build fails and the app ships junk).
npx @electron/packager . lumo-desktop \
  --platform=linux \
  --arch=x64 \
  --out=dist \
  --overwrite \
  --icon=assets/icon.png \
  --ignore='^/(\.flatpak-builder|build-dir|repo|dist|flatpak|scripts|\.git.*|docs|.*\.flatpak)($|/)'

if [ ! -x "dist/lumo-desktop-linux-x64/lumo-desktop" ]; then
  echo "error: expected packager output at dist/lumo-desktop-linux-x64/lumo-desktop not found" >&2
  exit 1
fi

echo "==> Resolving a flatpak-builder"
if command -v flatpak-builder >/dev/null 2>&1; then
  BUILDER=(flatpak-builder)
else
  echo "    flatpak-builder not found on PATH; falling back to org.flatpak.Builder"
  BUILDER=(flatpak run org.flatpak.Builder)
fi

echo "==> Building and installing the Flatpak (--user)"
"${BUILDER[@]}" --user --install --force-clean --repo="$REPO_DIR" "$BUILD_DIR" "$MANIFEST"

if [ "$NO_BUNDLE" -eq 1 ]; then
  echo "==> --no-bundle passed, skipping bundle creation"
  echo "Done. Installed locally; run with: flatpak run $APP_ID"
  exit 0
fi

echo "==> Creating a distributable bundle"
flatpak build-bundle "$REPO_DIR" "$BUNDLE" "$APP_ID"

BUNDLE_PATH="$REPO_ROOT/$BUNDLE"
echo
echo "==> Done"
echo "Bundle: $BUNDLE_PATH"
echo
echo "Install it elsewhere with:"
echo "  flatpak install --user \"$BUNDLE_PATH\""
