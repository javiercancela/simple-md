import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { bracketMatching, defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { useEffect, useRef } from "react";

const theme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "#fbf7f0",
    color: "#1c1915",
    fontSize: "15px",
  },
  ".cm-scroller": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    lineHeight: "1.55",
  },
  ".cm-content": { padding: "12px 0" },
  ".cm-gutters": {
    backgroundColor: "#f6f1e8",
    color: "#8d8478",
    border: "none",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-activeLine": { backgroundColor: "rgba(31, 111, 104, 0.07)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent" },
});

export function Editor({
  path,
  text,
  revision,
  onChange,
  onSave,
}: {
  path: string;
  text: string;
  revision: number;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const textRef = useRef(text);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  textRef.current = text;

  useEffect(() => {
    const parent = hostRef.current;
    if (!parent) return;
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: textRef.current,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          history(),
          bracketMatching(),
          markdown(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
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
          theme,
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
    const next = textRef.current;
    const current = view.state.doc.toString();
    if (current === next) return;
    view.dispatch({ changes: { from: 0, to: current.length, insert: next } });
  }, [path, revision]);

  return <div className="editor-host" data-testid="editor" ref={hostRef} />;
}
