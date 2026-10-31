import type { CSSProperties } from "react";
import type { TreeNode } from "../shared/types";

export function collectPaths(nodes: readonly TreeNode[], into = new Set<string>()): Set<string> {
  for (const node of nodes) {
    into.add(node.path);
    if (node.children) collectPaths(node.children, into);
  }
  return into;
}

export function folderPaths(nodes: readonly TreeNode[], into = new Set<string>()): Set<string> {
  for (const node of nodes) {
    if (node.kind !== "folder") continue;
    into.add(node.path);
    if (node.children) folderPaths(node.children, into);
  }
  return into;
}

export function filterTree(nodes: readonly TreeNode[], query: string): TreeNode[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...nodes];
  const out: TreeNode[] = [];
  for (const node of nodes) {
    if (node.kind === "folder") {
      const children = filterTree(node.children ?? [], needle);
      if (children.length > 0) out.push({ ...node, children });
    } else if (node.name.toLowerCase().includes(needle)) {
      out.push(node);
    }
  }
  return out;
}

export function FileTree({
  nodes,
  depth,
  expanded,
  selected,
  onSelect,
}: {
  nodes: readonly TreeNode[];
  depth: number;
  expanded: ReadonlySet<string>;
  selected: string | null;
  onSelect: (node: TreeNode) => void;
}) {
  return (
    <ul className="tree">
      {nodes.map((node) => {
        const folder = node.kind === "folder";
        const open = folder && expanded.has(node.path);
        return (
          <li key={node.path}>
            <button
              type="button"
              className="tree-item"
              data-testid={folder ? "tree-folder" : "tree-file"}
              data-path={node.path}
              aria-current={selected === node.path ? "true" : undefined}
              style={{ paddingLeft: 8 + depth * 14 } as CSSProperties}
              onClick={() => onSelect(node)}
            >
              <span className="twisty" aria-hidden="true">
                {folder ? (open ? "▾" : "▸") : ""}
              </span>
              <span className="tree-name">{node.name}</span>
            </button>
            {folder && open && node.children ? (
              <FileTree
                nodes={node.children}
                depth={depth + 1}
                expanded={expanded}
                selected={selected}
                onSelect={onSelect}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
