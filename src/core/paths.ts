import fs from "node:fs";
import path from "node:path";
import { assertPortableSegments } from "./names";

export function isInsideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, path.resolve(candidate));
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

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export function resolveContained(
  root: string,
  relInput: string,
  options: { allowMissing?: boolean } = {},
): string {
  const rel = normalizeRelative(relInput);
  const segments = rel.split("/");
  let current = root;
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
        assertInside(root, next);
        return next;
      }
      throw new Error("Path not found");
    }
    if (listed.isSymbolicLink()) {
      const target = fs.realpathSync(next);
      assertInside(root, target);
      current = target;
      continue;
    }
    assertInside(root, next);
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
