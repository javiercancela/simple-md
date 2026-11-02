import { stopElectron } from "./helpers";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { expect, test } from "@playwright/test";

const electronBinary = createRequire(import.meta.url)("electron") as string;
const mod = process.platform === "darwin" ? "Meta" : "Control";

async function setup() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "simple-md-p2-ui-"));
  const root = path.join(parent, "Alpha");
  const beta = path.join(parent, "Beta");
  for (const folder of [root, beta]) {
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, "a.md"), `Snippet from ${path.basename(folder)}`);
    fs.utimesSync(path.join(folder, "a.md"), 1700000000, 1700000000);
  }
  const app = await electron.launch({
    executablePath: electronBinary,
    args: [path.resolve("."), "--no-sandbox", "--disable-gpu", root],
    env: { ...process.env, SIMPLE_MD_USER_DATA: path.join(parent, "user") },
  });
  const page = await app.firstWindow();
  await page.locator('[data-testid="doc"][data-path="a.md"]').click();
  return { app, page, root, beta, parent };
}

async function cleanup(app: ElectronApplication, parent: string) {
  await stopElectron(app);
  fs.rmSync(parent, { recursive: true, force: true });
}

async function menu(app: ElectronApplication, id: string) {
  await app.evaluate(({ Menu }, itemId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(itemId);
    if (!item) throw new Error(`Missing menu item ${itemId}`);
    item.click();
  }, id);
}
async function switchFolder(app: ElectronApplication, folder: string) {
  await app.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [selected] });
  }, folder);
  await menu(app, "open-folder");
}
async function edit(page: Page, text: string) {
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(text);
}

test("save conflicts preserve disk edits until explicit overwrite or recreation", async () => {
  const { app, page, root, parent } = await setup();
  const file = path.join(root, "a.md");
  try {
    await edit(page, " local draft");
    fs.writeFileSync(file, "external draft");
    await menu(app, "save");
    await expect(page.getByRole("heading", { name: "File changed on disk" })).toBeVisible();
    expect(fs.readFileSync(file, "utf8")).toBe("external draft");
    await page.getByTestId("dialog").getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("dirty")).toBeVisible();
    await menu(app, "save");
    await page.getByRole("button", { name: "Overwrite", exact: true }).click();
    await expect(page.getByTestId("dirty")).toHaveCount(0);
    expect(fs.readFileSync(file, "utf8")).toContain("local draft");
    await edit(page, " restored");
    fs.unlinkSync(file);
    await menu(app, "save");
    await page.getByRole("button", { name: "Recreate", exact: true }).click();
    await expect(page.getByTestId("dirty")).toHaveCount(0);
    expect(fs.readFileSync(file, "utf8")).toContain("restored");
  } finally {
    await cleanup(app, parent);
  }
});

test("history and cursor survive Preview, Focus and rename", async () => {
  const { app, page, parent } = await setup();
  try {
    await edit(page, " draft");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await page.getByTestId("mode-preview").click();
    await expect(page.getByTestId("editor")).toBeHidden();
    await page.getByTestId("mode-editor").click();
    await page.getByTestId("focus").click();
    await page.getByTestId("exit-focus").click();
    await page.getByTestId("more").click();
    await page.getByTestId("rename").click();
    await page.getByTestId("dialog").locator("input").fill("renamed.md");
    await page.getByTestId("dialog").getByRole("button", { name: "Rename", exact: true }).click();
    await expect(page.locator('[data-testid="doc"][data-path="renamed.md"]')).toBeVisible();
    await page.locator(".cm-content").focus();
    await page.keyboard.type("!");
    await expect(page.locator(".cm-content")).toContainText("dra!ft");
    await page.keyboard.press(`${mod}+z`);
    await expect(page.locator(".cm-content")).toContainText(" draft");
    await page.keyboard.press(`${mod}+z`);
    await expect(page.locator(".cm-content")).not.toContainText("draft");
    await page.keyboard.press(`${mod}+Shift+z`);
    await expect(page.locator(".cm-content")).toContainText(" draft");
    // Renaming retains the save revision as well as the editor state.
    await menu(app, "save");
    await expect(page.getByTestId("dirty")).toHaveCount(0);
  } finally {
    await cleanup(app, parent);
  }
});

test("snippets stay within their library when paths and timestamps match", async () => {
  const { app, page, beta, parent } = await setup();
  try {
    await expect(page.locator(".doc-excerpt")).toHaveText("Snippet from Alpha");
    await switchFolder(app, beta);
    await expect(page.locator(".doc-excerpt")).toHaveText("Snippet from Beta");
  } finally {
    await cleanup(app, parent);
  }
});

test("an old library's delayed snippet cannot populate the new library", async () => {
  const { app, page, root, beta, parent } = await setup();
  try {
    await app.evaluate(({ ipcMain }) => {
      const handlers = (
        ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => unknown> }
      )._invokeHandlers;
      const original = handlers.get("file:snippet")!;
      const state = globalThis as unknown as { releaseSnippet: () => void; snippetHeld: boolean };
      let first = true;
      ipcMain.removeHandler("file:snippet");
      ipcMain.handle("file:snippet", async (...args) => {
        const result = await original(...args);
        if (first) {
          first = false;
          state.snippetHeld = true;
          await new Promise<void>((resolve) => {
            state.releaseSnippet = resolve;
          });
        }
        return result;
      });
    });
    // A fresh session requests Alpha's snippet again, but holds its IPC response.
    await switchFolder(app, root);
    await expect
      .poll(() =>
        app.evaluate(() => (globalThis as unknown as { snippetHeld: boolean }).snippetHeld),
      )
      .toBe(true);
    await switchFolder(app, beta);
    await expect(page.locator(".doc-excerpt")).toHaveText("Snippet from Beta");
    await app.evaluate(() =>
      (globalThis as unknown as { releaseSnippet: () => void }).releaseSnippet(),
    );
    await page.waitForTimeout(100);
    await expect(page.locator(".doc-excerpt")).toHaveText("Snippet from Beta");
  } finally {
    await cleanup(app, parent);
  }
});

test("filesystem notifications reconcile nested external renames and replacements", async () => {
  const { app, page, root, parent } = await setup();
  try {
    fs.mkdirSync(path.join(root, "nested"));
    fs.renameSync(path.join(root, "a.md"), path.join(root, "nested", "moved.md"));
    await expect(page.locator('[data-testid="doc"][data-path="nested/moved.md"]')).toBeVisible();
    await page.locator('[data-testid="doc"][data-path="nested/moved.md"]').click();
    fs.writeFileSync(path.join(root, "nested", "replacement.md"), "replacement content");
    fs.renameSync(
      path.join(root, "nested", "replacement.md"),
      path.join(root, "nested", "moved.md"),
    );
    await expect(page.locator(".cm-content")).toHaveText("replacement content");
  } finally {
    await cleanup(app, parent);
  }
});

test("macOS stops monitoring with no window and reconciles on activation", async () => {
  test.skip(
    process.platform !== "darwin",
    "Only macOS retains the process after closing its last window",
  );
  const { app, page, root, parent } = await setup();
  try {
    const closed = page.waitForEvent("close");
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
    await closed;
    await app.evaluate(() => {
      const fs = process.getBuiltinModule("fs") as typeof import("node:fs");
      const state = globalThis as unknown as { backgroundReads: number };
      state.backgroundReads = 0;
      const read = fs.promises.readdir;
      fs.promises.readdir = ((...args: Parameters<typeof read>) => {
        state.backgroundReads += 1;
        return read(...args);
      }) as typeof read;
    });
    fs.writeFileSync(path.join(root, "while-closed.md"), "Created while closed");
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(
      await app.evaluate(
        () => (globalThis as unknown as { backgroundReads: number }).backgroundReads,
      ),
    ).toBe(0);
    await app.evaluate(({ app: instance }) => instance.emit("activate"));
    const reopened = await app.firstWindow();
    await expect(
      reopened.locator('[data-testid="doc"][data-path="while-closed.md"]'),
    ).toBeVisible();
  } finally {
    await cleanup(app, parent);
  }
});
