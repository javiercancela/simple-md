import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";
import { expect, test } from "@playwright/test";
import { stopElectron } from "./helpers";

const electronBinary = createRequire(import.meta.url)("electron") as string;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function setup(content: string) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "simple-md-further-"));
  const root = path.join(parent, "Alpha");
  const beta = path.join(parent, "Beta");
  for (const folder of [root, beta]) {
    fs.mkdirSync(path.join(folder, "sub"), { recursive: true });
    fs.writeFileSync(path.join(folder, "a.md"), content);
    for (let index = 0; index < 4; index++)
      fs.writeFileSync(path.join(folder, `${index}.png`), png);
  }
  const app = await electron.launch({
    executablePath: electronBinary,
    args: [path.resolve("."), "--no-sandbox", "--disable-gpu", root],
    env: { ...process.env, SIMPLE_MD_USER_DATA: path.join(parent, "user") },
  });
  const page = await app.firstWindow();
  await page.locator('[data-testid="doc"][data-path="a.md"]').click();
  return { app, page, parent, root, beta };
}

test("image-heavy split view revalidates once per path without retransferring unchanged images", async () => {
  const source = Array.from({ length: 20 }, (_, index) => `![image](${index % 4}.png)`).join(
    "\n\n",
  );
  const { app, page, root, beta, parent } = await setup(source);
  try {
    await app.evaluate(({ ipcMain }) => {
      const handlers = (
        ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => unknown> }
      )._invokeHandlers;
      const original = handlers.get("asset:read")!;
      const state = globalThis as unknown as { assetCalls: number; assetPayloads: number };
      state.assetCalls = state.assetPayloads = 0;
      ipcMain.removeHandler("asset:read");
      ipcMain.handle("asset:read", async (...args) => {
        state.assetCalls++;
        const result = (await original(...args)) as { url: string | null } | null;
        if (result?.url) state.assetPayloads++;
        return result;
      });
    });
    const counts = () =>
      app.evaluate(() => {
        const state = globalThis as unknown as { assetCalls: number; assetPayloads: number };
        return { calls: state.assetCalls, payloads: state.assetPayloads };
      });
    await page.getByTestId("more").click();
    await page.getByTestId("mode-split").click();
    await expect(page.locator('.preview img[src^="data:"]')).toHaveCount(20);
    expect(await counts()).toEqual({ calls: 4, payloads: 4 });
    for (let edit = 0; edit < 3; edit++) {
      await page.locator(".cm-content").focus();
      await page.keyboard.press(process.platform === "darwin" ? "Meta+End" : "Control+End");
      await page.keyboard.type(`\nedit ${edit}`);
      await expect(page.getByTestId("preview")).toContainText(`edit ${edit}`);
      await expect(page.locator('.preview img[src^="data:"]')).toHaveCount(20);
    }
    expect(await counts()).toEqual({ calls: 16, payloads: 4 });
    const updated = Buffer.concat([png, Buffer.from("updated")]);
    fs.writeFileSync(path.join(root, "0.png"), updated);
    await page.locator(".cm-content").focus();
    await page.keyboard.type(" refresh");
    await expect(page.getByTestId("preview").locator("img").first()).toHaveAttribute(
      "src",
      `data:image/png;base64,${updated.toString("base64")}`,
    );
    expect((await counts()).payloads).toBe(5);
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folder] });
    }, beta);
    await page.getByTestId("open-folder").click();
    await page.getByTestId("discard-confirm").click();
    await page.locator('[data-testid="doc"][data-path="a.md"]').click();
    await expect(page.getByTestId("preview").locator("img").first()).toHaveAttribute(
      "src",
      `data:image/png;base64,${png.toString("base64")}`,
    );
  } finally {
    await stopElectron(app);
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("the toolbar names a selected folder before rename or trash", async () => {
  const { app, page, root, parent } = await setup("Open document");
  try {
    await page.locator('[data-testid="tree-folder"][data-path="sub"]').click();
    await page.getByTestId("more").click();
    await expect(page.getByTestId("rename")).toHaveText("Rename folder “sub”");
    await expect(page.getByTestId("delete")).toHaveText("Move folder “sub” to trash");
    await page.getByTestId("rename").click();
    await expect(page.getByTestId("dialog").locator("input")).toHaveValue("sub");
    await page.getByTestId("dialog").getByRole("button", { name: "Cancel" }).click();
    await page.getByTestId("more").click();
    await page.getByTestId("delete").click();
    await expect(page.getByTestId("dialog")).toContainText("Move “sub” to the trash?");
    await page.getByTestId("dialog").getByRole("button", { name: "Cancel" }).click();
    expect(fs.existsSync(path.join(root, "sub"))).toBe(true);
    await expect(page.locator(".cm-content")).toContainText("Open document");
    await expect(page.locator(".status")).toContainText("2 words");
    await page.locator(".cm-content").focus();
    await page.keyboard.type("extra ");
    await expect(page.locator(".status")).toContainText("3 words");
    await page.keyboard.press(`${process.platform === "darwin" ? "Meta" : "Control"}+z`);
    await expect(page.locator(".status")).toContainText("2 words");
    await expect(page.getByTestId("dirty")).toHaveCount(0);
  } finally {
    await stopElectron(app);
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("text snapshots preserve untouched CRLF files and undo returns to a clean baseline", async () => {
  const original = "# Heading\r\n\r\nFirst paragraph.\r\n";
  const { app, page, root, parent } = await setup(original);
  try {
    const save = async () => {
      const before = fs.statSync(path.join(root, "a.md"), { bigint: true }).ino;
      await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.getMenuItemById("save")!.click());
      await expect
        .poll(() => fs.statSync(path.join(root, "a.md"), { bigint: true }).ino)
        .not.toBe(before);
    };
    await expect(page.getByTestId("dirty")).toHaveCount(0);
    await save();
    expect(fs.readFileSync(path.join(root, "a.md"), "utf8")).toBe(original);
    await page.locator(".cm-content").focus();
    await page.keyboard.type("extra ");
    await expect(page.getByTestId("dirty")).toBeVisible();
    await page.keyboard.press(`${process.platform === "darwin" ? "Meta" : "Control"}+z`);
    await expect(page.getByTestId("dirty")).toHaveCount(0);
    await save();
    expect(fs.readFileSync(path.join(root, "a.md"), "utf8")).toBe(original);
  } finally {
    await stopElectron(app);
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
