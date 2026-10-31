import fs from "node:fs";
import { writeAtomic } from "./atomic";

export type FileIdentity = {
  path: string;
  ino: string;
  dev: string;
  size: number;
  mtimeMs: number;
};

export type TagCount = { tag: string; count: number };

type Entry = {
  tags: string[];
  ino: string;
  dev: string;
  size: number;
  mtimeMs: number;
};

type IndexData = {
  version: 1;
  root: string;
  files: Record<string, Entry>;
};

const TAG = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,39}$/u;

export function normalizeTags(input: readonly string[]): string[] {
  if (input.length > 32) throw new Error("Too many tags");
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const tag = raw.trim().replace(/\s+/g, " ");
    if (!TAG.test(tag)) throw new Error("Invalid tag");
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

function empty(root: string): IndexData {
  return { version: 1, root, files: {} };
}

function isEntry(value: unknown): value is Entry {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<Entry>;
  return (
    Array.isArray(record.tags) && typeof record.ino === "string" && typeof record.dev === "string"
  );
}

function parseIndex(raw: string, root: string): IndexData {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") throw new Error("bad index");
  const record = parsed as { version?: unknown; root?: unknown; files?: unknown };
  if (
    record.version !== 1 ||
    record.root !== root ||
    !record.files ||
    typeof record.files !== "object"
  ) {
    throw new Error("bad index");
  }
  const files: Record<string, Entry> = {};
  for (const [key, value] of Object.entries(record.files)) {
    if (!isEntry(value)) continue;
    files[key] = {
      tags: value.tags.filter((tag): tag is string => typeof tag === "string"),
      ino: value.ino,
      dev: value.dev,
      size: typeof value.size === "number" ? value.size : 0,
      mtimeMs: typeof value.mtimeMs === "number" ? value.mtimeMs : 0,
    };
  }
  return { version: 1, root, files };
}

function identityOf(file: FileIdentity): Pick<Entry, "ino" | "dev" | "size" | "mtimeMs"> {
  return { ino: file.ino, dev: file.dev, size: file.size, mtimeMs: file.mtimeMs };
}

export class TagIndex {
  private data: IndexData;
  private savedText = "";

  private constructor(
    private readonly file: string,
    root: string,
  ) {
    this.data = empty(root);
    this.load();
  }

  static open(file: string, root: string): TagIndex {
    return new TagIndex(file, root);
  }

  tagsFor(filePath: string): string[] {
    return [...(this.data.files[filePath]?.tags ?? [])];
  }

  setTags(filePath: string, tags: readonly string[], identity: FileIdentity): string[] {
    const normalized = normalizeTags(tags);
    if (normalized.length === 0) {
      delete this.data.files[filePath];
    } else {
      this.data.files[filePath] = { tags: normalized, ...identityOf(identity) };
    }
    this.save();
    return normalized;
  }

  noteIdentity(filePath: string, identity: FileIdentity): void {
    const entry = this.data.files[filePath];
    if (!entry) return;
    this.data.files[filePath] = { ...entry, ...identityOf(identity) };
    this.save();
  }

  listTags(): TagCount[] {
    const counts = new Map<string, TagCount>();
    for (const entry of Object.values(this.data.files)) {
      const seen = new Set<string>();
      for (const tag of entry.tags) {
        const key = tag.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const existing = counts.get(key);
        if (existing) existing.count += 1;
        else counts.set(key, { tag, count: 1 });
      }
    }
    return [...counts.values()].sort((a, b) =>
      a.tag.localeCompare(b.tag, undefined, { sensitivity: "base" }),
    );
  }

  filesForTag(tag: string): string[] {
    const key = tag.trim().toLowerCase();
    return Object.entries(this.data.files)
      .filter(([, entry]) => entry.tags.some((item) => item.toLowerCase() === key))
      .map(([filePath]) => filePath)
      .sort((a, b) => a.localeCompare(b));
  }

  rename(from: string, to: string): void {
    if (from === to) return;
    const prefix = `${from}/`;
    const next: Record<string, Entry> = {};
    const moves: [string, Entry][] = [];
    for (const [key, entry] of Object.entries(this.data.files)) {
      if (key === from) moves.push([to, entry]);
      else if (key.startsWith(prefix)) moves.push([`${to}/${key.slice(prefix.length)}`, entry]);
      else next[key] = entry;
    }
    for (const [key, entry] of moves) next[key] = entry;
    this.data.files = next;
    this.save();
  }

  remove(target: string): void {
    const prefix = `${target}/`;
    for (const key of Object.keys(this.data.files)) {
      if (key === target || key.startsWith(prefix)) delete this.data.files[key];
    }
    this.save();
  }

  reconcile(files: readonly FileIdentity[]): void {
    const byPath = new Map(files.map((file) => [file.path, file]));
    const claimed = new Set<string>();
    const next: Record<string, Entry> = {};
    for (const [key, entry] of Object.entries(this.data.files)) {
      const live = byPath.get(key);
      if (!live) continue;
      next[key] = { tags: entry.tags, ...identityOf(live) };
      claimed.add(key);
    }
    const unclaimed = files.filter((file) => !claimed.has(file.path));
    for (const [key, entry] of Object.entries(this.data.files)) {
      if (next[key]) continue;
      if (!entry.ino || entry.ino === "0") continue;
      const matches = unclaimed.filter((file) => file.ino === entry.ino && file.dev === entry.dev);
      const match = matches.length === 1 ? matches[0] : undefined;
      if (!match || next[match.path]) continue;
      next[match.path] = { tags: entry.tags, ...identityOf(match) };
      const index = unclaimed.indexOf(match);
      if (index >= 0) unclaimed.splice(index, 1);
    }
    this.data.files = next;
    this.save();
  }

  private load(): void {
    if (!fs.existsSync(this.file)) {
      this.save();
      return;
    }
    try {
      this.data = parseIndex(fs.readFileSync(this.file, "utf8"), this.data.root);
    } catch {
      try {
        fs.renameSync(this.file, `${this.file}.bak`);
      } catch {
        // The unreadable index is replaced below.
      }
      this.data = empty(this.data.root);
    }
    this.save();
  }

  private save(): void {
    const files = Object.fromEntries(
      Object.entries(this.data.files).sort(([a], [b]) => a.localeCompare(b)),
    );
    const text = JSON.stringify({ version: 1, root: this.data.root, files }, null, 2);
    if (text === this.savedText) return;
    this.savedText = text;
    writeAtomic(this.file, text);
  }
}
