import fs from "node:fs";
import { isMarkdownPath } from "./names";
import { isInsideRoot, resolveContained } from "./paths";
import type { FileIdentity } from "./tags";
import type { TreeNode } from "../shared/types";

const SKIP = new Set([".git", "node_modules"]);

function compareNodes(a: TreeNode, b: TreeNode): number {
  if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
}

function fileIdentity(rel: string, abs: string): FileIdentity {
  const stat = fs.statSync(abs, { bigint: true });
  return {
    path: rel,
    ino: stat.ino.toString(),
    dev: stat.dev.toString(),
    size: Number(stat.size),
    mtimeMs: Number(stat.mtimeMs),
  };
}

export function scanRoot(root: string): { tree: TreeNode[]; files: FileIdentity[] } {
  const files: FileIdentity[] = [];
  const seen = new Set<string>();

  const walk = (logicalRel: string): TreeNode[] => {
    const abs = logicalRel === "" ? root : resolveContained(root, logicalRel);
    const real = fs.realpathSync(abs);
    if (!isInsideRoot(root, real) || seen.has(real)) return [];
    seen.add(real);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(real, { withFileTypes: true });
    } catch {
      return [];
    }
    const nodes: TreeNode[] = [];
    for (const entry of entries) {
      if (SKIP.has(entry.name)) continue;
      const childRel = logicalRel ? `${logicalRel}/${entry.name}` : entry.name;
      let childAbs: string;
      try {
        childAbs = resolveContained(root, childRel);
      } catch {
        continue;
      }
      let stat: fs.Stats;
      try {
        stat = fs.statSync(childAbs);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        const children = walk(childRel);
        let empty = false;
        try {
          empty = fs.readdirSync(childAbs).length === 0;
        } catch {
          empty = false;
        }
        if (children.length > 0 || empty) {
          nodes.push({ name: entry.name, path: childRel, kind: "folder", children });
        }
      } else if (stat.isFile() && isMarkdownPath(entry.name)) {
        nodes.push({ name: entry.name, path: childRel, kind: "file" });
        files.push(fileIdentity(childRel, childAbs));
      }
    }
    nodes.sort(compareNodes);
    return nodes;
  };

  return { tree: walk(""), files };
}
