import { z } from "zod";
import { normalizeRelative } from "../core/paths";

function relativePath(value: string): boolean {
  try {
    normalizeRelative(value);
    return true;
  } catch {
    return false;
  }
}

export const relativePathSchema = z.string().min(1).max(4096).refine(relativePath);
export const emptySchema = z.union([z.undefined(), z.null()]);

export const pathSchema = z.object({
  path: relativePathSchema,
});

export const writeFileSchema = z.object({
  path: relativePathSchema,
  content: z.string().max(8_000_000),
});

export const renameSchema = z.object({
  from: relativePathSchema,
  to: relativePathSchema,
});

export const tagsSchema = z.object({
  path: relativePathSchema,
  tags: z.array(z.string().max(80)).max(32),
});

export const tagQuerySchema = z.object({
  tag: z.string().min(1).max(80),
});

export const assetSchema = z.object({
  from: relativePathSchema,
  href: z.string().min(1).max(4096),
});

export const externalSchema = z.object({
  url: z.string().min(1).max(2000),
});

export const watchSchema = z.object({
  path: relativePathSchema,
});
