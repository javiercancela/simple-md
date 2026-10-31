import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from "electron";
import started from "electron-squirrel-startup";
import { realRoot } from "./core/paths";
import { channels } from "./shared/channels";
import { registerIpc } from "./main/ipc";
import { closeLibrary, openLibrary, setLibrarySink } from "./main/library";
import { readLastRoot } from "./main/settings";
import { hardenContents, installSessionGuards } from "./main/security";

let mainWindow: BrowserWindow | null = null;
const allowClose = new WeakSet<BrowserWindow>();
let quitAfterClose = false;

if (started) {
  app.quit();
} else {
  const userData = process.env.SIMPLE_MD_USER_DATA;
  if (userData && path.isAbsolute(userData)) {
    fs.mkdirSync(userData, { recursive: true });
    app.setPath("userData", userData);
  }
  bootstrap();
}

function devServerUrl(): string {
  return typeof MAIN_WINDOW_VITE_DEV_SERVER_URL === "string" ? MAIN_WINDOW_VITE_DEV_SERVER_URL : "";
}

function folderFromArgv(argv: string[]): string | null {
  const args = app.isPackaged ? argv.slice(1) : argv.slice(2);
  const appPath = app.getAppPath();
  for (const arg of args) {
    if (!arg || arg.startsWith("-")) continue;
    const candidate = path.resolve(arg);
    if (candidate === appPath || candidate.startsWith(`${appPath}${path.sep}`)) continue;
    try {
      return realRoot(candidate);
    } catch {
      continue;
    }
  }
  return null;
}

function openInitialFolder(): void {
  const userData = app.getPath("userData");
  const fromArg = folderFromArgv(process.argv);
  const last = readLastRoot(userData);
  const candidate =
    fromArg ??
    (last
      ? (() => {
          try {
            return realRoot(last);
          } catch {
            return null;
          }
        })()
      : null);
  if (!candidate) return;
  try {
    openLibrary(candidate, userData);
  } catch {
    // Keep the empty state when the remembered folder is gone.
  }
}

function send(channel: string): void {
  const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
  if (!win || win.isDestroyed()) return;
  win.webContents.send(channel);
}

function installMenu(): void {
  const file: MenuItemConstructorOptions = {
    label: "File",
    submenu: [
      {
        label: "Open Folder…",
        accelerator: "CmdOrCtrl+O",
        click: () => send(channels.menuOpenFolder),
      },
      { label: "New File", accelerator: "CmdOrCtrl+N", click: () => send(channels.menuNewFile) },
      { label: "New Folder", click: () => send(channels.menuNewFolder) },
      { type: "separator" },
      { label: "Save", accelerator: "CmdOrCtrl+S", click: () => send(channels.menuSave) },
      { type: "separator" },
      process.platform === "darwin" ? { role: "close" } : { role: "quit" },
    ],
  };
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
    file,
    { role: "editMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function windowIcon(): string | undefined {
  const icon = path.join(app.getAppPath(), "assets", "icon.png");
  return fs.existsSync(icon) ? icon : undefined;
}

function createWindow(): BrowserWindow {
  const icon = windowIcon();
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 860,
    minHeight: 560,
    show: false,
    backgroundColor: "#f3efe6",
    title: "Simple MD",
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    },
  });
  mainWindow = win;
  hardenContents(win);
  win.on("close", (event) => {
    if (allowClose.has(win)) return;
    if (win.webContents.isLoading()) return;
    event.preventDefault();
    win.webContents.send(channels.requestClose);
  });
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
  win.once("ready-to-show", () => {
    win.show();
  });
  const dev = devServerUrl();
  if (dev) void win.loadURL(dev);
  else void win.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  return win;
}

function bootstrap(): void {
  registerIpc(
    () => mainWindow,
    allowClose,
    (value) => {
      quitAfterClose = value;
    },
    () => {
      const quit = quitAfterClose;
      quitAfterClose = false;
      return quit;
    },
  );

  void app.whenReady().then(() => {
    installSessionGuards();
    installMenu();
    setLibrarySink({
      library: (session) => {
        if (mainWindow && !mainWindow.isDestroyed())
          mainWindow.webContents.send(channels.libraryUpdated, session);
      },
      file: (event) => {
        if (mainWindow && !mainWindow.isDestroyed())
          mainWindow.webContents.send(channels.fileExternal, event);
      },
    });
    createWindow();
    openInitialFolder();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("before-quit", () => {
    quitAfterClose = true;
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("will-quit", () => {
    closeLibrary();
  });
}
