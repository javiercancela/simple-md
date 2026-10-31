import fs from "node:fs";
import path from "node:path";
import { writeAtomic } from "../core/atomic";

type Settings = { lastRoot?: string };

export function readLastRoot(userData: string): string | null {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(userData, "settings.json"), "utf8"),
    ) as Settings;
    return typeof parsed.lastRoot === "string" ? parsed.lastRoot : null;
  } catch {
    return null;
  }
}

export function writeLastRoot(userData: string, root: string): void {
  writeAtomic(path.join(userData, "settings.json"), JSON.stringify({ lastRoot: root }, null, 2));
}
