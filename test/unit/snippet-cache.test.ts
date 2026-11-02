import { expect, it } from "vitest";
import { SnippetCache } from "../../src/ui/snippetCache";

it("replaces older versions and evicts the least recently used document", () => {
  const cache = new SnippetCache(2);
  cache.set("a.md", 1, "old");
  cache.set("a.md", 2, "new");
  cache.set("b.md", 1, "beta");
  expect(cache.get("a.md", 1)).toBeUndefined();
  expect(cache.get("a.md", 2)).toBe("new");
  cache.set("c.md", 1, "gamma");
  expect(cache.get("b.md", 1)).toBeUndefined();
  expect(cache.get("a.md", 2)).toBe("new");
  expect(cache.get("c.md", 1)).toBe("gamma");
});
