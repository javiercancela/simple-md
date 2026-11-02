import { StateField, type Text } from "@codemirror/state";
import { wordCount } from "./docs";

function wordsInRanges(doc: Text, ranges: { from: number; to: number }[]): number {
  let count = 0;
  let end = -1;
  for (const range of ranges) {
    const from = Math.max(end + 1, doc.lineAt(range.from).from);
    const to = doc.lineAt(range.to).to;
    if (from > to) continue;
    const iterator = doc.iterRange(from, to);
    while (!iterator.next().done) {
      if (!iterator.lineBreak) count += wordCount(iterator.value);
    }
    end = to;
  }
  return count;
}

// Recount only affected lines, including the boundary words when lines join/split.
export const editorWordCount = StateField.define<number>({
  create: (state) => wordsInRanges(state.doc, [{ from: 0, to: state.doc.length }]),
  update(count, transaction) {
    if (!transaction.docChanged) return count;
    const before: { from: number; to: number }[] = [];
    const after: { from: number; to: number }[] = [];
    transaction.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
      before.push({ from: fromA, to: toA });
      after.push({ from: fromB, to: toB });
    });
    return (
      count -
      wordsInRanges(transaction.startState.doc, before) +
      wordsInRanges(transaction.newDoc, after)
    );
  },
});
