// SPDX-License-Identifier: Apache-2.0
/**
 * Mermaid diagrams in the docs, at build time. Both ways a diagram reaches a page produce the same structure:
 *   - the docs sync (scripts/lib/docs-transform.mjs) writes mermaidHtml() into the synced Markdown pages, and
 *   - remarkMermaid (astro.config.mjs, next to rehypeBrand) turns ```mermaid fences of hand-written pages into
 *     mermaidHast().
 *
 *   <div class="mermaid-diagram" data-label="Diagram: flowchart" translate="no">
 *     <pre class="mermaid" data-source>…the source…</pre>
 *     <details><summary>Diagram source</summary><pre class="mermaid-source">…the source…</pre></details>
 *   </div>
 *
 * The source <pre>s are focusable (they scroll sideways when long lines do not fit) and have no <code> child, so the code highlighter leaves both paths alike. translate="no": machine
 * translation must not change the source before Mermaid reads it. Without JavaScript,
 * and until the diagram is drawn, the first <pre> shows the source like code. On pages that
 * have a diagram, a small loader (src/components/starlight/MarkdownContent.astro) imports Mermaid lazily and
 * replaces that <pre> by the drawing (src/lib/mermaid-render.ts); the <details> keeps the source for copying and
 * for screen readers.
 */

const TYPES = /** @type {[RegExp, string][]} */ ([
  [/^(flowchart|graph)\b/, "flowchart"],
  [/^sequenceDiagram\b/, "sequence diagram"],
  [/^classDiagram\b/, "class diagram"],
  [/^stateDiagram(-v2)?\b/, "state diagram"],
  [/^erDiagram\b/, "entity relationship diagram"],
  [/^journey\b/, "user journey"],
  [/^gantt\b/, "Gantt chart"],
  [/^pie\b/, "pie chart"],
  [/^mindmap\b/, "mind map"],
  [/^timeline\b/, "timeline"],
  [/^gitGraph\b/, "Git graph"],
]);

/**
 * The accessible name of a diagram: its title (front matter `title:` or `accTitle:`), else its kind.
 * @param {string} source
 */
export function mermaidLabel(source) {
  const frontTitle = /^---\s*\n[\s\S]*?^title:\s*(.+?)\s*$[\s\S]*?^---\s*$/m.exec(source)?.[1];
  const accTitle = /^\s*accTitle\s*:\s*(.+?)\s*$/m.exec(source)?.[1];
  const title = (frontTitle ?? accTitle)?.replace(/^["']|["']$/g, "");
  if (title) return `Diagram: ${title}`;
  const body = source.replace(/^---\s*\n[\s\S]*?\n---\s*\n/, "");
  const first = body.split("\n").map((l) => l.trim()).find((l) => l !== "" && !l.startsWith("%%")) ?? "";
  const kind = TYPES.find(([re]) => re.test(first))?.[1] ?? "diagram";
  return `Diagram: ${kind}`;
}

/** @param {string} tagName @param {Record<string, unknown>} properties @param {any[]} children */
const element = (tagName, properties, children) => ({ type: "element", tagName, properties, children });

/**
 * The diagram as a hast element.
 * @param {string} source
 */
export function mermaidHast(source) {
  const text = source.replace(/\s+$/, "");
  return element("div", { className: ["mermaid-diagram"], dataLabel: mermaidLabel(text), translate: "no" }, [
    element("pre", { className: ["mermaid"], dataSource: "", tabIndex: 0 }, [{ type: "text", value: text }]),
    element("details", {}, [
      element("summary", {}, [{ type: "text", value: "Diagram source" }]),
      element("pre", { className: ["mermaid-source"], tabIndex: 0 }, [{ type: "text", value: text }]),
    ]),
  ]);
}

/** Text for HTML: `&`, `<`, `>` and quotes as entities, line breaks as `&#10;` (the result is one line). */
export function escapeHtml(/** @type {string} */ text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\r?\n/g, "&#10;");
}

/**
 * The diagram as HTML on a single line, so that Markdown keeps it as one HTML block even when the source has
 * blank lines.
 * @param {string} source
 */
export function mermaidHtml(source) {
  const text = source.replace(/\s+$/, "");
  const code = escapeHtml(text);
  return (
    `<div class="mermaid-diagram" data-label="${escapeHtml(mermaidLabel(text))}" translate="no">` +
    `<pre class="mermaid" data-source tabindex="0">${code}</pre>` +
    `<details><summary>Diagram source</summary><pre class="mermaid-source" tabindex="0">${code}</pre></details>` +
    `</div>`
  );
}

/**
 * Remark plugin: ```mermaid fences become the diagram structure (as hast, so it works in .md and .mdx alike and
 * the code highlighter never sees them).
 */
export default function remarkMermaid() {
  /** @param {any} node */
  const visit = (node) => {
    if (!Array.isArray(node.children)) return;
    node.children = node.children.map((/** @type {any} */ child) => {
      if (child.type === "code" && /^mermaid$/i.test(child.lang ?? "")) {
        const hast = mermaidHast(child.value ?? "");
        return {
          type: "paragraph",
          children: [],
          data: { hName: hast.tagName, hProperties: hast.properties, hChildren: hast.children },
          position: child.position,
        };
      }
      visit(child);
      return child;
    });
  };
  return (/** @type {any} */ tree) => visit(tree);
}
