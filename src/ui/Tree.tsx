import type { CSSProperties } from "react";
import type { TreeNode } from "../shared/types";

export function collectPaths(nodes: readonly TreeNode[], into = new Set<string>()): Set<string> {
  for (const node of nodes) {
    into.add(node.path);
    if (node.children) collectPaths(node.children, into);
  }
  return into;
}

export function folderTree(nodes: readonly TreeNode[]): TreeNode[] {
  const out: TreeNode[] = [];
  for (const node of nodes) {
    if (node.kind !== "folder") continue;
    out.push({ ...node, children: folderTree(node.children ?? []) });
  }
  return out;
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
  counts,
  onSelect,
}: {
  nodes: readonly TreeNode[];
  depth: number;
  expanded: ReadonlySet<string>;
  selected: string | null;
  counts: ReadonlyMap<string, number>;
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
              className={selected === node.path ? "tree-item is-on" : "tree-item"}
              data-testid={folder ? "tree-folder" : "tree-file"}
              data-path={node.path}
              aria-current={selected === node.path ? "true" : undefined}
              aria-expanded={folder ? open : undefined}
              style={{ paddingLeft: 8 + depth * 14 } as CSSProperties}
              onClick={() => onSelect(node)}
            >
              <span className="twisty" aria-hidden="true">
                {folder ? (open ? "▾" : "▸") : ""}
              </span>
              <svg
                className="folder-icon"
                width="16"
                height="16"
                viewBox="0 0 20 20"
                aria-hidden="true"
              >
                <path
                  d="M2.75 6A1.75 1.75 0 0 1 4.5 4.25h3.25l1.75 2h6A1.75 1.75 0 0 1 17.25 8v6.5a1.75 1.75 0 0 1-1.75 1.75h-11a1.75 1.75 0 0 1-1.75-1.75z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="tree-name">{node.name}</span>
              <span className="count">{counts.get(node.path) ?? 0}</span>
            </button>
            {folder && open && node.children ? (
              <FileTree
                nodes={node.children}
                depth={depth + 1}
                expanded={expanded}
                selected={selected}
                counts={counts}
                onSelect={onSelect}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
