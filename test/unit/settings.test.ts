import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readLastRoot, readWordGoal, writeLastRoot, writeWordGoal } from "../../src/main/settings";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("settings", () => {
  it("remembers a word goal without dropping the last folder", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "simple-md-settings-"));
    dirs.push(dir);
    writeLastRoot(dir, "/notes");
    expect(writeWordGoal(dir, 800)).toBe(800);
    expect(readLastRoot(dir)).toBe("/notes");
    expect(readWordGoal(dir)).toBe(800);
    writeLastRoot(dir, "/other");
    expect(readWordGoal(dir)).toBe(800);
  });
});
