import fs from "node:fs";
import { writeAtomic } from "./atomic";
import { resolveRelativeLink } from "./links";
import {
  imageMime,
  isMarkdownPath,
  markdownTarget,
  MAX_IMAGE_BYTES,
  MAX_MARKDOWN_BYTES,
} from "./names";
import { excerpt } from "./excerpt";
import { portableRelative, resolveContained } from "./paths";
import type { FileIdentity } from "./tags";

export type { FileIdentity };

function statIdentity(rel: string, abs: string): FileIdentity {
  const stat = fs.statSync(abs, { bigint: true });
  return {
    path: rel,
    ino: stat.ino.toString(),
    dev: stat.dev.toString(),
    size: Number(stat.size),
    mtimeMs: Number(stat.mtimeMs),
  };
}

function existingMarkdown(
  root: string,
  relInput: string,
): { rel: string; abs: string; identity: FileIdentity } {
  const rel = portableRelative(relInput);
  if (!isMarkdownPath(rel)) throw new Error("Only Markdown files can be opened");
  const abs = resolveContained(root, rel);
  const stat = fs.statSync(abs);
  if (!stat.isFile()) throw new Error("Not a Markdown file");
  if (stat.size > MAX_MARKDOWN_BYTES)
    throw new Error("Markdown files are limited to 8 MB of UTF-8 text");
  return { rel, abs, identity: statIdentity(rel, abs) };
}

export function readMarkdown(
  root: string,
  relInput: string,
): { content: string; identity: FileIdentity } {
  const { abs, identity } = existingMarkdown(root, relInput);
  return { content: fs.readFileSync(abs, "utf8"), identity };
}

export function readExcerpt(root: string, relInput: string): string {
  const { abs } = existingMarkdown(root, relInput);
  const fd = fs.openSync(abs, "r");
  try {
    const buf = Buffer.alloc(4096);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return excerpt(buf.toString("utf8", 0, n));
  } finally {
    fs.closeSync(fd);
  }
}

export function writeMarkdown(root: string, relInput: string, content: string): FileIdentity {
  if (Buffer.byteLength(content, "utf8") > MAX_MARKDOWN_BYTES)
    throw new Error("Markdown files are limited to 8 MB of UTF-8 text");
  const rel = portableRelative(relInput);
  if (!isMarkdownPath(rel)) throw new Error("Only Markdown files can be saved");
  const abs = resolveContained(root, rel, { allowMissing: true });
  if (fs.existsSync(abs) && !fs.statSync(abs).isFile()) throw new Error("Not a Markdown file");
  writeAtomic(abs, content);
  return statIdentity(rel, abs);
}

export function createMarkdown(root: string, relInput: string): string {
  const rel = markdownTarget(portableRelative(relInput));
  let abs: string;
  try {
    abs = resolveContained(root, rel, { allowMissing: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Path not found")
      throw new Error("Folder not found");
    throw error;
  }
  if (fs.existsSync(abs)) throw new Error("Already exists");
  writeAtomic(abs, "");
  return rel;
}

export function createFolder(root: string, relInput: string): string {
  const rel = portableRelative(relInput);
  let abs: string;
  try {
    abs = resolveContained(root, rel, { allowMissing: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Path not found")
      throw new Error("Folder not found");
    throw error;
  }
  if (fs.existsSync(abs)) throw new Error("Already exists");
  fs.mkdirSync(abs);
  return rel;
}

export function describePath(
  root: string,
  relInput: string,
): { rel: string; abs: string; isDirectory: boolean } {
  const rel = portableRelative(relInput);
  const abs = resolveContained(root, rel, { preserveFinalSymlink: true });
  return { rel, abs, isDirectory: fs.statSync(abs).isDirectory() };
}

export function renameInside(
  root: string,
  fromInput: string,
  toInput: string,
): { from: string; to: string; isDirectory: boolean } {
  const from = portableRelative(fromInput);
  const fromAbs = resolveContained(root, from, { preserveFinalSymlink: true });
  const isDirectory = fs.statSync(fromAbs).isDirectory();
  const to = isDirectory ? portableRelative(toInput) : markdownTarget(portableRelative(toInput));
  if (!isDirectory && !isMarkdownPath(from)) throw new Error("Only Markdown files can be renamed");
  if (from === to) return { from, to, isDirectory };
  let toAbs: string;
  try {
    toAbs = resolveContained(root, to, { allowMissing: true, preserveFinalSymlink: true });
  } catch (error) {
    if (error instanceof Error && error.message === "Path not found")
      throw new Error("Folder not found");
    throw error;
  }
  if (fs.existsSync(toAbs) || fs.lstatSync(toAbs, { throwIfNoEntry: false }))
    throw new Error("Already exists");
  fs.renameSync(fromAbs, toAbs);
  return { from, to, isDirectory };
}

export function readImageDataUrl(root: string, fromRel: string, href: string): string | null {
  try {
    const from = portableRelative(fromRel);
    const rel = resolveRelativeLink(from, href);
    if (!rel) return null;
    const mime = imageMime(rel);
    if (!mime) return null;
    const abs = resolveContained(root, rel);
    const stat = fs.statSync(abs);
    if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES || stat.size === 0) return null;
    const bytes = fs.readFileSync(abs);
    return `data:${mime};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}
