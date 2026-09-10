#!/usr/bin/env bash
# Installed as /app/bin/lumo-desktop (see the "command:" key in the Flatpak manifest).
#
# zypak-wrapper (no ".sh" suffix -- the form used by flathub/me.proton.Mail and documented in
# zypak's own README "Basic usage" section) redirects Chromium's sandbox through the Flatpak
# sandbox instead of the inert chrome-sandbox SUID helper.
#
# Flags:
#   --ozone-platform-hint=auto   let Chromium pick Wayland when available, X11 otherwise
#   --enable-features=WaylandWindowDecorations   server-side window decorations under Wayland
#   --enable-wayland-ime          proper IME support under native Wayland
#
# "$@" is forwarded untouched so `flatpak run io.github.davethegamedev.LumoDesktop --toggle`
# reaches src/main.js.
exec zypak-wrapper /app/lumo-desktop/lumo-desktop \
  --ozone-platform-hint=auto \
  --enable-features=WaylandWindowDecorations \
  --enable-wayland-ime \
  "$@"
