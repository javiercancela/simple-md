import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  clipboard: { writeText: vi.fn() },
  shell: {
    trashItem: vi.fn(async (entry: string) => {
      fs.unlinkSync(entry);
    }),
  },
}));

import { Library, setLibrarySink } from "../../src/main/library";
import { scanRoot } from "../../src/core/tree";
import { TagIndex } from "../../src/core/tags";
import { readMarkdown, renameInside } from "../../src/core/files";

const dirs: string[] = [];
const libraries: Library[] = [];
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "simple-md-integrity-"));
  dirs.push(root);
  fs.mkdirSync(path.join(root, "sub"));
  fs.writeFileSync(path.join(root, "sub/a.md"), "original");
  const indexFile = path.join(root, "index.json");
  const library = new Library(root, indexFile);
  libraries.push(library);
  return { root, indexFile, library };
}
function refresh(library: Library) {
  return (library as unknown as { refresh(force: boolean): Promise<unknown> }).refresh(true);
}
function pollFile(library: Library) {
  return (library as unknown as { pollFile(): Promise<void> }).pollFile();
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const library of libraries.splice(0)) library.close();
  setLibrarySink({ library() {}, file() {} });
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("incomplete filesystem reads", () => {
  for (const operation of ["directory", "stat"] as const) {
    it(`preserves persisted tags/favorites after a transient ${operation} failure and cleans up confirmed deletion`, async () => {
      const { root, indexFile, library } = setup();
      await library.load();
      library.setTags("sub/a.md", ["keep"]);
      library.setFavorite("sub/a.md", true);
      const before = fs.readFileSync(indexFile, "utf8");
      const method = operation === "directory" ? "readdir" : "stat";
      // Match scanRoot's native resolution, including Windows short-path expansion.
      const failedPath = path.join(
        await fs.promises.realpath(root),
        operation === "directory" ? "sub" : "sub/a.md",
      );
      const original = fs.promises[method];
      const spy = vi.spyOn(fs.promises, method).mockImplementation((async (...args: unknown[]) => {
        if (String(args[0]) === failedPath) {
          throw Object.assign(new Error("temporary I/O failure"), { code: "EIO" });
        }
        return (original as (...args: unknown[]) => unknown)(...args);
      }) as typeof original);
      const scan = await scanRoot(root);
      expect(scan.complete).toBe(false);
      expect(scan.failedPaths).toContain(operation === "directory" ? "sub" : "sub/a.md");
      await refresh(library);
      expect(fs.readFileSync(indexFile, "utf8")).toBe(before);
      spy.mockRestore();
      await refresh(library);
      const restored = TagIndex.open(indexFile, root);
      expect(restored.tagsFor("sub/a.md")).toEqual(["keep"]);
      expect(restored.isFavorite("sub/a.md")).toBe(true);
      fs.unlinkSync(path.join(root, "sub/a.md"));
      await refresh(library);
      expect(TagIndex.open(indexFile, root).tagsFor("sub/a.md")).toEqual([]);
      expect(TagIndex.open(indexFile, root).isFavorite("sub/a.md")).toBe(false);
    });
  }

  it("retries unreadable open files without reporting disappearance", async () => {
    const { root, library } = setup();
    await library.load();
    library.read("sub/a.md");
    const file = vi.fn();
    setLibrarySink({ library() {}, file });
    const original = fs.promises.readFile;
    const spy = vi.spyOn(fs.promises, "readFile").mockImplementation((async (
      ...args: unknown[]
    ) => {
      if (String(args[0]).endsWith("a.md"))
        throw Object.assign(new Error("unreadable"), { code: "EACCES" });
      return (original as (...args: unknown[]) => unknown)(...args);
    }) as typeof original);
    await pollFile(library);
    expect(file).not.toHaveBeenCalled();
    spy.mockRestore();
    fs.writeFileSync(path.join(root, "sub/a.md"), "changed");
    await pollFile(library);
    expect(file).toHaveBeenLastCalledWith(
      expect.objectContaining({
        path: "sub/a.md",
        exists: true,
        content: "changed",
        revision: expect.any(String),
      }),
    );
    fs.unlinkSync(path.join(root, "sub/a.md"));
    await pollFile(library);
    expect(file).toHaveBeenLastCalledWith({
      path: "sub/a.md",
      exists: false,
      content: "",
      revision: null,
    });
  });
});

describe("symlink entry mutations", () => {
  for (const kind of ["file", "dir"] as const) {
    it(`renames and trashes a ${kind} alias while preserving its real target`, async () => {
      const { root, library } = setup();
      fs.writeFileSync(path.join(root, "sub/b.md"), "second document");
      const target = kind === "file" ? "sub/a.md" : "sub";
      const alias = kind === "file" ? "alias.md" : "alias";
      const renamed = kind === "file" ? "renamed.md" : "renamed";
      fs.symlinkSync(path.join(root, target), path.join(root, alias), kind);
      renameInside(root, alias, renamed);
      expect(fs.lstatSync(path.join(root, renamed)).isSymbolicLink()).toBe(true);
      expect(fs.existsSync(path.join(root, alias))).toBe(false);
      expect(readMarkdown(root, "sub/a.md").content).toBe("original");
      await library.trash(renamed);
      expect(fs.existsSync(path.join(root, renamed))).toBe(false);
      expect(readMarkdown(root, "sub/a.md").content).toBe("original");
      expect(readMarkdown(root, "sub/b.md").content).toBe("second document");
    });
  }

  it("rejects mutations through parents escaping the library", () => {
    const { root } = setup();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "simple-md-outside-"));
    dirs.push(outside);
    fs.writeFileSync(path.join(outside, "a.md"), "secret");
    fs.symlinkSync(outside, path.join(root, "escape"), "dir");
    expect(() => renameInside(root, "escape/a.md", "moved.md")).toThrow(/escapes/);
    fs.symlinkSync(path.join(outside, "a.md"), path.join(root, "escape.md"), "file");
    expect(() => renameInside(root, "escape.md", "moved.md")).toThrow(/escapes/);
    expect(fs.readFileSync(path.join(outside, "a.md"), "utf8")).toBe("secret");
  });
});
