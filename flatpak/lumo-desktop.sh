#!/usr/bin/env bash
# Installed as /app/bin/lumo-desktop (see the "command:" key in the Flatpak manifest).
#
# zypak-wrapper (no ".sh" suffix -- the form used by flathub/me.proton.Mail and documented in
# zypak's own README "Basic usage" section) redirects Chromium's sandbox through the Flatpak
# sandbox instead of the inert chrome-sandbox SUID helper.
#
# Flags:
#   --ozone-platform-hint=auto   let Chromium pick Wayland when available, X11 otherwise
#   --enable-features=WaylandWindowDecorations   let Chromium draw its own (client-side) window frame under Wayland
#   --enable-wayland-ime          proper IME support under native Wayland
#
# Window frame theme:
#   GNOME's Wayland compositor draws no window frames, so Chromium draws the title bar and its
#   buttons itself from whatever GTK 3 theme the sandbox sees (the host theme's
#   org.gtk.Gtk3theme.* extension). Themes that special-case Chromium windows can get that wrong:
#   Breeze's dark variant, for example, reuses its light-theme button images, leaving dark
#   minimise/maximise/close glyphs on a dark bar. Pin the frame to GTK's built-in Adwaita instead,
#   in the light or dark variant the desktop asks for (settings portal, org.freedesktop.appearance
#   color-scheme: 1 = prefer dark). GTK_THEME fixes the variant for the process lifetime, so a
#   light/dark switch while the app is running only takes effect after a relaunch. An explicit
#   GTK_THEME (flatpak override --env=GTK_THEME=...) is respected, and nothing is changed when the
#   portal cannot be asked.
if [ -z "${GTK_THEME:-}" ]; then
  color_scheme=$(gdbus call --session \
    --dest org.freedesktop.portal.Desktop \
    --object-path /org/freedesktop/portal/desktop \
    --method org.freedesktop.portal.Settings.Read \
    org.freedesktop.appearance color-scheme 2>/dev/null)
  case "$color_scheme" in
    *"uint32 1>"*) export GTK_THEME=Adwaita:dark ;;
    *"uint32 "*)   export GTK_THEME=Adwaita ;;
  esac
fi

# Tray icon:
#   Chromium publishes the tray icon (StatusNotifierItem) as a PNG in its temp directory and
#   hands the host only the path. The sandbox's /tmp is private, so the host's tray never finds
#   the file and shows a placeholder instead. $XDG_RUNTIME_DIR/app/$FLATPAK_ID is mounted at the
#   same path inside and outside the sandbox, so keep Chromium's temp files there. An explicit
#   TMPDIR (flatpak override --env=TMPDIR=...) is respected.
if [ -z "${TMPDIR:-}" ] && [ -n "${XDG_RUNTIME_DIR:-}" ] && [ -n "${FLATPAK_ID:-}" ]; then
  shared_tmp="$XDG_RUNTIME_DIR/app/$FLATPAK_ID"
  if mkdir -p "$shared_tmp" 2>/dev/null; then
    export TMPDIR="$shared_tmp"
  fi
fi

# "$@" is forwarded untouched so `flatpak run io.github.davethegamedev.LumoDesktop --toggle`
# reaches src/main.js.
exec zypak-wrapper /app/lumo-desktop/lumo-desktop \
  --ozone-platform-hint=auto \
  --enable-features=WaylandWindowDecorations \
  --enable-wayland-ime \
  "$@"
