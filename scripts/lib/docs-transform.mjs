// SPDX-License-Identifier: Apache-2.0
/**
 * The Markdown transformer of the docs sync (scripts/sync-docs.mjs): pure functions without file access, so the
 * Vitest suite (scripts/lib/docs-transform.test.ts) runs them on fixtures and the output stays deterministic.
 *
 * A source document becomes one or more Starlight pages:
 *   1. planDocument() reads the headings (outside code), takes the first H1 as the title, optionally splits the
 *      document at its H2 headings, and records where every heading anchor of the source ends up (page + id).
 *   2. The anchor maps of all documents form the registry (sync-docs.mjs), so links between synced files, also
 *      into the middle of a split document, become site routes.
 *   3. renderPage() writes the frontmatter and the body: GitHub-only markup removed, alerts as asides, links
 *      rewritten, headings starting at H2, every code block with a language.
 * The parser is line based and fence aware; it only touches what it understands and leaves the rest as it is.
 */
import { posix } from "node:path";
import { mermaidHtml } from "../../src/lib/mermaid.mjs";

const FENCE = /^(\s*)(`{3,}|~{3,})(.*)$/;
const HEADING = /^(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;
const ALERT = /^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i;
const BADGE_HOSTS = /^(https?:)?\/\/(img\.shields\.io|badgen\.net|badge\.fury\.io|codecov\.io|github\.com\/[^)\s]*\/badge\.svg|[^/)\s]*\/badges?\/)/i;

// ---------------------------------------------------------------------------------------------------------------
// Slugs (the same algorithm as github-slugger, which both GitHub and Astro's heading ids use)

/** The slug of one heading text (already plain text). */
export function githubSlug(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replace(/ /g, "-");
}

/** A slugger with github-slugger's de-duplication ("intro", "intro-1", "intro-2"). */
export function createSlugger() {
  /** @type {Map<string, number>} */
  const occurrences = new Map();
  return (/** @type {string} */ text) => {
    const original = githubSlug(text);
    let result = original;
    while (occurrences.has(result)) {
      const n = (occurrences.get(original) ?? 0) + 1;
      occurrences.set(original, n);
      result = `${original}-${n}`;
    }
    occurrences.set(result, 0);
    return result;
  };
}

/** Markdown inline text -> plain text (links and images to their text, code and emphasis markers removed). */
export function plainText(markdown) {
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/`+([^`]*)`+/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[^\w*])\*([^*\s][^*]*)\*/g, "$1$2")
    .replace(/\\([\\`*_{}[\]()#+\-.!|<>])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------------------------------------------
// Structure

/**
 * Splits lines into code segments (fenced blocks, fences included) and text segments.
 * @param {string[]} lines
 * @returns {{ type: "code" | "text", lines: string[] }[]}
 */
export function segments(lines) {
  /** @type {{ type: "code" | "text", lines: string[] }[]} */
  const out = [];
  /** @type {{ type: "code" | "text", lines: string[] } | null} */
  let current = null;
  /** @type {{ char: string, length: number } | null} */
  let fence = null;
  for (const line of lines) {
    if (fence && current) {
      current.lines.push(line);
      const m = FENCE.exec(line);
      if (m && m[2]?.[0] === fence.char && m[2].length >= fence.length && (m[3] ?? "").trim() === "") {
        fence = null;
        current = null;
      }
      continue;
    }
    const m = FENCE.exec(line);
    if (m && !(m[2]?.[0] === "`" && (m[3] ?? "").includes("`"))) {
      fence = { char: m[2]?.[0] ?? "`", length: m[2]?.length ?? 3 };
      current = { type: "code", lines: [line] };
      out.push(current);
      continue;
    }
    if (!current || current.type !== "text") {
      current = { type: "text", lines: [] };
      out.push(current);
    }
    current.lines.push(line);
  }
  return out;
}

/**
 * Every heading outside code: its line index, level and plain text.
 * @param {string[]} lines
 */
export function headings(lines) {
  /** @type {{ index: number, level: number, text: string, raw: string }[]} */
  const found = [];
  let index = 0;
  for (const segment of segments(lines)) {
    if (segment.type === "text") {
      segment.lines.forEach((line, i) => {
        const m = HEADING.exec(line);
        if (m) found.push({ index: index + i, level: m[1]?.length ?? 1, text: plainText(m[2] ?? ""), raw: m[2] ?? "" });
      });
    }
    index += segment.lines.length;
  }
  return found;
}

/** Removes leading and trailing blank lines. */
function trimBlank(/** @type {string[]} */ lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]?.trim() === "") start++;
  while (end > start && lines[end - 1]?.trim() === "") end--;
  return lines.slice(start, end);
}

/**
 * The first paragraph of a body as plain text, cut to at most `max` characters at a sentence end where possible.
 * @param {string[]} lines
 */
export function firstParagraph(lines, max = 200) {
  const blockStart = /^(\s*$|#|>|\||\s*[-*+]\s|\s*\d+[.)]\s|<|:::|\s{4})/;
  for (const segment of segments(lines)) {
    if (segment.type !== "text") continue;
    // A paragraph starts after a blank line or a heading; continuation lines of lists and tables do not count.
    let boundary = true;
    for (let i = 0; i < segment.lines.length; i++) {
      const line = segment.lines[i] ?? "";
      const atBoundary = boundary;
      boundary = line.trim() === "" || HEADING.test(line);
      if (!atBoundary || blockStart.test(line) || line.trim() === "---") continue;
      const paragraph = [];
      for (let j = i; j < segment.lines.length && (segment.lines[j] ?? "").trim() !== ""; j++) paragraph.push(segment.lines[j]);
      const text = plainText(paragraph.join(" "));
      // Lead-ins ("What the compose file does:"), status or license notes and badge rows do not describe a page.
      if (/:$/.test(text) || /^(License|Status):/i.test(text) || /^\s*\[?!\[/.test(paragraph[0] ?? "")) continue;
      return shorten(text, max);
    }
  }
  return "";
}

/** Cuts text at the last sentence end within max characters, or at a word boundary with an ellipsis. */
export function shorten(/** @type {string} */ text, max = 200) {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const sentence = Math.max(head.lastIndexOf(". "), head.lastIndexOf("? "), head.lastIndexOf("! "));
  if (sentence > max * 0.4) return head.slice(0, sentence + 1);
  return `${head.slice(0, head.lastIndexOf(" ")).replace(/[,;:(]$/, "")}…`;
}

// ---------------------------------------------------------------------------------------------------------------
// Planning: title, pages, anchors

/**
 * @typedef {{ slug: string, label?: string, description?: string, title?: string }} SectionConfig
 * @typedef {{
 *   repo: string, path: string, slug?: string, label?: string, order?: number, title?: string, description?: string,
 *   license?: string, keepTitle?: boolean,
 *   split?: { prefix: string, order: number, step?: number, drop?: string[], intro?: string,
 *             sections?: Record<string, SectionConfig> },
 *   replacements?: [string, string][],
 * }} DocConfig
 * @typedef {{ slug: string, title: string, label: string, order: number, description: string, lines: string[],
 *             shift: number }} PlannedPage
 * @typedef {{ route: string, id: string | null }} AnchorTarget
 * @typedef {{ title: string, pages: PlannedPage[], anchors: Map<string, AnchorTarget>, warnings: string[] }} Plan
 */

/** The site route of a slug ("docs/admins/x" -> "/docs/admins/x/"). */
export function route(/** @type {string} */ slug) {
  return `/${slug.replace(/^\/+|\/+$/g, "")}/`;
}

/**
 * Applies the configured literal replacements; a replacement that no longer matches is reported, not fatal.
 * @param {string} markdown @param {[string, string][]} replacements @param {string[]} warnings
 */
export function applyReplacements(markdown, replacements, warnings) {
  let out = markdown;
  for (const [from, to] of replacements) {
    if (!out.includes(from)) warnings.push(`replacement no longer matches: ${JSON.stringify(from.slice(0, 60))}`);
    out = out.split(from).join(to);
  }
  return out;
}

/**
 * Reads a document and decides its pages.
 * @param {string} markdown @param {DocConfig} doc @returns {Plan}
 */
export function planDocument(markdown, doc) {
  /** @type {string[]} */
  const warnings = [];
  const text = applyReplacements(markdown.replace(/\r\n?/g, "\n"), doc.replacements ?? [], warnings);
  const lines = text.split("\n");
  const all = headings(lines);
  const h1 = all.find((h) => h.level === 1);
  const title = doc.title ?? (h1 ? h1.text : posix.basename(doc.path, posix.extname(doc.path)));

  // GitHub's anchors: one slugger over the whole document, the H1 included.
  const githubSlugger = createSlugger();
  const githubIds = new Map(all.map((h) => [h.index, githubSlugger(h.text)]));

  // The body without the title line.
  const body = lines.map((line, i) => (h1 && i === h1.index && !doc.keepTitle ? null : line));
  /** @type {Map<string, AnchorTarget>} */
  const anchors = new Map();
  /** @type {PlannedPage[]} */
  const pages = [];

  if (!doc.split) {
    const slug = doc.slug ?? "";
    const kept = /** @type {string[]} */ (body.filter((l) => l !== null));
    const rest = all.filter((h) => !(h1 && h.index === h1.index && !doc.keepTitle));
    // Headings start at H2: a body that still has an H1 is shifted down by one level.
    const shift = !doc.keepTitle && rest.some((h) => h.level === 1) ? 1 : 0;
    const pageSlugger = createSlugger();
    for (const h of rest) anchors.set(githubIds.get(h.index) ?? "", { route: route(slug), id: pageSlugger(h.text) });
    if (h1 && !doc.keepTitle) anchors.set(githubIds.get(h1.index) ?? "", { route: route(slug), id: null });
    pages.push({
      slug,
      title,
      label: doc.label ?? title,
      order: doc.order ?? 0,
      description: doc.description ?? firstParagraph(kept),
      lines: trimBlank(kept),
      shift,
    });
    return { title, pages, anchors, warnings };
  }

  // Split at every H2: the part before the first H2 is the intro.
  const split = doc.split;
  const h2s = all.filter((h) => h.level === 2);
  const drop = new Set(split.drop ?? []);
  const step = split.step ?? 10;
  const introEnd = h2s[0]?.index ?? lines.length;
  const intro = trimBlank(/** @type {string[]} */ (body.slice(0, introEnd).filter((l) => l !== null)));
  /** @type {{ heading: typeof all[number], id: string, lines: string[] }[]} */
  const sections = h2s.map((h, n) => ({
    heading: h,
    id: githubIds.get(h.index) ?? "",
    lines: lines.slice(h.index + 1, h2s[n + 1]?.index ?? lines.length),
  }));
  for (const id of drop) if (!sections.some((s) => s.id === id)) warnings.push(`section to drop not found: #${id}`);
  if (split.intro && split.intro !== "drop" && !sections.some((s) => s.id === split.intro)) {
    warnings.push(`section for the intro not found: #${split.intro}`);
  }
  for (const id of Object.keys(split.sections ?? {})) {
    if (!sections.some((s) => s.id === id)) warnings.push(`configured section not found: #${id}`);
  }

  let n = 0;
  for (const section of sections) {
    if (drop.has(section.id)) continue;
    const config = split.sections?.[section.id];
    const slug = `${split.prefix}/${config?.slug ?? section.id}`;
    const sectionTitle = config?.title ?? section.heading.text;
    const withIntro = split.intro === section.id ? [...intro, "", ...trimBlank(section.lines)] : section.lines;
    const pageRoute = route(slug);
    anchors.set(section.id, { route: pageRoute, id: null });
    const pageSlugger = createSlugger();
    for (const h of all) {
      if (h.index <= section.heading.index || h.index >= section.heading.index + 1 + section.lines.length) continue;
      anchors.set(githubIds.get(h.index) ?? "", { route: pageRoute, id: pageSlugger(h.text) });
    }
    pages.push({
      slug,
      title: sectionTitle,
      label: config?.label ?? sectionTitle,
      order: split.order + n * step,
      description: config?.description ?? (firstParagraph(section.lines) || `${sectionTitle}: from ${title}.`),
      lines: trimBlank(withIntro),
      shift: -1,
    });
    n++;
  }
  // The intro's own anchors and the title point at the first page.
  const first = pages[0];
  if (first && h1) anchors.set(githubIds.get(h1.index) ?? "", { route: route(first.slug), id: null });
  for (const id of drop) {
    const target = first ? route(first.slug) : "/";
    anchors.set(id, { route: target, id: null });
  }
  return { title, pages, anchors, warnings };
}

// ---------------------------------------------------------------------------------------------------------------
// Links

/**
 * @typedef {{ route: string, anchors?: Map<string, AnchorTarget> }} RegistryEntry
 * @typedef {{
 *   repo: string, path: string, pageRoute: string, registry: Map<string, RegistryEntry>, github: string,
 *   isDirectory: (repo: string, path: string) => boolean, warnings: string[],
 * }} LinkContext
 */

/** The registry key of a file. */
export function fileKey(/** @type {string} */ repo, /** @type {string} */ path) {
  return `${repo}:${path.replace(/^\.?\/+/, "").replace(/\/+$/, "")}`;
}

/** {repo, path} of a GitHub file URL of the organization, or null. */
export function parseGithubUrl(/** @type {string} */ url, /** @type {string} */ github) {
  const base = github.replace(/\/+$/, "");
  if (!url.startsWith(`${base}/`)) return null;
  const m = /^([^/]+)\/(?:blob|tree|edit|raw)\/[^/]+\/(.+)$/.exec(url.slice(base.length + 1));
  return m ? { repo: m[1] ?? "", path: (m[2] ?? "").replace(/\/+$/, "") } : null;
}

/** A link to a registry entry, with the fragment mapped through its anchors. */
function linkTo(/** @type {RegistryEntry} */ entry, /** @type {string | null} */ fragment, /** @type {LinkContext} */ ctx) {
  let target = entry.route;
  /** @type {string | null} */
  let id = null;
  if (fragment) {
    const anchor = entry.anchors?.get(fragment.toLowerCase());
    if (anchor) {
      target = anchor.route;
      id = anchor.id;
    } else if (entry.anchors) {
      ctx.warnings.push(`unknown anchor #${fragment} (link kept without it) in ${ctx.repo}/${ctx.path}`);
    } else {
      id = fragment;
    }
  }
  if (target === ctx.pageRoute) return id ? `#${id}` : "#_top";
  return id ? `${target}#${id}` : target;
}

/**
 * Rewrites one link target: synced files (relative or as GitHub URLs) become site routes, other files of the
 * source repository become GitHub URLs, everything else stays.
 * @param {string} href @param {LinkContext} ctx
 */
export function resolveHref(href, ctx) {
  const hashAt = href.indexOf("#");
  const path = hashAt >= 0 ? href.slice(0, hashAt) : href;
  const fragment = hashAt >= 0 ? href.slice(hashAt + 1) : null;
  if (path === "") {
    const own = ctx.registry.get(fileKey(ctx.repo, ctx.path));
    return own && fragment ? linkTo(own, fragment, ctx) : href;
  }
  const gh = parseGithubUrl(path, ctx.github);
  if (gh) {
    const entry = ctx.registry.get(fileKey(gh.repo, gh.path));
    return entry ? linkTo(entry, fragment, ctx) : href;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("//")) return href;
  let decoded = path;
  try {
    decoded = decodeURI(path);
  } catch {
    // keep it as written
  }
  const target = decoded.startsWith("/")
    ? posix.normalize(decoded.slice(1))
    : posix.normalize(posix.join(posix.dirname(ctx.path), decoded));
  if (target.startsWith("..")) return `${ctx.github}`;
  const clean = target === "." || target === "./" ? "" : target.replace(/\/+$/, "");
  const entry = ctx.registry.get(fileKey(ctx.repo, clean));
  if (entry) return linkTo(entry, fragment, ctx);
  if (!clean) return `${ctx.github}/${ctx.repo}`;
  const kind = ctx.isDirectory(ctx.repo, clean) ? "tree" : "blob";
  return `${ctx.github}/${ctx.repo}/${kind}/main/${encodeURI(clean)}${fragment ? `#${fragment}` : ""}`;
}

const LINK =
  /(!?)\[((?:\\.|[^[\]\\]|\[(?:\\.|[^[\]\\])*\])*)\]\(\s*(<[^<>\n]*>|(?:[^\s()\\]|\\.|\((?:[^\s()\\]|\\.)*\))*)((?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?)\s*\)/g;

/** Replaces code spans by placeholders, so links around code text still match and code is never touched. */
function protectCode(/** @type {string} */ text) {
  /** @type {string[]} */
  const spans = [];
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "`") {
      out += text[i];
      i++;
      continue;
    }
    let j = i;
    while (text[j] === "`") j++;
    const run = text.slice(i, j);
    let k = j;
    let close = -1;
    while (k < text.length) {
      const at = text.indexOf(run, k);
      if (at < 0) break;
      let end = at;
      while (text[end] === "`") end++;
      if (end - at === run.length) {
        close = at;
        break;
      }
      k = end;
    }
    if (close < 0) {
      out += run;
      i = j;
      continue;
    }
    spans.push(text.slice(i, close + run.length));
    out += `${spans.length - 1}`;
    i = close + run.length;
  }
  return { text: out, restore: (/** @type {string} */ s) => s.replace(/(\d+)/g, (_, n) => spans[Number(n)] ?? "") };
}

/** True for badge images (shields.io and the like). */
export function isBadge(/** @type {string} */ src) {
  return BADGE_HOSTS.test(src.replace(/^<|>$/g, ""));
}

/**
 * Rewrites the links and images of one text segment (code spans untouched).
 * @param {string} text @param {LinkContext} ctx
 */
export function rewriteLinks(text, ctx) {
  const { text: safe, restore } = protectCode(text);
  const rewrite = (/** @type {string} */ s) =>
    s.replace(LINK, (_whole, bang, label, rawUrl, title) => {
      const url = String(rawUrl).replace(/^<|>$/g, "");
      if (bang) {
        if (isBadge(url)) return "";
        // Images are not copied, and the site loads nothing from elsewhere: the image becomes a link to it.
        return `[${label || "Image"}](${resolveHref(url, ctx)})`;
      }
      const inner = rewrite(String(label)).trim();
      if (inner === "") return "";
      return `[${inner}](${resolveHref(url, ctx)}${title ?? ""})`;
    });
  let out = rewrite(safe);
  // Placeholders such as <prefix> outside code are text, not HTML (GitHub drops them, a browser hides them).
  out = out.replace(/<(?!\/?(?:a|abbr|b|br|code|dd|del|details|div|dl|dt|em|figcaption|figure|h[1-6]|hr|i|img|ins|kbd|li|mark|ol|p|picture|pre|q|s|samp|small|source|span|strong|sub|summary|sup|table|tbody|td|tfoot|th|thead|tr|u|ul|video)\b)([a-z][^<>\n]*)>/gi, (whole, inner) =>
    /:\/\/|@/.test(inner) ? whole : `&lt;${inner}&gt;`,
  );
  // Raw HTML links and badge images.
  out = out
    .replace(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi, (tag, src) => (isBadge(src) ? "" : tag))
    .replace(/(<a\b[^>]*?\bhref=)(["'])(.*?)\2/gi, (_, start, quote, href) => `${start}${quote}${resolveHref(href, ctx)}${quote}`);
  return restore(out);
}

// ---------------------------------------------------------------------------------------------------------------
// Rendering

const ASIDES = /** @type {Record<string, [string, string | null]>} */ ({
  NOTE: ["note", null],
  TIP: ["tip", null],
  IMPORTANT: ["note", "Important"],
  WARNING: ["caution", null],
  CAUTION: ["danger", null],
});

/** GitHub alerts (`> [!NOTE]`) -> Starlight asides (`:::note`). */
export function convertAlerts(/** @type {string[]} */ lines) {
  /** @type {string[]} */
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = ALERT.exec(lines[i] ?? "");
    if (!m) {
      out.push(lines[i] ?? "");
      continue;
    }
    const [type, title] = ASIDES[(m[1] ?? "NOTE").toUpperCase()] ?? ["note", null];
    out.push(title ? `:::${type}[${title}]` : `:::${type}`);
    if (m[2]) out.push(m[2]);
    while (i + 1 < lines.length && /^>/.test(lines[i + 1] ?? "")) {
      i++;
      out.push((lines[i] ?? "").replace(/^>\s?/, ""));
    }
    out.push(":::");
  }
  return out;
}

/**
 * Task list items (`- [ ] text`) become plain list items with a ballot box: the checkboxes GitHub draws are
 * disabled form fields without a label, which assistive technology announces as unlabeled controls.
 */
export function plainTaskLists(/** @type {string} */ line) {
  return line.replace(/^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]\s+/, (_, bullet, mark) => `${bullet}${mark === " " ? "☐" : "☑"} `);
}

/** Drops GitHub-only blocks: `<p align>` / `<div align>` headers, `<picture>`, HTML comments. */
export function stripGithubOnly(/** @type {string[]} */ lines) {
  /** @type {string[]} */
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const block = /^\s*<(p|div)\b[^>]*\balign=/i.exec(line);
    if (block) {
      const close = new RegExp(`</${block[1]}>`, "i");
      while (i < lines.length && !close.test(lines[i] ?? "")) i++;
      continue;
    }
    if (/^\s*<!--/.test(line)) {
      while (i < lines.length && !/-->/.test(lines[i] ?? "")) i++;
      continue;
    }
    out.push(line);
  }
  return out;
}

/** Languages the site's highlighter does not know: shown as text, with the language as the frame title. */
const UNHIGHLIGHTED = /** @type {Record<string, string>} */ ({ caddyfile: "Caddyfile", dns: "DNS records" });

/** Every fence gets a language (`text` when it has none). */
export function labelFence(/** @type {string} */ line) {
  const m = FENCE.exec(line);
  if (!m) return line;
  const info = (m[3] ?? "").trim();
  if (info === "") return `${m[1]}${m[2]}text`;
  const [language = "", ...meta] = info.split(/\s+/);
  const title = UNHIGHLIGHTED[language.toLowerCase()];
  if (title) return `${m[1]}${m[2]}text ${meta.length > 0 ? meta.join(" ") : `title="${title}"`}`;
  return line;
}

/**
 * The source of a ```mermaid block (its lines without the fences and the fence's indentation), or null for other
 * code. The page shows it as a diagram (src/lib/mermaid.mjs).
 * @param {string[]} lines
 */
export function mermaidBlock(lines) {
  const m = FENCE.exec(lines[0] ?? "");
  if (!m || !/^mermaid$/i.test((m[3] ?? "").trim().split(/\s+/)[0] ?? "")) return null;
  const indent = (m[1] ?? "").length;
  const last = lines.length > 1 && FENCE.test(lines.at(-1) ?? "") ? -1 : undefined;
  return lines
    .slice(1, last)
    .map((l) => l.slice(Math.min(indent, l.length - l.trimStart().length)))
    .join("\n");
}

/** A YAML double-quoted string. */
function yaml(/** @type {string} */ value) {
  return JSON.stringify(value);
}

/**
 * The full page file (frontmatter and body).
 * @param {PlannedPage} page
 * @param {{ ctx: LinkContext, editUrl: string, sourceUrl: string, source: string, license: string,
 *           keepTitle?: boolean, frontmatter?: "docs" | "page", reworded?: boolean }} options
 */
export function renderPage(page, options) {
  const { ctx } = options;
  /** @type {string[]} */
  const body = [];
  for (const segment of segments(stripGithubOnly(page.lines))) {
    if (segment.type === "code") {
      const diagram = mermaidBlock(segment.lines);
      if (diagram !== null) body.push("", mermaidHtml(diagram), "");
      else body.push(labelFence(segment.lines[0] ?? ""), ...segment.lines.slice(1));
      continue;
    }
    const shifted = segment.lines.map(plainTaskLists).map((line) => {
      const m = HEADING.exec(line);
      if (!m || page.shift === 0) return line;
      const level = Math.min(6, Math.max(options.keepTitle ? 1 : 2, (m[1]?.length ?? 2) + page.shift));
      return `${"#".repeat(level)} ${m[2]}`;
    });
    body.push(...rewriteLinks(convertAlerts(shifted).join("\n"), ctx).split("\n"));
  }
  const adapted = options.reworded ? "its links and a few words were adapted for this site" : "its links were adapted for this site";
  const footer = `*This page is generated from [${options.source}](${options.sourceUrl}) (${options.license}) when the website is built; ${adapted}.*`;
  const fm =
    options.frontmatter === "page"
      ? ["---", `title: ${yaml(page.title)}`, `description: ${yaml(page.description)}`, "---"]
      : [
          "---",
          `# Generated by scripts/sync-docs.mjs from ${options.source}. Do not edit; change the source instead.`,
          `title: ${yaml(page.title)}`,
          `description: ${yaml(page.description)}`,
          `slug: ${page.slug}`,
          `editUrl: ${yaml(options.editUrl)}`,
          "sidebar:",
          `  label: ${yaml(page.label)}`,
          `  order: ${page.order}`,
          "---",
        ];
  return `${[...fm, "", ...trimBlank(body.map((l) => l.replace(/[ \t]+$/, ""))), "", "---", "", footer].join("\n")}\n`;
}
