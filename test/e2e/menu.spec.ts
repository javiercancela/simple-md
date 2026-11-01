import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron, type ElectronApplication } from "playwright";
import { expect, test } from "@playwright/test";

const electronBinary = createRequire(import.meta.url)("electron") as string;

async function launch(root: string, userData: string): Promise<ElectronApplication> {
  return electron.launch({
    executablePath: electronBinary,
    cwd: path.resolve("."),
    args: [
      path.resolve("."),
      "--no-sandbox",
      "--disable-gpu",
      "--disable-gpu-sandbox",
      "--disable-dev-shm-usage",
      root,
    ],
    env: { ...process.env, SIMPLE_MD_USER_DATA: userData },
  });
}

async function clickMenu(app: ElectronApplication, id: string): Promise<void> {
  await app.evaluate(({ Menu }, menuId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(menuId);
    if (!item) throw new Error(`Missing menu item ${menuId}`);
    item.click();
  }, id);
}

function exited(app: ElectronApplication): Promise<number | null> {
  return new Promise((resolve) => {
    app.process().once("exit", (code) => resolve(code));
  });
}

async function setup(): Promise<{ root: string; userData: string; welcome: string }> {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "simple-md-menu-"));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "simple-md-menu-user-"));
  const root = path.join(parent, "Notes");
  fs.mkdirSync(root);
  const welcome = path.join(root, "Welcome.md");
  fs.writeFileSync(welcome, "# Hi\n");
  return { root, userData, welcome };
}

test("menu commands create and save, and standard roles are present", async () => {
  const { root, userData, welcome } = await setup();
  const app = await launch(root, userData);
  try {
    const page = await app.firstWindow();
    await page.locator('[data-testid="tree-file"][data-path="Welcome.md"]').waitFor();

    const accelerators = await app.evaluate(({ Menu }) => {
      const menu = Menu.getApplicationMenu();
      return {
        open: menu?.getMenuItemById("open-folder")?.accelerator,
        file: menu?.getMenuItemById("new-file")?.accelerator,
        save: menu?.getMenuItemById("save")?.accelerator,
      };
    });
    expect(accelerators).toEqual({
      open: "CmdOrCtrl+O",
      file: "CmdOrCtrl+N",
      save: "CmdOrCtrl+S",
    });
    const roles = await app.evaluate(({ Menu }) => {
      const found = new Set<string>();
      const walk = (items: { role: string; submenu?: { items: typeof items } }[]): void => {
        for (const item of items) {
          if (item.role) found.add(item.role);
          if (item.submenu) walk(item.submenu.items);
        }
      };
      const menu = Menu.getApplicationMenu();
      if (menu) walk(menu.items as never);
      return [...found].sort();
    });
    for (const role of ["undo", "redo", "cut", "copy", "paste", "selectall", "close", "quit"]) {
      expect(roles).toContain(role);
    }

    await clickMenu(app, "new-file");
    await expect(page.getByRole("heading", { name: "New file" })).toBeVisible();
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.locator('[data-testid="tree-file"][data-path="untitled.md"]')).toBeVisible();

    await page.locator('[data-testid="tree-file"][data-path="Welcome.md"]').click();
    const editor = page.locator(".cm-content");
    await editor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("Saved from the menu.");
    await clickMenu(app, "save");
    await expect(page.getByTestId("dirty")).toHaveCount(0);
    expect(fs.readFileSync(welcome, "utf8")).toContain("Saved from the menu.");
  } finally {
    if (app.process().exitCode === null) await app.close();
    fs.rmSync(path.dirname(root), { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test("quit exits, and a dirty buffer asks before the process exits", async () => {
  const { root, userData } = await setup();
  const app = await launch(root, userData);
  try {
    const page = await app.firstWindow();
    await page.locator('[data-testid="tree-file"][data-path="Welcome.md"]').click();
    await page.locator(".cm-content").click();
    await page.keyboard.type("not saved");
    await expect(page.getByTestId("dirty")).toBeVisible();

    const exit = exited(app);
    await clickMenu(app, "quit");
    await expect(page.getByTestId("discard-dialog")).toBeVisible();
    await page.getByTestId("discard-confirm").click();
    await expect.poll(() => exit.then((code) => code ?? 0), { timeout: 10000 }).toBe(0);
  } finally {
    if (app.process().exitCode === null) await app.close();
    fs.rmSync(path.dirname(root), { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test("quit with a clean window exits the process", async () => {
  const { root, userData } = await setup();
  const app = await launch(root, userData);
  const page = await app.firstWindow();
  await page.locator('[data-testid="tree-file"][data-path="Welcome.md"]').waitFor();
  const exit = exited(app);
  await clickMenu(app, "quit");
  await expect.poll(() => exit.then((code) => code ?? 0), { timeout: 10000 }).toBe(0);
});
