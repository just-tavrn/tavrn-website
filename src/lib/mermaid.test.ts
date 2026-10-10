// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import remarkMermaid, { escapeHtml, mermaidHast, mermaidHtml, mermaidLabel } from "./mermaid.mjs";

/** A minimal hast serializer, enough for the diagram structure. */
function toHtml(node: any): string {
  if (node.type === "text") return escapeHtml(node.value);
  const attrs = Object.entries(node.properties ?? {})
    .map(([k, v]) => {
      const name = k === "className" ? "class" : k === "tabIndex" ? "tabindex" : k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
      const value = Array.isArray(v) ? v.join(" ") : String(v);
      return value === "" ? ` ${name}` : ` ${name}="${escapeHtml(value)}"`;
    })
    .join("");
  return `<${node.tagName}${attrs}>${node.children.map(toHtml).join("")}</${node.tagName}>`;
}

const SOURCE = 'flowchart LR\n  A["Browser <b>&</b> app"] -->|"it\'s HTTPS"| B\n\n  B --> C';

describe("the diagram structure", () => {
  it("names a diagram by its title or its kind", () => {
    expect(mermaidLabel("flowchart LR\n A --> B")).toBe("Diagram: flowchart");
    expect(mermaidLabel("graph TD\n A --> B")).toBe("Diagram: flowchart");
    expect(mermaidLabel("%% a comment\nsequenceDiagram\n A->>B: hi")).toBe("Diagram: sequence diagram");
    expect(mermaidLabel("---\ntitle: How a node is found\n---\nsequenceDiagram\n A->>B: hi")).toBe("Diagram: How a node is found");
    expect(mermaidLabel("flowchart LR\n accTitle: Keys and devices\n A --> B")).toBe("Diagram: Keys and devices");
    expect(mermaidLabel("somethingNew\n A")).toBe("Diagram: diagram");
  });

  it("writes the source twice, escaped, on one line", () => {
    const html = mermaidHtml(SOURCE);
    expect(html).not.toContain("\n");
    expect(html.startsWith('<div class="mermaid-diagram" data-label="Diagram: flowchart" translate="no"><pre class="mermaid" data-source tabindex="0">')).toBe(true);
    expect(html).toContain("A[&quot;Browser &lt;b&gt;&amp;&lt;/b&gt; app&quot;] --&gt;|&quot;it&#39;s HTTPS&quot;| B&#10;&#10;  B --&gt; C</pre>");
    expect(html).toContain('<details><summary>Diagram source</summary><pre class="mermaid-source" tabindex="0">flowchart LR&#10;');
    expect(html.match(/flowchart LR/g)).toHaveLength(2);
    expect(html).not.toMatch(/<b>|"it's/);
  });

  it("builds the same structure as hast and as HTML", () => {
    expect(toHtml(mermaidHast(SOURCE))).toBe(mermaidHtml(SOURCE));
  });
});

describe("remarkMermaid", () => {
  it("turns mermaid fences into the diagram structure and leaves other code alone", () => {
    const code = { type: "code", lang: "ts", value: "let a = 1;" };
    const tree = {
      type: "root",
      children: [
        { type: "code", lang: "mermaid", value: SOURCE },
        { type: "blockquote", children: [{ type: "code", lang: "Mermaid", value: "graph TD\n X --> Y" }] },
        code,
      ],
    };
    remarkMermaid()(tree);
    const [diagram, quote, other] = tree.children as any[];
    const hast = mermaidHast(SOURCE);
    expect(diagram.data).toEqual({ hName: "div", hProperties: hast.properties, hChildren: hast.children });
    expect(quote.children[0].data.hProperties.className).toEqual(["mermaid-diagram"]);
    expect(other).toBe(code);
  });
});
