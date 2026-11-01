import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export type FormatKind = "heading" | "bold" | "italic" | "link" | "list" | "task" | "code";

function dispatchWrap(view: EditorView, before: string, after: string): void {
  view.dispatch(
    view.state.changeByRange((range) => {
      const selected = view.state.sliceDoc(range.from, range.to);
      const wrapped =
        selected.startsWith(before) &&
        selected.endsWith(after) &&
        selected.length >= before.length + after.length;
      if (wrapped) {
        const inner = selected.slice(before.length, selected.length - after.length);
        return {
          changes: { from: range.from, to: range.to, insert: inner },
          range: EditorSelection.range(range.from, range.from + inner.length),
        };
      }
      return {
        changes: { from: range.from, to: range.to, insert: `${before}${selected}${after}` },
        range: selected
          ? EditorSelection.range(
              range.from + before.length,
              range.from + before.length + selected.length,
            )
          : EditorSelection.cursor(range.from + before.length),
      };
    }),
  );
  view.focus();
}

function prefixLines(view: EditorView, prefix: string, pattern: RegExp): void {
  const { state } = view;
  const start = state.doc.lineAt(state.selection.main.from).number;
  const end = state.doc.lineAt(state.selection.main.to).number;
  const present = [];
  for (let number = start; number <= end; number += 1) {
    if (pattern.test(state.doc.line(number).text)) present.push(number);
  }
  const remove = present.length === end - start + 1;
  const changes = [];
  for (let number = start; number <= end; number += 1) {
    const line = state.doc.line(number);
    if (remove) {
      const match = pattern.exec(line.text);
      if (match) changes.push({ from: line.from, to: line.from + match[0].length, insert: "" });
    } else if (!pattern.test(line.text)) {
      changes.push({ from: line.from, to: line.from, insert: prefix });
    }
  }
  if (changes.length > 0) view.dispatch({ changes });
  view.focus();
}

function applyHeading(view: EditorView): void {
  const line = view.state.doc.lineAt(view.state.selection.main.from);
  const match = /^(#{1,6})(\s*)/.exec(line.text);
  let next = line.text;
  if (!match) next = `# ${line.text}`;
  else if ((match[1]?.length ?? 0) >= 3) next = line.text.slice(match[0].length);
  else next = `#${line.text}`;
  view.dispatch({ changes: { from: line.from, to: line.to, insert: next } });
  view.focus();
}

function applyTask(view: EditorView): void {
  const { state } = view;
  const start = state.doc.lineAt(state.selection.main.from).number;
  const end = state.doc.lineAt(state.selection.main.to).number;
  const changes = [];
  for (let number = start; number <= end; number += 1) {
    const line = state.doc.line(number);
    if (/^[-*+]\s+\[[ xX]\]\s+/.test(line.text)) {
      changes.push({
        from: line.from,
        to: line.to,
        insert: line.text.replace(/^[-*+]\s+\[[ xX]\]\s+/, ""),
      });
    } else if (/^[-*+]\s+/.test(line.text)) {
      changes.push({
        from: line.from,
        to: line.to,
        insert: line.text.replace(/^([-*+]\s+)/, "$1[ ] "),
      });
    } else {
      changes.push({ from: line.from, to: line.from, insert: "- [ ] " });
    }
  }
  view.dispatch({ changes });
  view.focus();
}

function applyLink(view: EditorView): void {
  const range = view.state.selection.main;
  const selected = view.state.sliceDoc(range.from, range.to) || "text";
  const insert = `[${selected}](https://)`;
  const urlFrom = range.from + selected.length + 3;
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: EditorSelection.range(urlFrom, urlFrom + "https://".length),
  });
  view.focus();
}

function applyCode(view: EditorView): void {
  const selected = view.state.sliceDoc(
    view.state.selection.main.from,
    view.state.selection.main.to,
  );
  if (selected.includes("\n")) {
    dispatchWrap(view, "```\n", "\n```");
    return;
  }
  dispatchWrap(view, "`", "`");
}

export function applyFormat(view: EditorView, kind: FormatKind): void {
  if (kind === "heading") applyHeading(view);
  else if (kind === "bold") dispatchWrap(view, "**", "**");
  else if (kind === "italic") dispatchWrap(view, "*", "*");
  else if (kind === "link") applyLink(view);
  else if (kind === "list") prefixLines(view, "- ", /^[-*+]\s+/);
  else if (kind === "task") applyTask(view);
  else applyCode(view);
}
