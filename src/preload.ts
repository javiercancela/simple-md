import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { MdApi } from "./shared/api";
import { channels } from "./shared/channels";
import type {
  ExternalFileEvent,
  FilePayload,
  SessionInfo,
  TagCount,
  TreeNode,
} from "./shared/types";

function listen<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T) => {
    callback(payload);
  };
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

function listenSignal(channel: string, callback: () => void): () => void {
  const listener = () => {
    callback();
  };
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const api: MdApi = {
  getSession: () => ipcRenderer.invoke(channels.getSession) as Promise<SessionInfo | null>,
  openFolder: () => ipcRenderer.invoke(channels.openFolder) as Promise<SessionInfo | null>,
  readFile: (filePath: string) =>
    ipcRenderer.invoke(channels.readFile, { path: filePath }) as Promise<FilePayload>,
  writeFile: (filePath: string, content: string) =>
    ipcRenderer.invoke(channels.writeFile, { path: filePath, content }) as Promise<{
      mtimeMs: number;
    }>,
  createFile: (filePath: string) =>
    ipcRenderer.invoke(channels.createFile, { path: filePath }) as Promise<{
      path: string;
      tree: TreeNode[];
    }>,
  createFolder: (filePath: string) =>
    ipcRenderer.invoke(channels.createFolder, { path: filePath }) as Promise<{
      path: string;
      tree: TreeNode[];
    }>,
  renamePath: (from: string, to: string) =>
    ipcRenderer.invoke(channels.renamePath, { from, to }) as Promise<{
      from: string;
      to: string;
      tree: TreeNode[];
    }>,
  trashPath: (filePath: string) =>
    ipcRenderer.invoke(channels.trashPath, { path: filePath }) as Promise<{ tree: TreeNode[] }>,
  setTags: (filePath: string, tags: string[]) =>
    ipcRenderer.invoke(channels.setTags, { path: filePath, tags }) as Promise<string[]>,
  listTags: () => ipcRenderer.invoke(channels.listTags) as Promise<TagCount[]>,
  filesForTag: (tag: string) =>
    ipcRenderer.invoke(channels.filesForTag, { tag }) as Promise<string[]>,
  readAsset: (from: string, href: string) =>
    ipcRenderer.invoke(channels.readAsset, { from, href }) as Promise<string | null>,
  openExternal: (url: string) =>
    ipcRenderer.invoke(channels.openExternal, { url }) as Promise<void>,
  watchFile: (filePath: string) =>
    ipcRenderer.invoke(channels.watchFile, { path: filePath }) as Promise<void>,
  unwatch: () => ipcRenderer.invoke(channels.unwatch) as Promise<void>,
  confirmClose: () => ipcRenderer.invoke(channels.confirmClose) as Promise<void>,
  cancelClose: () => ipcRenderer.invoke(channels.cancelClose) as Promise<void>,
  onLibrary: (callback) => listen<SessionInfo>(channels.libraryUpdated, callback),
  onFileExternal: (callback) => listen<ExternalFileEvent>(channels.fileExternal, callback),
  onMenuSave: (callback) => listenSignal(channels.menuSave, callback),
  onMenuOpenFolder: (callback) => listenSignal(channels.menuOpenFolder, callback),
  onMenuNewFile: (callback) => listenSignal(channels.menuNewFile, callback),
  onMenuNewFolder: (callback) => listenSignal(channels.menuNewFolder, callback),
  onRequestClose: (callback) => listenSignal(channels.requestClose, callback),
};

contextBridge.exposeInMainWorld("md", api);
