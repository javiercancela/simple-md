import {
  app,
  dialog,
  ipcMain,
  shell,
  type BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";
import { z } from "zod";
import { classifyHref } from "../core/links";
import { channels } from "../shared/channels";
import {
  assetSchema,
  emptySchema,
  externalSchema,
  favoriteSchema,
  goalSchema,
  pathSchema,
  renameSchema,
  tagColorSchema,
  tagQuerySchema,
  tagsSchema,
  watchSchema,
  writeFileSchema,
} from "../shared/schemas";
import { getLibrary, openLibrary } from "./library";
import { readWordGoal, writeWordGoal } from "./settings";
import { assertSender } from "./security";

type IpcEvent = IpcMainInvokeEvent | IpcMainEvent;

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error("Invalid request");
  return parsed.data;
}

function requireLibrary() {
  const library = getLibrary();
  if (!library) throw new Error("Open a folder first");
  return library;
}

export function registerIpc(
  getWindow: () => BrowserWindow | null,
  actions: {
    markReady: () => void;
    confirmClose: () => void;
    cancelClose: () => void;
  },
): void {
  const handle = <T>(channel: string, schema: z.ZodType<T>, fn: (input: T) => unknown): void => {
    ipcMain.handle(channel, (event: IpcEvent, raw: unknown) => {
      assertSender(event, getWindow());
      return fn(parse(schema, raw));
    });
  };

  handle(channels.getSession, emptySchema, () => getLibrary()?.session() ?? null);

  handle(channels.openFolder, emptySchema, async () => {
    const win = getWindow();
    if (!win) return null;
    const picked = await dialog.showOpenDialog(win, {
      title: "Open folder",
      properties: ["openDirectory"],
    });
    const folder = picked.filePaths[0];
    if (picked.canceled || !folder) return null;
    return (await openLibrary(folder, app.getPath("userData"))).session();
  });

  handle(channels.readFile, pathSchema, ({ path }) => requireLibrary().read(path));
  handle(channels.writeFile, writeFileSchema, ({ path, content, revision }) =>
    requireLibrary().write(path, content, revision),
  );
  handle(channels.createFile, pathSchema, ({ path }) => requireLibrary().createFile(path));
  handle(channels.createFolder, pathSchema, ({ path }) => requireLibrary().createFolder(path));
  handle(channels.renamePath, renameSchema, ({ from, to }) => requireLibrary().rename(from, to));
  handle(channels.trashPath, pathSchema, ({ path }) => requireLibrary().trash(path));
  handle(channels.setTags, tagsSchema, ({ path, tags }) => requireLibrary().setTags(path, tags));
  handle(channels.listTags, emptySchema, () => requireLibrary().listTags());
  handle(channels.filesForTag, tagQuerySchema, ({ tag }) => requireLibrary().filesForTag(tag));
  handle(channels.setFavorite, favoriteSchema, ({ path, favorite }) =>
    requireLibrary().setFavorite(path, favorite),
  );
  handle(channels.setTagColor, tagColorSchema, ({ tag, color }) => {
    requireLibrary().setColor(tag, color);
  });
  handle(channels.snippet, pathSchema, ({ path }) => requireLibrary().snippet(path));
  handle(channels.revealPath, pathSchema, ({ path }) => {
    requireLibrary().reveal(path);
  });
  handle(channels.copyPath, pathSchema, ({ path }) => {
    requireLibrary().copyPath(path);
  });
  handle(channels.getSettings, emptySchema, () => ({
    wordGoal: readWordGoal(app.getPath("userData")),
    platform: process.platform,
  }));
  handle(channels.setWordGoal, goalSchema, ({ goal }) => ({
    wordGoal: writeWordGoal(app.getPath("userData"), goal),
  }));
  handle(channels.readAsset, assetSchema, ({ sessionId, from, href, revision }) => {
    const library = requireLibrary();
    if (library.id !== sessionId) return null;
    return library.readAsset(from, href, revision);
  });
  handle(channels.watchFile, watchSchema, ({ path }) => {
    requireLibrary().watch(path);
  });
  handle(channels.unwatch, emptySchema, () => {
    getLibrary()?.unwatch();
  });
  handle(channels.openExternal, externalSchema, async ({ url }) => {
    const action = classifyHref("note.md", url);
    if (action.type !== "external") throw new Error("Invalid link");
    await shell.openExternal(action.url);
  });
  handle(channels.ready, emptySchema, () => {
    actions.markReady();
  });
  handle(channels.cancelClose, emptySchema, () => {
    actions.cancelClose();
  });
  handle(channels.confirmClose, emptySchema, () => {
    actions.confirmClose();
  });
}
