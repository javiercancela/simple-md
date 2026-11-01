export const TAG_COLOR_IDS = [
  "blue",
  "teal",
  "violet",
  "amber",
  "grey",
  "pink",
  "brown",
  "orange",
  "green",
] as const;

export type TagColorId = (typeof TAG_COLOR_IDS)[number];

export type TagPaint = { dot: string; bg: string; fg: string };

type Swatch = TagPaint & { id: TagColorId; darkDot: string; darkBg: string; darkFg: string };

const SWATCHES: readonly Swatch[] = [
  {
    id: "blue",
    dot: "#3D7BE5",
    bg: "#E5EEFC",
    fg: "#1E4FA3",
    darkDot: "#7EABF5",
    darkBg: "#1A2C4A",
    darkFg: "#D3E4FF",
  },
  {
    id: "teal",
    dot: "#12A3A3",
    bg: "#DFF4F3",
    fg: "#0B6464",
    darkDot: "#3EC4C4",
    darkBg: "#123838",
    darkFg: "#C6F4F3",
  },
  {
    id: "violet",
    dot: "#8B5CF6",
    bg: "#EEE8FD",
    fg: "#5B2FC2",
    darkDot: "#B79AF8",
    darkBg: "#2A2048",
    darkFg: "#E4D9FF",
  },
  {
    id: "amber",
    dot: "#E3A008",
    bg: "#FCF2D9",
    fg: "#7A5200",
    darkDot: "#E3A008",
    darkBg: "#3A2E10",
    darkFg: "#FFE6B0",
  },
  {
    id: "grey",
    dot: "#8E8E96",
    bg: "#EEEEF1",
    fg: "#4A4A52",
    darkDot: "#B4B4BC",
    darkBg: "#2A2A2E",
    darkFg: "#E4E4E8",
  },
  {
    id: "pink",
    dot: "#DB4C8A",
    bg: "#FCE7F0",
    fg: "#9C2559",
    darkDot: "#F08AB4",
    darkBg: "#3A1C2C",
    darkFg: "#FFD5E6",
  },
  {
    id: "brown",
    dot: "#A07A55",
    bg: "#F3ECE4",
    fg: "#6B4A2B",
    darkDot: "#C4A484",
    darkBg: "#34281E",
    darkFg: "#F0E2D4",
  },
  {
    id: "orange",
    dot: "#E8692E",
    bg: "#FDEBE2",
    fg: "#9A3B10",
    darkDot: "#F09A6A",
    darkBg: "#3A2418",
    darkFg: "#FFD8C4",
  },
  {
    id: "green",
    dot: "#2FA35F",
    bg: "#E2F4E9",
    fg: "#1D6B3E",
    darkDot: "#5FC39A",
    darkBg: "#143226",
    darkFg: "#C8F3DE",
  },
];

export function isColorId(value: string | undefined): value is TagColorId {
  return !!value && (TAG_COLOR_IDS as readonly string[]).includes(value);
}

export function defaultColorId(name: string): TagColorId {
  let hash = 2166136261;
  for (const char of name.trim().toLowerCase()) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return SWATCHES[(hash >>> 0) % SWATCHES.length]?.id ?? "grey";
}

export function tagPaint(name: string, stored: string | undefined, dark: boolean): TagPaint {
  const id = isColorId(stored) ? stored : defaultColorId(name);
  const swatch = SWATCHES.find((item) => item.id === id) ?? SWATCHES[4]!;
  return dark
    ? { dot: swatch.darkDot, bg: swatch.darkBg, fg: swatch.darkFg }
    : { dot: swatch.dot, bg: swatch.bg, fg: swatch.fg };
}

export function swatchDots(dark: boolean): { id: TagColorId; dot: string }[] {
  return SWATCHES.map((item) => ({ id: item.id, dot: dark ? item.darkDot : item.dot }));
}
