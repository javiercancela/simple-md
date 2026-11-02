import { removeTestDirectory, stopElectron } from "./helpers";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { expect, test } from "@playwright/test";

const electronBinary = createRequire(import.meta.url)("electron") as string;

async function setup(content = "# Alpha\n") {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "simple-md-p1-"));
  const root = path.join(parent, "notes");
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, "a.md"), content);
  fs.writeFileSync(path.join(root, "b.md"), "# Beta\n");
  const app = await electron.launch({
    executablePath: electronBinary,
    args: [path.resolve("."), "--no-sandbox", "--disable-gpu", root],
    env: { ...process.env, SIMPLE_MD_USER_DATA: path.join(parent, "user") },
  });
  const page = await app.firstWindow();
  await page.locator('[data-testid="doc"][data-path="a.md"]').click();
  return { app, page, root, parent };
}

async function cleanup(app: ElectronApplication, parent: string) {
  await stopElectron(app);
  removeTestDirectory(parent);
}

async function menu(app: ElectronApplication, id: string) {
  await app.evaluate(({ Menu }, itemId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(itemId);
    if (!item) throw new Error(`Missing menu item ${itemId}`);
    item.click();
  }, id);
}

async function edit(page: Page, text: string) {
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(text);
}

// Hold the response after the actual write, making the save race deterministic.
async function holdFirstWrite(app: ElectronApplication) {
  await app.evaluate(({ ipcMain }) => {
    const handlers = (
      ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => unknown> }
    )._invokeHandlers;
    const original = handlers.get("file:write")!;
    const state = globalThis as unknown as { releaseWrite: () => void; writeHeld: boolean };
    state.writeHeld = false;
    let first = true;
    ipcMain.removeHandler("file:write");
    ipcMain.handle("file:write", async (...args) => {
      const result = await original(...args);
      if (first) {
        first = false;
        await new Promise<void>((resolve) => {
          state.releaseWrite = resolve;
          state.writeHeld = true;
        });
      }
      return result;
    });
  });
}

async function waitHeld(app: ElectronApplication) {
  await expect
    .poll(() => app.evaluate(() => (globalThis as unknown as { writeHeld: boolean }).writeHeld))
    .toBe(true);
}
async function release(app: ElectronApplication) {
  await app.evaluate(() => (globalThis as unknown as { releaseWrite: () => void }).releaseWrite());
}

test("typing during a save stays dirty and overlapping saves persist in order", async () => {
  const { app, page, root, parent } = await setup();
  try {
    await holdFirstWrite(app);
    await edit(page, "submitted");
    await menu(app, "save");
    await waitHeld(app);
    await edit(page, " NEW UNSAVED TEXT");
    await release(app);
    await page.waitForTimeout(100);
    await expect(page.getByTestId("dirty")).toBeVisible();
    expect(fs.readFileSync(path.join(root, "a.md"), "utf8")).not.toContain("NEW UNSAVED TEXT");
    // A second pair of saves verifies that the later snapshot reaches disk last.
    await holdFirstWrite(app);
    await menu(app, "save");
    await waitHeld(app);
    await edit(page, " latest");
    await menu(app, "save");
    await release(app);
    await expect(page.getByTestId("dirty")).toHaveCount(0);
    expect(fs.readFileSync(path.join(root, "a.md"), "utf8")).toContain("NEW UNSAVED TEXT latest");
  } finally {
    await cleanup(app, parent);
  }
});

test("a delayed save response cannot change the newly opened document's baseline", async () => {
  const { app, page, parent } = await setup();
  try {
    await holdFirstWrite(app);
    await edit(page, "submitted");
    await menu(app, "save");
    await waitHeld(app);
    await page.locator('[data-testid="doc"][data-path="b.md"]').click();
    await page.getByTestId("discard-confirm").click();
    await expect(page.locator(".cm-content")).toContainText("Beta");
    await edit(page, " Beta draft");
    await release(app);
    await page.waitForTimeout(100);
    await expect(page.getByTestId("dirty")).toBeVisible();
    await page.locator('[data-testid="doc"][data-path="a.md"]').click();
    await expect(page.getByTestId("discard-dialog")).toBeVisible();
  } finally {
    await cleanup(app, parent);
  }
});

test("discard authorization survives canceled or failed navigation without marking the draft saved", async () => {
  const { app, page, root, parent } = await setup();
  try {
    await edit(page, "draft");
    await menu(app, "new-file");
    await page.getByTestId("discard-confirm").click();
    await page.getByTestId("dialog").getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("dirty")).toBeVisible();

    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: true, filePaths: [] });
    });
    await menu(app, "open-folder");
    await page.getByTestId("discard-confirm").click();
    await expect(page.getByTestId("discard-dialog")).toHaveCount(0);
    await expect(page.getByTestId("dirty")).toBeVisible();

    await menu(app, "new-file");
    await page.getByTestId("discard-confirm").click();
    await page.getByTestId("dialog").locator("input").fill("a.md");
    await page.getByTestId("dialog").getByRole("button", { name: "Create" }).click();
    await expect(page.getByTestId("error")).toContainText("Already exists");
    await expect(page.getByTestId("dirty")).toBeVisible();

    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("file:read");
      ipcMain.handle("file:read", () => {
        throw new Error("Destination unreadable");
      });
    });
    await page.locator('[data-testid="doc"][data-path="b.md"]').click();
    await page.getByTestId("discard-confirm").click();
    await expect(page.getByTestId("error")).toContainText("Destination unreadable");
    await expect(page.getByTestId("dirty")).toBeVisible();
    await expect(page.locator(".cm-content")).toContainText("draft");
    expect(fs.readFileSync(path.join(root, "a.md"), "utf8")).toBe("# Alpha\n");
  } finally {
    await cleanup(app, parent);
  }
});

test("Write and Focus skip preview work; large visible previews run in a worker", async () => {
  const sample =
    "Paragraph with **bold** text.\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n```js\nconst value = 42;\n```\n\n";
  const { app, page, parent } = await setup(sample.repeat(5400));
  try {
    await page.evaluate(() => {
      const state = window as unknown as { previewRequests: number };
      state.previewRequests = 0;
      const Original = window.Worker;
      window.Worker = class extends Original {
        override postMessage(message: unknown) {
          state.previewRequests += 1;
          super.postMessage(message);
        }
      };
    });
    await edit(page, "hidden preview edit");
    await page.getByTestId("focus").click();
    await edit(page, "focus edit");
    await page.getByTestId("exit-focus").click();
    expect(
      await page.evaluate(() => (window as unknown as { previewRequests: number }).previewRequests),
    ).toBe(0);
    await page.getByTestId("more").click();
    await page.getByTestId("mode-split").click();
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { previewRequests: number }).previewRequests),
      )
      .toBeGreaterThan(0);
    // The worker is rendering tables/code while the UI event loop still services timers.
    const elapsed = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const start = performance.now();
          setTimeout(() => resolve(performance.now() - start), 20);
        }),
    );
    expect(elapsed).toBeLessThan(500);
    await edit(page, " latest preview content");
    await expect(page.getByTestId("preview")).toContainText("latest preview content", {
      timeout: 30000,
    });
    await expect(page.getByTestId("preview").locator("table").first()).toBeVisible();
  } finally {
    await cleanup(app, parent);
  }
});

test("preview explains its size limit while the document remains editable", async () => {
  const { app, page, parent } = await setup("Large prose paragraph. ".repeat(50000));
  try {
    await page.getByTestId("more").click();
    await page.getByTestId("mode-split").click();
    await expect(page.getByTestId("preview")).toContainText("Preview is limited to 1 MB");
    await edit(page, "still editable");
    await expect(page.getByTestId("dirty")).toBeVisible();
  } finally {
    await cleanup(app, parent);
  }
});
