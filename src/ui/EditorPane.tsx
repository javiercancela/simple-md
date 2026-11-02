import { useEffect, useState } from "react";
import { tagPaint, type TagColorId } from "../core/colors";
import type { ViewMode } from "../shared/types";
import { Editor } from "./Editor";
import type { FormatKind } from "./format";
import { Preview } from "./Preview";
import { TagPicker } from "./TagPicker";

const FORMATS: { kind: FormatKind; label: string; glyph: string }[] = [
  { kind: "heading", label: "Heading", glyph: "H" },
  { kind: "bold", label: "Bold", glyph: "B" },
  { kind: "italic", label: "Italic", glyph: "I" },
  { kind: "link", label: "Link", glyph: "↗" },
  { kind: "list", label: "Bulleted list", glyph: "•" },
  { kind: "task", label: "Task list", glyph: "☑" },
  { kind: "code", label: "Code", glyph: "</>" },
];

export function EditorPane({
  sessionOpen,
  filePath,
  folderLabel,
  fileLabel,
  edited,
  tags,
  tagList,
  colors,
  dark,
  mode,
  focus,
  dirty,
  words,
  readTime,
  goal,
  goalPct,
  focusShortcut,
  html,
  hash,
  revision,
  documentId,
  buffer,
  error,
  diskNotice,
  pickerOpen,
  formatRef,
  onMode,
  onFocus,
  onExitFocus,
  onGoal,
  onChange,
  onSave,
  onNavigate,
  onRemoveTag,
  onToggleTag,
  onCreateTag,
  onPicker,
  onFavorite,
  favorite,
  onReveal,
  onCopyPath,
  onRename,
  onTrash,
  onNewFolder,
  onReload,
  onCloseRemoved,
  onDismissNotice,
  onOpenFolder,
}: {
  sessionOpen: boolean;
  filePath: string | null;
  folderLabel: string;
  fileLabel: string;
  edited: string;
  tags: readonly string[];
  tagList: readonly { tag: string; count: number }[];
  colors: Record<string, string>;
  dark: boolean;
  mode: ViewMode;
  focus: boolean;
  dirty: boolean;
  words: string;
  readTime: string;
  goal: number;
  goalPct: number;
  focusShortcut: string;
  html: string;
  hash: string;
  revision: number;
  documentId: number;
  buffer: string;
  error: string | null;
  diskNotice: { kind: "changed"; content: string } | { kind: "removed" } | null;
  pickerOpen: boolean;
  formatRef: { current: (kind: FormatKind) => void };
  onMode: (mode: ViewMode) => void;
  onFocus: () => void;
  onExitFocus: () => void;
  onGoal: (goal: number) => void;
  onChange: (value: string) => void;
  onSave: () => void;
  onNavigate: (href: string) => void;
  onRemoveTag: (tag: string) => void;
  onToggleTag: (tag: string) => void;
  onCreateTag: (tag: string, color: TagColorId) => void;
  onPicker: (open: boolean) => void;
  onFavorite: () => void;
  favorite: boolean;
  onReveal: () => void;
  onCopyPath: () => void;
  onRename: () => void;
  onTrash: () => void;
  onNewFolder: () => void;
  onReload: () => void;
  onCloseRemoved: () => void;
  onDismissNotice: () => void;
  onOpenFolder: () => void;
}) {
  const [more, setMore] = useState(false);
  useEffect(() => {
    if (!more) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-more-root]")) return;
      setMore(false);
    };
    window.addEventListener("pointerdown", onPointer);
    return () => window.removeEventListener("pointerdown", onPointer);
  }, [more]);
  const previewing = mode === "preview";
  const showEditor = focus || mode !== "preview";
  const showPreview = !focus && mode !== "editor";

  return (
    <section className="editor-pane" aria-label="Editor">
      {focus ? (
        <header className="focus-bar drag-region">
          <div className="focus-path">
            <span>{folderLabel}</span>
            <span aria-hidden="true">›</span>
            <strong>{fileLabel}</strong>
          </div>
          <button type="button" data-testid="exit-focus" onClick={onExitFocus}>
            Exit Focus <kbd>{focusShortcut}</kbd>
          </button>
        </header>
      ) : (
        <header className="editor-toolbar drag-region">
          <div
            className="fmt"
            role="group"
            aria-label="Formatting"
            style={{ opacity: previewing ? 0.45 : 1 }}
          >
            {FORMATS.map((item, index) => (
              <span key={item.kind} className="fmt-slot">
                {index === 3 ? <span className="fmt-rule" aria-hidden="true" /> : null}
                <button
                  type="button"
                  aria-label={item.label}
                  disabled={!filePath || previewing}
                  className={item.kind === "italic" ? "fmt-i" : item.kind === "bold" ? "fmt-b" : ""}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => formatRef.current(item.kind)}
                >
                  {item.glyph}
                </button>
              </span>
            ))}
          </div>
          <div className="toolbar-spacer" />
          <div className="seg" role="group" aria-label="Editor mode">
            <button
              type="button"
              data-testid="mode-editor"
              aria-pressed={mode === "editor" || mode === "split"}
              onClick={() => onMode("editor")}
            >
              Write
            </button>
            <button
              type="button"
              data-testid="mode-preview"
              aria-pressed={mode === "preview" || mode === "split"}
              onClick={() => onMode("preview")}
            >
              Preview
            </button>
          </div>
          <button
            type="button"
            className="icon-btn"
            data-testid="focus"
            aria-label="Focus mode"
            disabled={!filePath}
            onClick={onFocus}
          >
            <svg width="17" height="17" viewBox="0 0 20 20" aria-hidden="true">
              <path
                d="M3.5 7.5v-4h4M16.5 7.5v-4h-4M3.5 12.5v4h4M16.5 12.5v4h-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <div className="popover-anchor" data-more-root>
            <button
              type="button"
              className="icon-btn"
              data-testid="more"
              aria-label="More"
              aria-expanded={more}
              disabled={!sessionOpen}
              onClick={() => setMore((open) => !open)}
            >
              ···
            </button>
            {more ? (
              <div className="more-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  data-testid="mode-split"
                  onClick={() => {
                    onMode("split");
                    setMore(false);
                  }}
                >
                  Split view
                </button>
                <button
                  type="button"
                  role="menuitem"
                  data-testid="save"
                  disabled={!dirty}
                  onClick={() => {
                    onSave();
                    setMore(false);
                  }}
                >
                  Save
                </button>
                <button
                  type="button"
                  role="menuitem"
                  data-testid="favorite"
                  disabled={!filePath}
                  aria-pressed={favorite}
                  onClick={() => {
                    onFavorite();
                    setMore(false);
                  }}
                >
                  {favorite ? "Remove from Favorites" : "Add to Favorites"}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  data-testid="reveal"
                  disabled={!filePath}
                  onClick={() => {
                    onReveal();
                    setMore(false);
                  }}
                >
                  Reveal in folder
                </button>
                <button
                  type="button"
                  role="menuitem"
                  data-testid="copy-path"
                  disabled={!filePath}
                  onClick={() => {
                    onCopyPath();
                    setMore(false);
                  }}
                >
                  Copy path
                </button>
                <button
                  type="button"
                  role="menuitem"
                  data-testid="rename"
                  disabled={!sessionOpen}
                  onClick={() => {
                    setMore(false);
                    onRename();
                  }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  role="menuitem"
                  data-testid="new-folder"
                  disabled={!sessionOpen}
                  onClick={() => {
                    setMore(false);
                    onNewFolder();
                  }}
                >
                  New folder
                </button>
                <button
                  type="button"
                  role="menuitem"
                  data-testid="delete"
                  disabled={!sessionOpen}
                  onClick={() => {
                    setMore(false);
                    onTrash();
                  }}
                >
                  Move to trash
                </button>
              </div>
            ) : null}
          </div>
        </header>
      )}

      {filePath && !focus ? (
        <div className="meta">
          <div className="crumbs">
            <span>{folderLabel}</span>
            <span aria-hidden="true">›</span>
            <strong>{fileLabel}</strong>
            <span className="edited">{edited}</span>
          </div>
          <div className="chips">
            {tags.map((tag) => {
              const paint = tagPaint(tag, colors[tag.toLowerCase()], dark);
              return (
                <span
                  key={tag}
                  className="chip"
                  data-testid="tag-chip"
                  style={{ background: paint.bg, color: paint.fg }}
                >
                  <i style={{ background: paint.dot }} />
                  {tag}
                  <button
                    type="button"
                    aria-label={`Remove tag ${tag}`}
                    onClick={() => onRemoveTag(tag)}
                  >
                    ×
                  </button>
                </span>
              );
            })}
            <span className="popover-anchor" data-picker-root>
              <button
                type="button"
                className="add-tag"
                data-testid="add-tag"
                aria-expanded={pickerOpen}
                aria-haspopup="dialog"
                onClick={() => onPicker(!pickerOpen)}
              >
                + Add tag
              </button>
              {pickerOpen ? (
                <TagPicker
                  assigned={tags}
                  tags={tagList}
                  colors={colors}
                  dark={dark}
                  onToggle={onToggleTag}
                  onCreate={onCreateTag}
                  onClose={() => onPicker(false)}
                />
              ) : null}
            </span>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="banner" data-testid="error" role="alert">
          {error}
        </div>
      ) : null}
      {diskNotice ? (
        <div className="banner notice" data-testid="disk-notice">
          <span>
            {diskNotice.kind === "changed"
              ? "This file changed on disk."
              : "This file was removed on disk."}
          </span>
          {diskNotice.kind === "changed" ? (
            <button type="button" data-testid="reload-disk" onClick={onReload}>
              Reload
            </button>
          ) : (
            <button type="button" data-testid="close-removed" onClick={onCloseRemoved}>
              Close
            </button>
          )}
          <button type="button" onClick={onDismissNotice}>
            Keep editing
          </button>
        </div>
      ) : null}

      <div className={`stage panes-${mode}`}>
        {filePath ? (
          <Editor
            documentId={documentId}
            hidden={!showEditor}
            text={buffer}
            revision={revision}
            focus={focus}
            onChange={onChange}
            onSave={onSave}
            formatRef={formatRef}
          />
        ) : null}
        {filePath && showPreview ? (
          <Preview html={html} fromRel={filePath} hash={hash} onNavigate={onNavigate} />
        ) : null}
        {!filePath ? (
          <div className="empty" data-testid="empty">
            <h1>Simple MD</h1>
            <p>{sessionOpen ? "Select a document." : "Open a folder of Markdown files."}</p>
            {sessionOpen ? null : (
              <button type="button" onClick={onOpenFolder}>
                Open folder
              </button>
            )}
          </div>
        ) : null}
      </div>

      {filePath && !focus ? (
        <footer className="status">
          <span>
            {words} {words === "1" ? "word" : "words"}
          </span>
          <span>{readTime}</span>
          <span className="status-mode">{previewing ? "Preview — read only" : "Markdown"}</span>
          {dirty ? (
            <span className="unsaved" data-testid="dirty">
              Unsaved
            </span>
          ) : (
            <span className="saved">Saved</span>
          )}
        </footer>
      ) : null}

      {filePath && focus ? (
        <div className="goal-pill">
          <span>
            {words} {words === "1" ? "word" : "words"}
          </span>
          <span className="dot-sep" aria-hidden="true">
            ·
          </span>
          <span>{readTime}</span>
          <span className="dot-sep" aria-hidden="true">
            ·
          </span>
          <label>
            Goal
            <input
              data-testid="word-goal"
              aria-label="Word goal"
              type="number"
              min={50}
              max={20000}
              value={goal}
              onChange={(event) => onGoal(Number(event.target.value))}
            />
          </label>
          <span
            className="goal-bar"
            role="progressbar"
            aria-label="Progress toward word goal"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={goalPct}
          >
            <span style={{ width: `${goalPct}%` }} />
          </span>
        </div>
      ) : null}
    </section>
  );
}
