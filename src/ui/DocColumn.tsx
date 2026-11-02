import { useEffect, useRef, useState, type RefObject } from "react";
import { SnippetCache } from "./snippetCache";
import { tagPaint } from "../core/colors";
import type { CatalogFile } from "../shared/types";
import type { DocSort } from "./docs";
import { shortWhen } from "./docs";

const ROW = 112;

export function DocColumn({
  title,
  countLabel,
  query,
  sort,
  rows,
  selected,
  colors,
  dark,
  searchRef,
  findHint,
  onQuery,
  onSort,
  onNew,
  onOpen,
  onFavorite,
  sidebarHidden,
  onShowSidebar,
}: {
  title: string;
  countLabel: string;
  query: string;
  sort: DocSort;
  rows: readonly CatalogFile[];
  selected: string | null;
  colors: Record<string, string>;
  dark: boolean;
  searchRef: RefObject<HTMLInputElement | null>;
  findHint: string;
  onQuery: (value: string) => void;
  onSort: () => void;
  onNew: () => void;
  onOpen: (path: string) => void;
  onFavorite: (path: string) => void;
  sidebarHidden: boolean;
  onShowSidebar: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const cache = useRef(new SnippetCache());
  const [tick, setTick] = useState(0);
  const [windowed, setWindowed] = useState({ start: 0, end: 20 });
  const sortLabel =
    sort === "title"
      ? "Sort by title"
      : sort === "title-desc"
        ? "Sort by title, descending"
        : sort === "edited-asc"
          ? "Sort by date modified, oldest first"
          : "Sort by date modified";

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => {
      const start = Math.max(0, Math.floor(el.scrollTop / ROW) - 6);
      const count = Math.ceil(el.clientHeight / ROW) + 14;
      setWindowed({ start, end: Math.min(rows.length, start + count) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    el.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", measure);
    };
  }, [rows.length]);

  useEffect(() => {
    const slice = rows.slice(windowed.start, windowed.end);
    const missing = slice.filter((row) => cache.current.get(row.path, row.mtimeMs) === undefined);
    if (missing.length === 0) return;
    let cancelled = false;
    void Promise.all(
      missing.map(async (row) => {
        try {
          const text = await window.md.snippet(row.path);
          if (!cancelled) cache.current.set(row.path, row.mtimeMs, text);
        } catch {
          if (!cancelled) cache.current.set(row.path, row.mtimeMs, "");
        }
      }),
    ).then(() => {
      if (!cancelled) setTick((value) => value + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [rows, windowed.start, windowed.end]);

  function move(key: string): void {
    if (rows.length === 0) return;
    const index = rows.findIndex((row) => row.path === selected);
    let next = index;
    if (key === "ArrowDown") next = Math.min(rows.length - 1, index < 0 ? 0 : index + 1);
    else if (key === "ArrowUp") next = Math.max(0, index < 0 ? 0 : index - 1);
    else if (key === "Home") next = 0;
    else next = rows.length - 1;
    const row = rows[next];
    if (!row) return;
    const el = scroller.current;
    if (el) {
      const top = next * ROW;
      if (top < el.scrollTop) el.scrollTop = top;
      else if (top + ROW > el.scrollTop + el.clientHeight)
        el.scrollTop = top + ROW - el.clientHeight;
    }
    onOpen(row.path);
  }

  const start = Math.min(windowed.start, rows.length);
  const end = Math.min(Math.max(windowed.end, start), rows.length);
  const visible = rows.slice(start, end);

  return (
    <section className="doc-col" aria-label="Documents">
      <div className="doc-head drag-region">
        {sidebarHidden ? (
          <button
            type="button"
            className="icon-btn"
            aria-label="Show sidebar"
            onClick={onShowSidebar}
          >
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
        ) : null}
        <div className="doc-heading">
          <h2>{title}</h2>
          <div data-testid="doc-count">{countLabel}</div>
        </div>
        <button type="button" className="icon-btn" aria-label={sortLabel} onClick={onSort}>
          <svg width="17" height="17" viewBox="0 0 20 20" aria-hidden="true">
            <path
              d="M6 4v12M3.5 13.5 6 16l2.5-2.5M14 16V4M11.5 6.5 14 4l2.5 2.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          className="icon-btn"
          data-testid="new-file"
          aria-label="New document"
          onClick={onNew}
        >
          <svg width="17" height="17" viewBox="0 0 20 20" aria-hidden="true">
            <path
              d="M10 4H5.5A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16h9a1.5 1.5 0 0 0 1.5-1.5V10M14.5 3.5l2 2L10 12l-2.75.75L8 10z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      <div className="doc-search-wrap">
        <label className="doc-search">
          <svg width="15" height="15" viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
            <path
              d="M13.25 13.25 17 17"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
          </svg>
          <input
            ref={searchRef}
            type="search"
            data-testid="search"
            aria-label="Search documents or #tags"
            placeholder="Search or #tag"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                move(event.key);
              }
            }}
          />
          <span className="kbd-hint" aria-hidden="true">
            {findHint}
          </span>
        </label>
      </div>
      <div
        className="doc-scroll"
        ref={scroller}
        role="listbox"
        aria-label={title}
        tabIndex={0}
        onKeyDown={(event) => {
          if (
            event.key === "ArrowDown" ||
            event.key === "ArrowUp" ||
            event.key === "Home" ||
            event.key === "End"
          ) {
            event.preventDefault();
            move(event.key);
          }
        }}
      >
        {rows.length === 0 ? (
          <div className="doc-empty">
            <strong>{query.trim() ? "No results" : "Nothing here yet"}</strong>
            <p>
              {query.trim()
                ? `Nothing matches “${query.trim()}”. Try a title or a #tag.`
                : "Documents in this view show up here."}
            </p>
          </div>
        ) : (
          <div style={{ paddingTop: start * ROW, paddingBottom: (rows.length - end) * ROW }}>
            {visible.map((row) => {
              const on = row.path === selected;
              const snippet = cache.current.get(row.path, row.mtimeMs) ?? "";
              return (
                <div
                  key={row.path}
                  className={on ? "doc-card is-on" : "doc-card"}
                  style={{ height: ROW }}
                  data-snippets={tick}
                >
                  <div className="doc-topline">
                    <button
                      type="button"
                      className="doc-open"
                      role="option"
                      data-testid="doc"
                      data-path={row.path}
                      aria-selected={on}
                      aria-current={on ? "true" : undefined}
                      onClick={() => onOpen(row.path)}
                    >
                      {row.name.replace(/\.markdown$/i, "").replace(/\.md$/i, "")}
                    </button>
                    <button
                      type="button"
                      className={row.favorite ? "star is-on" : "star"}
                      data-testid="doc-favorite"
                      aria-label={
                        row.favorite
                          ? `Remove ${row.name} from favorites`
                          : `Add ${row.name} to favorites`
                      }
                      aria-pressed={row.favorite}
                      onClick={() => onFavorite(row.path)}
                    >
                      ★
                    </button>
                    <span className="when">{shortWhen(row.mtimeMs)}</span>
                  </div>
                  <button type="button" className="doc-excerpt" onClick={() => onOpen(row.path)}>
                    {snippet || " "}
                  </button>
                  <div className="doc-chips">
                    {row.tags.slice(0, 3).map((tag) => {
                      const paint = tagPaint(tag, colors[tag.toLowerCase()], dark);
                      return (
                        <span
                          key={tag}
                          className="mini-chip"
                          style={{ background: paint.bg, color: paint.fg }}
                        >
                          <i style={{ background: paint.dot }} />
                          {tag}
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
