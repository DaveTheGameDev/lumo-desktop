# Security Policy

Lumo Desktop is an **unofficial**, community-maintained Electron wrapper around Proton's Lumo
web app (<https://lumo.proton.me>), packaged as a Flatpak with the application ID
`io.github.davethegamedev.LumoDesktop`. It is not built, endorsed, reviewed or supported by
Proton. The wrapper is deliberately thin: Proton's unmodified web app is loaded in a sandboxed
renderer as an ordinary untrusted remote origin, and everything this project adds — window state,
tray icon, toggle shortcut, spellchecker, context menu, navigation allowlist — lives in the main
process (`src/main.js`, roughly 700 lines) and needs no cooperation from the page.

## Supported versions

| Version | Supported |
| --- | --- |
| Latest release on <https://github.com/DaveTheGameDev/lumo-desktop/releases> | Yes |
| Any older release | No |

Only the newest release receives fixes. A full Chromium build is bundled inside the Flatpak and
there is no auto-update mechanism, so an old install keeps running an old browser engine: always
install the newest release rather than staying on a version that still works.

## Scope

**In scope** — anything in this repository:

- the Electron main process (`src/main.js`) and the preload script (`src/preload.js`)
- the Flatpak manifest and the permissions it requests (`flatpak/io.github.davethegamedev.LumoDesktop.yml`)
- the launcher wrapper (`flatpak/lumo-desktop.sh`), the build script (`scripts/build-flatpak.sh`)
  and the published `.flatpak` bundle

**Out of scope — report these to Proton, not here:**

- the Lumo web app itself, its UI and its behaviour
- Proton accounts, login, 2FA, SRP and session handling
- Proton's APIs, server infrastructure and cryptography

Proton's security contact is `security@proton.me`, and its disclosure policy is published at
<https://proton.me/security/bug-bounty>.

Vulnerabilities in Electron or Chromium belong upstream, but please tell this project too **if
its configuration is what makes one exploitable** — for example if the navigation allowlist or the
Flatpak permissions turn an upstream bug into a worse outcome than it would have in a browser.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting:

**<https://github.com/DaveTheGameDev/lumo-desktop/security/advisories/new>**
(or the repository's **Security** tab → *Report a vulnerability*)

Please do **not** open a public issue for a security problem.

Include as much of the following as you can:

- the release version or the commit hash you tested
- your distribution and desktop environment (and Wayland or X11)
- whether you ran the Flatpak or `npm start` from a source checkout
- steps to reproduce, and what an attacker gains
- a proof of concept, if you have one

What to expect: **acknowledgement within 7 days**, and for high-severity issues a best-effort fix
or a published advisory **within 30 days**. Disclosure is coordinated — please give the fix a
chance to ship before going public — and you get credit in the advisory if you want it. There is
**no bounty**: this is a solo, unpaid volunteer project with no budget for rewards.

## Security model

### Renderer isolation

The main window — and any child window the app allows — is created with `contextIsolation: true`,
`sandbox: true` and `nodeIntegration: false`. The page runs in Chromium's renderer sandbox with no
access to Node or to Electron internals.

`src/preload.js` deliberately exposes nothing: there is no `contextBridge` call and no `ipcMain`
handler anywhere in the project, so the page has no message channel into the main process at all.
The preload file exists only to make that boundary explicit and to give any future proposal to
open one an obvious place to be reviewed.

### What the main process does and does not do

The main process never inspects or modifies page content, and never handles credentials. There
is no `session.cookies` access, no `webRequest` interception, no `executeJavaScript` or
`insertCSS`, no `certificate-error` handler and no `setCertificateVerifyProc` (so TLS validation
is Chromium's, unmodified), no custom user agent (an override exists only as commented-out code),
no proxy configuration and no remote-debugging flags.

Downloads and uploads are left to Electron's defaults on purpose: under Flatpak, Chromium's GTK
dialogs go through the XDG FileChooser portal, so the app only ever sees the individual files the
user picks. There is no `will-download` handler that could bypass that.

### Navigation allowlist

Every `webContents` created by the app gets the same guards:

- `will-navigate` allows a navigation only if the URL is `https:` **and** its host matches
  `^([a-z0-9-]+\.)*proton\.me$`. Anything else is cancelled and handed to the system browser.
- The window-open handler denies anything that is not an allowed `https://…proton.me` URL. Of the
  allowed ones, only `lumo.proton.me` and `account.proton.me` may take over the main window; other
  proton.me pages (blog, legal, support) go to the system browser. A `window.open()` with window
  features — how Proton's OAuth/2FA-style flows behave — gets its own child window, created with
  the same isolation settings as the main window.
- Only `http:` and `https:` URLs are ever passed to `shell.openExternal`; any other scheme is
  dropped silently. Under Flatpak, `openExternal` goes through the OpenURI portal, so the
  sandbox — not the app — decides what actually opens.

### Sandbox permissions

The Flatpak requests exactly this:

| Permission | Purpose |
| --- | --- |
| `--share=ipc` | X11 shared-memory; required for reasonable rendering performance |
| `--share=network` | Reach `lumo.proton.me`; without it the app cannot work |
| `--socket=wayland` | Native Wayland display |
| `--socket=fallback-x11` | X11 display, used only when Wayland is unavailable |
| `--device=dri` | GPU access for hardware-accelerated rendering |
| `--socket=pulseaudio` | Audio and microphone, so Lumo's voice input can work |
| `--talk-name=org.freedesktop.Notifications` | Desktop notifications raised by the page |
| `--talk-name=org.kde.StatusNotifierWatcher` | Tray icon (StatusNotifierItem) |
| `--env=XCURSOR_PATH=…` | Find the host cursor theme instead of the X11 default |

Deliberately **not** requested:

- **No `--filesystem=` of any kind.** The app has no access to your home directory. File
  open/save dialogs run through the XDG portal, which hands back only the chosen file.
- **No `--talk-name=org.freedesktop.secrets`.** The Secret Service API has no per-application
  isolation: granting it would expose the *entire* GNOME Keyring / KWallet to this app. That
  trade-off was judged worse than the consequence described under *Data at rest* below.
- **No `--socket=session-bus`, no `--socket=system-bus`** — only the two bus names in the table
  above are reachable — and **no `--device=all`**: the GPU only, not arbitrary devices.

### Credentials and encryption

Your Proton password, 2FA code, the SRP login exchange and all end-to-end encryption are handled
by Proton's own unmodified web app inside the sandboxed renderer, exactly as they would be in a
browser tab. This wrapper adds no login screen, no credential prompt and no key handling, and
never sees any of it.

### Data at rest

Chromium's profile lives in:

- `~/.var/app/io.github.davethegamedev.LumoDesktop/config/Lumo Desktop/` (Flatpak), or
- `~/.config/Lumo Desktop/` (running from source with `npm start`)

**Cookies in that profile are stored in plaintext.** Chromium normally encrypts its cookie
database with a key from the system keyring, and the sandbox cannot reach the keyring for the
reason given above, so it falls back to no encryption. The files are mode `0600` inside a `0700`
directory, so other users on the machine cannot read them — but anyone who can read your home
directory, or an unencrypted disk image of it, can lift your session. **Use full-disk encryption.**

Proton's own client-side encrypted data lives in IndexedDB and localStorage in the same profile,
as it does in a browser. Deleting the profile directory logs you out and removes local state.

### Network activity

The wrapper itself contacts nothing beyond what the page loads, with one exception: Electron's
built-in spellchecker downloads Hunspell dictionaries from Google's CDN on first use, which
reveals your IP address and locale to Google. The text you type is checked locally and is never
sent anywhere.

There is no telemetry, no analytics, no update check and no crash-report upload: `crashReporter`
is never started, so Crashpad only ever writes minidumps locally.

### Engine updates

The app bundles Electron 44.3.0 (Chromium 152) inside the Flatpak. **There is no auto-update.**
You get Chromium security fixes only by installing a newer release — or, from a source checkout,
by bumping `electron` in `package.json` and rebuilding. The maintainer tracks Electron stable
releases and rebuilds on a best-effort basis when Chromium security fixes land.

## Known limitations

These are accepted trade-offs, stated plainly rather than hidden:

- **Plaintext cookies at rest**, as described above. Full-disk encryption is the mitigation.
- **No automatic engine updates.** A stale install is a stale browser.
- **No address bar.** You cannot see what URL is loaded. The navigation allowlist is the
  mitigation: only `https://*.proton.me` can ever render in-window.
- **DevTools is reachable from the View menu.** This is local access only, the same as in any
  browser, but anyone at your keyboard can use it.
- **The spellchecker's first-use dictionary download** talks to Google's CDN.
- **The main process is trusted code with full system access**, as in every Electron app; it is
  not sandboxed the way the renderer is. The mitigation is that it is small enough to review —
  read `src/main.js` yourself before trusting it.

## Hardening tips

- **Revoke audio** if you never use voice input:

  ```sh
  flatpak override --user --nosocket=pulseaudio io.github.davethegamedev.LumoDesktop
  ```

- **Use full-disk encryption.** It is the only real protection for the plaintext cookie database.
- **Verify the download.** Check the `sha256sum` of the `.flatpak` bundle against the checksum in
  the release notes before installing it.
- **Review the permissions with [Flatseal](https://flathub.org/apps/com.github.tchx84.Flatseal)**
  and remove anything you do not need.
- **Log out of Lumo before lending someone the machine**, or delete the profile directory
  (`~/.var/app/io.github.davethegamedev.LumoDesktop/config/Lumo Desktop/`), which logs you out.
