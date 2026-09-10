// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 DaveTheGameDev

// Lumo Desktop — preload script.
//
// This file deliberately exposes NOTHING to the page.
//
// The renderer loads Proton's own web application (https://lumo.proton.me) as a
// plain, untrusted remote origin. It is running with contextIsolation: true,
// sandbox: true and nodeIntegration: false, so it has no access to Node or to
// Electron internals. Handing it any `contextBridge` API would punch a hole in
// exactly that boundary and would give remote code (or anything injected into
// it) a privileged path into the main process, for no benefit: everything this
// wrapper adds — window state, tray, global shortcut, spellcheck, context menu,
// navigation allowlist — is implemented entirely in the main process and needs
// no cooperation from the page.
//
// A preload script is still declared so the boundary is explicit and so there
// is an obvious place to review if a bridge is ever proposed. Keep it empty.
