import { isMarkdownPath } from "./names";

export type LinkAction =
  | { type: "scroll"; id: string }
  | { type: "external"; url: string }
  | { type: "file"; path: string; hash: string }
  | { type: "ignore" };

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function resolveRelativeLink(fromRel: string, href: string): string | null {
  const decoded = decode(href.trim());
  if (decoded === null) return null;
  if (!decoded || decoded.length > 4096 || decoded.includes("\0") || decoded.includes("\\")) {
    return null;
  }
  if (decoded.startsWith("//") || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(decoded)) return null;
  const rooted = decoded.startsWith("/");
  const slash = fromRel.lastIndexOf("/");
  const base = slash === -1 ? "" : fromRel.slice(0, slash);
  const combined = rooted ? decoded.slice(1) : base ? `${base}/${decoded}` : decoded;
  const parts: string[] = [];
  for (const part of combined.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    if (part.includes(":")) return null;
    parts.push(part);
  }
  if (parts.length === 0) return null;
  return parts.join("/");
}

export function classifyHref(fromRel: string, href: string): LinkAction {
  const trimmed = href.trim();
  if (!trimmed) return { type: "ignore" };
  if (trimmed.startsWith("#")) {
    const id = decode(trimmed.slice(1));
    return id ? { type: "scroll", id } : { type: "ignore" };
  }
  if (trimmed.startsWith("//")) return { type: "ignore" };
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      if (url.protocol === "http:" || url.protocol === "https:") {
        if (url.username || url.password) return { type: "ignore" };
        return { type: "external", url: url.toString() };
      }
    } catch {
      return { type: "ignore" };
    }
    return { type: "ignore" };
  }
  const hashAt = trimmed.indexOf("#");
  const beforeHash = hashAt >= 0 ? trimmed.slice(0, hashAt) : trimmed;
  const hash = hashAt >= 0 ? (decode(trimmed.slice(hashAt + 1)) ?? "") : "";
  const pathOnly = beforeHash.split("?")[0] ?? "";
  if (!pathOnly) return hash ? { type: "scroll", id: hash } : { type: "ignore" };
  const resolved = resolveRelativeLink(fromRel, pathOnly);
  if (!resolved || !isMarkdownPath(resolved)) return { type: "ignore" };
  return { type: "file", path: resolved, hash };
}
