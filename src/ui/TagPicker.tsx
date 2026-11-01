import { useEffect, useMemo, useState } from "react";
import { defaultColorId, swatchDots, tagPaint, type TagColorId } from "../core/colors";

export function TagPicker({
  assigned,
  tags,
  colors,
  dark,
  onToggle,
  onCreate,
  onClose,
}: {
  assigned: readonly string[];
  tags: readonly { tag: string; count: number }[];
  colors: Record<string, string>;
  dark: boolean;
  onToggle: (tag: string) => void;
  onCreate: (tag: string, color: TagColorId) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [picked, setPicked] = useState<TagColorId | null>(null);
  const needle = query.trim().toLowerCase().replace(/^#/, "");
  const rows = useMemo(
    () => tags.filter((item) => !needle || item.tag.toLowerCase().includes(needle)),
    [tags, needle],
  );
  const exact = tags.some((item) => item.tag.toLowerCase() === needle);
  const showCreate = needle.length > 0 && !exact;
  const total = rows.length + (showCreate ? 1 : 0);
  const current = Math.min(active, Math.max(0, total - 1));
  const color = picked ?? defaultColorId(needle || "tag");
  const dots = swatchDots(dark);

  useEffect(() => {
    setActive(0);
    setPicked(null);
  }, [query]);

  function applyActive(): void {
    if (showCreate && current === rows.length) onCreate(query.trim().replace(/^#/, ""), color);
    else if (rows[current]) onToggle(rows[current].tag);
  }

  return (
    <div
      className="picker"
      role="dialog"
      aria-label="Find or create a tag"
      data-testid="tag-picker"
    >
      <label className="picker-search">
        <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true">
          <path
            d="M3 4.5v4.8a1.5 1.5 0 0 0 .44 1.06l6.2 6.2a1.5 1.5 0 0 0 2.12 0l4.8-4.8a1.5 1.5 0 0 0 0-2.12l-6.2-6.2A1.5 1.5 0 0 0 9.3 3H4.5A1.5 1.5 0 0 0 3 4.5z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
          />
          <circle cx="7" cy="7" r="1.1" fill="currentColor" />
        </svg>
        <input
          autoFocus
          data-testid="tag-input"
          aria-label="Find or create a tag"
          placeholder="Find or create a tag"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive(Math.min(current + 1, Math.max(0, total - 1)));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive(Math.max(current - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              applyActive();
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              if (query) setQuery("");
              else onClose();
            }
          }}
        />
      </label>
      <div className="picker-list">
        {rows.length > 0 ? (
          <div className="picker-label">{needle ? "Matching tags" : "All tags"}</div>
        ) : null}
        {rows.map((row, index) => {
          const on = assigned.some((item) => item.toLowerCase() === row.tag.toLowerCase());
          const paint = tagPaint(row.tag, colors[row.tag.toLowerCase()], dark);
          return (
            <button
              key={row.tag}
              type="button"
              className={index === current ? "picker-row is-active" : "picker-row"}
              aria-pressed={on}
              aria-label={`${on ? "Remove tag" : "Add tag"} ${row.tag}`}
              onMouseEnter={() => setActive(index)}
              onClick={() => onToggle(row.tag)}
            >
              <span className="dot" style={{ background: paint.dot }} />
              <span className="picker-name">{row.tag}</span>
              <span className="count">{row.count}</span>
              <span className="check" aria-hidden="true">
                {on ? "✓" : ""}
              </span>
            </button>
          );
        })}
        {showCreate ? (
          <div className="picker-create">
            <button
              type="button"
              className={current === rows.length ? "picker-row is-active" : "picker-row"}
              onMouseEnter={() => setActive(rows.length)}
              onClick={() => onCreate(query.trim().replace(/^#/, ""), color)}
            >
              <span className="dot" style={{ background: tagPaint(needle, color, dark).dot }} />
              <span className="picker-name">
                Create tag <strong>{query.trim().replace(/^#/, "")}</strong>
              </span>
              <span className="hint">↩</span>
            </button>
            <div className="swatches" role="group" aria-label="Color for the new tag">
              <span>Color</span>
              {dots.map((swatch) => (
                <button
                  key={swatch.id}
                  type="button"
                  className="swatch"
                  aria-label={`Color ${swatch.id}`}
                  aria-pressed={color === swatch.id}
                  style={{
                    background: swatch.dot,
                    boxShadow:
                      color === swatch.id
                        ? `0 0 0 2px var(--popover), 0 0 0 3.5px ${swatch.dot}`
                        : undefined,
                  }}
                  onClick={() => setPicked(swatch.id)}
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <div className="picker-foot">
        <p>Stored in the app, your file is not modified</p>
        <div className="keys">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> Move
          </span>
          <span>
            <kbd>↩</kbd> Apply
          </span>
          <span>
            <kbd>esc</kbd> Clear
          </span>
        </div>
      </div>
    </div>
  );
}
