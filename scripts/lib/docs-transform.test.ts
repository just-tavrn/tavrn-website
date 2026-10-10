// SPDX-License-Identifier: Apache-2.0
// The docs sync's Markdown transformer on fixtures (scripts/fixtures/docs/): frontmatter, link rewriting, the split
// at H2, alerts as asides, headings, code fences, and that the output is the same on every run.
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  type DocConfig,
  type RegistryEntry,
  createSlugger,
  fileKey,
  firstParagraph,
  githubSlug,
  labelFence,
  planDocument,
  renderPage,
  rewriteLinks,
  route,
} from "./docs-transform.mjs";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/docs");
const GITHUB = "https://github.com/org";

const DOCS: DocConfig[] = [
  {
    repo: "repo-a",
    path: "docs/GUIDE.md",
    split: { prefix: "docs/guide", order: 10, drop: ["contents"], intro: "install", sections: { usage: { slug: "use", label: "Use it" } } },
  },
  { repo: "repo-a", path: "api/API.md", slug: "docs/api", label: "API", order: 5 },
  { repo: "repo-b", path: "README.md", slug: "docs/b", order: 1, license: "CC-BY-4.0" },
];

/** Plans and renders the fixtures the way scripts/sync-docs.mjs does. */
function sync() {
  const warnings: string[] = [];
  const plans = DOCS.map((doc) => ({ doc, plan: planDocument(readFileSync(join(fixtures, doc.repo, doc.path), "utf8"), doc) }));
  const registry = new Map<string, RegistryEntry>();
  for (const { doc, plan } of plans) registry.set(fileKey(doc.repo, doc.path), { route: route(plan.pages[0]!.slug), anchors: plan.anchors });
  const isDirectory = (repo: string, path: string) => {
    const full = join(fixtures, repo, path);
    return existsSync(full) && statSync(full).isDirectory();
  };
  const pages = new Map<string, string>();
  for (const { doc, plan } of plans) {
    for (const page of plan.pages) {
      const ctx = { repo: doc.repo, path: doc.path, pageRoute: route(page.slug), registry, github: GITHUB, isDirectory, warnings };
      pages.set(
        page.slug,
        renderPage(page, {
          ctx,
          editUrl: `${GITHUB}/${doc.repo}/edit/main/${doc.path}`,
          sourceUrl: `${GITHUB}/${doc.repo}/blob/main/${doc.path}`,
          source: `${doc.repo}/${doc.path}`,
          license: doc.license ?? "Apache-2.0",
        }),
      );
    }
  }
  return { plans, pages, warnings };
}

describe("slugs", () => {
  it("match GitHub's anchors", () => {
    expect(githubSlug("The doctor and other CLI commands")).toBe("the-doctor-and-other-cli-commands");
    expect(githubSlug("Identity domain and node host (delegation)")).toBe("identity-domain-and-node-host-delegation");
    expect(githubSlug("Node.js (libsodium-wrappers)")).toBe("nodejs-libsodium-wrappers");
    expect(githubSlug("Phase 0: Foundation")).toBe("phase-0-foundation");
    expect(githubSlug("5a. Voice frame keys")).toBe("5a-voice-frame-keys");
    expect(githubSlug("Mail languages & templates")).toBe("mail-languages--templates");
  });

  it("number repeated headings like github-slugger", () => {
    const slug = createSlugger();
    expect([slug("Details"), slug("Details"), slug("Details-1"), slug("Details")]).toEqual(["details", "details-1", "details-1-1", "details-2"]);
  });
});

describe("planning", () => {
  it("splits a document at H2 in its order, drops Contents and puts the intro on the configured page", () => {
    const { plans } = sync();
    const guide = plans[0]!.plan;
    expect(guide.title).toBe("The example guide");
    expect(guide.pages.map((p) => [p.slug, p.title, p.label, p.order])).toEqual([
      ["docs/guide/install", "Install", "Install", 10],
      ["docs/guide/use", "Usage", "Use it", 20],
    ]);
    expect(guide.pages[0]!.lines.join("\n")).toContain("Everything about the example");
    expect(guide.pages.some((p) => p.lines.join("\n").includes("1. [Install]"))).toBe(false);
  });

  it("maps every source anchor to its page and the page's own heading id", () => {
    const { anchors } = sync().plans[0]!.plan;
    expect(anchors.get("install")).toEqual({ route: "/docs/guide/install/", id: null });
    expect(anchors.get("details")).toEqual({ route: "/docs/guide/install/", id: "details" });
    // GitHub numbers the second "Details" of the whole document; on its own page it is the first.
    expect(anchors.get("details-1")).toEqual({ route: "/docs/guide/use/", id: "details" });
    expect(anchors.get("options")).toEqual({ route: "/docs/guide/use/", id: "options" });
    expect(anchors.get("contents")).toEqual({ route: "/docs/guide/install/", id: null });
  });

  it("takes the description from the first real paragraph", () => {
    const { plans } = sync();
    expect(plans[0]!.plan.pages[1]!.description).toBe("Use it every day.");
    // "License: …" and lead-ins ending with a colon are skipped.
    expect(plans[1]!.plan.pages[0]!.description).toBe("The API of the example, in two parts. Read the install details first.");
    expect(firstParagraph(["Run the following:", "", "- a list", "", "Then this."])).toBe("Then this.");
  });

  it("reports configured sections and replacements that no longer match", () => {
    const plan = planDocument("# T\n\n## A\n\ntext\n", {
      repo: "r",
      path: "x.md",
      split: { prefix: "docs/x", order: 1, drop: ["gone"], sections: { missing: { slug: "m" } } },
      replacements: [["not there", "x"]],
    });
    expect(plan.warnings).toEqual([
      'replacement no longer matches: "not there"',
      "section to drop not found: #gone",
      "configured section not found: #missing",
    ]);
  });
});

describe("rendering", () => {
  it("writes Starlight frontmatter with the edit link to the source repository", () => {
    const page = sync().pages.get("docs/b")!;
    expect(page.split("\n").slice(0, 11)).toEqual([
      "---",
      "# Generated by scripts/sync-docs.mjs from repo-b/README.md. Do not edit; change the source instead.",
      'title: "Repository B: \\"quotes\\" and colons"',
      'description: "It links to the guide\'s options, to the whole guide, to a missing anchor and to an unsynced file."',
      "slug: docs/b",
      'editUrl: "https://github.com/org/repo-b/edit/main/README.md"',
      "sidebar:",
      '  label: "Repository B: \\"quotes\\" and colons"',
      "  order: 1",
      "---",
      "",
    ]);
    expect(page).toMatch(/\*This page is generated from \[repo-b\/README\.md\]\(https:\/\/github\.com\/org\/repo-b\/blob\/main\/README\.md\) \(CC-BY-4\.0\)/);
  });

  it("removes the title, GitHub-only blocks and badges, and starts headings at H2", () => {
    const { pages } = sync();
    const install = pages.get("docs/guide/install")!;
    expect(install).not.toMatch(/^# The example guide/m);
    expect(install).not.toContain("<p align");
    expect(install).not.toContain("shields.io");
    expect(install).toMatch(/^## Details$/m);
    // A "#" line inside a code block is no heading.
    expect(install).toContain("# a comment, not a heading");
    const use = pages.get("docs/guide/use")!;
    expect(use).not.toContain("build-passing");
    expect(use).toMatch(/^## Options$/m);
    // A document with further H1s is shifted down by one level.
    const api = pages.get("docs/api")!;
    expect(api).toMatch(/^## Part one$/m);
    expect(api).toMatch(/^### Calls$/m);
  });

  it("rewrites links: synced files to routes, others to GitHub, anchors across split pages", () => {
    const { pages, warnings } = sync();
    const install = pages.get("docs/guide/install")!;
    expect(install).toContain("[API reference](/docs/api/)");
    expect(install).toContain("[options](/docs/guide/use/#options)");
    expect(install).toContain("[readme](https://github.com/org/repo-a/blob/main/README.md)");
    expect(install).toContain("[examples](https://github.com/org/repo-a/tree/main/examples)");
    expect(install).toContain('[another site](https://example.org/page "A title")');
    const use = pages.get("docs/guide/use")!;
    expect(use).toContain("[back to the install](/docs/guide/install/)");
    expect(use).toContain("[to `the API`](/docs/api/#part-one)");
    const api = pages.get("docs/api")!;
    expect(api).toContain("[install details](/docs/guide/install/#details)");
    const b = pages.get("docs/b")!;
    expect(b).toContain("[guide's options](/docs/guide/use/#options)");
    expect(b).toContain("[whole guide](/docs/guide/install/)");
    expect(b).toContain("[missing anchor](/docs/api/)");
    expect(b).toContain("[an unsynced file](https://github.com/org/repo-a/blob/main/CHANGELOG.md)");
    // Images are not copied: they become links.
    expect(b).toContain("[A diagram](https://github.com/org/repo-b/blob/main/diagram.png)");
    expect(warnings).toEqual(["unknown anchor #nowhere (link kept without it) in repo-b/README.md"]);
  });

  it("links within the same page by fragment only", () => {
    const registry = new Map<string, RegistryEntry>([
      ["r:x.md", { route: "/docs/x/", anchors: new Map([["a", { route: "/docs/x/", id: "a" }]]) }],
    ]);
    const ctx = { repo: "r", path: "x.md", pageRoute: "/docs/x/", registry, github: GITHUB, isDirectory: () => false, warnings: [] };
    expect(rewriteLinks("[here](#a) and [code `[x](y)`](#a)", ctx)).toBe("[here](#a) and [code `[x](y)`](#a)");
  });

  it("converts GitHub alerts to Starlight asides", () => {
    const { pages } = sync();
    expect(pages.get("docs/guide/install")).toContain(":::caution\nBack up the data first.\n:::");
    expect(pages.get("docs/api")).toContain(":::note\nCalls are signed.\n:::");
  });

  it("turns task lists into plain lists with ballot boxes", () => {
    expect(sync().pages.get("docs/api")).toContain("- ☐ an open task\n- ☑ a done task");
  });

  it("gives every code block a language and keeps code untouched", () => {
    const { pages } = sync();
    const use = pages.get("docs/guide/use")!;
    expect(use).toContain("```text\nno language here");
    // Mermaid blocks become the diagram structure of src/lib/mermaid.mjs, with the source escaped.
    expect(use).toContain(
      '<div class="mermaid-diagram" data-label="Diagram: flowchart" translate="no"><pre class="mermaid" data-source tabindex="0">flowchart LR&#10;  A --&gt; B</pre>',
    );
    expect(use).not.toContain("```mermaid");
    expect(use).toContain("`<kept>`");
    expect(use).toContain("&lt;placeholder&gt;");
    expect(pages.get("docs/api")).toContain('```text title="Caddyfile"');
    expect(labelFence("   ~~~ts")).toBe("   ~~~ts");
  });

  it("is deterministic", () => {
    const first = sync().pages;
    const second = sync().pages;
    expect([...second]).toEqual([...first]);
  });
});
