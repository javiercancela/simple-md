import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { describe, expect, it } from "vitest";
import { editorWordCount } from "../../src/ui/editorStats";
import { lineDecorations } from "../../src/ui/Editor";
import { wordCount } from "../../src/ui/docs";

function state(doc: string) {
  return EditorState.create({ doc, extensions: [editorWordCount] });
}

describe("incremental word counts", () => {
  it("handles split/joined words, Unicode whitespace, undo-shaped edits and multiple changes", () => {
    let current = state("one two\n\nthree\tfour\n五 六\nemoji 😀");
    let seed = 17;
    const random = (max: number) => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed % max;
    };
    for (let index = 0; index < 500; index++) {
      const a = random(current.doc.length + 1);
      const b = a + random(current.doc.length - a + 1);
      const changes = [
        { from: a, to: b, insert: ["", " ", "\n", "new words", "\u2003café 😀"][random(5)]! },
      ];
      if (a > 0) changes.unshift({ from: 0, to: 0, insert: "prefix " });
      const previous = current.doc.toString();
      current = current.update({ changes }).state;
      expect(
        current.field(editorWordCount),
        JSON.stringify({ previous, changes, next: current.doc.toString() }),
      ).toBe(wordCount(current.doc.toString()));
    }
  });

  it("counts adjacent changed lines, multi-line replacements and long Unicode lines", () => {
    let current = state(`${"word café 五 😀 ".repeat(5000)}\nsecond third\nfourth fifth\nlast`);
    const apply = (changes: { from: number; to?: number; insert: string }[]) => {
      current = current.update({ changes }).state;
      expect(current.field(editorWordCount)).toBe(wordCount(current.doc.toString()));
    };
    apply([
      { from: 5, to: 7, insert: "\njoined" },
      { from: 100, to: 1000, insert: "replacement\n" },
    ]);
    const second = current.doc.line(current.doc.lines - 2);
    const third = current.doc.line(current.doc.lines - 1);
    apply([{ from: second.to, to: third.from, insert: " " }]);
    apply([
      { from: 0, to: 3, insert: "" },
      { from: current.doc.length, insert: " final" },
    ]);
  });

  it("keeps changed-line counting local for large prose documents", () => {
    for (const size of [100_000, 1_000_000, 7_900_000]) {
      let current = state("one two three four\n".repeat(Math.ceil(size / 19)).slice(0, size));
      const start = performance.now();
      for (let index = 0; index < 50; index++) {
        const from = Math.floor(current.doc.length / 2);
        current = current.update({ changes: { from, insert: "x" } }).state;
      }
      console.log(
        `${size} characters: ${((performance.now() - start) / 50).toFixed(3)} ms/edit (text update and word count)`,
      );
      expect(current.field(editorWordCount)).toBe(wordCount(current.doc.toString()));
    }
  });
});

for (const kind of ["fence", "quote"]) {
  it(`decorates only visible lines in a long ${kind}`, () => {
    const body =
      kind === "fence" ? `\`\`\`\n${"code\n".repeat(20_000)}\`\`\`` : "> quote\n".repeat(20_000);
    const current = EditorState.create({
      doc: body,
      extensions: [markdown({ base: markdownLanguage })],
    });
    expect(ensureSyntaxTree(current, current.doc.length, 5000)?.length).toBe(current.doc.length);
    const first = current.doc.line(10_000).from;
    const last = current.doc.line(10_010).to;
    const decorations = lineDecorations({
      state: current,
      visibleRanges: [{ from: first, to: last }],
    });
    expect(decorations.size).toBe(11);
    const cursor = decorations.iter();
    while (cursor.value) {
      expect(cursor.from).toBeGreaterThanOrEqual(first);
      expect(cursor.from).toBeLessThanOrEqual(last);
      cursor.next();
    }
  });
}
