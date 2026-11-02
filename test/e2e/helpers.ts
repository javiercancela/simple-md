import type { ChildProcess } from "node:child_process";
import type { ElectronApplication } from "playwright";

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
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  child.kill("SIGKILL");
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
