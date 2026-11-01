import { useEffect, useMemo, useRef, useState } from "react";
import { decideExternalChange } from "../core/external";
import { classifyHref } from "../core/links";
import { renderMarkdown } from "../core/markdown";
import type { TagColorId } from "../core/colors";
import type {
  CatalogFile,
  ExternalFileEvent,
  SessionInfo,
  TreeNode,
  ViewMode,
} from "../shared/types";
import { DocColumn } from "./DocColumn";
import {
  editedLabel,
  filterLabel,
  isRecent,
  modLabel,
  readMinutes,
  tagCounts,
  visibleDocs,
  wordCount,
  type DocSort,
  type LibraryFilter,
} from "./docs";
import { EditorPane } from "./EditorPane";
import type { FormatKind } from "./format";
import { Sidebar } from "./Sidebar";
import { collectPaths } from "./Tree";

type DialogState =
  | { kind: "discard" }
  | { kind: "prompt"; title: string; label: string; value: string; confirm: string }
  | { kind: "confirm"; title: string; body: string; confirm: string };

type DiskNotice = { kind: "changed"; content: string } | { kind: "removed" };

type SessionState = {
  root: string;
  rootName: string;
  tree: TreeNode[];
  catalog: CatalogFile[];
  colors: Record<string, string>;
};

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

function detectPlatform(): string {
  const agent = navigator.userAgent;
  if (agent.includes("Mac")) return "darwin";
  if (agent.includes("Windows")) return "win32";
  return "linux";
}

function usePrefersDark(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => setDark(media.matches);
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
  return dark;
}

function folderCounts(catalog: readonly CatalogFile[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const file of catalog) {
    const parts = file.path.split("/");
    parts.pop();
    let folder = "";
    for (const part of parts) {
      folder = folder ? `${folder}/${part}` : part;
      counts.set(folder, (counts.get(folder) ?? 0) + 1);
    }
  }
  return counts;
}

function isFocusShortcut(event: KeyboardEvent): boolean {
  if (event.key.toLowerCase() !== "f" || event.altKey) return false;
  if (event.metaKey && event.ctrlKey && !event.shiftKey) return true;
  return (event.metaKey || event.ctrlKey) && event.shiftKey;
}

function isFindShortcut(event: KeyboardEvent): boolean {
  if (event.key.toLowerCase() !== "f" || event.altKey || event.shiftKey) return false;
  if (event.metaKey && event.ctrlKey) return false;
  return event.metaKey || event.ctrlKey;
}

export function App() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedKind, setSelectedKind] = useState<"file" | "folder" | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LibraryFilter>({ type: "all" });
  const [sort, setSort] = useState<DocSort>("edited");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [focus, setFocus] = useState(false);
  const [mode, setMode] = useState<ViewMode>("editor");
  const [goal, setGoal] = useState(500);
  const [platform, setPlatform] = useState(detectPlatform);
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

  const rootRef = useRef<string | null>(null);
  const filePathRef = useRef<string | null>(null);
  const bufferRef = useRef("");
  const savedRef = useRef("");
  const fileTagsRef = useRef<string[]>([]);
  const dialogRef = useRef<DialogState | null>(null);
  const resolver = useRef<(value: unknown) => void>(() => {});
  const closingRef = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const formatRef = useRef<(kind: FormatKind) => void>(() => {});
  const actions = useRef({
    save: async (): Promise<boolean> => true,
    openFolder: async () => {},
    newFile: async () => {},
    newFolder: async () => {},
    requestClose: async () => {},
    external: (_event: ExternalFileEvent) => {},
    library: (_session: SessionInfo) => {},
  });

  const osDark = usePrefersDark();
  const dark = focus || osDark;
  const dirty = filePath !== null && buffer !== saved;
  const html = useMemo(
    () => (filePath ? renderMarkdown(previewSource) : ""),
    [filePath, previewSource],
  );
  const catalog = session?.catalog ?? [];
  const docs = useMemo(
    () => visibleDocs(catalog, filter, query, sort),
    [catalog, filter, query, sort],
  );
  const tags = useMemo(() => tagCounts(catalog), [catalog]);
  const counts = useMemo(() => folderCounts(catalog), [catalog]);
  const words = useMemo(() => wordCount(filePath ? buffer : ""), [buffer, filePath]);
  const openFile = catalog.find((file) => file.path === filePath);
  const goalPct = Math.min(100, Math.round((words / Math.max(goal, 1)) * 100));
  const shortcutMod = modLabel(platform);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

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

  function applySession(next: SessionInfo): void {
    const changed = rootRef.current !== next.root;
    rootRef.current = next.root;
    setSession({
      root: next.root,
      rootName: basename(next.root),
      tree: next.tree,
      catalog: next.catalog ?? [],
      colors: next.colors ?? {},
    });
    if (!changed) {
      const open = filePathRef.current;
      const row = open ? next.catalog?.find((file) => file.path === open) : undefined;
      if (row && row.tags.join("\0") !== fileTagsRef.current.join("\0")) {
        fileTagsRef.current = row.tags;
        setFileTags(row.tags);
      }
      return;
    }
    setExpanded(defaultExpanded(next.tree));
    commitFile(null, "", []);
    void window.md.unwatch();
    setQuery("");
    setFilter({ type: "all" });
    setPickerOpen(false);
    setFocus(false);
    setSelected(null);
    setSelectedKind(null);
    setError(null);
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
    setPickerOpen(false);
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
      setFilter({ type: "folder", path: created.path });
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
      if (filter.type === "folder") {
        const nextFolder = remap(filter.path, result.from, result.to);
        if (nextFolder !== filter.path) setFilter({ type: "folder", path: nextFolder });
      }
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
    } catch (reason) {
      setError(errorText(reason));
    }
  }

  async function writeTags(next: string[], color?: TagColorId): Promise<void> {
    const rel = filePathRef.current;
    if (!rel) return;
    try {
      const stored = await window.md.setTags(rel, next);
      fileTagsRef.current = stored;
      setFileTags(stored);
      const named = next[next.length - 1];
      if (color && named) await window.md.setTagColor(named, color);
      setError(null);
    } catch (reason) {
      setError(errorText(reason));
    }
  }

  function toggleTag(tag: string): void {
    const has = fileTagsRef.current.some((item) => item.toLowerCase() === tag.toLowerCase());
    const next = has
      ? fileTagsRef.current.filter((item) => item.toLowerCase() !== tag.toLowerCase())
      : [...fileTagsRef.current, tag];
    void writeTags(next);
  }

  function createTag(tag: string, color: TagColorId): void {
    void writeTags([...fileTagsRef.current, tag], color);
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

  function onSelectFolder(node: TreeNode): void {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(node.path)) next.delete(node.path);
      else next.add(node.path);
      return next;
    });
    setSelected(node.path);
    setSelectedKind("folder");
    setFilter({ type: "folder", path: node.path });
  }

  function pickLibrary(type: "all" | "recent" | "favorites"): void {
    setFilter({ type });
    const open = filePathRef.current;
    if (open) {
      setSelected(open);
      setSelectedKind("file");
    } else {
      setSelected(null);
      setSelectedKind(null);
    }
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
    if (!pickerOpen) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-picker-root]")) return;
      setPickerOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    return () => window.removeEventListener("pointerdown", onPointer);
  }, [pickerOpen]);

  useEffect(() => {
    void window.md.ready();
    void window.md.getSettings().then((settings) => {
      setGoal(settings.wordGoal);
      if (settings.platform) setPlatform(settings.platform);
    });
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s" && !event.shiftKey) {
        event.preventDefault();
        void actions.current.save();
      }
      if (event.key === "Escape" && dialogRef.current) closeDialog(null);
      if (isFocusShortcut(event)) {
        event.preventDefault();
        if (filePathRef.current) setFocus((value) => !value);
      } else if (isFindShortcut(event)) {
        event.preventDefault();
        setFocus(false);
        window.setTimeout(() => {
          searchRef.current?.focus();
          searchRef.current?.select();
        }, 0);
      }
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

  const now = Date.now();
  const recentCount = catalog.filter((file) => isRecent(file.mtimeMs, now)).length;
  const favoriteCount = catalog.filter((file) => file.favorite).length;
  const rootName = session?.rootName ?? "";
  const parent = filePath ? parentPath(filePath) : "";
  const folderName = !filePath ? "" : parent ? (parent.split("/").pop() ?? parent) : rootName;

  return (
    <div
      className={`shell${focus ? " is-focus" : ""}${sidebarOpen ? "" : " sidebar-hidden"} platform-${platform}`}
      data-testid="app"
    >
      <Sidebar
        open={sidebarOpen}
        platform={platform}
        filter={filter}
        tree={session?.tree ?? []}
        expanded={expanded}
        selected={selected}
        counts={counts}
        allCount={catalog.length}
        recentCount={recentCount}
        favoriteCount={favoriteCount}
        tags={tags}
        colors={session?.colors ?? {}}
        dark={dark}
        openShortcut={`${shortcutMod}${platform === "darwin" ? "O" : "+O"}`}
        onHide={() => setSidebarOpen(false)}
        onAll={() => pickLibrary("all")}
        onRecent={() => pickLibrary("recent")}
        onFavorites={() => pickLibrary("favorites")}
        onTag={(tag) => setFilter({ type: "tag", tag })}
        onAddTag={() => {
          if (!filePathRef.current) {
            setError("Open a document before adding a tag.");
            return;
          }
          setPickerOpen(true);
        }}
        onOpenFolder={() => void openFolder()}
        onSelectFolder={onSelectFolder}
      />
      <DocColumn
        title={session ? filterLabel(filter) : "All Documents"}
        countLabel={`${docs.length} ${docs.length === 1 ? "document" : "documents"}`}
        query={query}
        sort={sort}
        rows={docs}
        selected={filePath}
        colors={session?.colors ?? {}}
        dark={dark}
        searchRef={searchRef}
        findHint={platform === "darwin" ? "⌘F" : "Ctrl+F"}
        onQuery={setQuery}
        onSort={() =>
          setSort((current) =>
            current === "edited"
              ? "title"
              : current === "title"
                ? "title-desc"
                : current === "title-desc"
                  ? "edited-asc"
                  : "edited",
          )
        }
        onNew={() => void newFile()}
        onOpen={(path) => void openPath(path).catch((reason) => setError(errorText(reason)))}
        onFavorite={(path) => {
          const file = catalog.find((item) => item.path === path);
          void window.md.setFavorite(path, !(file?.favorite ?? false)).catch((reason) => {
            setError(errorText(reason));
          });
        }}
        sidebarHidden={!sidebarOpen}
        onShowSidebar={() => setSidebarOpen(true)}
      />
      <EditorPane
        sessionOpen={session !== null}
        filePath={filePath}
        folderLabel={folderName}
        fileLabel={filePath?.split("/").pop() ?? ""}
        edited={openFile ? editedLabel(openFile.mtimeMs) : ""}
        tags={fileTags}
        tagList={tags}
        colors={session?.colors ?? {}}
        dark={dark}
        mode={mode}
        focus={focus}
        dirty={dirty}
        words={words.toLocaleString("en-US")}
        readTime={readMinutes(words)}
        goal={goal}
        goalPct={goalPct}
        focusShortcut={platform === "darwin" ? "⌘⇧F" : "Ctrl+Shift+F"}
        html={html}
        hash={pendingHash}
        revision={revision}
        buffer={buffer}
        error={error}
        diskNotice={diskNotice}
        pickerOpen={pickerOpen}
        formatRef={formatRef}
        onMode={setMode}
        onFocus={() => {
          if (filePath) setFocus(true);
        }}
        onExitFocus={() => setFocus(false)}
        onGoal={(value) => {
          if (!Number.isInteger(value) || value < 50 || value > 20_000) return;
          setGoal(value);
          void window.md.setWordGoal(value).catch((reason) => setError(errorText(reason)));
        }}
        onChange={(value) => {
          bufferRef.current = value;
          setBuffer(value);
        }}
        onSave={() => void save()}
        onNavigate={onNavigate}
        onRemoveTag={(tag) => void writeTags(fileTagsRef.current.filter((item) => item !== tag))}
        onToggleTag={toggleTag}
        onCreateTag={createTag}
        onPicker={setPickerOpen}
        onFavorite={() => {
          if (!filePath) return;
          void window.md.setFavorite(filePath, !(openFile?.favorite ?? false)).catch((reason) => {
            setError(errorText(reason));
          });
        }}
        favorite={openFile?.favorite ?? false}
        onReveal={() => {
          if (!filePath) return;
          void window.md.revealPath(filePath).catch((reason) => setError(errorText(reason)));
        }}
        onCopyPath={() => {
          if (!filePath) return;
          void window.md.copyPath(filePath).catch((reason) => setError(errorText(reason)));
        }}
        onRename={() => void renameSelected()}
        onTrash={() => void trashSelected()}
        onNewFolder={() => void newFolder()}
        onReload={() => {
          if (diskNotice?.kind === "changed" && filePath)
            commitFile(filePath, diskNotice.content, fileTags);
        }}
        onCloseRemoved={() => {
          commitFile(null, "", []);
          void window.md.unwatch();
          setDiskNotice(null);
        }}
        onDismissNotice={() => setDiskNotice(null)}
        onOpenFolder={() => void openFolder()}
      />
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
