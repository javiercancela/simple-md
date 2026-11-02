import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { clipboard, shell } from "electron";
import {
  createFolder,
  createMarkdown,
  describePath,
  readExcerpt,
  readImageDataUrl,
  readMarkdown,
  renameInside,
  writeMarkdown,
} from "../core/files";
import { isColorId } from "../core/colors";
import { realRoot, resolveContainedAsync } from "../core/paths";
import { MAX_MARKDOWN_BYTES } from "../core/names";
import { scanRoot } from "../core/tree";
import { TagIndex, type FileIdentity } from "../core/tags";
import type {
  ExternalFileEvent,
  FilePayload,
  SessionInfo,
  TagCount,
  TreeNode,
  WriteResult,
} from "../shared/types";
import { writeLastRoot } from "./settings";

type Sink = {
  library: (session: SessionInfo) => void;
  file: (event: ExternalFileEvent) => void;
};

const noopSink: Sink = { library() {}, file() {} };

let sink: Sink = noopSink;
let current: Library | null = null;

export function setLibrarySink(next: Sink): void {
  sink = next;
}

export function getLibrary(): Library | null {
  return current;
}

export async function openLibrary(rootInput: string, userData: string): Promise<Library> {
  const root = realRoot(rootInput);
  current?.close();
  const indexFile = path.join(
    userData,
    "indexes",
    `${createHash("sha256").update(root).digest("hex")}.json`,
  );
  const library = new Library(root, indexFile);
  current = library;
  await library.load();
  if (current === library) writeLastRoot(userData, root);
  return library;
}

export function closeLibrary(): void {
  current?.close();
  current = null;
}

function diskRevision(content: string, identity: FileIdentity): string {
  return createHash("sha256")
    .update(`${identity.dev}:${identity.ino}:${identity.size}:${identity.mtimeMs}\0`)
    .update(content)
    .digest("hex");
}

function isMissing(error: unknown): boolean {
  const cause = error instanceof Error && error.cause ? error.cause : error;
  return (
    !!cause &&
    typeof cause === "object" &&
    "code" in cause &&
    (cause.code === "ENOENT" || cause.code === "ENOTDIR")
  );
}

const FALLBACK_MS = 60_000;

export class Library {
  private readonly id = randomUUID();
  readonly root: string;
  private readonly tags: TagIndex;
  private tree: TreeNode[] = [];
  private files: FileIdentity[] = [];
  private scanIncomplete = false;
  private signature = "";
  private fileSignature = "";
  private timer: NodeJS.Timeout | null = null;
  private generation = 0;
  private refreshId = 0;
  private polling = false;
  private watcher: fs.FSWatcher | null = null;
  private treeDirty = false;
  private fileDirty = false;
  private lastScan = 0;
  private lastContentCheck = 0;
  private fingerprint = "";
  private suspended = false;
  private paused = false;
  private watched: string | null = null;
  private baseline: { revision: string | null; missing: boolean } | null = null;

  constructor(root: string, indexFile: string) {
    this.root = root;
    this.tags = TagIndex.open(indexFile, root);
  }

  async load(): Promise<void> {
    const generation = this.generation;
    await this.refresh(true);
    if (generation !== this.generation) return;
    this.startMonitoring();
  }

  close(): void {
    this.generation += 1;
    this.stopMonitoring();
  }

  suspend(): void {
    this.suspended = true;
    this.generation += 1;
    this.stopMonitoring();
  }

  resume(): void {
    if (!this.suspended) return;
    this.suspended = false;
    this.treeDirty = true;
    this.fileDirty = true;
    this.startMonitoring();
    void this.poll();
  }

  private startMonitoring(): void {
    if (this.timer || this.suspended) return;
    try {
      this.watcher = fs.watch(this.root, { recursive: true }, () => {
        this.treeDirty = true;
        this.fileDirty = true;
      });
      this.watcher.on("error", () => {
        this.watcher?.close();
        this.watcher = null;
        this.treeDirty = true;
      });
    } catch {
      // Unsupported watchers/unavailable storage use bounded reconciliation.
    }
    this.timer = setInterval(() => void this.poll(), 1000);
  }

  private stopMonitoring(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.watcher?.close();
    this.watcher = null;
  }

  session(): SessionInfo {
    return {
      id: this.id,
      root: this.root,
      tree: this.tree,
      catalog: this.files.map((file) => ({
        path: file.path,
        name: file.path.split("/").pop() ?? file.path,
        mtimeMs: file.mtimeMs,
        favorite: this.tags.isFavorite(file.path),
        tags: this.tags.tagsFor(file.path),
      })),
      colors: this.tags.colors(),
    };
  }

  read(rel: string): FilePayload {
    const { content, identity } = readMarkdown(this.root, rel);
    this.watched = identity.path;
    this.baseline = { revision: diskRevision(content, identity), missing: false };
    this.fingerprint = "";
    return {
      revision: this.baseline.revision!,
      content,
      mtimeMs: identity.mtimeMs,
      tags: this.tags.tagsFor(identity.path),
      favorite: this.tags.isFavorite(identity.path),
    };
  }

  write(rel: string, content: string, expectedRevision: string | null): WriteResult {
    if (Buffer.byteLength(content, "utf8") > MAX_MARKDOWN_BYTES)
      throw new Error("Markdown files are limited to 8 MB of UTF-8 text");
    let revision: string | null = null;
    try {
      const current = readMarkdown(this.root, rel);
      revision = diskRevision(current.content, current.identity);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    if (revision !== expectedRevision) return { status: "conflict", revision };
    // Best effort revision check immediately before atomic replacement. The OS
    // offers no portable compare-and-swap against another process's rename.
    const identity = writeMarkdown(this.root, rel, content);
    revision = diskRevision(content, identity);
    this.tags.noteIdentity(identity.path, identity);
    const index = this.files.findIndex((file) => file.path === identity.path);
    if (index >= 0) this.files[index] = identity;
    else this.files.push(identity);
    if (this.watched === identity.path) {
      this.baseline = { revision, missing: false };
      this.fingerprint = "";
    }
    this.publish();
    return { status: "saved", mtimeMs: identity.mtimeMs, revision };
  }

  async createFile(rel: string): Promise<{ path: string; tree: TreeNode[] }> {
    const created = createMarkdown(this.root, rel);
    return { path: created, tree: await this.refresh(true) };
  }

  async createFolder(rel: string): Promise<{ path: string; tree: TreeNode[] }> {
    const created = createFolder(this.root, rel);
    return { path: created, tree: await this.refresh(true) };
  }

  async rename(from: string, to: string): Promise<{ from: string; to: string; tree: TreeNode[] }> {
    const moved = renameInside(this.root, from, to);
    this.tags.rename(moved.from, moved.to);
    const watched = this.watched;
    if (watched === moved.from || (watched !== null && watched.startsWith(`${moved.from}/`))) {
      const next =
        watched === moved.from ? moved.to : `${moved.to}/${watched.slice(moved.from.length + 1)}`;
      this.watch(next);
    }
    return { ...moved, tree: await this.refresh(true) };
  }

  async trash(rel: string): Promise<{ tree: TreeNode[] }> {
    const described = describePath(this.root, rel);
    this.paused = true;
    try {
      await shell.trashItem(described.abs);
      this.tags.remove(described.rel);
      const watched = this.watched;
      if (
        watched === described.rel ||
        (described.isDirectory && watched !== null && watched.startsWith(`${described.rel}/`))
      ) {
        this.unwatch();
      }
      return { tree: await this.refresh(true) };
    } finally {
      this.paused = false;
    }
  }

  setTags(rel: string, tags: string[]): string[] {
    const { identity } = readMarkdown(this.root, rel);
    const next = this.tags.setTags(identity.path, tags, identity);
    this.publish();
    return next;
  }

  setFavorite(rel: string, favorite: boolean): boolean {
    const { identity } = readMarkdown(this.root, rel);
    const next = this.tags.setFavorite(identity.path, favorite, identity);
    this.publish();
    return next;
  }

  setColor(tag: string, color: string): void {
    if (!isColorId(color)) throw new Error("Invalid tag color");
    this.tags.setColor(tag, color);
    this.publish();
  }

  snippet(rel: string): string {
    return readExcerpt(this.root, rel);
  }

  reveal(rel: string): void {
    shell.showItemInFolder(describePath(this.root, rel).abs);
  }

  copyPath(rel: string): void {
    clipboard.writeText(describePath(this.root, rel).abs);
  }

  listTags(): TagCount[] {
    return this.tags.listTags();
  }

  filesForTag(tag: string): string[] {
    return this.tags.filesForTag(tag);
  }

  readAsset(from: string, href: string): string | null {
    return readImageDataUrl(this.root, from, href);
  }

  watch(rel: string): void {
    const { content, identity } = readMarkdown(this.root, rel);
    this.watched = identity.path;
    this.baseline = { revision: diskRevision(content, identity), missing: false };
    this.fingerprint = "";
  }

  unwatch(): void {
    this.watched = null;
    this.baseline = null;
  }

  private async refresh(force: boolean): Promise<TreeNode[]> {
    const generation = this.generation;
    const refreshId = ++this.refreshId;
    // Clear before awaiting so notifications arriving during a scan survive it.
    this.treeDirty = false;
    let scan: Awaited<ReturnType<typeof scanRoot>>;
    try {
      scan = await scanRoot(this.root);
    } catch (error) {
      this.treeDirty = true;
      throw error;
    }
    if (generation !== this.generation || refreshId !== this.refreshId) return this.tree;
    this.lastScan = Date.now();
    const next = JSON.stringify(scan.tree);
    const fileSig = scan.files
      .map((file) => `${file.path}\0${file.mtimeMs}\0${file.ino}`)
      .join("\n");
    const changed = next !== this.signature || fileSig !== this.fileSignature;
    this.tree = scan.tree;
    this.files = scan.files;
    this.signature = next;
    this.fileSignature = fileSig;
    // A partial snapshot cannot establish deletion or an unambiguous rename.
    if (scan.complete && (changed || this.scanIncomplete)) this.tags.reconcile(scan.files);
    this.scanIncomplete = !scan.complete;
    if (changed || force) this.publish();
    return this.tree;
  }

  private publish(): void {
    sink.library(this.session());
  }

  private async poll(): Promise<void> {
    if (this.suspended || this.paused || this.polling) return;
    this.polling = true;
    const generation = this.generation;
    try {
      if (this.treeDirty || Date.now() - this.lastScan >= FALLBACK_MS) await this.refresh(false);
      if (generation !== this.generation) return;
      await this.pollFile();
    } catch {
      // A transient unreadable directory is retried on the next tick.
    } finally {
      this.polling = false;
    }
  }

  private async pollFile(): Promise<void> {
    const watched = this.watched;
    const baseline = this.baseline;
    if (!watched || !baseline) return;
    const generation = this.generation;
    const notified = this.fileDirty;
    this.fileDirty = false;
    let content: string;
    let revision: string;
    let fingerprint: string;
    try {
      const abs = await resolveContainedAsync(this.root, watched);
      const stat = await fs.promises.stat(abs, { bigint: true });
      fingerprint = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
      if (
        !notified &&
        fingerprint === this.fingerprint &&
        Date.now() - this.lastContentCheck < FALLBACK_MS
      )
        return;
      if (!stat.isFile() || stat.size > BigInt(MAX_MARKDOWN_BYTES)) return;
      content = await fs.promises.readFile(abs, "utf8");
      revision = diskRevision(content, {
        path: watched,
        dev: String(stat.dev),
        ino: String(stat.ino),
        size: Number(stat.size),
        mtimeMs: Number(stat.mtimeMs),
      });
    } catch (error) {
      if (generation !== this.generation || this.baseline !== baseline) return;
      // Read errors never imply deletion.
      if (!isMissing(error)) {
        this.fileDirty = true;
        return;
      }
      if (baseline.missing) return;
      this.baseline = { revision: null, missing: true };
      this.fingerprint = "";
      sink.file({ path: watched, exists: false, content: "", revision: null });
      return;
    }
    if (generation !== this.generation || this.baseline !== baseline) return;
    this.fingerprint = fingerprint;
    this.lastContentCheck = Date.now();
    if (!baseline.missing && revision === baseline.revision) return;
    this.baseline = { revision, missing: false };
    sink.file({ path: watched, exists: true, content, revision });
  }
}
