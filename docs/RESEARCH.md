# Lumo Desktop (Flatpak) — Research Brief

**Researched:** 2026-09-10 · **Question:** Is it possible and practical to package Proton's Lumo AI
assistant as a Flatpak Linux desktop app?

**Short answer: Yes.** A Flatpak for personal/self-distributed use is a day of work and there is
already a working Electron wrapper to learn from. Getting it onto **Flathub** is the hard part, and it
fails on a *policy* rule, not a technical one.

> Read this first if you're picking the work back up: jump to
> [§7 Concrete plan](#7-concrete-plan) and [§8 Risks](#8-risks-ranked). Everything above those is
> the evidence behind them.

---

## 1. Current state of Lumo

| Fact | Evidence |
|---|---|
| No official Lumo desktop client, any OS | <https://proton.me/lumo/download> lists **web, iOS, Android only** |
| Proton's only desktop shell is Mail+Calendar | [`applications/inbox-desktop`](https://github.com/ProtonMail/WebClients/tree/main/applications/inbox-desktop) README: *"Proton Desktop is an Electron-based project that offers a native desktop experience for Proton Mail and Proton Calendar"* — zero occurrences of "Lumo" in the tree |
| Proton's Lumo GitHub org has mobile only | <https://github.com/ProtonLumo> → `android-lumo`, `ios-lumo` |
| A desktop app is an open, unimplemented feature request | Proton UserVoice forum 932842, "Stand-alone Lumo desktop application" |
| **Proton has publicly promised a Lumo desktop app AND a Lumo API** | [Spring/summer 2026 roadmap](https://proton.me/blog/2026-spring-summer-roadmaps): *"Get more done with a desktop Lumo app"* and *"we're releasing a Lumo API that will let you add Lumo to your product or software."* **Future tense, no ship date, no docs, no build as of 2026-09-10.** |

**Implication:** the window for this project is open but its lifespan is unknown. Which engine
Proton will pick is *unknown* — a claim that they're already building on Tauri was investigated and
refuted.

---

## 2. Can Proton's own Electron shell host Lumo?

Forkable, but it fights you.

- **License:** `proton-inbox-desktop` v1.14.0 is **GPL-3.0**; the WebClients monorepo root LICENSE is
  verbatim GPLv3. Linux is a real build target (`@electron-forge/maker-deb`, `maker-rpm`,
  `snapcraft.yaml.template`).
- **Blocker:** `src/store/urlStore.ts` hard-codes `defaultAppURL` to exactly
  `https://{account,mail,calendar}.proton.me`, plus `ALLOWED_HOSTNAME_PATTERNS` regexes fixed to
  those literal subdomains, a zod `urlSchema` with exactly those three keys, and `isHostAllowed()`
  enforcing it on every navigation. Overrides are rejected with *"Override hostname is not an
  allowed Proton domain"*.
- **Trend is against you:** commits dated 2026-09-02/04 titled *"Harden overrideURL validation
  schema"* — the restriction is being tightened, not loosened.
- Also: Proton's Linux desktop build is **beta and gated to paid plans**.

**Verdict:** patching `urlStore.ts` to add a Lumo origin is a ~10-line diff, but you inherit a large
Electron app built for Mail/Calendar and must strip all Proton branding. Only worth it if you
specifically want Proton's own hardened shell. Otherwise see §4.

---

## 3. API, auth and crypto — why you want a *webview*, not a native client

### No public API
- Mindgard: *"we could find no documented APIs or SDKs available from Proton or elsewhere that
  provided programmatic access to Lumo"* ([blog](https://mindgard.ai/blog/understanding-lumo-ai-assistant-announcing-pylumo)).
- **But the real client code is public:** [`packages/lumo-api-client`](https://github.com/ProtonMail/WebClients/tree/main/packages/lumo-api-client)
  — `@proton/lumo-api-client` v2.1.0, *"Modular LLM API client for Lumo products with clean
  separation of concerns"*, **GPL-3.0**, Proton Technologies AG.
  - ⚠️ Correction to note: it is at `packages/lumo-api-client/`, **not** the often-cited
    `applications/lumo/src/app/lib/lumo-api-client` (404).
  - Not published to npm; TypeScript source only with `@proton/shared: workspace:^`, so consuming it
    means **vendoring the monorepo**. `client.callAssistant()` expects an already-authenticated
    Proton `api` object.

### Auth is SRP, no OAuth, no API keys
- The web client runs Proton's standard **SRP-6a** login; on success the server issues a token in a
  cookie. Non-browser clients must run the SRP handshake themselves (Proton's own
  [`proton-python-client`](https://github.com/ProtonMail/proton-python-client) returns
  access+refresh tokens directly) and then manage token refresh.
- lumo-tamer: *"Proton's security model doesn't allow for a simple OAuth authentication"* — it
  resorts to a Go SRP binary, or scraping browser tokens, or reusing rclone Proton Drive config.
- **CAPTCHA is a live problem:** pyLumo issue #2 (*"Authentication fails with 'please complete
  CAPTCHA'"*), opened 2026-07-26, still open.
- Lumo does have a **guest mode** needing no account at all.

### Client-side crypto
Documented in [Proton's Lumo security model](https://proton.me/blog/lumo-security-model): a fresh
per-request symmetric key, encrypted to Lumo's PGP public key, with AEAD bound to the Request ID.
Reverse-engineered parameters (Mindgard, confirmed in pyLumo source): **AES-256-GCM**, 256-bit key,
96-bit IV, 128-bit tag, AEAD contexts `lumo.request.{request_id}.turn` /
`lumo.response.{request_id}.chunk`.

⚠️ Third-party clients **bundle the Lumo PGP key as a constant** — pyLumo carries
`"Proton Lumo (Prod Key 0002)"` with the comment *"If Proton roll their key then we need to update
this"*. Already at revision 0002 → at least one rotation has happened. This is a standing maintenance
liability for native clients.

> **Decisive asymmetry:** a webview shell that loads `lumo.proton.me` runs *Proton's own JavaScript*,
> so SRP login, the AES-GCM/PGP crypto, CSP, service workers, file upload/download and 2FA all come
> for free — **and keep working when Proton changes them**. A native client must reimplement SRP,
> manage tokens, hardcode a rotating PGP key, and fight CAPTCHA. **Do not build a native client.**

---

## 4. Prior art — three existing unofficial clients

| Project | Tech | License | Packaging | Maturity | Notes |
|---|---|---|---|---|---|
| **[kenvandine/proton-lumo-ai](https://github.com/kenvandine/proton-lumo-ai)** | **Electron** | GPL-3.0 | **Snap only — no Flatpak manifest** | ~25 commits, 1 star, recently active | ⭐ **Closest reference implementation — read it, don't fork it (see §7).** README: *"Unofficial wrapper for Proton's Lumo AI, providing a native Linux desktop experince"*. Disclaimer: *"This project and its contributors are not affiliated with Proton. This is simply an Electron wrapper that loads the offical Proton Lumo.ai web application."* Also on snapcraft.io as `proton-lumo-ai`. |
| **[llixon/Lumora](https://github.com/llixon/Lumora)** | **Tauri v2 + WebKitGTK**, Rust, no Node | MIT | AppImage/deb/rpm — **no Flatpak** | ⚠️ 0 stars, 0 forks, ~4 commits, single author, *"I made this for myself"*, version strings disagree (Cargo 1.0.0 vs conf 0.1.0) | `main.rs:14 const HOME_URL = "https://lumo.proton.me"`, `WebviewUrl::External`. proton.me host allowlist, tray icon, global shortcut, window-state plugin. Sets `security: { csp: null }`. Tiny binary. |
| **[ZeroTricks/lumo-tamer](https://github.com/ZeroTricks/lumo-tamer)** | TS/Node 18 + Go SRP binary | GPL-3.0 | CLI | 423 commits, 101 stars, v0.1.0→v0.6.0, active to 2026-08 | *"OpenAI-compatible API and CLI for Lumo"*. **Not a GUI.** Vendors ~40 files from `applications/lumo/src/app/` + `aesGcm.ts`/`hash.ts`/`mergeUint8Arrays.ts`, with 4 DEP-3 patches and an `npm run sync-upstream` script — proves the vendoring path works. |
| [Mindgard/pyLumo](https://github.com/Mindgard/pyLumo) | Python | GPL-3.0-or-later | lib + CLI + TUI | ⚠️ v0.0.1, single squashed commit, Jan 2026 | Reference implementation of the crypto. Not a GUI. |

Also seen: `dustinm16/LUMO-Term`, `carlostkd/Lumo-Api`.

### ⚠️ WebKitGTK hazard (if you pick Tauri)
Lumora's `main.rs:104` sets `std::env::set_var("JSC_useWasmIPInt", "0")`. The README attributes it to
**WebKitGTK 2.50's in-place WASM interpreter hitting a fatal assert (`ipint_reserved_0xcb_validate`)
inside Proton's post-login crypto**, killing the web process right after 2FA — *"found via coredump
backtrace"*. Version-specific; may be fixed upstream by now. Also needs `NO_STRIP=1` because
linuxdeploy's bundled `strip` chokes on `.relr.dyn`.

**Under Flatpak that env var must be set in the manifest**, and Lumora's tray/global-shortcut
features would need the GlobalShortcuts portal.

---

## 5. Flatpak / Flathub — the real blocker

*(This section was verified directly against Flathub docs; the automated research pass got it wrong.)*

### For personal / self-distributed use: **no policy applies at all.**
Build locally, ship a `.flatpak` bundle on GitHub Releases or your own repo, `flatpak install --user`.
This is 100% of what you actually asked for ("I don't want to care about different distros"). **Do
this first.**

### For Flathub submission — [requirements](https://docs.flathub.org/docs/for-app-authors/requirements), quoted verbatim:

> **"Simple web wrapper applications that embed local or remote content in a web engine without
> providing significant polish, functionality, or meaningful desktop integration will not be
> accepted."**

☝️ **This is the blocker.** A bare Lumo wrapper is exactly this. To clear it you need real desktop
integration: system tray, global shortcut, native notifications, spellcheck, multi-account, offline
handling, etc.

Other rules that bind:

> "the domain must be directly related to the project or the application being submitted and the
> author or the developer or the project **must have control over the domain**"

→ App ID must be `io.github.<you>.<Name>`. **Never `me.proton.*` or anything Proton-derived.**

> "The application name and icon as presented to the Flathub website and to users must be distinct
> and must not violate any trademarks."
>
> "**Official affiliation must not be implied by using a vendor's name in the application name or
> icon** unless the application is actually part of that vendor's project."

> "If an application is provided by the upstream author or developers as a Flatpak outside of
> Flathub, third party submissions of it to Flathub will be rejected."

→ relevant the moment Proton ships their own.

### The two precedents, correctly characterised

- **[com.github.vladimiry.ElectronMail](https://flathub.org/apps/com.github.vladimiry.ElectronMail)**
  — ⭐ **this is your model.** Unofficial third-party Electron client for Proton Mail, on Flathub.
  Own distinct name ("ElectronMail"), own domain-controlled ID, summary literally *"Unofficial
  ProtonMail desktop app"*, developer Vladimir Yakovlev, unverified. It clears the wrapper rule by
  adding features *"not supported by the official in-browser web clients"*.
- **[me.proton.Mail](https://flathub.org/apps/me.proton.Mail)** — community-provided, **Unverified**,
  developer listed as Proton AG, Source Code → `ProtonMail/WebClients`, manifest →
  `flathub/me.proton.Mail`, with the disclaimer *"This community-provided package is not verified by,
  affiliated with, or supported by Proton AG."*
  **⚠️ Do not read this as licence to use a Proton app ID.** It keeps the vendor ID because it
  packages *Proton's own upstream application*. A wrapper you write is not Proton's app.

### Manifest sketch (⚠️ standard practice, NOT verified against a working build)

Electron route:
- Base: `org.electronjs.Electron2.BaseApp` on `org.freedesktop.Platform`
- [zypak](https://github.com/refi64/zypak) for Chromium sandboxing under Flatpak
- See [flatpak's Electron guide](https://docs.flatpak.org/en/latest/electron.html)

Finish args to start from:
```
--share=network
--share=ipc
--socket=wayland
--socket=fallback-x11
--device=dri
--socket=pulseaudio        # only if Lumo voice input matters
```
- **File access via XDG portals**, not `--filesystem=home` (Flathub reviewers push back hard on broad
  filesystem access).
- `--talk-name=org.freedesktop.secrets` **only if** you persist something to the keyring. A pure
  webview wrapper does not — a claim that Lumo session tokens land in the Secret Service was
  investigated and **refuted**.
- Tauri route: see [this Tauri v2 Flatpak/Snap writeup](https://vincent.jousse.org/blog/en/packaging-tauri-v2-flatpak-snapcraft-elm/); add `JSC_useWasmIPInt=0` as an env var in the manifest.
- Run [the Flathub linter](https://docs.flathub.org/docs/for-app-authors/linter) before submitting.

---

## 6. Legal

Three separate things, do not conflate them:

1. **Copyright — granted.** WebClients root LICENSE is verbatim GPLv3; `applications/lumo/package.json`
   (`proton-lumo` v0.1.0) declares GPL-3.0; `@proton/lumo-api-client` is GPL-3.0 and its only external
   runtime dep `@protontech/crypto` is GPL-3.0 on npm. No proprietary carve-out found. You may fork
   and redistribute modified Proton code under GPL-3.0 **with source**.
2. **Trademark — NOT granted.** The Proton and Lumo names, logos and `assets/icons/icon.png` are
   marks. A fork must strip them. GPL says nothing about trademark.
3. **Service access — governed by Proton's ToS, silent in the GPL.**
   ⚠️ **Nobody in this research actually read Proton's Terms of Service.** The entire ToS risk
   assessment rests on other projects' self-protective disclaimers:
   - lumo-tamer: *"Use of this software may violate Proton's terms of service; use at your own risk"*
     and *"not affiliated with or endorsed by Proton"*
   - Lumora: self-describes as "unofficial"
   - snapcraft.io/proton-lumo-ai: *"unofficial… not affiliated with Proton AG"*

   Practically negligible for personal use. Matters if you publish. **Read the ToS before submitting
   anything public.**

---

## 7. Concrete plan

**Phase 1 — get it working for yourself (~1 day)**
1. Start a **new repo from scratch** (decided 2026-09-10). Read
   [`kenvandine/proton-lumo-ai`](https://github.com/kenvandine/proton-lumo-ai) as the closest
   reference implementation (Electron + Lumo + GPL-3.0, Snap-only) but don't fork it: it's ~25
   commits of boilerplate, upstream is Snap-focused, and Phase 2 rewrites everything except the
   `loadURL` call anyway. If any of its code is copied, stay GPL-3.0 and credit it.
2. Write `io.github.<you>.<Name>.yml`: `org.electronjs.Electron2.BaseApp` on
   `org.freedesktop.Platform`, zypak wrapper, finish-args from §5.
3. `flatpak-builder --user --install`, test the **full path**: login → 2FA → first message →
   file upload → download through the portal → conversation history.
4. Ship a `.flatpak` bundle on GitHub Releases. **Done — distro-independent, zero policy exposure.**

**Phase 2 — only if you want Flathub**
5. Add genuine desktop integration to clear the thin-wrapper rule: tray, global shortcut, native
   notifications, spellcheck. (Lumora already implements tray + global shortcut in ~9 KB of Rust —
   worth reading even if you go Electron.)
6. Rebrand completely: distinct name, own icon, `io.github.*` ID, summary in the ElectronMail idiom
   ("Unofficial desktop app for …"). Strip every Proton mark.
7. Read Proton's ToS. Run the Flathub linter. Submit.

**Engine choice:** **Electron/Chromium** unless binary size is a hard constraint — it's the engine
Proton tests against, and it sidesteps the WebKitGTK WASM crash. Tauri/WebKitGTK gives a ~10 MB
binary instead of ~150 MB but you own the JSC risk.

**Avoid:** Nativefier (effectively unmaintained); Chromium `--app` mode and GNOME Web/Epiphany web
apps (per-user local installs, not distributable Flatpaks); any native reimplementation of the Lumo
API.

---

## 8. Risks, ranked

1. **Proton ships an official Lumo desktop app and/or API** (on their 2026 roadmap, no date) —
   obsoletes the work, and would also bar a third-party Flathub submission.
2. **Flathub's thin-web-wrapper rule** — blocks publication until you add real desktop integration.
   Does not affect self-distribution.
3. **Trademark / naming** — must fully rebrand; no Proton or Lumo marks in name, icon or app ID.
4. **ToS exposure — unquantified.** Nobody read the actual document.
5. **Engine-specific breakage** — the WebKitGTK 2.50 post-login WASM crash if you go Tauri; Proton
   changing markup or crypto if you go native.

---

## 9. Open questions to resolve before Phase 2

- [ ] What do Proton's actual Terms of Service say about third-party clients and repackaging?
- [ ] When do Proton's roadmapped Lumo desktop app and API ship, and on what engine?
- [ ] Does a webview wrapper survive the **full** Lumo feature set inside a Flatpak sandbox —
      2FA login, file upload, portal downloads, service-worker/offline, voice? **No source tested
      this.** Test it yourself in Phase 1 step 3.
- [ ] Is the WebKitGTK WASM assert fixed in current WebKitGTK (>2.50)?

## 10. Claims that were investigated and REFUTED — do not carry these forward

- ❌ Proton pins TLS certs for `account.proton.me` requiring runtime patching
- ❌ Lumo session tokens land in `org.freedesktop.secrets`
- ❌ `POST /api/ai/v1/chat` is a stable reverse-engineered endpoint
- ❌ Lumora needs DOM scraping because no API exists
- ❌ Proton's official desktop direction is Tauri (inferred from a `window.__TAURI__.external_tools`
  bridge check) — **platform is unknown**

## Source-quality warnings

- Lumora: 0 stars, ~4 commits, single author, "working" is author-attested with **no independent
  confirmation**.
- pyLumo: v0.0.1, one squashed commit.
- The Mindgard blog underpinning the no-API and auth findings is ~8 months old.
- lumo-tamer is the most mature third-party client, and its README notes it was written with
  extensive use of an AI coding tool.
- Automated research pass: 5 angles, 21 sources fetched, 105 claims extracted, 25 verified, 12
  confirmed, 13 killed. The Flathub sub-question failed entirely in that pass and §5 was
  re-researched by hand against Flathub's own docs.
