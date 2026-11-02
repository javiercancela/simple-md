import fs from "node:fs";
import path from "node:path";
import { assertPortableSegments } from "./names";

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function canonicalExisting(candidate: string): string {
  const resolved = path.resolve(candidate);
  try {
    return fs.realpathSync(resolved);
  } catch (error) {
    if (!isEnoent(error)) throw error;
  }
  const parent = path.dirname(resolved);
  try {
    return path.join(fs.realpathSync(parent), path.basename(resolved));
  } catch (error) {
    if (!isEnoent(error)) throw error;
    return resolved;
  }
}

export function isInsideRoot(root: string, candidate: string): boolean {
  const rootReal = fs.realpathSync(path.resolve(root));
  const candidateReal = canonicalExisting(candidate);
  const relative = path.relative(rootReal, candidateReal);
  if (relative === "") return true;
  if (path.isAbsolute(relative)) return false;
  return relative !== ".." && !relative.startsWith(`..${path.sep}`);
}

function assertInside(root: string, candidate: string): void {
  if (!isInsideRoot(root, candidate)) throw new Error("Path escapes the opened folder");
}

export function normalizeRelative(input: string): string {
  if (typeof input !== "string" || input.length === 0 || input.length > 4096) {
    throw new Error("Invalid path");
  }
  if (input.includes("\0")) throw new Error("Invalid path");
  if (path.win32.isAbsolute(input) || path.posix.isAbsolute(input)) {
    throw new Error("Invalid path");
  }
  const slash = input.replaceAll("\\", "/");
  if (slash.split("/").includes("..")) throw new Error("Invalid path");
  const normalized = path.posix.normalize(slash);
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/") ||
    path.posix.isAbsolute(normalized)
  ) {
    throw new Error("Invalid path");
  }
  return normalized;
}

export function portableRelative(input: string): string {
  const rel = normalizeRelative(input);
  assertPortableSegments(rel);
  return rel;
}

export function resolveContained(
  root: string,
  relInput: string,
  options: { allowMissing?: boolean; preserveFinalSymlink?: boolean } = {},
): string {
  const rootReal = realRoot(root);
  const rel = normalizeRelative(relInput);
  const segments = rel.split("/");
  let current = rootReal;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (!segment || segment === "." || segment === "..") throw new Error("Invalid path");
    const next = path.join(current, segment);
    const last = index === segments.length - 1;
    let listed: fs.Stats;
    try {
      listed = fs.lstatSync(next);
    } catch (error) {
      if (isEnoent(error) && last && options.allowMissing) {
        assertInside(rootReal, next);
        return next;
      }
      if (!isEnoent(error)) throw error;
      throw new Error("Path not found", { cause: error });
    }
    if (listed.isSymbolicLink()) {
      const target = fs.realpathSync(next);
      assertInside(rootReal, target);
      current = last && options.preserveFinalSymlink ? next : target;
      continue;
    }
    assertInside(rootReal, next);
    current = next;
  }
  return current;
}

export function realRoot(input: string): string {
  const resolved = path.resolve(input);
  const real = fs.realpathSync(resolved);
  if (!fs.statSync(real).isDirectory()) throw new Error("Not a folder");
  return real;
}
