import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeAtomic } from "../../src/core/atomic";
import { readMarkdown, writeMarkdown } from "../../src/core/files";
import { MAX_MARKDOWN_BYTES } from "../../src/core/names";
import { TagIndex } from "../../src/core/tags";

const dirs: string[] = [];
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "simple-md-p2-"));
  dirs.push(root);
  const file = path.join(root, "a.md");
  fs.writeFileSync(file, "original", { mode: 0o600 });
  return { root, file };
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("atomic replacement", () => {
  it.skipIf(process.platform === "win32")(
    "preserves private permission bits with a permissive umask",
    () => {
      const { root, file } = setup();
      const previous = process.umask(0o022);
      try {
        writeMarkdown(root, "a.md", "saved");
        expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      } finally {
        process.umask(previous);
      }
    },
  );

  for (const operation of ["openSync", "writeFileSync", "renameSync"] as const) {
    it(`preserves the original and cleans temporary files after ${operation} failure`, () => {
      const { root, file } = setup();
      vi.spyOn(fs, operation).mockImplementationOnce(() => {
        throw new Error("injected failure");
      });
      expect(() => writeAtomic(file, "replacement")).toThrow("injected failure");
      expect(fs.readFileSync(file, "utf8")).toBe("original");
      expect(fs.readdirSync(root)).toEqual(["a.md"]);
    });
  }

  it("uses exclusive, private, unique temporary files", () => {
    const { file } = setup();
    const open = vi.spyOn(fs, "openSync");
    writeAtomic(file, "one");
    writeAtomic(file, "two");
    const temporary = open.mock.calls.filter((call) => call[1] === "wx");
    expect(temporary).toHaveLength(2);
    expect(temporary[0]![2]).toBe(0o600);
    expect(temporary[0]![0]).not.toBe(temporary[1]![0]);
  });
});

describe("UTF-8 byte limit", () => {
  for (const character of ["a", "é", "中", "😀"]) {
    it(`round trips ${character} at the limit and rejects oversized content without changing disk`, () => {
      const { root, file } = setup();
      const bytes = Buffer.byteLength(character, "utf8");
      const count = Math.floor(MAX_MARKDOWN_BYTES / bytes);
      const content = character.repeat(count);
      writeMarkdown(root, "a.md", content);
      expect(readMarkdown(root, "a.md").content).toBe(content);
      expect(() => writeMarkdown(root, "a.md", content + character)).toThrow(/8 MB.*UTF-8/);
      expect(fs.readFileSync(file, "utf8")).toBe(content);
    });
  }
});

describe("metadata persistence retries", () => {
  for (const kind of ["tags", "favorite"] as const) {
    it(`rolls back a failed ${kind} mutation and persists an identical retry`, () => {
      const { root } = setup();
      const indexFile = path.join(root, "index.json");
      const index = TagIndex.open(indexFile, root);
      const identity = readMarkdown(root, "a.md").identity;
      const mutate = () =>
        kind === "tags"
          ? index.setTags("a.md", ["keep"], identity)
          : index.setFavorite("a.md", true, identity);
      vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
        throw new Error("retry me");
      });
      expect(mutate).toThrow("retry me");
      expect(index.tagsFor("a.md")).toEqual([]);
      expect(index.isFavorite("a.md")).toBe(false);
      mutate();
      const reopened = TagIndex.open(indexFile, root);
      expect(reopened.tagsFor("a.md")).toEqual(kind === "tags" ? ["keep"] : []);
      expect(reopened.isFavorite("a.md")).toBe(kind === "favorite");
    });
  }
});
