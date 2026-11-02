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

function fixture(): { root: string; userData: string } {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "simple-md-design-"));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "simple-md-design-user-"));
  const root = path.join(parent, "Notes");
  fs.mkdirSync(path.join(root, "Writing"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "Writing", "field.md"),
    `# Field notes

Keep the useful part short, then leave the file alone.

## Open loops

- [x] Write it down
- [ ] Read it again

> Plain files still open later.

\`\`\`
tomorrow
\`\`\`
`,
  );
  fs.writeFileSync(path.join(root, "Writing", "other.md"), "# Other\n\nA second note.\n");
  return { root, userData };
}

async function openField(page: Page): Promise<void> {
  await page.locator('[data-testid="doc"][data-path="Writing/field.md"]').click();
}

test("tag picker assigns and removes a tag from the keyboard", async () => {
  const { root, userData } = fixture();
  fs.mkdirSync(path.resolve("docs/screenshots"), { recursive: true });
  const app = await launch(root, userData);
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1440, height: 900 });
    await openField(page);
    await page.screenshot({ path: "docs/screenshots/library-light.png" });
    await page.getByTestId("add-tag").click();
    await expect(page.getByTestId("tag-picker")).toBeVisible();
    await expect(page.getByTestId("tag-picker")).toContainText("Stored in the app");
    await page.getByTestId("tag-input").fill("field");
    await page.getByTestId("tag-input").press("Enter");
    await expect(page.getByTestId("tag-chip")).toContainText("field");
    await page.screenshot({ path: "docs/screenshots/tag-picker.png" });
    await page.getByTestId("tag-input").press("ArrowDown");
    await page.getByTestId("tag-input").press("Enter");
    await expect(page.getByTestId("tag-chip")).toHaveCount(0);
  } finally {
    await stopElectron(app);
    removeTestDirectory(path.dirname(root));
    removeTestDirectory(userData);
  }
});

test("search by #tag, favorites, and focus mode", async () => {
  const { root, userData } = fixture();
  const app = await launch(root, userData);
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1440, height: 900 });
    await openField(page);
    await page.getByTestId("add-tag").click();
    await page.getByTestId("tag-input").fill("field");
    await page.getByTestId("tag-input").press("Enter");
    await page.keyboard.press("Escape");
    await page.getByTestId("search").fill("#field");
    await expect(page.locator('[data-testid="doc"][data-path="Writing/field.md"]')).toBeVisible();
    await expect(page.locator('[data-testid="doc"][data-path="Writing/other.md"]')).toHaveCount(0);
    await page.getByTestId("search").fill("");

    await page.getByTestId("more").click();
    await page.getByTestId("favorite").click();
    await page.getByTestId("nav-favorites").click();
    await expect(page.locator('[data-testid="doc"][data-path="Writing/field.md"]')).toBeVisible();
    await expect(page.locator('[data-testid="doc"][data-path="Writing/other.md"]')).toHaveCount(0);

    await page.getByTestId("focus").click();
    await expect(page.getByTestId("exit-focus")).toBeVisible();
    await expect(page.getByTestId("sidebar")).toBeHidden();
    await expect(page.getByTestId("word-goal")).toBeVisible();
    await expect(page.locator(".cm-content")).toContainText("Field notes");
    await page.screenshot({ path: "docs/screenshots/focus-dark.png" });
    await page.getByTestId("exit-focus").click();
    await expect(page.getByTestId("sidebar")).toBeVisible();

    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.screenshot({ path: "docs/screenshots/library-dark.png" });
  } finally {
    await stopElectron(app);
    removeTestDirectory(path.dirname(root));
    removeTestDirectory(userData);
  }
});
