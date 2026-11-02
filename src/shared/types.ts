export type TreeNode = {
  name: string;
  path: string;
  kind: "file" | "folder";
  children?: TreeNode[];
};

export type CatalogFile = {
  path: string;
  name: string;
  mtimeMs: number;
  favorite: boolean;
  tags: string[];
};

export type SessionInfo = {
  id: string;
  root: string;
  tree: TreeNode[];
  catalog: CatalogFile[];
  colors: Record<string, string>;
};

export type FilePayload = {
  revision: string;
  content: string;
  mtimeMs: number;
  tags: string[];
  favorite: boolean;
};

export type AppSettings = {
  wordGoal: number;
  platform: string;
};

export type TagCount = {
  tag: string;
  count: number;
};

export type WriteResult =
  | { status: "saved"; mtimeMs: number; revision: string }
  | { status: "conflict"; revision: string | null };

export type ExternalFileEvent = {
  revision: string | null;
  path: string;
  exists: boolean;
  content: string;
};

export type ViewMode = "editor" | "split" | "preview";

export type AssetPayload = { revision: string; url: string | null };
