const FRONT = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

function plainLine(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, "")
    .replace(/^>\s?/, "")
    .replace(/^[-*+]\s+\[[ xX]\]\s+/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function excerpt(markdown: string, max = 180): string {
  let text = markdown.replace(/^\uFEFF/, "");
  if (FRONT.test(text)) text = text.replace(FRONT, "");
  const kept: string[] = [];
  let skippedHeading = false;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("```")) continue;
    if (!skippedHeading && /^#{1,6}\s+/.test(trimmed)) {
      skippedHeading = true;
      continue;
    }
    skippedHeading = true;
    const plain = plainLine(trimmed);
    if (plain) kept.push(plain);
    if (kept.join(" ").length >= max) break;
  }
  const joined = kept.join(" ").replace(/\s+/g, " ").trim();
  if (joined.length <= max) return joined;
  return `${joined.slice(0, max - 1).trimEnd()}…`;
}
