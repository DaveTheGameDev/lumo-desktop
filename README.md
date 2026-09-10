# Lumo Desktop

An unofficial Linux desktop wrapper around [Proton's Lumo web app](https://lumo.proton.me), packaged as a Flatpak for personal use.

> **Unofficial. Not affiliated with, endorsed by, or supported by Proton AG.** "Lumo" and "Proton" are trademarks of Proton AG. This is a thin Electron shell around their public web app, nothing more.

## Why

- Distro-independent: a single Flatpak bundle runs the same way on any Linux distro that has Flatpak, instead of chasing per-distro packages.
- Proton's own web app runs unmodified inside the wrapper, so login, 2FA, and end-to-end encryption are entirely Proton's code doing Proton's job — this project never touches credentials or crypto.
- Deliberately thin: a window, a tray icon, and a handful of native-integration conveniences. No reimplementation of Lumo's API or protocol.

## Features

- **System tray icon** with a quick way to show/hide the window.
- **Show/Hide toggle** without a tray click, via:
  ```
  flatpak run io.github.davethegamedev.LumoDesktop --toggle
  ```
  Bind this to a keyboard shortcut in **GNOME Settings → Keyboard → View and Customize Shortcuts → Custom Shortcuts → Add Shortcut**, with the command above and whatever key combo you like.
- **Native notifications** via the desktop notification daemon.
- **Spellcheck** with right-click suggestions, using Electron's built-in spellchecker.
- **Portal-based file dialogs** — uploads/downloads go through the XDG desktop portals rather than broad filesystem access.
- **Wayland native**, with an X11 fallback.
- **Keyboard shortcuts**: Ctrl+Q quit, Ctrl+W close to tray, Ctrl+R reload, Alt+Left / Alt+Right back/forward, Ctrl+Shift+H back to Lumo home, Ctrl+Plus / Ctrl+Minus / Ctrl+0 zoom in/out/reset, Alt shows the menu bar.
- Links to other websites, and to proton.me pages other than Lumo/account, open in your default browser instead of inside the app window.

## Build & install

Prerequisites:

- Node.js >= 22
- Flatpak, with:
  ```
  flatpak install --user flathub org.electronjs.Electron2.BaseApp//25.08 org.flatpak.Builder
  ```

Build everything (packages the Electron app, then builds and installs the Flatpak):

```
scripts/build-flatpak.sh
```

This produces `LumoDesktop.flatpak` in the repo root and also installs the app to your user Flatpak install. To install the bundle somewhere else (e.g. another machine):

```
flatpak install --user LumoDesktop.flatpak
```

Pass `--no-bundle` to `scripts/build-flatpak.sh` to build and install locally without producing the `.flatpak` bundle file.

## Development

Run it directly with Electron, outside of Flatpak, while iterating:

```
npm install
npm start
```

## Notes / limitations

- **Tray icon on GNOME**: vanilla GNOME Shell doesn't render `StatusNotifierItem` tray icons without the [AppIndicator and KStatusNotifierItem Support extension](https://extensions.gnome.org/extension/615/appindicator-support/). The app works fine without it — just relaunch it or run the `--toggle` command above to bring the window back.
- **Spellcheck dictionaries**: Electron's built-in spellchecker downloads its dictionaries from Google's CDN the first time each language is used, so the first spellcheck needs network access.
- **Global shortcut caveat**: Electron's `globalShortcut` (bound to Ctrl+Shift+L) only works reliably on X11. Under Wayland, use the `--toggle` command above with a compositor-level custom shortcut instead — see Features above.
- **Profile location**: cookies, session, and window state live in `~/.var/app/io.github.davethegamedev.LumoDesktop/config/Lumo Desktop/` when running as a Flatpak, and in `~/.config/Lumo Desktop/` when run via `npm start`. Deleting that directory logs you out and resets the app.
- **Offline handling**: if Lumo can't be reached, the window shows a simple "Can't reach Lumo" page with a Retry link.
- **No audio/microphone by default**: the sandbox ships without `--socket=pulseaudio`, so the app has no audio or microphone access out of the box. If you want to use voice input in Lumo, grant it to the installed app without rebuilding:
  ```
  flatpak override --user --socket=pulseaudio io.github.davethegamedev.LumoDesktop
  ```
  and revoke it again with:
  ```
  flatpak override --user --nosocket=pulseaudio io.github.davethegamedev.LumoDesktop
  ```
- **Trademark note**: "Lumo" and "Proton" are trademarks of Proton AG. This project is for personal use; it would need a distinct name and a different app ID before any public or Flathub distribution.

## License

GPL-3.0. See [LICENSE](LICENSE).
