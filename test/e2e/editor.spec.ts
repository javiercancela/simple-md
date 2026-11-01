import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron, type ElectronApplication } from "playwright";
import { expect, test } from "@playwright/test";

const electronBinary = createRequire(import.meta.url)("electron") as string;

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("opens a folder, edits, tags, and previews markdown", async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "simple-md-e2e-"));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "simple-md-user-"));
  const root = path.join(parent, "Garden");
  fs.mkdirSync(path.join(root, "journal"), { recursive: true });
  fs.mkdirSync(path.join(root, "reference"), { recursive: true });
  fs.mkdirSync(path.join(root, "inbox"));
  fs.mkdirSync(path.join(root, "assets"));
  fs.writeFileSync(path.join(root, "assets", "leaf.png"), png);
  fs.writeFileSync(path.join(root, "ignore.txt"), "not markdown");
  fs.writeFileSync(
    path.join(root, "Welcome.md"),
    `# Garden notes

A folder of Markdown, edited locally.

## This week

| Bed | Crop | Status |
| --- | --- | --- |
| North | Kale | Up |
| South | Garlic | Planted |

- [x] Mulch the paths
- [ ] Split the chives

~~Frost cloth~~ stored in the shed.

\`\`\`js
const beds = ['North', 'South']
\`\`\`

![Leaf](assets/leaf.png)

See [Monday](journal/monday.md).
`,
  );
  fs.writeFileSync(
    path.join(root, "journal", "monday.md"),
    "# Monday\n\nRain in the morning, then sun.\n",
  );
  fs.writeFileSync(path.join(root, "journal", "tuesday.md"), "# Tuesday\n\nSow the sweet peas.\n");
  fs.writeFileSync(
    path.join(root, "reference", "shortcuts.md"),
    "# Shortcuts\n\nSave with Ctrl+S or Cmd+S.\n",
  );

  fs.mkdirSync(path.resolve("docs/screenshots"), { recursive: true });
  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({
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
      env: {
        ...process.env,
        SIMPLE_MD_USER_DATA: userData,
      },
    });
    app.process().stderr?.on("data", (chunk: Buffer) => {
      process.stderr.write(chunk);
    });
    const page = await app.firstWindow();
    page.on("pageerror", (error) => {
      console.error("PAGE", error);
    });
    page.on("console", (message) => {
      console.log("CONSOLE", message.type(), message.text());
    });
    await page.setViewportSize({ width: 1280, height: 800 });

    await expect(page.locator('[data-testid="doc"][data-path="Welcome.md"]')).toBeVisible();
    await expect(page.locator('[data-testid="doc"][data-path="journal/monday.md"]')).toBeVisible();
    await expect(page.locator('[data-testid="tree-folder"][data-path="inbox"]')).toBeVisible();
    await expect(page.getByText("ignore.txt")).toHaveCount(0);

    await page.getByTestId("search").fill("monday");
    await expect(page.locator('[data-path="Welcome.md"]')).toHaveCount(0);
    await expect(page.locator('[data-path="journal/monday.md"]')).toBeVisible();
    await page.getByTestId("search").fill("");

    await page.locator('[data-testid="doc"][data-path="Welcome.md"]').click();
    await page.getByTestId("more").click();
    await page.getByTestId("mode-split").click();
    await expect(page.getByTestId("preview").locator("table")).toBeVisible();
    await expect(page.getByTestId("preview")).toContainText("Garden notes");
    await expect(page.getByTestId("preview").locator("img")).toHaveAttribute(
      "src",
      /^data:image\/png/,
    );
    await expect(
      page.getByTestId("preview").locator('input[type="checkbox"]').first(),
    ).toBeChecked();

    await page.getByTestId("preview").getByRole("link", { name: "Monday" }).click();
    await expect(page.getByTestId("preview")).toContainText("Rain in the morning");

    await page.locator('[data-testid="doc"][data-path="Welcome.md"]').click();
    const editor = page.locator(".cm-content");
    await editor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("\n\nTags stay with the file when it moves.");
    await expect(page.getByTestId("dirty")).toBeVisible();
    await page.keyboard.press("Control+s");
    await expect(page.getByTestId("dirty")).toHaveCount(0);
    expect(fs.readFileSync(path.join(root, "Welcome.md"), "utf8")).toContain(
      "Tags stay with the file when it moves.",
    );

    await page.getByTestId("add-tag").click();
    await page.getByTestId("tag-input").fill("garden");
    await page.getByTestId("tag-input").press("Enter");
    await expect(page.getByTestId("tag-chip")).toContainText("garden");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.screenshot({ path: "docs/screenshots/split-view.png" });

    await page.locator('[data-testid="doc"][data-path="journal/monday.md"]').click();
    await page.getByTestId("add-tag").click();
    await page.getByTestId("tag-input").fill("garden");
    await page.getByTestId("tag-input").press("Enter");
    await expect(page.locator('[data-testid="tag"][data-tag="garden"]')).toContainText("2");
    await page.locator('[data-testid="tag"][data-tag="garden"]').click();
    await expect(page.locator('[data-testid="doc"][data-path="Welcome.md"]')).toBeVisible();
    await expect(page.locator('[data-testid="doc"][data-path="journal/monday.md"]')).toBeVisible();
    await page.screenshot({ path: "docs/screenshots/tag-view.png" });

    await page.locator(".cm-content").click();
    await page.keyboard.type(" draft");
    await page.locator('[data-testid="doc"][data-path="Welcome.md"]').click();
    await expect(page.getByTestId("discard-dialog")).toBeVisible();
    await page.getByTestId("discard-confirm").click();
    await expect(page.getByTestId("preview")).toContainText("Tags stay with the file");

    const welcome = path.join(root, "Welcome.md");
    fs.writeFileSync(welcome, `${fs.readFileSync(welcome, "utf8")}\nExternal note.\n`);
    await expect(page.getByTestId("preview")).toContainText("External note.");
  } finally {
    await app?.close();
    fs.rmSync(parent, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
