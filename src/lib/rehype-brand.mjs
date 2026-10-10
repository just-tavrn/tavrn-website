// SPDX-License-Identifier: Apache-2.0
/**
 * Rehype plugin for Markdown and MDX content (docs, roadmap): machine translation must leave the product name and
 * code alone (plan, "Languages"). Every "tavrn" in running text is wrapped in <span translate="no">, and code
 * elements get translate="no". Text inside code, pre, links' href and existing translate="no" subtrees is kept.
 */
const BRAND = /\btavrn\b/g;
const SKIP = new Set(["code", "pre", "script", "style", "kbd", "samp"]);

/** @param {any} node @param {boolean} inside */
function walk(node, inside) {
  if (!node.children) return;
  const next = [];
  for (const child of node.children) {
    if (child.type === "element") {
      const props = child.properties ?? (child.properties = {});
      if (child.tagName === "code" || child.tagName === "pre") props.translate = "no";
      const skip = inside || SKIP.has(child.tagName) || props.translate === "no";
      walk(child, skip);
      next.push(child);
    } else if (child.type === "text" && !inside && BRAND.test(child.value)) {
      BRAND.lastIndex = 0;
      let last = 0;
      for (const match of child.value.matchAll(BRAND)) {
        const at = match.index ?? 0;
        if (at > last) next.push({ type: "text", value: child.value.slice(last, at) });
        next.push({
          type: "element",
          tagName: "span",
          properties: { translate: "no" },
          children: [{ type: "text", value: match[0] }],
        });
        last = at + match[0].length;
      }
      if (last < child.value.length) next.push({ type: "text", value: child.value.slice(last) });
    } else {
      next.push(child);
    }
  }
  node.children = next;
}

export default function rehypeBrand() {
  return (/** @type {any} */ tree) => walk(tree, false);
}
