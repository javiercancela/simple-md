import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../../src/core/markdown";

const source = `# Title

~~gone~~

| a | b |
| - | - |
| 1 | 2 |

- [x] done
- [ ] todo

\`\`\`js
const x = 1
\`\`\`

<script>alert(1)</script>

<img src="x.png" onerror="alert(1)">

[js](javascript:alert(1))

[other](./notes/other.md)

![pic](./images/pic.png)
`;

describe("renderMarkdown", () => {
  const html = renderMarkdown(source);

  it("renders GFM tables, tasks, strikethrough, and highlighted code", () => {
    expect(html).toContain("<table");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("checked");
    expect(html).toContain("<del>");
    expect(html).toMatch(/class="[^"]*hljs/);
  });

  it("keeps relative markdown links and local image paths", () => {
    expect(html).toContain('href="./notes/other.md"');
    expect(html).toContain('data-local-path="./images/pic.png"');
    expect(html).not.toMatch(/<img\b[^>]*\ssrc=/);
  });

  it("does not emit executable markup", () => {
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("javascript:");
    expect(html).not.toMatch(/<img\b[^>]*\sonerror=/i);
    expect(html).not.toMatch(/\son\w+=/i);
  });
});
