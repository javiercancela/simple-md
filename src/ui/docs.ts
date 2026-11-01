import type { CatalogFile } from "../shared/types";

export type LibraryFilter =
  | { type: "all" }
  | { type: "recent" }
  | { type: "favorites" }
  | { type: "folder"; path: string }
  | { type: "tag"; tag: string };

export type DocSort = "edited" | "edited-asc" | "title" | "title-desc";

export const RECENT_MS = 14 * 24 * 60 * 60 * 1000;

export function isRecent(mtimeMs: number, now: number): boolean {
  return mtimeMs <= now + 60_000 && now - mtimeMs <= RECENT_MS;
}

export function matchesQuery(file: CatalogFile, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  if (needle.startsWith("#")) {
    const tag = needle.slice(1);
    return file.tags.some((item) => item.toLowerCase().startsWith(tag));
  }
  if (file.name.toLowerCase().includes(needle) || file.path.toLowerCase().includes(needle))
    return true;
  return file.tags.some((item) => item.toLowerCase().includes(needle));
}

export function inFilter(file: CatalogFile, filter: LibraryFilter, now: number): boolean {
  if (filter.type === "all") return true;
  if (filter.type === "recent") return isRecent(file.mtimeMs, now);
  if (filter.type === "favorites") return file.favorite;
  if (filter.type === "tag")
    return file.tags.some((item) => item.toLowerCase() === filter.tag.toLowerCase());
  return file.path.startsWith(`${filter.path}/`);
}

export function sortDocs(files: readonly CatalogFile[], sort: DocSort): CatalogFile[] {
  const next = [...files];
  const byName = (a: CatalogFile, b: CatalogFile) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  next.sort((a, b) => {
    if (sort === "title") return byName(a, b);
    if (sort === "title-desc") return byName(b, a);
    if (sort === "edited-asc") return a.mtimeMs - b.mtimeMs || byName(a, b);
    return b.mtimeMs - a.mtimeMs || byName(a, b);
  });
  return next;
}

export function visibleDocs(
  files: readonly CatalogFile[],
  filter: LibraryFilter,
  query: string,
  sort: DocSort,
  now = Date.now(),
): CatalogFile[] {
  return sortDocs(
    files.filter((file) => inFilter(file, filter, now) && matchesQuery(file, query)),
    sort,
  );
}

export function tagCounts(files: readonly CatalogFile[]): { tag: string; count: number }[] {
  const map = new Map<string, { tag: string; count: number }>();
  for (const file of files) {
    const seen = new Set<string>();
    for (const tag of file.tags) {
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const existing = map.get(key);
      if (existing) existing.count += 1;
      else map.set(key, { tag, count: 1 });
    }
  }
  return [...map.values()].sort((a, b) =>
    a.tag.localeCompare(b.tag, undefined, { sensitivity: "base" }),
  );
}

export function countInFolder(files: readonly CatalogFile[], folder: string): number {
  const prefix = `${folder}/`;
  let count = 0;
  for (const file of files) if (file.path.startsWith(prefix)) count += 1;
  return count;
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

export function readMinutes(words: number): string {
  if (words <= 0) return "0 min read";
  return `${Math.max(1, Math.round(words / 230))} min read`;
}

export function editedLabel(mtimeMs: number, now = Date.now()): string {
  const date = new Date(mtimeMs);
  const today = new Date(now);
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (date.toDateString() === today.toDateString()) return `Edited today at ${time}`;
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Edited yesterday";
  const sameYear = date.getFullYear() === today.getFullYear();
  const day = date.toLocaleDateString(
    undefined,
    sameYear
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" },
  );
  return `Edited ${day}`;
}

export function shortWhen(mtimeMs: number, now = Date.now()): string {
  const date = new Date(mtimeMs);
  const today = new Date(now);
  if (date.toDateString() === today.toDateString())
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  const sameYear = date.getFullYear() === today.getFullYear();
  return date.toLocaleDateString(
    undefined,
    sameYear
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" },
  );
}

export function filterLabel(filter: LibraryFilter): string {
  if (filter.type === "all") return "All Documents";
  if (filter.type === "recent") return "Recent";
  if (filter.type === "favorites") return "Favorites";
  if (filter.type === "tag") return `#${filter.tag}`;
  const name = filter.path.split("/").pop();
  return name && name.length > 0 ? name : filter.path;
}

export function modLabel(platform: string): string {
  return platform === "darwin" ? "⌘" : "Ctrl";
}
