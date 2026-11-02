import { removeTestDirectory, stopElectron } from "./helpers";
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
  await page.locator('[data-testid="doc"][data-path="Welcome.md"]').click();
}

test("folders without Markdown are hidden by default and can be shown", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "simple-md-folder-filter-"));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "simple-md-folder-filter-user-"));
  fs.mkdirSync(path.join(root, "empty-parent", "empty-child"), { recursive: true });
  fs.mkdirSync(path.join(root, "assets"));
  fs.writeFileSync(path.join(root, "assets", "ignore.txt"), "Not Markdown");
  fs.mkdirSync(path.join(root, "notes", "nested"), { recursive: true });
  fs.writeFileSync(path.join(root, "notes", "nested", "note.markdown"), "# Note");
  fs.writeFileSync(path.join(root, "Welcome.md"), "# Welcome");
  const app = await launch(root, userData);
  try {
    const page = await app.firstWindow();
    await openWelcome(page);
    const toggle = page.getByRole("checkbox", { name: "Show all folders" });
    const folder = (rel: string) =>
      page.locator('[data-testid="tree-folder"]').filter({ hasText: rel });
    await expect(toggle).not.toBeChecked();
    await expect(folder("notes")).toBeVisible();
    await expect(folder("nested")).toBeVisible();
    await expect(folder("empty-parent")).toHaveCount(0);
    await expect(folder("assets")).toHaveCount(0);

    await toggle.check();
    await expect(folder("empty-parent")).toBeVisible();
    await expect(folder("empty-child")).toBeVisible();
    await expect(folder("assets")).toBeVisible();
    await folder("assets").click();
    await expect(page.getByTestId("doc-count")).toHaveText("0 documents");
    await toggle.uncheck();
    await expect(folder("assets")).toHaveCount(0);
    await expect(page.getByTestId("nav-all")).toHaveClass(/is-on/);

    // Reconciliation reveals/hides folders as Markdown is added/removed.
    const added = path.join(root, "assets", "added.md");
    fs.writeFileSync(added, "# Added");
    await expect(folder("assets")).toBeVisible();
    fs.unlinkSync(added);
    await expect(folder("assets")).toHaveCount(0);

    await page.getByTestId("more").click();
    await page.getByTestId("new-folder").click();
    await page.getByTestId("dialog").locator("input").fill("new-empty");
    await page.getByTestId("dialog").getByRole("button", { name: "Create", exact: true }).click();
    await expect(toggle).toBeChecked();
    await expect(folder("new-empty")).toBeVisible();
  } finally {
    await stopElectron(app);
    removeTestDirectory(root);
    removeTestDirectory(userData);
  }
});

test("preview fills the pane and wraps long table entries in preview and split modes", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "simple-md-preview-layout-"));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "simple-md-preview-layout-user-"));
  const longWord = "unbroken".repeat(40);
  const codeLine = `const value = '${longWord}';`;
  fs.writeFileSync(
    path.join(root, "Welcome.md"),
    `# Consolidated reference and pilot plan

Long link: https://example.com/${longWord}

| # | Source | Author | Written | Role here |
| --- | --- | --- | --- | --- |
| S1 | \`software-factory-option-a-implementation-guide.md\` | Guide author with review comments | 2026-10-27 10:08 | Design foundation and platform reference |
| S2 | ${longWord} | Reviewer | 2026-10-27 | Review of this repository |

\`\`\`js
${codeLine}
\`\`\`
`,
  );
  const app = await launch(root, userData);
  try {
    const page = await app.firstWindow();
    await openWelcome(page);
    await page.getByTestId("mode-preview").click();
    const preview = page.getByTestId("preview");
    await expect(preview.locator("table")).toBeVisible();
    for (const mode of ["preview", "split"]) {
      if (mode === "split") {
        await page.getByTestId("more").click();
        await page.getByTestId("mode-split").click();
      }
      for (const width of [1600, 1280, 1000]) {
        await page.setViewportSize({ width, height: 900 });
        await expect
          .poll(() => preview.evaluate((node) => node.scrollWidth - node.clientWidth))
          .toBeLessThanOrEqual(1);
        const bounds = await preview.evaluate((node) => {
          const pane = node.parentElement!.getBoundingClientRect();
          const preview = node.getBoundingClientRect();
          return {
            paneWidth: pane.width,
            previewWidth: preview.width,
            right: pane.right - preview.right,
          };
        });
        expect(Math.abs(bounds.right)).toBeLessThanOrEqual(1);
        if (mode === "preview") {
          expect(Math.abs(bounds.paneWidth - bounds.previewWidth)).toBeLessThanOrEqual(1);
        }
        const code = preview.locator("pre");
        await expect(code).toContainText(codeLine);
        expect(await code.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
      }
    }
  } finally {
    await stopElectron(app);
    removeTestDirectory(root);
    removeTestDirectory(userData);
  }
});

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
    await page.getByTestId("add-tag").click();
    await page.getByTestId("tag-input").fill("from-alpha");
    await page.getByTestId("tag-input").press("Enter");
    await expect(page.getByTestId("tag-chip")).toContainText("from-alpha");

    await chooseFolder(app, folderB);
    await page.getByTestId("open-folder").click();
    await expect(page.locator('[data-testid="doc"][data-path="Other.md"]')).toBeVisible();
    await expect(page.locator('[data-testid="doc"][data-path="Welcome.md"]')).toHaveCount(0);
    await page.getByTestId("search").fill("Other");
    await expect(page.locator('[data-testid="doc"][data-path="Other.md"]')).toBeVisible();
    await page.getByTestId("search").fill("");
    await expect(page.getByTestId("tag-chip")).toHaveCount(0);
    await expect(page.getByTestId("tag")).toHaveCount(0);
  } finally {
    await stopElectron(app);
    removeTestDirectory(parent);
    removeTestDirectory(userData);
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

    await expect(page.getByTestId("doc-count")).toContainText("3000", { timeout: 20_000 });
    await page.getByTestId("search").fill("n-42");
    const listed = page.locator('[data-testid="doc"][data-path="batch/n-42.md"]');
    await expect(listed).toBeVisible();
    await listed.click();
    await page.getByTestId("mode-preview").click();
    await expect(page.getByTestId("preview")).toContainText("Note 42", { timeout: 10_000 });
    await expect(page.locator('[data-testid="doc"][data-path="Welcome.md"]')).toHaveCount(0);
  } finally {
    await stopElectron(app);
    removeTestDirectory(parent);
    removeTestDirectory(userData);
  }
});
