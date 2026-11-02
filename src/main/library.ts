import { createHash } from "node:crypto";
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
import { realRoot } from "../core/paths";
import { scanRoot } from "../core/tree";
import { TagIndex, type FileIdentity } from "../core/tags";
import type { ExternalFileEvent, SessionInfo, TagCount, TreeNode } from "../shared/types";
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

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export class Library {
  readonly root: string;
  private readonly tags: TagIndex;
  private tree: TreeNode[] = [];
  private files: FileIdentity[] = [];
  private scanIncomplete = false;
  private signature = "";
  private fileSignature = "";
  private timer: NodeJS.Timeout | null = null;
  private generation = 0;
  private polling = false;
  private ticks = 0;
  private paused = false;
  private watched: string | null = null;
  private baseline: { hash: string; missing: boolean } | null = null;

  constructor(root: string, indexFile: string) {
    this.root = root;
    this.tags = TagIndex.open(indexFile, root);
  }

  async load(): Promise<void> {
    const generation = this.generation;
    await this.refresh(true);
    if (generation !== this.generation) return;
    this.timer = setInterval(() => {
      void this.poll();
    }, 1000);
  }

  close(): void {
    this.generation += 1;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  session(): SessionInfo {
    return {
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

  read(rel: string): { content: string; mtimeMs: number; tags: string[]; favorite: boolean } {
    const { content, identity } = readMarkdown(this.root, rel);
    this.watched = identity.path;
    this.baseline = { hash: hashContent(content), missing: false };
    return {
      content,
      mtimeMs: identity.mtimeMs,
      tags: this.tags.tagsFor(identity.path),
      favorite: this.tags.isFavorite(identity.path),
    };
  }

  write(rel: string, content: string): { mtimeMs: number } {
    const identity = writeMarkdown(this.root, rel, content);
    this.tags.noteIdentity(identity.path, identity);
    const index = this.files.findIndex((file) => file.path === identity.path);
    if (index >= 0) this.files[index] = identity;
    else this.files.push(identity);
    if (this.watched === identity.path)
      this.baseline = { hash: hashContent(content), missing: false };
    this.publish();
    return { mtimeMs: identity.mtimeMs };
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
    this.baseline = { hash: hashContent(content), missing: false };
  }

  unwatch(): void {
    this.watched = null;
    this.baseline = null;
  }

  private async refresh(force: boolean): Promise<TreeNode[]> {
    const generation = this.generation;
    const scan = await scanRoot(this.root);
    if (generation !== this.generation) return this.tree;
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
    if (this.paused || this.polling) return;
    this.polling = true;
    const generation = this.generation;
    this.ticks += 1;
    try {
      if (!fs.existsSync(this.root)) return;
      if (this.ticks % 4 === 0) await this.refresh(false);
      if (generation !== this.generation) return;
      this.pollFile();
    } catch {
      // A transient unreadable directory is retried on the next tick.
    } finally {
      this.polling = false;
    }
  }

  private pollFile(): void {
    if (!this.watched || !this.baseline) return;
    let content: string | null = null;
    try {
      content = readMarkdown(this.root, this.watched).content;
    } catch (error) {
      // Only confirmed absence is removal; unreadable/oversized files are retried.
      const cause = error instanceof Error && error.cause ? error.cause : error;
      if (
        !cause ||
        typeof cause !== "object" ||
        !("code" in cause) ||
        (cause.code !== "ENOENT" && cause.code !== "ENOTDIR")
      )
        return;
      content = null;
    }
    if (content === null) {
      if (this.baseline.missing) return;
      this.baseline = { hash: "", missing: true };
      sink.file({ path: this.watched, exists: false, content: "" });
      return;
    }
    const hash = hashContent(content);
    if (!this.baseline.missing && hash === this.baseline.hash) return;
    this.baseline = { hash, missing: false };
    sink.file({ path: this.watched, exists: true, content });
  }
}
