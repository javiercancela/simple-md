import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readImageDataUrl, readMarkdown, writeMarkdown } from "../../src/core/files";
import { classifyHref, resolveRelativeLink } from "../../src/core/links";
import { normalizeRelative, resolveContained } from "../../src/core/paths";
import { scanRoot } from "../../src/core/tree";

const dirs: string[] = [];
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "simple-md-paths-"));
  dirs.push(dir);
  return dir;
}

function linkTo(target: string, linkPath: string, kind: "file" | "dir"): void {
  fs.symlinkSync(target, linkPath, kind);
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("resolveContained", () => {
  it("allows files inside the root and rejects traversal, absolute paths, and prefix siblings", () => {
    const parent = tempDir();
    const root = path.join(parent, "notes");
    const evil = path.join(parent, "notes-evil");
    fs.mkdirSync(root);
    fs.mkdirSync(path.join(root, "nested"));
    fs.mkdirSync(evil);
    fs.writeFileSync(path.join(root, "nested", "a.md"), "ok");
    fs.writeFileSync(path.join(evil, "secret.md"), "no");

    expect(resolveContained(root, "nested/a.md")).toBe(
      fs.realpathSync(path.join(root, "nested", "a.md")),
    );
    expect(resolveContained(root, "fresh.md", { allowMissing: true })).toBe(
      path.join(fs.realpathSync(root), "fresh.md"),
    );
    expect(() => resolveContained(root, "missing/fresh.md", { allowMissing: true })).toThrow(
      /not found/i,
    );
    expect(() => resolveContained(root, "../notes-evil/secret.md")).toThrow();
    expect(() => resolveContained(root, path.join(root, "nested", "a.md"))).toThrow();
    expect(() => normalizeRelative("a\0b")).toThrow();
    expect(() => normalizeRelative("C:\\Windows\\notepad.exe")).toThrow();
    expect(fs.readFileSync(path.join(evil, "secret.md"), "utf8")).toBe("no");
  });

  it("follows symlinks that stay inside and rejects ones that escape", () => {
    const parent = tempDir();
    const root = path.join(parent, "notes");
    const outside = path.join(parent, "outside");
    fs.mkdirSync(path.join(root, "sub"), { recursive: true });
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(root, "sub", "a.md"), "inside");
    fs.writeFileSync(path.join(outside, "secret.md"), "secret");
    linkTo(path.join(root, "sub", "a.md"), path.join(root, "link.md"), "file");
    linkTo(path.join(outside, "secret.md"), path.join(root, "escape.md"), "file");
    linkTo(outside, path.join(root, "out"), "dir");

    expect(readMarkdown(root, "link.md").content).toBe("inside");
    expect(() => readMarkdown(root, "escape.md")).toThrow();
    expect(() => writeMarkdown(root, "escape.md", "pwned")).toThrow();
    expect(() => resolveContained(root, "out/secret.md")).toThrow();
    expect(fs.readFileSync(path.join(outside, "secret.md"), "utf8")).toBe("secret");
  });
});

describe("scanRoot", () => {
  it("lists markdown files, empty folders, and skips other files and escaping symlinks", () => {
    const parent = tempDir();
    const root = path.join(parent, "notes");
    const outside = path.join(parent, "outside");
    fs.mkdirSync(path.join(root, "journal"), { recursive: true });
    fs.mkdirSync(path.join(root, "inbox"));
    fs.mkdirSync(path.join(root, "assets"));
    fs.mkdirSync(path.join(root, ".git"));
    fs.mkdirSync(path.join(root, "node_modules", "pkg"), { recursive: true });
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(root, "Welcome.md"), "# Hi");
    fs.writeFileSync(path.join(root, "journal", "monday.md"), "# Mon");
    fs.writeFileSync(path.join(root, "ignore.txt"), "no");
    fs.writeFileSync(path.join(root, "assets", "leaf.png"), png);
    fs.writeFileSync(path.join(root, ".git", "README.md"), "hidden");
    fs.writeFileSync(path.join(root, "node_modules", "pkg", "README.md"), "hidden");
    fs.writeFileSync(path.join(outside, "secret.md"), "secret");
    linkTo(outside, path.join(root, "linked-out"), "dir");

    const { tree, files } = scanRoot(root);
    const paths = files.map((file) => file.path).sort();
    expect(paths).toEqual(["Welcome.md", "journal/monday.md"]);
    expect(JSON.stringify(tree)).toContain("inbox");
    expect(JSON.stringify(tree)).not.toContain("secret");
    expect(JSON.stringify(tree)).not.toContain("ignore.txt");
    expect(JSON.stringify(tree)).not.toContain("node_modules");
  });
});

describe("symlinked roots", () => {
  it("opens a root reached through a symlink and still rejects a link that escapes", () => {
    const parent = tempDir();
    const realParent = path.join(parent, "private");
    const aliasParent = path.join(parent, "var");
    const outside = path.join(parent, "outside");
    fs.mkdirSync(path.join(realParent, "notes", "sub"), { recursive: true });
    fs.mkdirSync(outside);
    const root = path.join(aliasParent, "notes");
    linkTo(realParent, aliasParent, "dir");
    fs.writeFileSync(path.join(root, "sub", "a.md"), "inside");
    fs.writeFileSync(path.join(root, "Welcome.md"), "# Hi");
    fs.writeFileSync(path.join(outside, "secret.md"), "secret");
    linkTo(path.join(root, "sub", "a.md"), path.join(root, "link.md"), "file");
    linkTo(path.join(outside, "secret.md"), path.join(root, "escape.md"), "file");
    const via = path.join(parent, "via-notes");
    linkTo(path.join(realParent, "notes"), via, "dir");

    expect(fs.realpathSync(root)).not.toBe(path.resolve(root));
    expect(readMarkdown(root, "sub/a.md").content).toBe("inside");
    expect(readMarkdown(root, "link.md").content).toBe("inside");
    expect(readMarkdown(via, "Welcome.md").content).toBe("# Hi");
    expect(() => readMarkdown(root, "escape.md")).toThrow(/escapes/);
    expect(() => readMarkdown(via, "escape.md")).toThrow(/escapes/);
    expect(() => writeMarkdown(via, "escape.md", "pwned")).toThrow(/escapes/);
    expect(
      scanRoot(root)
        .files.map((file) => file.path)
        .sort(),
    ).toEqual(["Welcome.md", "link.md", "sub/a.md"]);
    expect(
      scanRoot(via)
        .files.map((file) => file.path)
        .sort(),
    ).toEqual(["Welcome.md", "link.md", "sub/a.md"]);
    expect(fs.readFileSync(path.join(outside, "secret.md"), "utf8")).toBe("secret");
  });
});

describe("links and images", () => {
  it("resolves relative links inside the folder and ignores other schemes", () => {
    expect(resolveRelativeLink("journal/monday.md", "../Welcome.md")).toBe("Welcome.md");
    expect(resolveRelativeLink("Welcome.md", "../secret.md")).toBeNull();
    expect(resolveRelativeLink("Welcome.md", "/journal/monday.md")).toBe("journal/monday.md");
    expect(resolveRelativeLink("Welcome.md", "https://example.com")).toBeNull();
    expect(classifyHref("Welcome.md", "https://example.com/a")).toEqual({
      type: "external",
      url: "https://example.com/a",
    });
    expect(classifyHref("Welcome.md", "javascript:alert(1)").type).toBe("ignore");
    expect(classifyHref("Welcome.md", "journal/monday.md#week")).toEqual({
      type: "file",
      path: "journal/monday.md",
      hash: "week",
    });
    expect(classifyHref("Welcome.md", "#week")).toEqual({ type: "scroll", id: "week" });
  });

  it("reads an image inside the folder and refuses one outside it", () => {
    const parent = tempDir();
    const root = path.join(parent, "notes");
    const outside = path.join(parent, "outside");
    fs.mkdirSync(path.join(root, "assets"), { recursive: true });
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(root, "Welcome.md"), "# Hi");
    fs.writeFileSync(path.join(root, "assets", "leaf.png"), png);
    fs.writeFileSync(path.join(outside, "secret.png"), png);
    linkTo(path.join(outside, "secret.png"), path.join(root, "assets", "escape.png"), "file");

    expect(readImageDataUrl(root, "Welcome.md", "assets/leaf.png")).toMatch(
      /^data:image\/png;base64,/,
    );
    expect(readImageDataUrl(root, "Welcome.md", "../outside/secret.png")).toBeNull();
    expect(readImageDataUrl(root, "Welcome.md", "assets/escape.png")).toBeNull();
    expect(readImageDataUrl(root, "Welcome.md", "https://example.com/a.png")).toBeNull();
  });
});
