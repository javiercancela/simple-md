import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { readImageDataUrl } from "../../src/core/files";
import { PreviewAssets } from "../../src/ui/previewAssets";

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

it("deduplicates image references and unchanged revisions avoid content reads/transfers", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "simple-md-assets-"));
  dirs.push(root);
  fs.writeFileSync(path.join(root, "leaf.png"), "first image");
  const load = vi.fn((rel: string, revision?: string) =>
    readImageDataUrl(root, "a.md", rel, revision),
  );
  const cache = new PreviewAssets(load);
  const original = fs.promises.open;
  const reads = vi.fn();
  vi.spyOn(fs.promises, "open").mockImplementation(async (...args) => {
    const file = await original(...args);
    const read = file.read.bind(file);
    file.read = ((...input: Parameters<typeof read>) => {
      reads();
      return read(...input);
    }) as typeof read;
    return file;
  });
  const first = await Promise.all([
    cache.read("a.md", "leaf.png"),
    cache.read("nested/b.md", "../leaf.png"),
  ]);
  expect(load).toHaveBeenCalledTimes(1);
  expect(reads).toHaveBeenCalledTimes(1);
  expect(first[0]).toBe(first[1]);
  for (let edit = 0; edit < 10; edit++) expect(await cache.read("a.md", "leaf.png")).toBe(first[0]);
  expect(reads).toHaveBeenCalledTimes(1);
  const revision = load.mock.calls.at(-1)![1];
  expect(await readImageDataUrl(root, "a.md", "leaf.png", revision)).toEqual({
    revision,
    url: null,
  });
  fs.writeFileSync(path.join(root, "leaf.png"), "replacement image");
  expect(await cache.read("a.md", "leaf.png")).not.toBe(first[0]);
  expect(reads).toHaveBeenCalledTimes(2);
  fs.unlinkSync(path.join(root, "leaf.png"));
  expect(await cache.read("a.md", "leaf.png")).toBeNull();
});

it("bounds concurrency and cancels queued results when a library is disposed", async () => {
  const releases: (() => void)[] = [];
  const load = vi.fn(async () => {
    await new Promise<void>((resolve) => releases.push(resolve));
    return { revision: "1", url: "data:image/png;base64,AAAA" };
  });
  const cache = new PreviewAssets(load, 1024, 2);
  const requests = Array.from({ length: 10 }, (_, index) => cache.read("a.md", `${index}.png`));
  expect(load).toHaveBeenCalledTimes(2);
  cache.dispose();
  expect(await Promise.all(requests.slice(2))).toEqual(Array(8).fill(null));
  releases.forEach((release) => release());
  expect(await Promise.all(requests)).toEqual(Array(10).fill(null));
  expect(load).toHaveBeenCalledTimes(2);
  expect(await cache.read("a.md", "0.png")).toBeNull();
  const next = new PreviewAssets(async () => ({ revision: "1", url: "beta image" }));
  expect(await next.read("a.md", "0.png")).toBe("beta image");
});

it("evicts old paths by byte budget and entry count, and retries failed loads", async () => {
  const load = vi.fn(async (_path: string, revision?: string) => ({
    revision: "1",
    url: revision ? null : "12345",
  }));
  for (const cache of [new PreviewAssets(load, 15), new PreviewAssets(load, 1000, 4, 1)]) {
    await cache.read("a.md", "a.png");
    await cache.read("a.md", "b.png");
    await cache.read("a.md", "a.png");
    expect(load.mock.calls.at(-1)![1]).toBeUndefined();
  }
  const retry = vi
    .fn()
    .mockRejectedValueOnce(new Error("transient read error"))
    .mockResolvedValue({ revision: "1", url: "recovered" });
  const cache = new PreviewAssets(retry);
  expect(await cache.read("a.md", "a.png")).toBeNull();
  expect(await cache.read("a.md", "a.png")).toBe("recovered");
});
