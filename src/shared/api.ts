import type { AppSettings, ExternalFileEvent, FilePayload, SessionInfo, TagCount } from "./types";

export type MdApi = {
  getSession: () => Promise<SessionInfo | null>;
  openFolder: () => Promise<SessionInfo | null>;
  readFile: (path: string) => Promise<FilePayload>;
  writeFile: (path: string, content: string) => Promise<{ mtimeMs: number }>;
  createFile: (path: string) => Promise<{ path: string; tree: SessionInfo["tree"] }>;
  createFolder: (path: string) => Promise<{ path: string; tree: SessionInfo["tree"] }>;
  renamePath: (
    from: string,
    to: string,
  ) => Promise<{ from: string; to: string; tree: SessionInfo["tree"] }>;
  trashPath: (path: string) => Promise<{ tree: SessionInfo["tree"] }>;
  setTags: (path: string, tags: string[]) => Promise<string[]>;
  listTags: () => Promise<TagCount[]>;
  filesForTag: (tag: string) => Promise<string[]>;
  setFavorite: (path: string, favorite: boolean) => Promise<boolean>;
  setTagColor: (tag: string, color: string) => Promise<void>;
  snippet: (path: string) => Promise<string>;
  revealPath: (path: string) => Promise<void>;
  copyPath: (path: string) => Promise<void>;
  getSettings: () => Promise<AppSettings>;
  setWordGoal: (goal: number) => Promise<{ wordGoal: number }>;
  readAsset: (from: string, href: string) => Promise<string | null>;
  openExternal: (url: string) => Promise<void>;
  watchFile: (path: string) => Promise<void>;
  unwatch: () => Promise<void>;
  ready: () => Promise<void>;
  confirmClose: () => Promise<void>;
  cancelClose: () => Promise<void>;
  onLibrary: (callback: (session: SessionInfo) => void) => () => void;
  onFileExternal: (callback: (event: ExternalFileEvent) => void) => () => void;
  onMenuSave: (callback: () => void) => () => void;
  onMenuOpenFolder: (callback: () => void) => () => void;
  onMenuNewFile: (callback: () => void) => () => void;
  onMenuNewFolder: (callback: () => void) => () => void;
  onRequestClose: (callback: () => void) => () => void;
};
