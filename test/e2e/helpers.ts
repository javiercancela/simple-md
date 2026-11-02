import { execFileSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import type { ElectronApplication } from "playwright";

export function removeTestDirectory(directory: string): void {
  // Allow a short delay for the OS to release files after process-tree shutdown.
  fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

// Teardown must finish even if a failed test leaves the discard prompt open.
export async function stopElectron(app: ElectronApplication | undefined): Promise<void> {
  if (!app) return;
  let child: ChildProcess;
  try {
    child = app.process();
  } catch {
    // Playwright releases its process handle after a successful native quit.
    return;
  }
  await stopProcessTree(child);
}

// Playwright launches Electron in a separate POSIX process group. Direct spawns
// must use detached: true on POSIX so the whole Chromium tree can be stopped.
export async function stopProcessTree(child: ChildProcess | undefined): Promise<void> {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  if (process.platform === "win32") {
    execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
      timeout: 5000,
    });
  } else {
    process.kill(-child.pid, "SIGKILL");
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      exited,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Electron teardown timed out")), 5000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
