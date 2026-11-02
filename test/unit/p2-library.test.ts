import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("electron", () => ({ clipboard: {}, shell: {} }));
import { Library, setLibrarySink } from "../../src/main/library";

const dirs: string[] = [];
const libraries: Library[] = [];
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "simple-md-p2-lib-"));
  dirs.push(root);
  const file = path.join(root, "a.md");
  fs.writeFileSync(file, "original");
  const library = new Library(root, path.join(root, "index.json"));
  libraries.push(library);
  return { root, file, library };
}
function pollFile(library: Library) {
  return (library as unknown as { pollFile(): Promise<void> }).pollFile();
}
function poll(library: Library) {
  return (library as unknown as { poll(): Promise<void> }).poll();
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const library of libraries.splice(0)) library.close();
  setLibrarySink({ library() {}, file() {} });
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("save revision conflicts", () => {
  for (const change of ["edit", "replace", "delete"] as const) {
    it(`detects an external ${change} before polling and requires the confirmed revision`, () => {
      const { library, file } = setup();
      const opened = library.read("a.md");
      if (change === "edit") fs.writeFileSync(file, "external");
      else if (change === "replace") {
        fs.writeFileSync(`${file}.replacement`, "original");
        fs.renameSync(`${file}.replacement`, file);
      } else fs.unlinkSync(file);
      const result = library.write("a.md", "local", opened.revision);
      expect(result.status).toBe("conflict");
      if (result.status !== "conflict") throw new Error("expected conflict");
      expect(fs.existsSync(file)).toBe(change !== "delete");
      if (change !== "delete")
        expect(fs.readFileSync(file, "utf8")).toBe(change === "edit" ? "external" : "original");
      const saved = library.write("a.md", "local", result.revision);
      expect(saved.status).toBe("saved");
      expect(fs.readFileSync(file, "utf8")).toBe("local");
      expect(library.read("a.md").revision).toBe(saved.revision);
    });
  }

  it("rechecks a revision after conflict confirmation and before each subsequent save", () => {
    const { library, file } = setup();
    const opened = library.read("a.md");
    const saved = library.write("a.md", "first", opened.revision);
    expect(saved.status).toBe("saved");
    expect(library.write("a.md", "second", opened.revision).status).toBe("conflict");
    fs.writeFileSync(file, "another external edit");
    expect(library.write("a.md", "second", saved.revision).status).toBe("conflict");
    expect(fs.readFileSync(file, "utf8")).toBe("another external edit");
  });
});

describe("background reconciliation", () => {
  it("does no synchronous scanning or content reads during unchanged ticks", async () => {
    const { library } = setup();
    vi.spyOn(fs, "watch").mockImplementation(() => {
      throw new Error("unsupported");
    });
    await library.load();
    library.read("a.md");
    await pollFile(library);
    const read = vi.spyOn(fs.promises, "readFile");
    const scan = vi.spyOn(fs.promises, "readdir");
    const sync = vi.spyOn(fs, "readFileSync");
    for (let tick = 0; tick < 10; tick++) await poll(library);
    expect(read).not.toHaveBeenCalled();
    expect(scan).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
  });

  it("uses a bounded full reconciliation even when notifications are unavailable", async () => {
    const { library, root, file } = setup();
    vi.spyOn(fs, "watch").mockImplementation(() => {
      throw new Error("unsupported");
    });
    await library.load();
    library.read("a.md");
    await pollFile(library);
    const changed = vi.fn();
    setLibrarySink({ library() {}, file: changed });
    fs.writeFileSync(file, "external");
    fs.writeFileSync(path.join(root, "new.md"), "new");
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_001);
    await poll(library);
    expect(library.session().catalog.some((row) => row.path === "new.md")).toBe(true);
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ content: "external" }));
  });

  it("checks content on fallback even if the metadata fingerprint is unchanged", async () => {
    const { library, file } = setup();
    library.read("a.md");
    await pollFile(library);
    const stat = await fs.promises.stat(file, { bigint: true });
    vi.spyOn(fs.promises, "stat").mockResolvedValue(stat);
    fs.writeFileSync(file, "modified");
    const changed = vi.fn();
    setLibrarySink({ library() {}, file: changed });
    await pollFile(library);
    expect(changed).not.toHaveBeenCalled();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_001);
    await pollFile(library);
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ content: "modified" }));
  });

  it("stops background work while suspended and reconciles after resume", async () => {
    const { library, root } = setup();
    await library.load();
    library.suspend();
    const read = vi.spyOn(fs.promises, "readdir");
    fs.writeFileSync(path.join(root, "new.md"), "new");
    await poll(library);
    expect(read).not.toHaveBeenCalled();
    library.resume();
    await vi.waitFor(() =>
      expect(library.session().catalog.some((row) => row.path === "new.md")).toBe(true),
    );
  });
});

it("keeps the event loop responsive during slow reconciliation and ignores an obsolete scan", async () => {
  const { root, library } = setup();
  await library.load();
  const original = fs.promises.readdir;
  let release: () => void = () => {};
  let entered = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const spy = vi.spyOn(fs.promises, "readdir").mockImplementationOnce((async (
    ...args: unknown[]
  ) => {
    const result = await (original as (...args: unknown[]) => unknown)(...args);
    entered = true;
    await gate;
    return result;
  }) as typeof original);
  const refresh = () =>
    (library as unknown as { refresh(force: boolean): Promise<unknown> }).refresh(true);
  const obsolete = refresh();
  await vi.waitFor(() => expect(entered).toBe(true));
  // The old directory listing is held while a newer scan sees a new document.
  fs.writeFileSync(path.join(root, "new.md"), "new");
  await refresh();
  spy.mockRestore();
  let timerRan = false;
  await new Promise<void>((resolve) =>
    setTimeout(() => {
      timerRan = true;
      resolve();
    }, 5),
  );
  expect(timerRan).toBe(true);
  release();
  await obsolete;
  expect(library.session().catalog.some((file) => file.path === "new.md")).toBe(true);
});
