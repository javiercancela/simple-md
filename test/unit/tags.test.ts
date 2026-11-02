import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TagIndex, type FileIdentity } from "../../src/core/tags";

const dirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "simple-md-tags-"));
  dirs.push(dir);
  return dir;
}

function identity(root: string, rel: string): FileIdentity {
  const stat = fs.statSync(path.join(root, rel), { bigint: true });
  return {
    path: rel,
    ino: stat.ino.toString(),
    dev: stat.dev.toString(),
    size: Number(stat.size),
    mtimeMs: Number(stat.mtimeMs),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("TagIndex", () => {
  it("adds, dedupes, lists, and removes tags without changing the markdown file", () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, "sub"));
    fs.writeFileSync(path.join(root, "a.md"), "# A\n");
    fs.writeFileSync(path.join(root, "sub", "b.md"), "# B\n");
    const original = fs.readFileSync(path.join(root, "a.md"));
    const index = TagIndex.open(path.join(root, "index.json"), root);

    expect(index.setTags("a.md", ["Work", "work", " home "], identity(root, "a.md"))).toEqual([
      "Work",
      "home",
    ]);
    index.setTags("sub/b.md", ["work"], identity(root, "sub/b.md"));

    expect(index.tagsFor("a.md")).toEqual(["Work", "home"]);
    expect(index.listTags()).toEqual([
      { tag: "home", count: 1 },
      { tag: "Work", count: 2 },
    ]);
    expect(index.filesForTag("WORK").sort()).toEqual(["a.md", "sub/b.md"]);
    expect(fs.readFileSync(path.join(root, "a.md"))).toEqual(original);

    index.setTags("a.md", [], identity(root, "a.md"));
    expect(index.tagsFor("a.md")).toEqual([]);
    expect(index.filesForTag("home")).toEqual([]);
    expect(index.listTags()).toEqual([{ tag: "work", count: 1 }]);
  });

  it("rejects an invalid tag without dropping the previous ones", () => {
    const root = tempDir();
    fs.writeFileSync(path.join(root, "a.md"), "a");
    const index = TagIndex.open(path.join(root, "index.json"), root);
    index.setTags("a.md", ["keep"], identity(root, "a.md"));
    expect(() => index.setTags("a.md", ["bad/tag"], identity(root, "a.md"))).toThrow(/Invalid tag/);
    expect(index.tagsFor("a.md")).toEqual(["keep"]);
  });

  it("updates paths for an in-app rename or move", () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, "journal"));
    fs.writeFileSync(path.join(root, "journal", "monday.md"), "m");
    const index = TagIndex.open(path.join(root, "index.json"), root);
    index.setTags("journal/monday.md", ["day"], identity(root, "journal/monday.md"));
    index.rename("journal", "diary");
    expect(index.tagsFor("diary/monday.md")).toEqual(["day"]);
    expect(index.filesForTag("day")).toEqual(["diary/monday.md"]);
    index.remove("diary");
    expect(index.listTags()).toEqual([]);
  });

  it("follows a same-volume rename and drops a deleted or copied file", () => {
    const root = tempDir();
    const indexFile = path.join(root, "index.json");
    fs.writeFileSync(path.join(root, "a.md"), "alpha");
    fs.writeFileSync(path.join(root, "b.md"), "beta");
    const index = TagIndex.open(indexFile, root);
    index.setTags("a.md", ["alpha"], identity(root, "a.md"));
    index.setTags("b.md", ["beta"], identity(root, "b.md"));

    fs.renameSync(path.join(root, "a.md"), path.join(root, "moved.md"));
    index.reconcile([identity(root, "moved.md"), identity(root, "b.md")]);
    expect(index.tagsFor("moved.md")).toEqual(["alpha"]);
    expect(index.tagsFor("a.md")).toEqual([]);

    fs.copyFileSync(path.join(root, "b.md"), path.join(root, "copy.md"));
    fs.unlinkSync(path.join(root, "b.md"));
    index.reconcile([identity(root, "moved.md"), identity(root, "copy.md")]);
    expect(index.tagsFor("copy.md")).toEqual([]);
    expect(index.filesForTag("beta")).toEqual([]);
    expect(index.tagsFor("moved.md")).toEqual(["alpha"]);

    fs.unlinkSync(path.join(root, "moved.md"));
    index.reconcile([identity(root, "copy.md")]);
    expect(index.listTags()).toEqual([]);
  });

  it("keeps a favorite when the file has no tags and restores it after a rename", () => {
    const root = tempDir();
    fs.writeFileSync(path.join(root, "a.md"), "a");
    const index = TagIndex.open(path.join(root, "index.json"), root);
    index.setFavorite("a.md", true, identity(root, "a.md"));
    index.setTags("a.md", [], identity(root, "a.md"));
    expect(index.tagsFor("a.md")).toEqual([]);
    expect(index.isFavorite("a.md")).toBe(true);
    index.setColor("a.md", "blue");
    expect(index.colors()).toEqual({ "a.md": "blue" });

    fs.renameSync(path.join(root, "a.md"), path.join(root, "b.md"));
    index.reconcile([identity(root, "b.md")]);
    expect(index.isFavorite("b.md")).toBe(true);
    expect(index.isFavorite("a.md")).toBe(false);
    index.setFavorite("b.md", false, identity(root, "b.md"));
    expect(index.isFavorite("b.md")).toBe(false);
    expect(index.tagsFor("b.md")).toEqual([]);
  });

  it("reloads tags from disk and replaces a corrupt index", () => {
    const root = tempDir();
    const indexFile = path.join(root, "index.json");
    fs.writeFileSync(path.join(root, "a.md"), "a");
    const index = TagIndex.open(indexFile, root);
    index.setTags("a.md", ["keep"], identity(root, "a.md"));
    expect(TagIndex.open(indexFile, root).tagsFor("a.md")).toEqual(["keep"]);

    fs.writeFileSync(indexFile, "{");
    const replaced = TagIndex.open(indexFile, root);
    expect(replaced.listTags()).toEqual([]);
    expect(fs.existsSync(`${indexFile}.bak`)).toBe(true);
  });
});

describe("bulk rename reconciliation", () => {
  for (const count of [1000, 5000, 10000]) {
    it(`preserves tags and favorites for ${count} renamed documents with one index write`, () => {
      const root = tempDir();
      const indexFile = path.join(root, "index.json");
      const files = Object.fromEntries(
        Array.from({ length: count }, (_, i) => [
          `old/${i}.md`,
          { tags: ["keep"], favorite: true, dev: "1", ino: String(i + 1), size: 10, mtimeMs: 1 },
        ]),
      );
      fs.writeFileSync(indexFile, JSON.stringify({ version: 1, root, files, colors: {} }));
      const index = TagIndex.open(indexFile, root);
      const write = vi.spyOn(fs, "renameSync");
      const started = performance.now();
      index.reconcile(
        Array.from({ length: count }, (_, i) => ({
          path: `new/${i}.md`,
          dev: "1",
          ino: String(i + 1),
          size: 10,
          mtimeMs: 1,
        })),
      );
      const elapsed = performance.now() - started;
      console.info(`Reconcile ${count} renames: ${elapsed.toFixed(1)} ms`);
      expect(write).toHaveBeenCalledTimes(1);
      write.mockRestore();
      const reopened = TagIndex.open(indexFile, root);
      expect(reopened.filesForTag("keep")).toHaveLength(count);
      for (let i = 0; i < count; i++) {
        expect(reopened.tagsFor(`new/${i}.md`)).toEqual(["keep"]);
        expect(reopened.isFavorite(`new/${i}.md`)).toBe(true);
      }
    });
  }

  it("drops ambiguous inode matches and only consumes an unambiguous hard-link match once", () => {
    const root = tempDir();
    const index = TagIndex.open(path.join(root, "index.json"), root);
    const identity = { dev: "1", ino: "42", size: 1, mtimeMs: 1 };
    index.setTags("old.md", ["keep"], { path: "old.md", ...identity });
    index.setFavorite("old.md", true, { path: "old.md", ...identity });
    index.reconcile([
      { path: "a.md", ...identity },
      { path: "b.md", ...identity },
    ]);
    expect(index.tagsFor("a.md")).toEqual([]);
    expect(index.isFavorite("b.md")).toBe(false);
    index.setTags("old-a.md", ["first"], { path: "old-a.md", ...identity });
    index.setTags("old-b.md", ["second"], { path: "old-b.md", ...identity });
    index.reconcile([{ path: "new.md", ...identity }]);
    expect(index.tagsFor("new.md")).toEqual(["first"]);
    expect(index.filesForTag("second")).toEqual([]);
  });
});
