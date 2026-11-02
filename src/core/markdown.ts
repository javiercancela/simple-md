import type { Schema } from "hast-util-sanitize";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

const codeClass: [string, RegExp] = ["className", /^(hljs|hljs-.+|language-.+)$/];

function schema(): Schema {
  return {
    ...defaultSchema,
    attributes: {
      ...defaultSchema.attributes,
      code: [codeClass],
      span: [codeClass],
      pre: [codeClass],
      img: ["alt", "title", "dataLocalPath"],
    },
    protocols: {
      ...defaultSchema.protocols,
      href: ["http", "https"],
    },
  };
}

type HastLike = {
  type?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastLike[];
};

function isLocalImageRef(src: string): boolean {
  if (!src || src.length > 4096 || src.includes("\0") || src.includes("\\")) return false;
  if (src.startsWith("//") || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(src)) return false;
  return true;
}

function rewriteImages(node: HastLike): void {
  if (node.type === "element" && node.tagName === "img" && node.properties) {
    const src = node.properties.src;
    delete node.properties.src;
    delete node.properties.srcSet;
    if (typeof src === "string" && isLocalImageRef(src)) node.properties.dataLocalPath = src;
  }
  if (node.children) {
    for (const child of node.children) rewriteImages(child);
  }
}

function localImages() {
  return (tree: HastLike) => {
    rewriteImages(tree);
  };
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeSlug)
  .use(rehypeHighlight)
  .use(localImages)
  .use(rehypeSanitize, schema())
  .use(rehypeStringify);

export function renderMarkdown(markdown: string): string {
  return String(processor.processSync(markdown));
}
