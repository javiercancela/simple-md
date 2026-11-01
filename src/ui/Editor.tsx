import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  bracketMatching,
  HighlightStyle,
  syntaxHighlighting,
  syntaxTree,
} from "@codemirror/language";
import { Compartment, EditorState, RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  keymap,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { tags as highlightTags } from "@lezer/highlight";
import { useEffect, useRef } from "react";
import { applyFormat, type FormatKind } from "./format";

const markdownLook = HighlightStyle.define([
  { tag: highlightTags.heading1, class: "cm-h1" },
  { tag: highlightTags.heading2, class: "cm-h2" },
  { tag: highlightTags.heading3, class: "cm-h3" },
  { tag: highlightTags.heading4, class: "cm-h4" },
  { tag: highlightTags.strong, class: "cm-strong" },
  { tag: highlightTags.emphasis, class: "cm-em" },
  { tag: highlightTags.monospace, class: "cm-mono" },
  { tag: highlightTags.link, class: "cm-link" },
  { tag: highlightTags.url, class: "cm-mark" },
  { tag: highlightTags.processingInstruction, class: "cm-mark" },
]);

const chrome = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "transparent",
    color: "var(--editor-text)",
    fontSize: "15.5px",
  },
  ".cm-scroller": {
    fontFamily: "var(--mono)",
    lineHeight: "1.75",
  },
  ".cm-content": {
    maxWidth: "792px",
    margin: "0 auto",
    padding: "4px 8px 96px",
    caretColor: "var(--accent)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "var(--selection)",
  },
  ".cm-line": { padding: "0 2px" },
});

class TaskWidget extends WidgetType {
  constructor(private readonly checked: boolean) {
    super();
  }

  override eq(other: TaskWidget): boolean {
    return other.checked === this.checked;
  }

  toDOM(): HTMLElement {
    const box = document.createElement("span");
    box.className = this.checked ? "md-task is-done" : "md-task";
    box.setAttribute("role", "checkbox");
    box.setAttribute("aria-checked", this.checked ? "true" : "false");
    return box;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

function taskDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const range of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from: range.from,
      to: range.to,
      enter(node) {
        if (node.name !== "TaskMarker") return;
        const text = view.state.sliceDoc(node.from, node.to);
        builder.add(
          node.from,
          node.to,
          Decoration.replace({ widget: new TaskWidget(/[xX]/.test(text)) }),
        );
      },
    });
  }
  return builder.finish();
}

const taskPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = taskDecorations(view);
    }
    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged)
        this.decorations = taskDecorations(update.view);
    }
  },
  {
    decorations: (value) => value.decorations,
    eventHandlers: {
      mousedown(event, view) {
        const target = event.target;
        if (!(target instanceof HTMLElement) || !target.classList.contains("md-task")) return false;
        const pos = view.posAtDOM(target);
        const text = view.state.sliceDoc(pos, pos + 3);
        if (!/^\[[ xX]\]$/.test(text)) return false;
        view.dispatch({
          changes: { from: pos, to: pos + 3, insert: text[1] === " " ? "[x]" : "[ ]" },
        });
        event.preventDefault();
        return true;
      },
    },
  },
);

function addClass(classes: Map<number, string[]>, pos: number, name: string): void {
  const list = classes.get(pos) ?? [];
  if (!list.includes(name)) list.push(name);
  classes.set(pos, list);
}

function lineDecorations(view: EditorView): DecorationSet {
  const classes = new Map<number, string[]>();
  const { doc } = view.state;
  for (const range of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from: range.from,
      to: range.to,
      enter(node) {
        const name =
          node.name === "Blockquote" ? "cm-quote" : node.name === "FencedCode" ? "cm-fence" : "";
        if (!name) return;
        const start = doc.lineAt(node.from).number;
        const end = doc.lineAt(Math.max(node.from, node.to - 1)).number;
        for (let number = start; number <= end; number += 1) {
          addClass(classes, doc.line(number).from, name);
        }
      },
    });
    let line = doc.lineAt(range.from);
    while (line.from <= range.to) {
      if (/^[-*+]\s+\[[xX]\]\s+/.test(line.text)) addClass(classes, line.from, "cm-task-done");
      if (line.number >= doc.lines) break;
      line = doc.line(line.number + 1);
    }
  }
  const builder = new RangeSetBuilder<Decoration>();
  for (const pos of [...classes.keys()].sort((a, b) => a - b)) {
    builder.add(pos, pos, Decoration.line({ class: classes.get(pos)?.join(" ") ?? "" }));
  }
  return builder.finish();
}

const linePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = lineDecorations(view);
    }
    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged)
        this.decorations = lineDecorations(update.view);
    }
  },
  { decorations: (value) => value.decorations },
);

function paragraphDecorations(view: EditorView): DecorationSet {
  const { doc } = view.state;
  const cursor = doc.lineAt(view.state.selection.main.head);
  let start = cursor.number;
  let end = cursor.number;
  while (start > 1 && doc.line(start - 1).text.trim() !== "") start -= 1;
  while (end < doc.lines && doc.line(end + 1).text.trim() !== "") end += 1;
  const builder = new RangeSetBuilder<Decoration>();
  for (const range of view.visibleRanges) {
    let line = doc.lineAt(range.from);
    while (line.from <= range.to) {
      const live = line.number >= start && line.number <= end;
      builder.add(line.from, line.from, Decoration.line({ class: live ? "cm-live" : "cm-dim" }));
      if (line.number >= doc.lines) break;
      line = doc.line(line.number + 1);
    }
  }
  return builder.finish();
}

const focusPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = paragraphDecorations(view);
    }
    update(update: ViewUpdate): void {
      if (update.docChanged || update.selectionSet || update.viewportChanged)
        this.decorations = paragraphDecorations(update.view);
    }
  },
  { decorations: (value) => value.decorations },
);

export function Editor({
  path,
  text,
  revision,
  focus,
  onChange,
  onSave,
  formatRef,
}: {
  path: string;
  text: string;
  revision: number;
  focus: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  formatRef: { current: (kind: FormatKind) => void };
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const textRef = useRef(text);
  const focusCompartment = useRef(new Compartment());
  const focusRef = useRef(focus);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  textRef.current = text;
  focusRef.current = focus;
  formatRef.current = (kind) => {
    const view = viewRef.current;
    if (view) applyFormat(view, kind);
  };

  useEffect(() => {
    const parent = hostRef.current;
    if (!parent) return;
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: textRef.current,
        extensions: [
          history(),
          bracketMatching(),
          markdown({ base: markdownLanguage }),
          syntaxHighlighting(markdownLook),
          taskPlugin,
          linePlugin,
          focusCompartment.current.of(focusRef.current ? focusPlugin : []),
          keymap.of([
            {
              key: "Mod-s",
              preventDefault: true,
              run: () => {
                onSaveRef.current();
                return true;
              },
            },
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ spellcheck: "true" }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
          chrome,
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [path]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: focusCompartment.current.reconfigure(focus ? focusPlugin : []),
    });
  }, [focus]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const next = textRef.current;
    const current = view.state.doc.toString();
    if (current === next) return;
    view.dispatch({ changes: { from: 0, to: current.length, insert: next } });
  }, [path, revision]);

  return <div className="editor-host" data-testid="editor" ref={hostRef} />;
}
