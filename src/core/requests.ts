import path from "node:path";
import { fileURLToPath } from "node:url";

function within(root: string, candidate: string, windows: boolean): boolean {
  const paths = windows ? path.win32 : path.posix;
  const relative = paths.relative(root, candidate);
  return (
    relative === "" ||
    (!paths.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${paths.sep}`))
  );
}

export function isDevRequest(url: string, dev: string): boolean {
  if (!dev) return false;
  try {
    const request = new URL(url);
    const server = new URL(dev);
    const protocol =
      request.protocol === "ws:"
        ? "http:"
        : request.protocol === "wss:"
          ? "https:"
          : request.protocol;
    return (
      protocol === server.protocol &&
      request.host === server.host &&
      (request.pathname === server.pathname ||
        request.pathname.startsWith(
          server.pathname.endsWith("/") ? server.pathname : `${server.pathname}/`,
        ))
    );
  } catch {
    return false;
  }
}

export function isAppFile(
  url: string,
  appPath: string,
  windows = process.platform === "win32",
): boolean {
  try {
    if (new URL(url).protocol !== "file:") return false;
    const candidate = fileURLToPath(url, { windows });
    return within(appPath, candidate, windows) || within(`${appPath}.unpacked`, candidate, windows);
  } catch {
    return false;
  }
}

export function isRendererDocument(
  url: string,
  appPath: string,
  windows = process.platform === "win32",
): boolean {
  if (!isAppFile(url, appPath, windows)) return false;
  try {
    const candidate = fileURLToPath(url, { windows });
    const paths = windows ? path.win32 : path.posix;
    return (
      paths.relative(paths.join(appPath, ".vite/renderer/main_window/index.html"), candidate) === ""
    );
  } catch {
    return false;
  }
}
