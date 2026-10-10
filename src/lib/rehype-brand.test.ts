// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import rehypeBrand from "./rehype-brand.mjs";

const text = (value: string) => ({ type: "text", value });
const el = (tagName: string, children: unknown[], properties: Record<string, unknown> = {}) => ({
  type: "element",
  tagName,
  properties,
  children,
});

describe("rehypeBrand", () => {
  it("wraps the product name in running text and marks code translate=no", () => {
    const tree = { type: "root", children: [el("p", [text("Run tavrn, tavrn-node and tavrn.")]), el("pre", [el("code", [text("tavrn")])])] };
    rehypeBrand()(tree);
    const p = tree.children[0] as any;
    const spans = p.children.filter((c: any) => c.type === "element");
    expect(spans).toHaveLength(3);
    expect(spans.every((s: any) => s.properties.translate === "no")).toBe(true);
    const pre = tree.children[1] as any;
    expect(pre.properties.translate).toBe("no");
    expect(pre.children[0].properties.translate).toBe("no");
    expect(pre.children[0].children).toEqual([text("tavrn")]);
  });
});
