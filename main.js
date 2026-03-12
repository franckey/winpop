const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  screen,
  shell,
  Tray,
  Menu,
  nativeImage,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

// Fix GPU cache permission errors
app.disableHardwareAcceleration();
app.setPath("userData", path.join(__dirname, ".userData"));

let mainWindow = null;
let tray = null;
let projects = [];
let config = {};

const INDEX_PATH = path.join(__dirname, "index.json");
const CACHE_MAX_AGE_MS = 1000 * 60 * 60; // 1 hour

// ── Config ──────────────────────────────────────────────

function loadConfig() {
  const configPath = path.join(__dirname, "config.json");
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    config = {
      scanPaths: [path.join(require("os").homedir(), "Desktop")],
      maxDepth: 4,
      projectMarkers: [".git", "package.json", "Cargo.toml", "pyproject.toml", "go.mod", ".sln", "pom.xml", ".vscode"],
      shortcut: "Ctrl+Alt+P",
      editor: "code",
    };
  }
}

// ── Index / Cache ───────────────────────────────────────

function configFingerprint() {
  return JSON.stringify({ scanPaths: config.scanPaths, maxDepth: config.maxDepth, projectMarkers: config.projectMarkers });
}

function loadIndex() {
  try {
    const data = JSON.parse(fs.readFileSync(INDEX_PATH, "utf-8"));
    // Invalidate if config changed or cache expired
    if (data.configHash !== configFingerprint()) {
      console.log("Config changed, will re-scan");
      return false;
    }
    if (Date.now() - data.timestamp < CACHE_MAX_AGE_MS) {
      projects = data.projects || [];
      console.log(`Loaded ${projects.length} projects from cache`);
      return true;
    }
    console.log("Cache expired, will re-scan");
  } catch {
    console.log("No cache found, will scan");
  }
  return false;
}

function saveIndex() {
  try {
    fs.writeFileSync(INDEX_PATH, JSON.stringify({ timestamp: Date.now(), configHash: configFingerprint(), projects }, null, 2));
    console.log(`Saved ${projects.length} projects to cache`);
  } catch (err) {
    console.error("Failed to save index:", err.message);
  }
}

// ── Scan ────────────────────────────────────────────────

function scanProjects() {
  const t0 = Date.now();
  const found = new Map();

  const skipDirs = new Set([
    "node_modules", ".git", "dist", "build", ".next",
    "__pycache__", "target", "vendor", ".venv", "venv",
    "$RECYCLE.BIN", "System Volume Information",
  ]);

  function scan(dir, depth) {
    if (depth > config.maxDepth) return;

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const isProject = config.projectMarkers.some((marker) => {
      try {
        return fs.existsSync(path.join(dir, marker));
      } catch {
        return false;
      }
    });

    if (isProject && depth > 0) {
      if (!found.has(dir)) {
        let type = "project";
        if (fs.existsSync(path.join(dir, "package.json"))) type = "node";
        else if (fs.existsSync(path.join(dir, "Cargo.toml"))) type = "rust";
        else if (fs.existsSync(path.join(dir, "pyproject.toml"))) type = "python";
        else if (fs.existsSync(path.join(dir, "go.mod"))) type = "go";
        else if (entries.some((e) => e.name.endsWith(".sln"))) type = "dotnet";
        else if (fs.existsSync(path.join(dir, "pom.xml"))) type = "java";

        found.set(dir, { name: path.basename(dir), path: dir, type });
      }
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory() && !skipDirs.has(entry.name) && !entry.name.startsWith("$")) {
        scan(path.join(dir, entry.name), depth + 1);
      }
    }
  }

  for (const scanPath of config.scanPaths) {
    if (fs.existsSync(scanPath)) {
      scan(scanPath, 0);
    }
  }

  projects = Array.from(found.values()).sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase())
  );

  const elapsed = Date.now() - t0;
  console.log(`Scanned ${projects.length} projects in ${elapsed}ms`);

  saveIndex();
  return projects;
}

// Scan in background without blocking the UI
function scanInBackground() {
  setTimeout(() => {
    scanProjects();
    if (mainWindow) {
      mainWindow.webContents.send("projects-updated", projects);
    }
  }, 100);
}

// ── Window ──────────────────────────────────────────────

function createWindow() {
  const { width: screenWidth, height: screenHeight } =
    screen.getPrimaryDisplay().workAreaSize;

  const winWidth = 680;
  const winHeight = 480;

  mainWindow = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    x: Math.round((screenWidth - winWidth) / 2),
    y: Math.round(screenHeight * 0.22),
    frame: false,
    backgroundColor: "#1e1e2e",
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile("index.html");

  // Intercept close — just hide instead of destroying
  mainWindow.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      hideWindow();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function showWindow() {
  if (!mainWindow) return;

  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const { x: sx, y: sy, width: sw, height: sh } = display.workArea;
  const [winWidth] = mainWindow.getSize();

  mainWindow.setPosition(
    Math.round(sx + (sw - winWidth) / 2),
    Math.round(sy + sh * 0.22)
  );

  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send("window-shown");
}

function hideWindow() {
  if (!mainWindow) return;
  mainWindow.hide();
  mainWindow.webContents.send("window-hidden");
}

function toggleWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible()) {
    hideWindow();
  } else {
    showWindow();
  }
}

// ── App lifecycle ───────────────────────────────────────

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showWindow();
  });
}

app.whenReady().then(() => {
  loadConfig();

  // Auto-start with Windows
  app.setLoginItemSettings({
    openAtLogin: config.autoStart !== false,
    path: process.execPath,
    args: [path.resolve(__dirname)],
  });

  // Load cached index instantly, then refresh in background
  const hadCache = loadIndex();
  if (!hadCache) {
    scanProjects();
  }

  // Create tray icon
  const icon = nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAEFJREFUOI1jYBhsgJGBgYGBgYHhPwMDA8N/BgYGRkYGBgYmBgYGBlIMMEEyDCLNACcoDCAOAGkGEKcZRALyDCAVAABn3gMRbFnPnwAAAABJRU5ErkJggg=="
  );
  tray = new Tray(icon);
  tray.setToolTip("Project Launcher");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Ouvrir", click: () => showWindow() },
      { label: "Rafraîchir l'index", click: () => scanInBackground() },
      { type: "separator" },
      { label: "Quitter", click: () => { app.isQuitting = true; app.quit(); } },
    ])
  );
  tray.on("click", () => showWindow());

  createWindow();

  const shortcut = config.shortcut || "Ctrl+Alt+P";
  const registered = globalShortcut.register(shortcut, toggleWindow);
  if (!registered) {
    console.error(`Failed to register shortcut: ${shortcut}`);
  }

  // Once page is loaded: enable blur-to-hide and show unless silent start
  const silentStart = process.argv.includes("--hidden");
  mainWindow.webContents.on("did-finish-load", () => {
    if (!silentStart) {
      showWindow();
    }

    setTimeout(() => {
      mainWindow.on("blur", () => {
        if (mainWindow && mainWindow.isVisible()) {
          hideWindow();
        }
      });
    }, 500);

    if (hadCache) {
      scanInBackground();
    }
  });
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("before-quit", (e) => {
  if (!app.isQuitting) {
    e.preventDefault();
  }
});

app.on("window-all-closed", () => {
  // Keep alive
});

// ── IPC Handlers ────────────────────────────────────────

ipcMain.handle("get-projects", () => {
  return projects;
});

ipcMain.handle("refresh-projects", () => {
  return scanProjects();
});

ipcMain.handle("open-project", (event, projectPath) => {
  const editor = config.editor || "code";
  const child = spawn(editor, [projectPath], {
    shell: true,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  hideWindow();
});

ipcMain.handle("open-in-explorer", (event, projectPath) => {
  shell.openPath(projectPath);
  hideWindow();
});

ipcMain.handle("hide-window", () => {
  hideWindow();
});

ipcMain.handle("get-config", () => {
  return config;
});
