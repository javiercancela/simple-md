import { useEffect, useRef } from "react";
import type { PreviewAssets } from "./previewAssets";

function elementId(hash: string): string {
  return window.CSS?.escape ? window.CSS.escape(hash) : hash.replace(/[^a-zA-Z0-9_-]/g, "");
}

export function Preview({
  html,
  assets,
  fromRel,
  hash,
  onNavigate,
}: {
  html: string;
  assets: PreviewAssets;
  fromRel: string;
  hash: string;
  onNavigate: (href: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let cancelled = false;
    for (const image of root.querySelectorAll("img[data-local-path]")) {
      const href = image.getAttribute("data-local-path");
      if (!href) continue;
      void assets.read(fromRel, href).then((url) => {
        if (!cancelled && url && image.isConnected) image.setAttribute("src", url);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [html, fromRel, assets]);

  useEffect(() => {
    const root = ref.current;
    if (!root || !hash) return;
    const id = elementId(hash);
    const target = root.querySelector(`#${id}`) ?? root.querySelector(`#user-content-${id}`);
    target?.scrollIntoView({ block: "start" });
  }, [html, hash]);

  return (
    <div
      className="preview"
      data-testid="preview"
      ref={ref}
      onClick={(event) => {
        if (!(event.target instanceof Element)) return;
        const anchor = event.target.closest("a");
        if (!anchor) return;
        event.preventDefault();
        const href = anchor.getAttribute("href");
        if (href) onNavigateRef.current(href);
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
