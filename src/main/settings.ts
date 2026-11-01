import fs from "node:fs";
import path from "node:path";
import { writeAtomic } from "../core/atomic";

type Settings = { lastRoot?: string; wordGoal?: number };

const GOAL_MIN = 50;
const GOAL_MAX = 20_000;
const GOAL_DEFAULT = 500;

function settingsPath(userData: string): string {
  return path.join(userData, "settings.json");
}

function read(userData: string): Settings {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath(userData), "utf8")) as Settings;
    const wordGoal =
      typeof parsed.wordGoal === "number" && Number.isInteger(parsed.wordGoal)
        ? Math.min(GOAL_MAX, Math.max(GOAL_MIN, parsed.wordGoal))
        : undefined;
    return {
      ...(typeof parsed.lastRoot === "string" ? { lastRoot: parsed.lastRoot } : {}),
      ...(wordGoal !== undefined ? { wordGoal } : {}),
    };
  } catch {
    return {};
  }
}

function write(userData: string, next: Settings): void {
  writeAtomic(settingsPath(userData), JSON.stringify(next, null, 2));
}

export function readLastRoot(userData: string): string | null {
  return read(userData).lastRoot ?? null;
}

export function writeLastRoot(userData: string, root: string): void {
  write(userData, { ...read(userData), lastRoot: root });
}

export function readWordGoal(userData: string): number {
  return read(userData).wordGoal ?? GOAL_DEFAULT;
}

export function writeWordGoal(userData: string, goal: number): number {
  const wordGoal = Math.min(GOAL_MAX, Math.max(GOAL_MIN, Math.round(goal)));
  write(userData, { ...read(userData), wordGoal });
  return wordGoal;
}
