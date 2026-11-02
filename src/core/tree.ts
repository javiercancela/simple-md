import fs from "node:fs";
import path from "node:path";
import { isMarkdownPath } from "./names";
import { realRoot } from "./paths";
import type { FileIdentity } from "./tags";
import type { TreeNode } from "../shared/types";

const SKIP = new Set([".git", "node_modules"]);
const MAX_DEPTH = 40;
const YIELD_EVERY = 200;

function compareNodes(a: TreeNode, b: TreeNode): number {
  if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
}

function contained(rootReal: string, candidateReal: string): boolean {
  const relative = path.relative(rootReal, candidateReal);
  if (relative === "") return true;
  if (path.isAbsolute(relative)) return false;
  return relative !== ".." && !relative.startsWith(`..${path.sep}`);
}

function identityOf(rel: string, stat: fs.BigIntStats): FileIdentity {
  return {
    path: rel,
    ino: stat.ino.toString(),
    dev: stat.dev.toString(),
    size: Number(stat.size),
    mtimeMs: Number(stat.mtimeMs),
  };
}

async function breathe(progress: { n: number }): Promise<void> {
  progress.n += 1;
  if (progress.n % YIELD_EVERY === 0) {
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
  }
}

type Walk = { nodes: TreeNode[]; vacant: boolean };

export async function scanRoot(
  rootInput: string,
): Promise<{ tree: TreeNode[]; files: FileIdentity[]; complete: boolean; failedPaths: string[] }> {
  const root = realRoot(rootInput);
  const files: FileIdentity[] = [];
  const failedPaths: string[] = [];
  const seen = new Set<string>();
  const progress = { n: 0 };

  const walk = async (logicalRel: string, dirReal: string, depth: number): Promise<Walk> => {
    if (depth > MAX_DEPTH) failedPaths.push(logicalRel);
    if (depth > MAX_DEPTH || seen.has(dirReal) || !contained(root, dirReal)) {
      return { nodes: [], vacant: false };
    }
    seen.add(dirReal);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirReal, { withFileTypes: true });
    } catch {
      failedPaths.push(logicalRel);
      return { nodes: [], vacant: false };
    }
    if (entries.length === 0) return { nodes: [], vacant: true };
    const nodes: TreeNode[] = [];
    for (const entry of entries) {
      await breathe(progress);
      if (SKIP.has(entry.name)) continue;
      const childRel = logicalRel ? `${logicalRel}/${entry.name}` : entry.name;
      const childPath = path.join(dirReal, entry.name);
      if (entry.isSymbolicLink()) {
        let target: string;
        try {
          target = fs.realpathSync(childPath);
        } catch {
          failedPaths.push(childRel);
          continue;
        }
        if (!contained(root, target)) continue;
        let stat: fs.BigIntStats;
        try {
          stat = fs.statSync(target, { bigint: true });
        } catch {
          failedPaths.push(childRel);
          continue;
        }
        if (stat.isDirectory()) {
          if (seen.has(target)) continue;
          const child = await walk(childRel, target, depth + 1);
          if (child.nodes.length > 0 || child.vacant) {
            nodes.push({ name: entry.name, path: childRel, kind: "folder", children: child.nodes });
          }
        } else if (stat.isFile() && isMarkdownPath(entry.name)) {
          nodes.push({ name: entry.name, path: childRel, kind: "file" });
          files.push(identityOf(childRel, stat));
        }
        continue;
      }
      if (entry.isDirectory()) {
        const child = await walk(childRel, childPath, depth + 1);
        if (child.nodes.length > 0 || child.vacant) {
          nodes.push({ name: entry.name, path: childRel, kind: "folder", children: child.nodes });
        }
        continue;
      }
      if (entry.isFile() && isMarkdownPath(entry.name)) {
        try {
          const stat = fs.statSync(childPath, { bigint: true });
          nodes.push({ name: entry.name, path: childRel, kind: "file" });
          files.push(identityOf(childRel, stat));
        } catch {
          failedPaths.push(childRel);
          continue;
        }
      }
    }
    nodes.sort(compareNodes);
    return { nodes, vacant: false };
  };

  const walked = await walk("", root, 0);
  return { tree: walked.nodes, files, complete: failedPaths.length === 0, failedPaths };
}
