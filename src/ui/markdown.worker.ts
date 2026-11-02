import { renderMarkdown } from "../core/markdown";

self.onmessage = (event: MessageEvent<{ id: number; source: string }>) => {
  const { id, source } = event.data;
  try {
    self.postMessage({ id, html: renderMarkdown(source) });
  } catch {
    self.postMessage({ id, html: "<p>Preview could not be rendered.</p>" });
  }
};
