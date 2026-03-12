# WinPop

Windows project launcher with fuzzy search. Open any project in VS Code with a global shortcut.

## Stack
- Electron 33 (frameless window, system tray, global shortcut)
- Vanilla JS renderer with fuzzy search
- electron-builder for packaging

## Architecture
- `main.js` — Electron main process (scan, tray, shortcuts, IPC)
- `renderer.js` — UI logic (fuzzy match, keyboard nav, project list)
- `preload.js` — IPC bridge (contextIsolation)
- `config.json` — User config (scanPaths, shortcut, editor, autoStart)
- `index.json` — Cached project index (auto-generated, gitignored)
- `launch.js` — Dev launcher (unsets ELECTRON_RUN_AS_NODE from VS Code terminal)

## Key decisions
- `app.disableHardwareAcceleration()` required — GPU cache errors crash the app on Windows
- `app.setPath("userData", ...)` to avoid permission issues with default Electron userData path
- `spawn(editor, [path], { shell: true })` because `code` is a .cmd on Windows, not an .exe
- `before-quit` event prevented unless `app.isQuitting` flag is set (tray keeps app alive)
- Config fingerprint invalidates cache when scanPaths/markers change

## Dev
- `npm start` — launch app
- `npm run build:portable` — build portable .exe
- Repo: github.com/franckey/winpop

## Part of win* utility suite
- **winpop** — this project (project launcher)
- **winpatch** — software updater (D:\code\my-ws\soft-updater)
- **windots** — Windows environment profiles (D:\_install)
