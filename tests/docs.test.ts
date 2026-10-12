// SPDX-License-Identifier: Apache-2.0
// Checks of the built wiki (run `pnpm build` first; `just check` does): every docs page has a title, a description
// and one h1, headings in order, alt texts and code languages; the search index is built; nothing private, no
// other products by name and the brand in lowercase. The hand-written pages are checked in their source as well.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const built = existsSync(join(dist, "docs/index.html"));

const docsPages = built
  ? readdirSync(join(dist, "docs"), { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && e.name === "index.html")
      .map((e) => join(e.parentPath, e.name))
  : [];
const name = (file: string) => file.slice(dist.length);
const read = (file: string) => readFileSync(file, "utf8");

/** The Markdown content of a Starlight page (without header, sidebar and footer). */
function content(html: string): string {
  const start = html.indexOf('<div class="sl-markdown-content');
  const end = html.indexOf("<footer", start);
  return start < 0 ? "" : html.slice(start, end < 0 ? undefined : end);
}

/** Visible text without code, scripts and tags. */
function prose(html: string): string {
  return html
    .replace(/<(script|style|pre|code)\b[\s\S]*?<\/\1>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;|&#x?[0-9a-f]+;/gi, " ");
}

/**
 * The private strings of the publication check (scripts/publish-check.sh): PUBLISH_CHECK_PRIVATE, the
 * .publish-check.private files, the owner's list in a sibling tavrn-internal checkout (searched upwards, so a
 * worktree finds it too), and the default node host of deploy/.env.example with its parent domain, unless it is the
 * site's own domain (PUBLIC_SITE_URL, https://tavrn.org) or one of its subdomains.
 */
function privateStrings(): string[] {
  const found = (process.env.PUBLISH_CHECK_PRIVATE ?? "").split(",").map((s) => s.trim());
  const lists = [join(root, ".publish-check.private"), join(root, "../.publish-check.private")];
  for (let dir = root, i = 0; i < 5; i++, dir = dirname(dir)) lists.push(join(dir, "../tavrn-internal/publish-check.private"));
  for (const list of lists) {
    if (existsSync(list)) found.push(...read(list).split("\n").map((l) => l.trim()).filter((l) => !l.startsWith("#")));
  }
  const site = new URL(process.env.PUBLIC_SITE_URL || "https://tavrn.org").hostname;
  const host = /^TAVRN_NODE_URL=https?:\/\/([^/\s#]+)/m.exec(read(join(root, "deploy/.env.example")))?.[1];
  const own = (h: string) => h === site || h.endsWith(`.${site}`);
  if (host) found.push(...[host, host.slice(host.indexOf(".") + 1)].filter((h) => h.includes(".") && !own(h)));
  return [...new Set(found.filter((s) => s.length > 3))];
}

/** Products of others are not named on the site (README.md, "Rules for the content"). */
const OTHER_PRODUCTS = /\b(Discord|Slack|Matrix|WhatsApp|Telegram|TeamSpeak|Mumble|Guilded|Revolt|Zulip|Mattermost|Rocket\.Chat|Skype|Microsoft Teams)\b/;

describe.skipIf(!built)("the built wiki", () => {
  it("has the pages of all three groups", () => {
    const groups = ["users", "admins", "developers"].map((g) => docsPages.filter((p) => name(p).startsWith(`/docs/${g}/`)).length);
    expect(groups[0]).toBeGreaterThanOrEqual(14);
    expect(groups[1]).toBeGreaterThanOrEqual(20);
    expect(groups[2]).toBeGreaterThanOrEqual(20);
  });

  it("gives every page a title, a description and exactly one h1", () => {
    for (const file of docsPages) {
      const html = read(file);
      expect(/<title>[^<]{3,}<\/title>/.test(html), name(file)).toBe(true);
      const description = /<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? "";
      expect(description.length, `${name(file)}: description`).toBeGreaterThan(20);
      expect(html.match(/<h1\b/g)?.length, `${name(file)}: h1`).toBe(1);
    }
  });

  it("starts the headings of every page at h2 and never skips a level", () => {
    const problems: string[] = [];
    for (const file of docsPages) {
      let previous = 1;
      for (const m of content(read(file)).matchAll(/<h([1-6])\b/g)) {
        const level = Number(m[1]);
        if (level === 1 || level > previous + 1) problems.push(`${name(file)}: h${previous} -> h${level}`);
        previous = level;
      }
    }
    expect(problems).toEqual([]);
  });

  it("gives every content image an alt text and every code block a language", () => {
    for (const file of docsPages) {
      const body = content(read(file));
      for (const img of body.match(/<img\b[^>]*>/g) ?? []) expect(img, name(file)).toMatch(/\salt="[^"]+"/);
      // Mermaid diagrams (src/lib/mermaid.mjs) carry their source in <pre class="mermaid"> and <pre class="mermaid-source">.
      const diagrams = body.match(/<div class="mermaid-diagram"[\s\S]*?<\/details><\/div>/g) ?? [];
      for (const d of diagrams) expect(d, name(file)).toMatch(/<pre class="mermaid"[^>]*>[\s\S]+<pre class="mermaid-source"[^>]*>/);
      const rest = diagrams.reduce((html, d) => html.replace(d, ""), body);
      for (const pre of rest.match(/<pre\b[^>]*>/g) ?? []) expect(pre, name(file)).toMatch(/data-language="[^"]+"/);
    }
  });

  it("builds the search index", () => {
    expect(existsSync(join(dist, "pagefind/pagefind.js"))).toBe(true);
    expect(readdirSync(join(dist, "pagefind")).some((f) => f.startsWith("pagefind-entry"))).toBe(true);
  });

  it("has an anchor for every variable of the configuration reference", () => {
    const html = read(join(dist, "docs/admins/configuration-reference/index.html"));
    for (const v of ["TAVRN_DOMAIN", "TAVRN_PUBLIC_URL", "POSTGRES_PASSWORD", "TAVRN_REGISTRATION"]) expect(html).toContain(`id="${v}"`);
  });

  it("names nothing private in the docs and the roadmap", () => {
    const strings = privateStrings();
    expect(strings.length).toBeGreaterThan(0);
    for (const file of [...docsPages, join(dist, "roadmap/index.html")]) {
      const html = read(file);
      for (const s of strings) expect(html.includes(s), `${name(file)} contains a private string`).toBe(false);
    }
  });

  it("names no other chat products in the text of the docs", () => {
    for (const file of docsPages) expect(prose(content(read(file))), name(file)).not.toMatch(OTHER_PRODUCTS);
  });
});

describe("the hand-written docs", () => {
  const sources = readdirSync(join(root, "src/content/docs"), { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.mdx?$/.test(e.name) && !join(e.parentPath, e.name).includes("/synced/"))
    .map((e) => join(e.parentPath, e.name));

  it("write the brand in lowercase and name no other chat products", () => {
    expect(sources.length).toBeGreaterThan(14);
    for (const file of sources) {
      const text = read(file).replace(/```[\s\S]*?```|`[^`\n]*`/g, " ");
      expect(text, file).not.toMatch(/\bTavrn\b|\bTAVRN\b(?!_)/);
      expect(text, file).not.toMatch(OTHER_PRODUCTS);
    }
  });

  it("have a title, a description and a sidebar order", () => {
    for (const file of sources) {
      const frontmatter = /^---\n([\s\S]*?)\n---/.exec(read(file))?.[1] ?? "";
      expect(frontmatter, file).toMatch(/^title: .{3,}$/m);
      expect(frontmatter, file).toMatch(/^description: .{20,}$/m);
      if (!file.endsWith("docs/index.mdx")) expect(frontmatter, file).toMatch(/^ {2}order: \d+$/m);
    }
  });
});
