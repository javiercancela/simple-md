import { removeTestDirectory } from "./helpers";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser } from "playwright";
import { expect, test } from "@playwright/test";

// Node inspector fuses are disabled in release builds. Chromium's debugging
// endpoint lets this smoke test exercise the actual packaged executable/ASAR.
test("packaged resources start, preload connects, and preview worker/images load", async () => {
  test.skip(
    !process.env.SIMPLE_MD_PACKAGED_SMOKE,
    "Run after packaging with SIMPLE_MD_PACKAGED_SMOKE=1",
  );
  const output = path.resolve("out");
  const folder = fs
    .readdirSync(output)
    .find((entry) => entry.endsWith(`-${process.platform}-${process.arch}`));
  if (!folder) throw new Error("Packaged app not found; run npm run package first");
  const directory = path.join(output, folder);
  const executable =
    process.platform === "darwin"
      ? path.join(directory, "Simple MD.app", "Contents", "MacOS", "simple-md")
      : path.join(directory, process.platform === "win32" ? "simple-md.exe" : "simple-md");
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "simple md startup "));
  const root = path.join(temporary, "Notes with spaces");
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, "start.md"), "# Packaged startup\n\n![image](image.png)");
  fs.writeFileSync(
    path.join(root, "image.png"),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
  let child: ChildProcess | undefined;
  let browser: Browser | undefined;
  let diagnostic = "";
  try {
    child = spawn(
      executable,
      ["--no-sandbox", "--disable-gpu", "--remote-debugging-port=0", root],
      {
        env: { ...process.env, SIMPLE_MD_USER_DATA: path.join(temporary, "User data") },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const endpoint = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Startup timed out: ${diagnostic}`)), 20_000);
      child!.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child!.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Startup exited (${code}): ${diagnostic}`));
      });
      child!.stderr!.on("data", (chunk: Buffer) => {
        diagnostic = (diagnostic + chunk.toString()).slice(-16_000);
        const url = diagnostic.match(/DevTools listening on (ws:\/\/\S+)/)?.[1];
        if (url) {
          clearTimeout(timer);
          resolve(url);
        }
      });
    });
    browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0]!;
    await expect.poll(() => context.pages().length).toBeGreaterThan(0);
    const page = context.pages()[0]!;
    await expect(page.getByTestId("app")).toBeVisible();
    expect(page.url()).toMatch(/^file:.*app\.asar.*index\.html$/);
    await page.locator('[data-testid="doc"][data-path="start.md"]').click();
    await page.getByTestId("mode-preview").click();
    await expect(page.getByTestId("preview")).toContainText("Packaged startup");
    await expect(page.getByTestId("preview").locator("img")).toHaveAttribute(
      "src",
      /^data:image\/png;base64,/,
    );
    expect(
      await page.evaluate(async () => {
        await document.fonts.ready;
        return Array.from(document.fonts).some(
          (face) => face.family === "Inter" && face.status === "loaded",
        );
      }),
    ).toBe(true);
  } finally {
    await browser?.close();
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>((resolve) => child!.once("exit", () => resolve()));
      child.kill("SIGKILL");
      await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 5000))]);
    }
    removeTestDirectory(temporary);
  }
});
