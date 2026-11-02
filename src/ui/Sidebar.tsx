import { useMemo } from "react";
import { tagPaint } from "../core/colors";
import type { TreeNode } from "../shared/types";
import type { LibraryFilter } from "./docs";
import { FileTree, folderTree } from "./Tree";

function NavIcon({ d }: { d: string }) {
  return (
    <svg className="nav-icon" width="16" height="16" viewBox="0 0 20 20" aria-hidden="true">
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Sidebar({
  open,
  platform,
  filter,
  tree,
  expanded,
  selected,
  counts,
  allCount,
  recentCount,
  favoriteCount,
  tags,
  colors,
  dark,
  openShortcut,
  onHide,
  onAll,
  onRecent,
  onFavorites,
  onTag,
  onAddTag,
  onOpenFolder,
  onSelectFolder,
}: {
  open: boolean;
  platform: string;
  filter: LibraryFilter;
  tree: readonly TreeNode[];
  expanded: ReadonlySet<string>;
  selected: string | null;
  counts: ReadonlyMap<string, number>;
  allCount: number;
  recentCount: number;
  favoriteCount: number;
  tags: readonly { tag: string; count: number }[];
  colors: Record<string, string>;
  dark: boolean;
  openShortcut: string;
  onHide: () => void;
  onAll: () => void;
  onRecent: () => void;
  onFavorites: () => void;
  onTag: (tag: string) => void;
  onAddTag: () => void;
  onOpenFolder: () => void;
  onSelectFolder: (node: TreeNode) => void;
}) {
  const folders = useMemo(() => folderTree(tree), [tree]);
  if (!open) return null;
  return (
    <nav className="sidebar" data-testid="sidebar" aria-label="Sidebar">
      <div className="side-head drag-region">
        {platform === "darwin" ? (
          <span className="traffic-space" />
        ) : (
          <span className="side-brand">Library</span>
        )}
        <button type="button" className="icon-btn" aria-label="Hide sidebar" onClick={onHide}>
          <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
            <rect
              x="2.75"
              y="3.75"
              width="14.5"
              height="12.5"
              rx="3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path d="M8 4v12" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
      </div>
      <div className="side-scroll">
        <div className="side-group">
          <div className="side-label">Library</div>
          <button
            type="button"
            className={filter.type === "all" ? "nav-btn is-on" : "nav-btn"}
            data-testid="nav-all"
            onClick={onAll}
          >
            <NavIcon d="M6 2.75h5.5l3.75 3.75v10A1.25 1.25 0 0 1 14 17.75H6a1.25 1.25 0 0 1-1.25-1.25V4A1.25 1.25 0 0 1 6 2.75zM11.25 2.75v4h4" />
            <span>All Documents</span>
            <span className="count">{allCount}</span>
          </button>
          <button
            type="button"
            className={filter.type === "recent" ? "nav-btn is-on" : "nav-btn"}
            data-testid="nav-recent"
            onClick={onRecent}
          >
            <NavIcon d="M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM10 6.25V10l2.5 1.75" />
            <span>Recent</span>
            <span className="count">{recentCount}</span>
          </button>
          <button
            type="button"
            className={filter.type === "favorites" ? "nav-btn is-on" : "nav-btn"}
            data-testid="nav-favorites"
            onClick={onFavorites}
          >
            <NavIcon d="M10 3l2.1 4.3 4.7.7-3.4 3.3.8 4.7L10 13.8 5.8 16l.8-4.7L3.2 8l4.7-.7z" />
            <span>Favorites</span>
            <span className="count">{favoriteCount}</span>
          </button>
        </div>
        <div className="side-group">
          <div className="side-label">Folders</div>
          <div data-testid="tree">
            <FileTree
              nodes={folders}
              depth={0}
              expanded={expanded}
              selected={filter.type === "folder" ? selected : null}
              counts={counts}
              onSelect={onSelectFolder}
            />
          </div>
        </div>
        <div className="side-group">
          <div className="side-label-row">
            <span className="side-label">Tags</span>
            <button
              type="button"
              className="plus"
              data-testid="tag-add"
              aria-label="New tag"
              onClick={onAddTag}
            >
              +
            </button>
          </div>
          {tags.map((tag) => {
            const paint = tagPaint(tag.tag, colors[tag.tag.toLowerCase()], dark);
            const on = filter.type === "tag" && filter.tag.toLowerCase() === tag.tag.toLowerCase();
            return (
              <button
                key={tag.tag}
                type="button"
                className={on ? "tag-btn is-on" : "tag-btn"}
                data-testid="tag"
                data-tag={tag.tag}
                aria-pressed={on}
                onClick={() => onTag(tag.tag)}
              >
                <span className="dot" style={{ background: paint.dot }} />
                <span>{tag.tag}</span>
                <span className="count">{tag.count}</span>
              </button>
            );
          })}
        </div>
      </div>
      <button
        type="button"
        className="open-folder"
        data-testid="open-folder"
        onClick={onOpenFolder}
      >
        <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true">
          <path
            d="M2.75 6A1.75 1.75 0 0 1 4.5 4.25h3.25l1.75 2h6A1.75 1.75 0 0 1 17.25 8v6.5a1.75 1.75 0 0 1-1.75 1.75h-11a1.75 1.75 0 0 1-1.75-1.75zM10 9v4.5M7.75 11.25h4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span>Open Folder…</span>
        <span className="shortcut">{openShortcut}</span>
      </button>
    </nav>
  );
}
