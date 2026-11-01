import { describe, expect, it } from "vitest";
import { excerpt } from "../../src/core/excerpt";
import { matchesQuery, visibleDocs } from "../../src/ui/docs";
import type { CatalogFile } from "../../src/shared/types";

const file = (path: string, tags: string[] = [], favorite = false): CatalogFile => ({
  path,
  name: path.split("/").pop() ?? path,
  mtimeMs: 1,
  favorite,
  tags,
});

describe("excerpt", () => {
  it("skips the title and front matter", () => {
    const text = excerpt(`---
title: Roadmap
tags: [work]
---
# Roadmap

Ship the core loop first, then stop.

## Later
`);
    expect(text.startsWith("Ship the core loop")).toBe(true);
    expect(text).not.toContain("tags:");
    expect(text).not.toContain("# Roadmap");
  });
});

describe("document search", () => {
  const files = [file("Welcome.md", ["garden"]), file("journal/monday.md", ["work"])];

  it("matches a name and a #tag prefix", () => {
    expect(matchesQuery(files[0]!, "wel")).toBe(true);
    expect(matchesQuery(files[1]!, "#wo")).toBe(true);
    expect(matchesQuery(files[0]!, "#wo")).toBe(false);
    expect(
      visibleDocs(files, { type: "tag", tag: "garden" }, "", "title").map((item) => item.path),
    ).toEqual(["Welcome.md"]);
    expect(visibleDocs(files, { type: "favorites" }, "", "title", 10)).toEqual([]);
  });
});
