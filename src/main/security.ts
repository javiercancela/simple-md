import {
  app,
  session,
  type BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";
import { isAppFile, isDevRequest, isRendererDocument } from "../core/requests";
import { contentSecurityPolicy } from "../shared/csp";

function devServerUrl(): string {
  return typeof MAIN_WINDOW_VITE_DEV_SERVER_URL === "string" ? MAIN_WINDOW_VITE_DEV_SERVER_URL : "";
}

function allowedRequest(url: string): boolean {
  if (url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("devtools:"))
    return true;
  const dev = devServerUrl();
  if (isDevRequest(url, dev)) return true;
  return isAppFile(url, app.getAppPath());
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
      responseHeaders["Content-Security-Policy"] = [contentSecurityPolicy(devServerUrl())];
    }
    callback({ responseHeaders });
  });
}

function isAppNavigation(url: string): boolean {
  const dev = devServerUrl();
  return isDevRequest(url, dev) || isRendererDocument(url, app.getAppPath());
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
    if (!isDevRequest(url, dev)) throw new Error("Untrusted sender");
    return;
  }
  if (!isRendererDocument(url, app.getAppPath())) throw new Error("Untrusted sender");
}
