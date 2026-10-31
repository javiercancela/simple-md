import {
  app,
  session,
  type BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";

function devServerUrl(): string {
  return typeof MAIN_WINDOW_VITE_DEV_SERVER_URL === "string" ? MAIN_WINDOW_VITE_DEV_SERVER_URL : "";
}

export function contentSecurityPolicy(): string {
  const connect = devServerUrl()
    ? "connect-src 'self' ws://127.0.0.1:* ws://localhost:* http://127.0.0.1:* http://localhost:*"
    : "connect-src 'none'";
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src data: blob:",
    "font-src 'self'",
    connect,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

function allowedRequest(url: string): boolean {
  if (url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("devtools:"))
    return true;
  const dev = devServerUrl();
  if (dev && url.startsWith(dev)) return true;
  if (dev && (url.startsWith("ws://127.0.0.1:") || url.startsWith("ws://localhost:"))) return true;
  if (!url.startsWith("file:")) return false;
  let decoded = url;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    return false;
  }
  const appPath = app.getAppPath();
  return decoded.includes(appPath) || decoded.includes(`${appPath}.unpacked`);
}

export function installSessionGuards(): void {
  const current = session.defaultSession;
  current.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  current.setPermissionCheckHandler(() => false);
  current.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !allowedRequest(details.url) });
  });
  current.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = { ...details.responseHeaders };
    if (details.resourceType === "mainFrame") {
      responseHeaders["Content-Security-Policy"] = [contentSecurityPolicy()];
    }
    callback({ responseHeaders });
  });
}

function isAppNavigation(url: string): boolean {
  const dev = devServerUrl();
  if (dev && url.startsWith(dev)) return true;
  if (!url.startsWith("file:")) return false;
  return (
    url.includes("/renderer/main_window/index.html") ||
    url.includes("\\renderer\\main_window\\index.html")
  );
}

export function hardenContents(win: BrowserWindow): void {
  const contents = win.webContents;
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event, url) => {
    if (!isAppNavigation(url)) event.preventDefault();
  });
  contents.on("will-redirect", (event, url) => {
    if (!isAppNavigation(url)) event.preventDefault();
  });
  contents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
}

export function assertSender(
  event: IpcMainInvokeEvent | IpcMainEvent,
  win: BrowserWindow | null,
): void {
  if (!win || event.sender !== win.webContents || event.senderFrame !== event.sender.mainFrame) {
    throw new Error("Untrusted sender");
  }
  const url = event.senderFrame.url;
  const dev = devServerUrl();
  if (dev) {
    if (!url.startsWith(dev)) throw new Error("Untrusted sender");
    return;
  }
  if (!url.startsWith("file:")) throw new Error("Untrusted sender");
}
