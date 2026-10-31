import { describe, expect, it } from "vitest";
import { decideExternalChange } from "../../src/core/external";

describe("decideExternalChange", () => {
  it("reloads a clean file when the disk copy changes", () => {
    expect(decideExternalChange({ dirty: false, exists: true, contentChanged: true })).toBe(
      "reload",
    );
  });

  it("asks before replacing unsaved edits", () => {
    expect(decideExternalChange({ dirty: true, exists: true, contentChanged: true })).toBe(
      "prompt-reload",
    );
  });

  it("ignores an unchanged file", () => {
    expect(decideExternalChange({ dirty: true, exists: true, contentChanged: false })).toBe(
      "ignore",
    );
  });

  it("drops a clean file that disappeared", () => {
    expect(decideExternalChange({ dirty: false, exists: false, contentChanged: true })).toBe(
      "removed",
    );
  });

  it("asks before discarding a dirty file that disappeared", () => {
    expect(decideExternalChange({ dirty: true, exists: false, contentChanged: true })).toBe(
      "prompt-removed",
    );
  });
});
