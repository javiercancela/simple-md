export type TreeNode = {
  name: string;
  path: string;
  kind: "file" | "folder";
  children?: TreeNode[];
};

export type SessionInfo = {
  root: string;
  tree: TreeNode[];
};

export type FilePayload = {
  content: string;
  mtimeMs: number;
  tags: string[];
};

export type TagCount = {
  tag: string;
  count: number;
};

export type ExternalFileEvent = {
  path: string;
  exists: boolean;
  content: string;
};

export type ViewMode = "editor" | "split" | "preview";
