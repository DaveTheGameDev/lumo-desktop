'use strict';

// Lumo Desktop — Electron main process.
//
// A thin, unofficial desktop wrapper around Proton's Lumo web app. The renderer
// loads https://lumo.proton.me as an ordinary untrusted remote origin; every
// piece of desktop integration (window state, tray, toggle shortcut, spellcheck,
// context menu, navigation allowlist) lives here in the main process.

const fs = require('fs');
const path = require('path');
const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  clipboard,
  globalShortcut,
  nativeImage,
  session,
  shell,
} = require('electron');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const APP_URL = 'https://lumo.proton.me';
const APP_ID = 'io.github.davethegamedev.LumoDesktop';
const DESKTOP_FILE = `${APP_ID}.desktop`;

const DEFAULT_WIDTH = 1200;
const DEFAULT_HEIGHT = 800;
const MIN_SANE_SIZE = 320; // reject obviously broken persisted sizes

const ICON_PATH = path.join(__dirname, '..', 'assets', 'icon.png');
const PRELOAD_PATH = path.join(__dirname, 'preload.js');
const STATE_FILE_NAME = 'window-state.json';

const TOGGLE_FLAG = '--toggle';
const TOGGLE_ACCELERATOR = 'CommandOrControl+Shift+L';

// Hosts we are willing to navigate to in-window: proton.me and any subdomain,
// https only. Login runs through account.proton.me and redirects back, so the
// whole domain has to be allowed rather than just lumo.proton.me.
const PROTON_HOST_RE = /^([a-z0-9-]+\.)*proton\.me$/i;

// The two hosts that make up the app itself: the chat and the login flow that
// feeds it. Everything else on proton.me (legal, blog, support, marketing) is
// an ordinary web page and belongs in the user's browser, not on top of their
// conversation.
const APP_HOSTS = new Set(['lumo.proton.me', 'account.proton.me']);

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let mainWindow = null;
let tray = null;
let isQuitting = false;
let saveStateTimer = null;

const DEBUG = Boolean(process.env.LUMO_DESKTOP_DEBUG);

function debug(...args) {
  if (DEBUG) {
    console.log('[lumo-desktop]', ...args);
  }
}

// ---------------------------------------------------------------------------
// Desktop integration hints
// ---------------------------------------------------------------------------

// Tells GNOME which .desktop entry this process belongs to, so Web Notifications
// raised by the page and the Wayland app_id are attributed to our launcher (icon,
// "Settings" shortcut, notification grouping) instead of a generic "Electron".
// app.getName() is intentionally left deriving from package.json; Electron
// prefers productName over name, so userData is ~/.config/Lumo Desktop.
if (process.platform === 'linux') {
  app.setDesktopName(DESKTOP_FILE);
}

// ---------------------------------------------------------------------------
// Navigation allowlist
// ---------------------------------------------------------------------------

function isAllowedHost(urlString) {
  try {
    const parsed = new URL(urlString);
    return parsed.protocol === 'https:' && PROTON_HOST_RE.test(parsed.hostname);
  } catch (err) {
    return false;
  }
}

function isAppHost(urlString) {
  try {
    const parsed = new URL(urlString);
    return (
      parsed.protocol === 'https:' && APP_HOSTS.has(parsed.hostname.toLowerCase())
    );
  } catch (err) {
    return false;
  }
}

// Only ever hand http(s) to the system handler; anything else (file:, mailto
// oddities, custom schemes injected into the page) is silently dropped.
function openExternal(urlString) {
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      shell.openExternal(urlString);
      return;
    }
    debug('refusing to open non-http(s) url externally:', parsed.protocol);
  } catch (err) {
    debug('refusing to open unparseable url externally');
  }
}

function attachNavigationGuards(contents) {
  contents.on('will-navigate', (event, url) => {
    if (isAllowedHost(url)) {
      return;
    }
    event.preventDefault();
    debug('external navigation ->', url);
    openExternal(url);
  });

  contents.setWindowOpenHandler(({ url, disposition }) => {
    if (!isAllowedHost(url)) {
      debug('external popup ->', url);
      openExternal(url);
      return { action: 'deny' };
    }

    // Proton's OAuth/2FA-style flows call window.open() with window features,
    // which Chromium reports as 'new-window'; those genuinely need their own
    // window and must not be collapsed into the opener.
    if (disposition === 'new-window') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            spellcheck: true,
            preload: PRELOAD_PATH,
          },
        },
      };
    }

    // A plain target="_blank". Only the app's own hosts are worth taking over
    // the window, and only they need the logged-in session. Any other proton.me
    // page (legal, blog, support) would replace the chat with a static page the
    // user did not ask to leave, so it goes to the browser instead.
    if (isAppHost(url)) {
      contents.loadURL(url);
      return { action: 'deny' };
    }
    debug('proton.me content page -> browser:', url);
    openExternal(url);
    return { action: 'deny' };
  });
}

// ---------------------------------------------------------------------------
// Context menu (Electron ships none) + spellcheck
// ---------------------------------------------------------------------------

function attachContextMenu(contents) {
  contents.on('context-menu', (_event, params) => {
    const template = [];

    for (const suggestion of params.dictionarySuggestions) {
      template.push({
        label: suggestion,
        click: () => contents.replaceMisspelling(suggestion),
      });
    }

    if (params.misspelledWord) {
      template.push({
        label: `Add "${params.misspelledWord}" to dictionary`,
        click: () =>
          contents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
      });
    }

    if (template.length > 0) {
      template.push({ type: 'separator' });
    }

    if (params.linkURL) {
      template.push(
        {
          label: 'Copy Link Address',
          click: () => clipboard.writeText(params.linkURL),
        },
        {
          label: 'Open Link in Browser',
          click: () => openExternal(params.linkURL),
        },
        { type: 'separator' }
      );
    }

    const flags = params.editFlags;
    template.push(
      { role: 'cut', enabled: flags.canCut },
      { role: 'copy', enabled: flags.canCopy },
      { role: 'paste', enabled: flags.canPaste }
    );
    if (params.isEditable) {
      template.push({ role: 'pasteAndMatchStyle', enabled: flags.canPaste });
    }
    template.push({ role: 'selectAll', enabled: flags.canSelectAll });

    Menu.buildFromTemplate(template).popup({
      window: BrowserWindow.fromWebContents(contents) || undefined,
    });
  });
}

// Pick the closest available dictionary to the system locale: exact match first
// (en-US -> en-US), then anything sharing the language prefix (en -> en-GB),
// then leave Chromium's default alone.
function configureSpellchecker() {
  try {
    const ses = session.defaultSession;
    const available = ses.availableSpellCheckerLanguages || [];
    const locale = app.getLocale() || '';
    if (available.length === 0 || !locale) {
      return;
    }

    const wanted = locale.toLowerCase();
    const prefix = wanted.split('-')[0];
    const chosen =
      available.find((lang) => lang.toLowerCase() === wanted) ||
      available.find((lang) => lang.toLowerCase() === prefix) ||
      available.find((lang) => lang.toLowerCase().startsWith(`${prefix}-`));

    if (chosen) {
      ses.setSpellCheckerLanguages([chosen]);
      debug('spellchecker language:', chosen, 'from locale', locale);
    } else {
      debug('no dictionary available for locale', locale);
    }
  } catch (err) {
    debug('spellchecker setup failed:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Window state persistence (no npm dependency)
// ---------------------------------------------------------------------------

function stateFilePath() {
  return path.join(app.getPath('userData'), STATE_FILE_NAME);
}

// A saved position is only reusable if the display it lands on still overlaps
// it — otherwise an unplugged monitor would strand the window off-screen.
function isOnScreen(bounds) {
  // Required lazily: the screen module must not be touched before app ready.
  const { screen } = require('electron');
  const area = screen.getDisplayMatching(bounds).workArea;
  const overlapX =
    Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
  const overlapY =
    Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
  return overlapX >= 100 && overlapY >= 50;
}

function loadWindowState() {
  const fallback = { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, maximized: false };
  try {
    const saved = JSON.parse(fs.readFileSync(stateFilePath(), 'utf8'));
    const bounds = {
      x: saved.x,
      y: saved.y,
      width: saved.width,
      height: saved.height,
    };

    const sizeOk = [bounds.width, bounds.height].every(
      (n) => Number.isInteger(n) && n >= MIN_SANE_SIZE
    );
    const positionOk = Number.isInteger(bounds.x) && Number.isInteger(bounds.y);
    if (!sizeOk || !positionOk || !isOnScreen(bounds)) {
      debug('saved window state rejected, using defaults');
      return fallback;
    }

    return { ...bounds, maximized: Boolean(saved.maximized) };
  } catch (err) {
    debug('no usable window state:', err.message);
    return fallback;
  }
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  try {
    // getNormalBounds() is the un-maximized geometry, which is what we want to
    // restore to when the maximized flag is cleared.
    const bounds = mainWindow.getNormalBounds();
    const state = { ...bounds, maximized: mainWindow.isMaximized() };
    fs.writeFileSync(stateFilePath(), JSON.stringify(state, null, 2));
  } catch (err) {
    debug('could not persist window state:', err.message);
  }
}

function scheduleSaveWindowState() {
  clearTimeout(saveStateTimer);
  saveStateTimer = setTimeout(saveWindowState, 500);
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

// A local stand-in for Chromium's error screen when Lumo is unreachable. The
// Retry link is a real navigation to APP_URL, so the allowlist lets it through
// and Home / Ctrl+R work from here too; no script needed.
function offlinePage(description) {
  const detail = String(description || 'The connection failed.')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const html = `<!doctype html>
<meta charset="utf-8">
<title>Can't reach Lumo</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center;
         justify-content: center; background: #faf8f6; color: #1c1b1a;
         font: 15px/1.6 system-ui, -apple-system, sans-serif; }
  main { max-width: 26rem; padding: 2rem; text-align: center; }
  h1 { font-size: 1.35rem; margin: 0 0 .5rem; }
  p { margin: 0 0 1.6rem; opacity: .7; }
  code { font-size: .9em; }
  a { display: inline-block; padding: .55rem 1.5rem; border-radius: 999px;
      background: #1c1b1a; color: #faf8f6; text-decoration: none; }
  @media (prefers-color-scheme: dark) {
    body { background: #17161a; color: #ece9f0; }
    a { background: #ece9f0; color: #17161a; }
  }
</style>
<main>
  <h1>Can&rsquo;t reach Lumo</h1>
  <p><code>${detail}</code></p>
  <a href="${APP_URL}">Retry</a>
</main>`;

  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function createWindow() {
  const state = loadWindowState();
  const hasIcon = fs.existsSync(ICON_PATH);

  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    ...(Number.isInteger(state.x) && Number.isInteger(state.y)
      ? { x: state.x, y: state.y }
      : {}),
    show: false,
    autoHideMenuBar: true,
    ...(hasIcon ? { icon: ICON_PATH } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      preload: PRELOAD_PATH,
    },
  });

  if (state.maximized) {
    mainWindow.maximize();
  }

  let hasShown = false;
  mainWindow.once('ready-to-show', () => {
    hasShown = true;
    mainWindow.show();
  });
  mainWindow.on('resize', scheduleSaveWindowState);
  mainWindow.on('move', scheduleSaveWindowState);

  // Closing the window hides it (the app keeps living in the tray / behind the
  // --toggle launcher) unless we are genuinely on our way out.
  mainWindow.on('close', (event) => {
    clearTimeout(saveStateTimer);
    saveWindowState();
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // No network, no DNS, or Proton down: show our own page rather than
  // Chromium's. -3 is ERR_ABORTED, which fires for navigations the page itself
  // cancels and is not a failure worth reacting to.
  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) {
        return;
      }
      debug('main frame load failed:', errorCode, errorDescription);
      mainWindow.loadURL(offlinePage(errorDescription || `Error ${errorCode}`));
    }
  );

  mainWindow.loadURL(APP_URL);

  // Safety net: 'ready-to-show' can fail to fire if the very first load dies
  // hard, and on GNOME there may be no tray to recover an invisible window
  // from. Only fires if the window has never been shown, so it cannot undo a
  // deliberate hide.
  setTimeout(() => {
    if (!hasShown && mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      debug('showing window via fallback timer');
      mainWindow.show();
    }
  }, 3000);

  return mainWindow;
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function toggleWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isVisible() && mainWindow.isFocused()) {
    mainWindow.hide();
  } else {
    showWindow();
  }
}

function quitApp() {
  isQuitting = true;
  app.quit();
}

// ---------------------------------------------------------------------------
// Tray — best effort: GNOME often has no tray at all, and the app must stay
// fully usable without one (relaunching or --toggle re-shows a hidden window).
// ---------------------------------------------------------------------------

function createTray() {
  if (!fs.existsSync(ICON_PATH)) {
    debug('tray icon missing at', ICON_PATH, '- skipping tray');
    return;
  }
  try {
    const image = nativeImage
      .createFromPath(ICON_PATH)
      .resize({ width: 24, height: 24 });
    tray = new Tray(image);
    tray.setToolTip('Lumo Desktop');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Show / Hide', click: toggleWindow },
        { type: 'separator' },
        { label: 'Quit', click: quitApp },
      ])
    );
    tray.on('click', toggleWindow);
  } catch (err) {
    debug('tray unavailable:', err.message);
    tray = null;
  }
}

// ---------------------------------------------------------------------------
// Application menu (auto-hidden; Alt reveals it)
// ---------------------------------------------------------------------------

// Menu items act on the focused window, falling back to the main window (the
// menu can be triggered while a Proton popup holds focus).
function targetContents(focusedWindow) {
  const target = focusedWindow || mainWindow;
  return target && !target.isDestroyed() ? target.webContents : null;
}

function createApplicationMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'File',
        submenu: [
          { label: 'Quit', accelerator: 'CommandOrControl+Q', click: quitApp },
        ],
      },
      {
        label: 'View',
        submenu: [
          // Electron >= 40 moved goBack/canGoBack onto navigationHistory.
          {
            label: 'Back',
            accelerator: 'Alt+Left',
            click: (_item, focusedWindow) => {
              const contents = targetContents(focusedWindow);
              if (contents && contents.navigationHistory.canGoBack()) {
                contents.navigationHistory.goBack();
              }
            },
          },
          {
            label: 'Forward',
            accelerator: 'Alt+Right',
            click: (_item, focusedWindow) => {
              const contents = targetContents(focusedWindow);
              if (contents && contents.navigationHistory.canGoForward()) {
                contents.navigationHistory.goForward();
              }
            },
          },
          { type: 'separator' },
          {
            label: 'Home',
            accelerator: 'CommandOrControl+Shift+H',
            click: (_item, focusedWindow) => {
              const contents = targetContents(focusedWindow);
              if (contents) {
                contents.loadURL(APP_URL);
              }
            },
          },
          {
            label: 'Reload',
            accelerator: 'CommandOrControl+R',
            click: (_item, focusedWindow) => {
              const contents = targetContents(focusedWindow);
              if (contents) {
                contents.reload();
              }
            },
          },
          { type: 'separator' },
          { role: 'zoomIn', label: 'Zoom In' },
          { role: 'zoomOut', label: 'Zoom Out' },
          { role: 'resetZoom', label: 'Actual Size' },
          { type: 'separator' },
          { role: 'togglefullscreen', label: 'Toggle Full Screen' },
          { role: 'toggleDevTools', label: 'Toggle Developer Tools' },
        ],
      },
      {
        label: 'Window',
        submenu: [
          { role: 'minimize', label: 'Minimize' },
          {
            label: 'Close',
            accelerator: 'CommandOrControl+W',
            click: (_item, focusedWindow) => {
              const target = focusedWindow || mainWindow;
              if (target && !target.isDestroyed()) {
                target.close(); // hides, per the close handler above
              }
            },
          },
        ],
      },
    ])
  );
}

// ---------------------------------------------------------------------------
// User agent
// ---------------------------------------------------------------------------
//
// The default Electron user agent is left untouched — Proton serves the normal
// web app to it today. If Lumo ever puts up an "unsupported browser" wall, drop
// the Electron token (and, if needed, the app's own token) like this inside
// app.whenReady():
//
// session.defaultSession.setUserAgent(
//   app.userAgentFallback
//     .replace(/ Electron\/[\d.]+/, '')
//     .replace(/ Lumo Desktop\/[\d.]+/, '')
// );

// ---------------------------------------------------------------------------
// Downloads / uploads
// ---------------------------------------------------------------------------
//
// Intentionally no 'will-download' handler: Electron's default routine shows a
// native save dialog, and under Flatpak Chromium's GTK dialogs go through the
// XDG portals. Custom handling would only bypass that.

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

// Every webContents (main window and any allowed Proton popup) gets the same
// navigation allowlist and context menu.
app.on('web-contents-created', (_event, contents) => {
  attachNavigationGuards(contents);
  attachContextMenu(contents);
});

if (!app.requestSingleInstanceLock()) {
  // A primary instance is already running; it handles this launch's argv in its
  // 'second-instance' handler (including --toggle).
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    // `flatpak run io.github.davethegamedev.LumoDesktop --toggle` bound to a
    // GNOME shortcut is the Wayland-safe way to toggle the window.
    if (argv.includes(TOGGLE_FLAG)) {
      toggleWindow();
    } else {
      showWindow();
    }
  });

  app.whenReady().then(() => {
    configureSpellchecker();
    createApplicationMenu();
    createWindow();
    createTray();

    // Best effort only: global shortcuts do not work on Wayland, and that is
    // expected rather than an error — the --toggle launcher covers it.
    try {
      const registered = globalShortcut.register(TOGGLE_ACCELERATOR, toggleWindow);
      debug(
        registered
          ? `global shortcut ${TOGGLE_ACCELERATOR} registered`
          : `global shortcut ${TOGGLE_ACCELERATOR} unavailable (expected on Wayland)`
      );
    } catch (err) {
      debug('global shortcut registration failed:', err.message);
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

// app.quit() from anywhere (tray, menu, Ctrl+Q, session logout) must really quit,
// so the close handler stops swallowing the close.
app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// The window is hidden, not gone — keep running unless we are actually quitting.
app.on('window-all-closed', () => {
  if (isQuitting) {
    app.quit();
  }
});
