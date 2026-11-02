import fs from "node:fs";
import { isColorId, type TagColorId } from "./colors";
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
  favorite?: boolean;
  ino: string;
  dev: string;
  size: number;
  mtimeMs: number;
};

type IndexData = {
  version: 1;
  root: string;
  files: Record<string, Entry>;
  colors: Record<string, string>;
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
  return { version: 1, root, files: {}, colors: {} };
}

function isEntry(value: unknown): value is Entry {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<Entry>;
  return (
    Array.isArray(record.tags) && typeof record.ino === "string" && typeof record.dev === "string"
  );
}

function parseColors(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const colors: Record<string, string> = {};
  for (const [key, color] of Object.entries(value)) {
    if (typeof color === "string" && isColorId(color)) colors[key.toLowerCase()] = color;
  }
  return colors;
}

function parseIndex(raw: string, root: string): IndexData {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") throw new Error("bad index");
  const record = parsed as { version?: unknown; root?: unknown; files?: unknown; colors?: unknown };
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
      ...(value.favorite === true ? { favorite: true } : {}),
      ino: value.ino,
      dev: value.dev,
      size: typeof value.size === "number" ? value.size : 0,
      mtimeMs: typeof value.mtimeMs === "number" ? value.mtimeMs : 0,
    };
  }
  return { version: 1, root, files, colors: parseColors(record.colors) };
}

function identityOf(file: FileIdentity): Pick<Entry, "ino" | "dev" | "size" | "mtimeMs"> {
  return { ino: file.ino, dev: file.dev, size: file.size, mtimeMs: file.mtimeMs };
}

function withFavorite(entry: Entry, favorite: boolean): Entry {
  if (!favorite) {
    const { favorite: _drop, ...rest } = entry;
    return rest;
  }
  return { ...entry, favorite: true };
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

  isFavorite(filePath: string): boolean {
    return this.data.files[filePath]?.favorite === true;
  }

  setTags(filePath: string, tags: readonly string[], identity: FileIdentity): string[] {
    const normalized = normalizeTags(tags);
    const favorite = this.data.files[filePath]?.favorite === true;
    if (normalized.length === 0 && !favorite) {
      delete this.data.files[filePath];
    } else {
      this.data.files[filePath] = withFavorite(
        { tags: normalized, ...identityOf(identity) },
        favorite,
      );
    }
    this.save();
    return normalized;
  }

  setFavorite(filePath: string, favorite: boolean, identity: FileIdentity): boolean {
    const tags = this.data.files[filePath]?.tags ?? [];
    if (!favorite && tags.length === 0) {
      delete this.data.files[filePath];
      this.save();
      return false;
    }
    this.data.files[filePath] = withFavorite(
      { tags: [...tags], ...identityOf(identity) },
      favorite,
    );
    this.save();
    return favorite;
  }

  setColor(tag: string, color: TagColorId): void {
    const key = tag.trim().replace(/\s+/g, " ").toLowerCase();
    if (!key) throw new Error("Invalid tag color");
    this.data.colors[key] = color;
    this.save();
  }

  colors(): Record<string, string> {
    return { ...this.data.colors };
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
      next[key] = withFavorite({ tags: entry.tags, ...identityOf(live) }, entry.favorite === true);
      claimed.add(key);
    }
    const byIdentity = new Map<string, FileIdentity[]>();
    for (const file of files) {
      if (claimed.has(file.path)) continue;
      const key = `${file.dev}:${file.ino}`;
      const matches = byIdentity.get(key);
      if (matches) matches.push(file);
      else byIdentity.set(key, [file]);
    }
    for (const [key, entry] of Object.entries(this.data.files)) {
      if (next[key]) continue;
      if (!entry.ino || entry.ino === "0") continue;
      const identityKey = `${entry.dev}:${entry.ino}`;
      const matches = byIdentity.get(identityKey);
      const match = matches?.length === 1 ? matches[0] : undefined;
      if (!match || next[match.path]) continue;
      next[match.path] = withFavorite(
        { tags: entry.tags, ...identityOf(match) },
        entry.favorite === true,
      );
      byIdentity.delete(identityKey);
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
    const colors = Object.fromEntries(
      Object.entries(this.data.colors).sort(([a], [b]) => a.localeCompare(b)),
    );
    const text = JSON.stringify({ version: 1, root: this.data.root, files, colors }, null, 2);
    if (text === this.savedText) return;
    try {
      writeAtomic(this.file, text);
      this.savedText = text;
    } catch (error) {
      // Failed mutations are rolled back; identical retries must still persist.
      this.data = this.savedText
        ? parseIndex(this.savedText, this.data.root)
        : empty(this.data.root);
      throw error;
    }
  }
}
