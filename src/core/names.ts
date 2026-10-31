const MARKDOWN = [".md", ".markdown"];
const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
};

export const MAX_MARKDOWN_BYTES = 8_000_000;
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

const BAD_CHARS = new Set(["<", ">", ":", '"', "|", "?", "*"]);

function segmentIsPortable(segment: string): boolean {
  if (segment.endsWith(".") || segment.endsWith(" ")) return false;
  for (const char of segment) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 32 || BAD_CHARS.has(char)) return false;
  }
  return true;
}

export function extensionOf(rel: string): string {
  const slash = rel.lastIndexOf("/");
  const name = slash === -1 ? rel : rel.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "";
  return name.slice(dot).toLowerCase();
}

export function isMarkdownPath(rel: string): boolean {
  return MARKDOWN.includes(extensionOf(rel));
}

export function imageMime(rel: string): string | null {
  return IMAGE_MIME[extensionOf(rel)] ?? null;
}

export function assertPortableSegments(rel: string): void {
  for (const segment of rel.split("/")) {
    if (!segmentIsPortable(segment)) throw new Error("Invalid name");
  }
}

export function markdownTarget(rel: string): string {
  if (isMarkdownPath(rel)) return rel;
  if (extensionOf(rel) === "") return `${rel}.md`;
  throw new Error("Only Markdown files can be created");
}
