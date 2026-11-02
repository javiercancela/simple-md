import type { Text } from "@codemirror/state";
import { useEffect, useMemo, useRef, useState } from "react";

// Bound both worker parsing and the HTML inserted into the renderer DOM.
export const MAX_PREVIEW_BYTES = 1_000_000;

export function useMarkdownPreview(source: Text, visible: boolean, revision: number): string {
  const withinLimit = useMemo(
    () =>
      !visible ||
      (source.length <= MAX_PREVIEW_BYTES &&
        new TextEncoder().encode(source.toString()).length <= MAX_PREVIEW_BYTES),
    [source, visible],
  );
  const [html, setHtml] = useState("");
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef<{ id: number; source: string } | null>(null);
  const busyRef = useRef(false);
  const versionRef = useRef(0);

  useEffect(() => {
    if (!visible || !withinLimit) return;
    const worker = new Worker(new URL("./markdown.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<{ id: number; html: string }>) => {
      busyRef.current = false;
      if (event.data.id === versionRef.current) setHtml(event.data.html);
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending) {
        busyRef.current = true;
        worker.postMessage(pending);
      }
    };
    worker.onerror = () => {
      worker.terminate();
      workerRef.current = null;
      busyRef.current = false;
      pendingRef.current = null;
      setHtml("<p>Preview could not be rendered. Switch to Write and reopen Preview to retry.</p>");
    };
    return () => {
      versionRef.current += 1;
      worker.terminate();
      workerRef.current = null;
      busyRef.current = false;
      pendingRef.current = null;
    };
  }, [visible, revision, withinLimit]);

  useEffect(() => {
    const id = ++versionRef.current;
    pendingRef.current = null;
    setHtml("");
    if (!visible) return;
    // UTF-16 length is a cheap lower bound before allocating UTF-8 bytes.
    if (!withinLimit) {
      setHtml("<p>Preview is limited to 1 MB. Use Write mode to edit this document.</p>");
      return;
    }
    const timer = window.setTimeout(() => {
      const worker = workerRef.current;
      if (!worker) {
        setHtml(
          "<p>Preview could not be rendered. Switch to Write and reopen Preview to retry.</p>",
        );
        return;
      }
      const request = { id, source: source.toString() };
      if (busyRef.current) pendingRef.current = request;
      else {
        busyRef.current = true;
        worker.postMessage(request);
      }
    }, 40);
    return () => window.clearTimeout(timer);
  }, [source, visible, revision, withinLimit]);

  return html;
}
