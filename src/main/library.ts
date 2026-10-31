import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { shell } from "electron";
import {
  createFolder,
  createMarkdown,
  describePath,
  readImageDataUrl,
  readMarkdown,
  renameInside,
  writeMarkdown,
} from "../core/files";
import { realRoot } from "../core/paths";
import { scanRoot } from "../core/tree";
import { TagIndex } from "../core/tags";
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

export function openLibrary(rootInput: string, userData: string): Library {
  const root = realRoot(rootInput);
  current?.close();
  const indexFile = path.join(
    userData,
    "indexes",
    `${createHash("sha256").update(root).digest("hex")}.json`,
  );
  current = new Library(root, indexFile);
  writeLastRoot(userData, root);
  return current;
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
  private signature = "";
  private timer: NodeJS.Timeout | null = null;
  private paused = false;
  private watched: string | null = null;
  private baseline: { hash: string; missing: boolean } | null = null;

  constructor(root: string, indexFile: string) {
    this.root = root;
    this.tags = TagIndex.open(indexFile, root);
    this.refresh(true);
    this.timer = setInterval(() => {
      this.poll();
    }, 1000);
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  session(): SessionInfo {
    return { root: this.root, tree: this.tree };
  }

  read(rel: string): { content: string; mtimeMs: number; tags: string[] } {
    const { content, identity } = readMarkdown(this.root, rel);
    this.watched = identity.path;
    this.baseline = { hash: hashContent(content), missing: false };
    return { content, mtimeMs: identity.mtimeMs, tags: this.tags.tagsFor(identity.path) };
  }

  write(rel: string, content: string): { mtimeMs: number } {
    const identity = writeMarkdown(this.root, rel, content);
    this.tags.noteIdentity(identity.path, identity);
    if (this.watched === identity.path)
      this.baseline = { hash: hashContent(content), missing: false };
    return { mtimeMs: identity.mtimeMs };
  }

  createFile(rel: string): { path: string; tree: TreeNode[] } {
    const created = createMarkdown(this.root, rel);
    return { path: created, tree: this.refresh(true) };
  }

  createFolder(rel: string): { path: string; tree: TreeNode[] } {
    const created = createFolder(this.root, rel);
    return { path: created, tree: this.refresh(true) };
  }

  rename(from: string, to: string): { from: string; to: string; tree: TreeNode[] } {
    const moved = renameInside(this.root, from, to);
    this.tags.rename(moved.from, moved.to);
    const watched = this.watched;
    if (watched === moved.from || (watched !== null && watched.startsWith(`${moved.from}/`))) {
      const next =
        watched === moved.from ? moved.to : `${moved.to}/${watched.slice(moved.from.length + 1)}`;
      this.watch(next);
    }
    return { ...moved, tree: this.refresh(true) };
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
      return { tree: this.refresh(true) };
    } finally {
      this.paused = false;
    }
  }

  setTags(rel: string, tags: string[]): string[] {
    const { identity } = readMarkdown(this.root, rel);
    return this.tags.setTags(identity.path, tags, identity);
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

  private refresh(force: boolean): TreeNode[] {
    const scan = scanRoot(this.root);
    const next = JSON.stringify(scan.tree);
    const changed = next !== this.signature;
    this.tree = scan.tree;
    this.signature = next;
    if (changed) this.tags.reconcile(scan.files);
    if (changed || force) sink.library(this.session());
    return this.tree;
  }

  private poll(): void {
    if (this.paused) return;
    try {
      if (!fs.existsSync(this.root)) return;
      this.refresh(false);
      this.pollFile();
    } catch {
      // A transient unreadable directory is retried on the next tick.
    }
  }

  private pollFile(): void {
    if (!this.watched || !this.baseline) return;
    let content: string | null = null;
    try {
      content = readMarkdown(this.root, this.watched).content;
    } catch {
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
