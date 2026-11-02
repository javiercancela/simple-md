import { z } from "zod";
import { TAG_COLOR_IDS } from "../core/colors";
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
  // The main-process write boundary enforces the UTF-8 byte limit.
  content: z.string(),
  revision: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
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

export const favoriteSchema = z.object({
  path: relativePathSchema,
  favorite: z.boolean(),
});

export const tagColorSchema = z.object({
  tag: z.string().min(1).max(80),
  color: z.enum(TAG_COLOR_IDS),
});

export const goalSchema = z.object({
  goal: z.number().int().min(50).max(20_000),
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
