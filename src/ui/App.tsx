import { useEffect, useMemo, useRef, useState } from "react";
import { decideExternalChange } from "../core/external";
import { classifyHref } from "../core/links";
import { renderMarkdown } from "../core/markdown";
import type { ExternalFileEvent, SessionInfo, TagCount, TreeNode, ViewMode } from "../shared/types";
import { Editor } from "./Editor";
import { Preview } from "./Preview";
import { FileTree, collectPaths, filterTree, folderPaths } from "./Tree";

type DialogState =
  | { kind: "discard" }
  | { kind: "prompt"; title: string; label: string; value: string; confirm: string }
  | { kind: "confirm"; title: string; body: string; confirm: string };

type DiskNotice = { kind: "changed"; content: string } | { kind: "removed" };

function basename(root: string): string {
  const parts = root.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? root;
}

function ancestorPaths(rel: string): string[] {
  const parts = rel.split("/");
  const paths: string[] = [];
  for (let index = 0; index < parts.length - 1; index += 1) {
    paths.push(parts.slice(0, index + 1).join("/"));
  }
  return paths;
}

function parentPath(rel: string): string {
  const index = rel.lastIndexOf("/");
  return index === -1 ? "" : rel.slice(0, index);
}

function remap(filePath: string, from: string, to: string): string {
  if (filePath === from) return to;
  if (filePath.startsWith(`${from}/`)) return `${to}/${filePath.slice(from.length + 1)}`;
  return filePath;
}

function defaultExpanded(tree: readonly TreeNode[]): Set<string> {
  const expanded = new Set<string>();
  for (const node of tree) {
    if (node.kind === "folder") expanded.add(node.path);
  }
  return expanded;
}

function unusedPath(paths: ReadonlySet<string>, stem: string, suffix: string): string {
  const first = `${stem}${suffix}`;
  if (!paths.has(first)) return first;
  for (let index = 2; index < 100; index += 1) {
    const candidate = `${stem}-${index}${suffix}`;
    if (!paths.has(candidate)) return candidate;
  }
  return first;
}

function errorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : "Something went wrong";
  const marker = "Error: ";
  const index = raw.lastIndexOf(marker);
  return index >= 0 ? raw.slice(index + marker.length) : raw;
}

export function App() {
  const [session, setSession] = useState<{
    root: string;
    rootName: string;
    tree: TreeNode[];
  } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedKind, setSelectedKind] = useState<"file" | "folder" | null>(null);
  const [query, setQuery] = useState("");
  const [sidebar, setSidebar] = useState<"files" | "tags">("files");
  const [tags, setTags] = useState<TagCount[]>([]);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [tagFiles, setTagFiles] = useState<string[]>([]);
  const [mode, setMode] = useState<ViewMode>("split");
  const [filePath, setFilePath] = useState<string | null>(null);
  const [buffer, setBuffer] = useState("");
  const [saved, setSaved] = useState("");
  const [fileTags, setFileTags] = useState<string[]>([]);
  const [revision, setRevision] = useState(0);
  const [pendingHash, setPendingHash] = useState("");
  const [previewSource, setPreviewSource] = useState("");
  const [diskNotice, setDiskNotice] = useState<DiskNotice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [draft, setDraft] = useState("");
  const [tagDraft, setTagDraft] = useState("");

  const rootRef = useRef<string | null>(null);
  const filePathRef = useRef<string | null>(null);
  const bufferRef = useRef("");
  const savedRef = useRef("");
  const fileTagsRef = useRef<string[]>([]);
  const activeTagRef = useRef<string | null>(null);
  const dialogRef = useRef<DialogState | null>(null);
  const resolver = useRef<(value: unknown) => void>(() => {});
  const closingRef = useRef(false);
  const actions = useRef({
    save: async (): Promise<boolean> => true,
    openFolder: async () => {},
    newFile: async () => {},
    newFolder: async () => {},
    requestClose: async () => {},
    external: (_event: ExternalFileEvent) => {},
    library: (_session: SessionInfo) => {},
  });

  const dirty = filePath !== null && buffer !== saved;
  const html = useMemo(
    () => (filePath ? renderMarkdown(previewSource) : ""),
    [filePath, previewSource],
  );
  const visibleTree = useMemo(() => filterTree(session?.tree ?? [], query), [session, query]);
  const shownExpanded = query.trim() ? folderPaths(visibleTree) : expanded;
  const visibleTagFiles = tagFiles.filter((file) => {
    const name = file.split("/").pop() ?? file;
    const needle = query.trim().toLowerCase();
    return !needle || name.toLowerCase().includes(needle);
  });

  function commitFile(rel: string | null, content: string, nextTags: string[], hash = ""): void {
    filePathRef.current = rel;
    bufferRef.current = content;
    savedRef.current = content;
    fileTagsRef.current = nextTags;
    setFilePath(rel);
    setBuffer(content);
    setSaved(content);
    setFileTags(nextTags);
    setPreviewSource(content);
    setRevision((value) => value + 1);
    setPendingHash(hash);
    setDiskNotice(null);
  }

  function adoptTree(tree: TreeNode[]): void {
    setSession((current) => (current ? { ...current, tree } : current));
  }

  async function refreshTags(): Promise<void> {
    try {
      const list = await window.md.listTags();
      setTags(list);
      const current = activeTagRef.current;
      if (!current) return;
      if (!list.some((item) => item.tag.toLowerCase() === current.toLowerCase())) {
        activeTagRef.current = null;
        setActiveTag(null);
        setTagFiles([]);
        return;
      }
      setTagFiles(await window.md.filesForTag(current));
    } catch (reason) {
      setError(errorText(reason));
    }
  }

  function applySession(next: SessionInfo): void {
    const changed = rootRef.current !== next.root;
    rootRef.current = next.root;
    setSession({ root: next.root, rootName: basename(next.root), tree: next.tree });
    if (changed) {
      setExpanded(defaultExpanded(next.tree));
      commitFile(null, "", []);
      void window.md.unwatch();
      setQuery("");
      setSidebar("files");
      activeTagRef.current = null;
      setActiveTag(null);
      setTagFiles([]);
      setSelected(null);
      setSelectedKind(null);
      setError(null);
    }
    void refreshTags();
  }

  async function save(): Promise<boolean> {
    const rel = filePathRef.current;
    if (!rel) return true;
    try {
      await window.md.writeFile(rel, bufferRef.current);
      savedRef.current = bufferRef.current;
      setSaved(bufferRef.current);
      setError(null);
      return true;
    } catch (reason) {
      setError(errorText(reason));
      return false;
    }
  }

  function openDialog(next: DialogState, initial = ""): Promise<unknown> {
    if (dialogRef.current) return Promise.resolve(null);
    setDraft(initial);
    return new Promise((resolve) => {
      resolver.current = resolve;
      dialogRef.current = next;
      setDialog(next);
    });
  }

  function closeDialog(value: unknown): void {
    const resolve = resolver.current;
    dialogRef.current = null;
    setDialog(null);
    resolve(value);
  }

  async function ensureCanLeave(): Promise<boolean> {
    if (bufferRef.current === savedRef.current) return true;
    const choice = await openDialog({ kind: "discard" });
    if (choice !== "save" && choice !== "discard") return false;
    if (choice === "save") return save();
    savedRef.current = bufferRef.current;
    setSaved(bufferRef.current);
    return true;
  }

  async function loadFile(rel: string, hash = ""): Promise<void> {
    const file = await window.md.readFile(rel);
    commitFile(rel, file.content, file.tags, hash);
    setSelected(rel);
    setSelectedKind("file");
    setExpanded((current) => {
      const next = new Set(current);
      for (const ancestor of ancestorPaths(rel)) next.add(ancestor);
      return next;
    });
    setError(null);
  }

  async function openPath(rel: string, hash = ""): Promise<void> {
    if (rel === filePathRef.current) {
      setPendingHash(hash);
      return;
    }
    if (!(await ensureCanLeave())) return;
    await loadFile(rel, hash);
  }

  async function openFolder(): Promise<void> {
    if (!(await ensureCanLeave())) return;
    try {
      const next = await window.md.openFolder();
      if (next) applySession(next);
    } catch (reason) {
      setError(errorText(reason));
    }
  }

  function selectedDirectory(): string {
    if (!selected) return "";
    return selectedKind === "folder" ? selected : parentPath(selected);
  }

  async function newFile(): Promise<void> {
    if (!session) return;
    if (!(await ensureCanLeave())) return;
    const dir = selectedDirectory();
    const stem = dir ? `${dir}/untitled` : "untitled";
    const initial = unusedPath(collectPaths(session.tree), stem, ".md");
    const value = await openDialog(
      { kind: "prompt", title: "New file", label: "Path", value: initial, confirm: "Create" },
      initial,
    );
    if (typeof value !== "string" || !value.trim()) return;
    try {
      const created = await window.md.createFile(value.trim());
      adoptTree(created.tree);
      await loadFile(created.path);
    } catch (reason) {
      setError(errorText(reason));
    }
  }

  async function newFolder(): Promise<void> {
    if (!session) return;
    const dir = selectedDirectory();
    const stem = dir ? `${dir}/untitled-folder` : "untitled-folder";
    const initial = unusedPath(collectPaths(session.tree), stem, "");
    const value = await openDialog(
      { kind: "prompt", title: "New folder", label: "Path", value: initial, confirm: "Create" },
      initial,
    );
    if (typeof value !== "string" || !value.trim()) return;
    try {
      const created = await window.md.createFolder(value.trim());
      adoptTree(created.tree);
      setSelected(created.path);
      setSelectedKind("folder");
      setExpanded((current) => {
        const next = new Set(current);
        for (const ancestor of ancestorPaths(created.path)) next.add(ancestor);
        next.add(created.path);
        return next;
      });
      setError(null);
    } catch (reason) {
      setError(errorText(reason));
    }
  }

  async function renameSelected(): Promise<void> {
    if (!selected) return;
    const value = await openDialog(
      { kind: "prompt", title: "Rename", label: "New path", value: selected, confirm: "Rename" },
      selected,
    );
    if (typeof value !== "string" || !value.trim() || value.trim() === selected) return;
    try {
      const result = await window.md.renamePath(selected, value.trim());
      adoptTree(result.tree);
      const nextSelected = remap(selected, result.from, result.to);
      setSelected(nextSelected);
      setSelectedKind(
        result.from === selected && selectedKind === "folder" ? "folder" : selectedKind,
      );
      const open = filePathRef.current;
      if (open) {
        const nextFile = remap(open, result.from, result.to);
        if (nextFile !== open) {
          filePathRef.current = nextFile;
          setFilePath(nextFile);
          if (selected === open || open.startsWith(`${selected}/`)) setSelected(nextFile);
          await window.md.watchFile(nextFile);
        }
      }
      setError(null);
    } catch (reason) {
      setError(errorText(reason));
    }
  }

  async function trashSelected(): Promise<void> {
    if (!selected) return;
    const open = filePathRef.current;
    const affects = open === selected || (open !== null && open.startsWith(`${selected}/`));
    const losingEdits = affects && bufferRef.current !== savedRef.current;
    const body = losingEdits
      ? `Move “${selected}” to the trash? Unsaved changes will be lost.`
      : `Move “${selected}” to the trash?`;
    const ok = await openDialog({
      kind: "confirm",
      title: "Move to trash",
      body,
      confirm: "Move to trash",
    });
    if (ok !== true) return;
    try {
      const result = await window.md.trashPath(selected);
      adoptTree(result.tree);
      if (affects) commitFile(null, "", []);
      setSelected(null);
      setSelectedKind(null);
      setError(null);
      await refreshTags();
    } catch (reason) {
      setError(errorText(reason));
    }
  }

  async function addTag(raw: string): Promise<void> {
    const rel = filePathRef.current;
    if (!rel || !raw.trim()) return;
    try {
      const next = await window.md.setTags(rel, [...fileTagsRef.current, raw]);
      fileTagsRef.current = next;
      setFileTags(next);
      setTagDraft("");
      await refreshTags();
      setError(null);
    } catch (reason) {
      setError(errorText(reason));
    }
  }

  async function removeTag(tag: string): Promise<void> {
    const rel = filePathRef.current;
    if (!rel) return;
    try {
      const next = await window.md.setTags(
        rel,
        fileTagsRef.current.filter((item) => item !== tag),
      );
      fileTagsRef.current = next;
      setFileTags(next);
      await refreshTags();
    } catch (reason) {
      setError(errorText(reason));
    }
  }

  async function selectTag(tag: string): Promise<void> {
    activeTagRef.current = tag;
    setActiveTag(tag);
    try {
      setTagFiles(await window.md.filesForTag(tag));
    } catch (reason) {
      setError(errorText(reason));
    }
  }

  function onNavigate(href: string): void {
    const from = filePathRef.current;
    if (!from) return;
    const action = classifyHref(from, href);
    if (action.type === "scroll") {
      setPendingHash("");
      window.setTimeout(() => setPendingHash(action.id), 0);
      return;
    }
    if (action.type === "external") {
      void window.md.openExternal(action.url).catch((reason) => setError(errorText(reason)));
      return;
    }
    if (action.type === "file")
      void openPath(action.path, action.hash).catch((reason) => setError(errorText(reason)));
  }

  function onSelect(node: TreeNode): void {
    if (node.kind === "folder") {
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(node.path)) next.delete(node.path);
        else next.add(node.path);
        return next;
      });
      setSelected(node.path);
      setSelectedKind("folder");
      return;
    }
    void openPath(node.path).catch((reason) => setError(errorText(reason)));
  }

  actions.current = {
    save,
    openFolder,
    newFile,
    newFolder,
    requestClose: async () => {
      if (closingRef.current) return;
      closingRef.current = true;
      try {
        if (await ensureCanLeave()) await window.md.confirmClose();
        else await window.md.cancelClose();
      } finally {
        closingRef.current = false;
      }
    },
    external: (event) => {
      if (event.path !== filePathRef.current) return;
      const action = decideExternalChange({
        dirty: bufferRef.current !== savedRef.current,
        exists: event.exists,
        contentChanged: true,
      });
      if (action === "reload") {
        commitFile(event.path, event.content, fileTagsRef.current);
        return;
      }
      if (action === "prompt-reload") {
        setDiskNotice({ kind: "changed", content: event.content });
        return;
      }
      if (action === "removed") {
        commitFile(null, "", []);
        void window.md.unwatch();
        setError("This file was removed.");
        return;
      }
      if (action === "prompt-removed") setDiskNotice({ kind: "removed" });
    },
    library: applySession,
  };

  useEffect(() => {
    const id = window.setTimeout(() => setPreviewSource(buffer), 40);
    return () => window.clearTimeout(id);
  }, [buffer]);

  useEffect(() => {
    const name = filePath ? (filePath.split("/").pop() ?? "Simple MD") : "Simple MD";
    document.title = `${dirty ? "• " : ""}${name} — Simple MD`;
  }, [dirty, filePath]);

  useEffect(() => {
    void window.md.ready();
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void actions.current.save();
      }
      if (event.key === "Escape" && dialogRef.current) closeDialog(null);
    };
    window.addEventListener("keydown", onKey);
    const offs = [
      window.md.onMenuSave(() => void actions.current.save()),
      window.md.onMenuOpenFolder(() => void actions.current.openFolder()),
      window.md.onMenuNewFile(() => void actions.current.newFile()),
      window.md.onMenuNewFolder(() => void actions.current.newFolder()),
      window.md.onRequestClose(() => void actions.current.requestClose()),
      window.md.onLibrary((next) => actions.current.library(next)),
      window.md.onFileExternal((event) => actions.current.external(event)),
    ];
    void window.md.getSession().then((next) => {
      if (next) actions.current.library(next);
    });
    return () => {
      window.removeEventListener("keydown", onKey);
      for (const off of offs) off();
    };
  }, []);

  const showEditor = mode !== "preview";
  const showPreview = mode !== "editor";

  return (
    <div className="app" data-testid="app">
      <aside className="sidebar" data-testid="sidebar">
        <div className="brand">
          <span className="mark" aria-hidden="true">
            #
          </span>
          <div>
            <strong>Simple MD</strong>
            <div className="root-name" title={session?.root ?? ""}>
              {session?.rootName ?? "No folder"}
            </div>
          </div>
        </div>
        <div className="side-actions">
          <button type="button" data-testid="open-folder" onClick={() => void openFolder()}>
            Open folder
          </button>
          <button
            type="button"
            data-testid="new-file"
            disabled={!session}
            onClick={() => void newFile()}
          >
            New file
          </button>
          <button
            type="button"
            data-testid="new-folder"
            disabled={!session}
            onClick={() => void newFolder()}
          >
            New folder
          </button>
          <button
            type="button"
            data-testid="rename"
            disabled={!selected}
            onClick={() => void renameSelected()}
          >
            Rename
          </button>
          <button
            type="button"
            data-testid="delete"
            disabled={!selected}
            onClick={() => void trashSelected()}
          >
            Delete
          </button>
        </div>
        <input
          className="search"
          data-testid="search"
          placeholder="Filter by file name"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="tabs" role="tablist">
          <button
            type="button"
            data-testid="tab-files"
            aria-pressed={sidebar === "files"}
            onClick={() => setSidebar("files")}
          >
            Files
          </button>
          <button
            type="button"
            data-testid="tab-tags"
            aria-pressed={sidebar === "tags"}
            onClick={() => setSidebar("tags")}
          >
            Tags
          </button>
        </div>
        <div className="side-scroll">
          {sidebar === "files" ? (
            session ? (
              <div data-testid="tree">
                <FileTree
                  nodes={visibleTree}
                  depth={0}
                  expanded={shownExpanded}
                  selected={selected}
                  onSelect={onSelect}
                />
              </div>
            ) : (
              <p className="side-empty">Open a folder to browse Markdown files.</p>
            )
          ) : (
            <div data-testid="tag-view">
              {tags.length === 0 ? <p className="side-empty">No tags yet.</p> : null}
              <ul className="tag-list">
                {tags.map((tag) => (
                  <li key={tag.tag}>
                    <button
                      type="button"
                      className="tag-row"
                      data-testid="tag"
                      data-tag={tag.tag}
                      aria-pressed={activeTag === tag.tag}
                      onClick={() => void selectTag(tag.tag)}
                    >
                      <span>{tag.tag}</span>
                      <span className="count">{tag.count}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {activeTag ? (
                <ul className="tag-files">
                  {visibleTagFiles.map((file) => (
                    <li key={file}>
                      <button
                        type="button"
                        data-testid="tag-file"
                        data-path={file}
                        onClick={() => void openPath(file)}
                      >
                        {file}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
        </div>
      </aside>
      <main className="workspace">
        {session && filePath ? (
          <>
            <header className="toolbar">
              <div className="file-heading">
                {dirty ? (
                  <span className="dirty" data-testid="dirty" title="Unsaved changes" />
                ) : null}
                <div>
                  <div className="file-name">{filePath.split("/").pop()}</div>
                  <div className="file-path">{filePath}</div>
                </div>
              </div>
              <div className="file-tags">
                {fileTags.map((tag) => (
                  <span className="chip" key={tag} data-testid="tag-chip">
                    {tag}
                    <button
                      type="button"
                      aria-label={`Remove ${tag}`}
                      onClick={() => void removeTag(tag)}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <input
                  data-testid="tag-input"
                  placeholder="Add tag"
                  value={tagDraft}
                  onChange={(event) => setTagDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void addTag(tagDraft);
                    }
                  }}
                />
              </div>
              <div className="toolbar-end">
                <button
                  type="button"
                  data-testid="save"
                  disabled={!dirty}
                  onClick={() => void save()}
                >
                  Save
                </button>
                <div className="modes" role="radiogroup" aria-label="View">
                  {(
                    [
                      ["editor", "Editor"],
                      ["split", "Split"],
                      ["preview", "Preview"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={mode === value}
                      data-testid={`mode-${value}`}
                      className={mode === value ? "on" : ""}
                      onClick={() => setMode(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </header>
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
                  <button
                    type="button"
                    data-testid="reload-disk"
                    onClick={() => commitFile(filePath, diskNotice.content, fileTags)}
                  >
                    Reload
                  </button>
                ) : (
                  <button
                    type="button"
                    data-testid="close-removed"
                    onClick={() => {
                      commitFile(null, "", []);
                      void window.md.unwatch();
                      setDiskNotice(null);
                    }}
                  >
                    Close
                  </button>
                )}
                <button type="button" onClick={() => setDiskNotice(null)}>
                  Keep editing
                </button>
              </div>
            ) : null}
            <div className={`panes panes-${mode}`}>
              {showEditor ? (
                <Editor
                  path={filePath}
                  text={buffer}
                  revision={revision}
                  onChange={(value) => {
                    bufferRef.current = value;
                    setBuffer(value);
                  }}
                  onSave={() => void save()}
                />
              ) : null}
              {showPreview ? (
                <Preview
                  html={html}
                  fromRel={filePath}
                  hash={pendingHash}
                  onNavigate={onNavigate}
                />
              ) : null}
            </div>
          </>
        ) : (
          <div className="empty" data-testid="empty">
            <h1>Simple MD</h1>
            <p>{session ? "Select a Markdown file." : "Open a folder of Markdown files."}</p>
            {session ? null : (
              <button type="button" onClick={() => void openFolder()}>
                Open folder
              </button>
            )}
            {error ? <p className="empty-error">{error}</p> : null}
          </div>
        )}
      </main>
      {dialog ? (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            data-testid={dialog.kind === "discard" ? "discard-dialog" : "dialog"}
          >
            {dialog.kind === "discard" ? (
              <>
                <h2>Save changes?</h2>
                <p>This file has unsaved changes.</p>
                <div className="modal-actions">
                  <button
                    type="button"
                    data-testid="discard-cancel"
                    onClick={() => closeDialog("cancel")}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    data-testid="discard-confirm"
                    onClick={() => closeDialog("discard")}
                  >
                    Discard
                  </button>
                  <button
                    type="button"
                    className="primary"
                    data-testid="discard-save"
                    onClick={() => closeDialog("save")}
                  >
                    Save
                  </button>
                </div>
              </>
            ) : null}
            {dialog.kind === "prompt" ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  closeDialog(draft);
                }}
              >
                <h2>{dialog.title}</h2>
                <label>
                  {dialog.label}
                  <input
                    autoFocus
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                  />
                </label>
                <div className="modal-actions">
                  <button type="button" onClick={() => closeDialog(null)}>
                    Cancel
                  </button>
                  <button type="submit" className="primary">
                    {dialog.confirm}
                  </button>
                </div>
              </form>
            ) : null}
            {dialog.kind === "confirm" ? (
              <>
                <h2>{dialog.title}</h2>
                <p>{dialog.body}</p>
                <div className="modal-actions">
                  <button type="button" onClick={() => closeDialog(false)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="danger"
                    data-testid="confirm-delete"
                    onClick={() => closeDialog(true)}
                  >
                    {dialog.confirm}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
