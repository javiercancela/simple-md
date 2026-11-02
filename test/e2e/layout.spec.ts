import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { expect, test } from "@playwright/test";
import { removeTestDirectory, stopElectron } from "./helpers";

const electronBinary = createRequire(import.meta.url)("electron") as string;

async function setup() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "simple-md-layout-"));
  const root = path.join(parent, "Notes");
  fs.mkdirSync(root);
  fs.writeFileSync(
    path.join(root, "layout.md"),
    `# Layout checks

${"A readable paragraph with ordinary words. ".repeat(12)}

| Comment | What Codex raised | How the factory handles it | Remaining |
| --- | --- | --- | --- |
| C01 scope | Option A is sensible for a supervised pilot; fix execution and recovery. | Manual, serialized pilot; recovery tooling; evidence export. | No live cloud validation yet. |
| C02 | ${"Longer text with natural spaces. ".repeat(15)} | Short | Pending |

| Identifier | Value |
| --- | --- |
| ${"identifier".repeat(60)} | https://example.test/${"path".repeat(100)} |

\`\`\`text
${"wide code ".repeat(100)}
\`\`\`
`,
  );
  const app = await electron.launch({
    executablePath: electronBinary,
    args: [path.resolve("."), "--no-sandbox", "--disable-gpu", root],
    env: { ...process.env, SIMPLE_MD_USER_DATA: path.join(parent, "user") },
  });
  const page = await app.firstWindow();
  await page.getByTestId("doc").click();
  return { app, page, parent };
}

async function cleanup(app: ElectronApplication, parent: string) {
  await stopElectron(app);
  removeTestDirectory(parent);
}

async function expectNoOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const preview = document.querySelector(".preview")!;
        return {
          window: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          preview: preview.scrollWidth - preview.clientWidth,
          tables: [...preview.querySelectorAll("table")].map(
            (table) => table.getBoundingClientRect().right <= preview.getBoundingClientRect().right,
          ),
        };
      }),
    )
    .toEqual({ window: 0, preview: 0, tables: [true, true] });
}

test("collapsed macOS header clears native window controls", async () => {
  const { app, page, parent } = await setup();
  try {
    // Also exercise the macOS CSS on CI platforms with a standard title bar.
    await page.getByTestId("app").evaluate((el) => el.classList.add("platform-darwin"));
    await page.getByRole("button", { name: "Hide sidebar" }).click();
    const toggle = page.getByRole("button", { name: "Show sidebar" });
    const box = await toggle.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(40);
    await toggle.click();
    await expect(page.getByTestId("sidebar")).toBeVisible();
  } finally {
    await cleanup(app, parent);
  }
});

test("files divider supports dragging, keyboard resizing, and window constraints", async () => {
  const { app, page, parent } = await setup();
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    const divider = page.getByRole("separator", { name: "Resize files panel" });
    const panel = page.getByRole("region", { name: "Documents", exact: true });
    const box = (await divider.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + 200, { steps: 8 });
    await page.mouse.up();
    await expect(divider).toHaveAttribute("aria-valuenow", "420");
    expect((await panel.boundingBox())!.width).toBe(420);
    await divider.focus();
    await divider.press("ArrowLeft");
    await expect(divider).toHaveAttribute("aria-valuenow", "400");
    await divider.press("Home");
    await expect(divider).toHaveAttribute("aria-valuenow", "220");
    await divider.press("End");
    await expect(divider).toHaveAttribute("aria-valuenow", "600");
    await page.setViewportSize({ width: 860, height: 700 });
    await expect.poll(async () => (await panel.boundingBox())!.width).toBeLessThan(350);
    expect((await page.locator(".editor-pane").boundingBox())!.width).toBeGreaterThanOrEqual(320);
    await page.getByTestId("focus").click();
    await expect(divider).toBeHidden();
    await page.getByTestId("exit-focus").click();
    await expect(divider).toBeVisible();
    await page.getByRole("button", { name: "Hide sidebar" }).click();
    await divider.dblclick({ position: { x: 3, y: 200 } });
    await expect(divider).toHaveAttribute("aria-valuenow", "300");
  } finally {
    await cleanup(app, parent);
  }
});

test("preview caps reading width and tables retain header words without horizontal overflow", async () => {
  const { app, page, parent } = await setup();
  try {
    await page.setViewportSize({ width: 2000, height: 1000 });
    await page.getByTestId("mode-preview").click();
    const content = page.locator(".preview-content");
    await expect(content.locator("table")).toHaveCount(2);
    expect((await content.boundingBox())!.width).toBe(800);
    const previewBox = await page.getByTestId("preview").evaluate((el) => ({
      x: el.getBoundingClientRect().x,
      width: el.clientWidth,
    }));
    const contentBox = (await content.boundingBox())!;
    expect(
      Math.abs(contentBox.x + contentBox.width / 2 - previewBox.x - previewBox.width / 2),
    ).toBeLessThan(2);
    const header = content.locator("th").first();
    expect(
      await header.evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return range.getClientRects().length;
      }),
    ).toBe(1);
    await expectNoOverflow(page);
    await page.screenshot({ path: "test-results/layout-wide-preview.png" });
    await page.setViewportSize({ width: 1100, height: 800 });
    await expectNoOverflow(page);
    await page.setViewportSize({ width: 860, height: 700 });
    await expectNoOverflow(page);
    await page.getByRole("button", { name: "Hide sidebar" }).click();
    await page.getByTestId("more").click();
    await page.getByTestId("mode-split").click();
    await expectNoOverflow(page);
    await page.screenshot({ path: "test-results/layout-narrow-split.png" });
    await page.setViewportSize({ width: 2000, height: 1000 });
    await page.getByTestId("mode-preview").click();
    await expectNoOverflow(page);
    await expect
      .poll(() =>
        header.evaluate((el) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          return range.getClientRects().length;
        }),
      )
      .toBe(1);
  } finally {
    await cleanup(app, parent);
  }
});
