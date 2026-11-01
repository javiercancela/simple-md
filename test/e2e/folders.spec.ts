import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
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

async function chooseFolder(app: ElectronApplication, folder: string): Promise<void> {
  await app.evaluate(({ dialog }, next) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [next] });
  }, folder);
}

async function openWelcome(page: Page): Promise<void> {
  await page.locator('[data-testid="tree-file"][data-path="Welcome.md"]').click();
}

test("switching folders shows the new tree and does not keep the previous tags", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "simple-md-folders-"));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "simple-md-folders-user-"));
  const folderA = path.join(parent, "Alpha");
  const folderB = path.join(parent, "Beta");
  fs.mkdirSync(folderA);
  fs.mkdirSync(folderB);
  fs.writeFileSync(path.join(folderA, "Welcome.md"), "# Alpha\n");
  fs.writeFileSync(path.join(folderB, "Other.md"), "# Beta\n");
  const app = await launch(folderA, userData);
  try {
    const page = await app.firstWindow();
    await openWelcome(page);
    await page.getByTestId("tag-input").fill("from-alpha");
    await page.getByTestId("tag-input").press("Enter");
    await expect(page.getByTestId("tag-chip")).toContainText("from-alpha");

    await chooseFolder(app, folderB);
    await page.getByTestId("open-folder").click();
    await expect(page.locator('[data-testid="tree-file"][data-path="Other.md"]')).toBeVisible();
    await expect(page.locator('[data-testid="tree-file"][data-path="Welcome.md"]')).toHaveCount(0);
    await page.getByTestId("search").fill("Other");
    await expect(page.locator('[data-testid="tree-file"][data-path="Other.md"]')).toBeVisible();
    await page.getByTestId("search").fill("");
    await expect(page.getByTestId("tag-chip")).toHaveCount(0);
    await page.getByTestId("tab-tags").click();
    await expect(page.getByTestId("tag")).toHaveCount(0);
  } finally {
    if (app.process().exitCode === null) await app.close();
    fs.rmSync(parent, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test("opening another folder asks before discarding a dirty file and stays responsive", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "simple-md-dirty-"));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "simple-md-dirty-user-"));
  const folderA = path.join(parent, "Alpha");
  const folderB = path.join(parent, "Beta");
  fs.mkdirSync(folderA);
  fs.mkdirSync(path.join(folderB, "batch"), { recursive: true });
  fs.writeFileSync(path.join(folderA, "Welcome.md"), "# Alpha\n");
  for (let index = 0; index < 3000; index += 1) {
    fs.writeFileSync(path.join(folderB, "batch", `n-${index}.md`), `# Note ${index}\n`);
  }
  const app = await launch(folderA, userData);
  try {
    const page = await app.firstWindow();
    await openWelcome(page);
    await page.locator(".cm-content").click();
    await page.keyboard.type("draft");
    await expect(page.getByTestId("dirty")).toBeVisible();

    await chooseFolder(app, folderB);
    await page.getByTestId("open-folder").click();
    await expect(page.getByTestId("discard-dialog")).toBeVisible();
    await page.getByTestId("discard-confirm").click();

    const listed = page.locator('[data-testid="tree-file"][data-path="batch/n-42.md"]');
    await expect(listed).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("search").fill("n-42");
    await listed.click();
    await expect(page.getByTestId("preview")).toContainText("Note 42", { timeout: 10_000 });
    await expect(page.locator('[data-testid="tree-file"][data-path="Welcome.md"]')).toHaveCount(0);
  } finally {
    if (app.process().exitCode === null) await app.close();
    fs.rmSync(parent, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
