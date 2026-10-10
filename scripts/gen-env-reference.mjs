#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/**
 * The configuration reference of the wiki (/docs/admins/configuration-reference/), generated from the node's
 * deploy/.env.example (sources/tavrn-node): one table per section with every variable, its value in the example
 * file and the comment that explains it, and an anchor per variable (#TAVRN_DOMAIN).
 *
 * How the example file is read:
 *   - `NAME=value  # note` is a variable set in the example; `# NAME=value  # note` (exactly one space after #) a
 *     commented-out one, which shows the built-in default or an example. `#   NAME=value` (more spaces) is part
 *     of a comment, an example inside the explanation.
 *   - The comment lines above a variable (since the previous variable) explain it; the note after it is added. A
 *     comment that ends with a colon ("# Per remote domain and minute:") leads in every following variable of
 *     its block.
 *   - Sections start at configured variables (scripts/docs-sources.mjs, ENV_REFERENCE.sections), or, without a
 *     configuration, at a blank line followed by a short comment line such as "# Node". A section with
 *     `intro: true` shows the comment above its first variable as its introduction instead. A short first line
 *     such as "# Reports (protocol/MODERATION.md §1)" only names the section and is left out.
 * The sync (scripts/sync-docs.mjs) adds the descriptions of the handbook's tables for variables without a comment
 * and links the references to the handbook and the protocol. Alone, this script prints the page for a look:
 *   node scripts/gen-env-reference.mjs [env file]
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ACTIVE = /^([A-Z][A-Z0-9_]*)=(.*)$/;
const COMMENTED = /^# ([A-Z][A-Z0-9_]*)=(.*)$/;

/**
 * @typedef {{ name: string, values: { value: string, commented: boolean }[], leadIn: string[], description: string[],
 *             notes: string[] }} EnvVar
 * @typedef {{ title: string, intro: string[], vars: EnvVar[] }} EnvSection
 * @typedef {{ first: string, title: string, intro?: boolean }} SectionStart
 */

/** Splits `value   # note` into its value and the note. */
function splitNote(/** @type {string} */ rest) {
  const m = /^(.*?)\s+#\s?(.*)$/.exec(rest);
  return m ? { value: (m[1] ?? "").trim(), note: (m[2] ?? "").trim() } : { value: rest.trim(), note: "" };
}

/**
 * A comment line that only names a section: at most five words, plus at most a reference in parentheses
 * ("# Node", "# Rooms and uploads", "# Reports (protocol/MODERATION.md §1)").
 */
export function isHeader(/** @type {string} */ text) {
  const line = text.trim();
  const parenthetical = /\(([^)]*)\)/.exec(line)?.[1];
  if (parenthetical !== undefined && !/\.md|§/.test(parenthetical)) return false;
  const words = line.replace(/\([^)]*\)/g, "").trim().split(/\s+/).filter(Boolean);
  return words.length > 0 && words.length <= 5 && !/[=.:,;]$/.test(line) && !line.includes("=");
}

/**
 * Parses an .env.example file.
 * @param {string} text @param {{ sections?: SectionStart[] }} [options] @returns {EnvSection[]}
 */
export function parseEnvExample(text, options = {}) {
  const starts = new Map((options.sections ?? []).map((s) => [s.first, s]));
  /** @type {EnvSection[]} */
  const sections = [];
  /** @type {Map<string, EnvVar>} */
  const byName = new Map();
  /** @type {string[]} */
  let pending = [];
  /** @type {string[]} */
  let carry = [];
  let blockStart = true;
  /** @type {string | null} */
  let headerTitle = null;
  /** @type {EnvSection | null} */
  let section = null;

  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (line === "") {
      blockStart = true;
      carry = [];
      continue;
    }
    const variable = ACTIVE.exec(line) ?? COMMENTED.exec(line);
    if (!variable) {
      if (!line.startsWith("#")) continue;
      const comment = line.replace(/^#/, "");
      // Without configured sections, a short first comment line of a block names a new section.
      if (blockStart && !options.sections && isHeader(comment)) headerTitle = comment.trim();
      else pending.push(comment);
      blockStart = false;
      carry = [];
      continue;
    }
    blockStart = false;
    const name = variable[1] ?? "";
    const { value, note } = splitNote(variable[2] ?? "");
    const commented = line.startsWith("#");

    // A configured section starts at its first variable; a header line above it only names the section.
    const start = starts.get(name);
    if (start && !byName.has(name)) {
      if (pending.length > 0 && isHeader(pending[0] ?? "")) pending.shift();
      section = { title: start.title, intro: [], vars: [] };
      sections.push(section);
      if (start.intro) {
        section.intro = pending;
        pending = [];
      }
    } else if (headerTitle) {
      section = { title: headerTitle, intro: [], vars: [] };
      sections.push(section);
      headerTitle = null;
    }
    if (!section) {
      section = { title: "General", intro: [], vars: [] };
      sections.push(section);
    }

    // "Per remote domain and minute:" leads in this variable and the next ones of the block.
    /** @type {string[]} */
    let leadIn = [];
    if (pending.length > 0 && /:$/.test((pending.at(-1) ?? "").trim())) {
      leadIn = pending;
      carry = pending;
      pending = [];
    } else if (pending.length === 0) {
      leadIn = carry;
    } else {
      carry = [];
    }

    const existing = byName.get(name);
    if (existing) {
      // The same variable once more (another example): one row with both values.
      existing.values.push({ value, commented });
      existing.description.push(...pending);
      if (note) existing.notes.push(note);
    } else {
      /** @type {EnvVar} */
      const entry = { name, values: [{ value, commented }], leadIn, description: pending, notes: note ? [note] : [] };
      byName.set(name, entry);
      section.vars.push(entry);
    }
    pending = [];
  }
  return sections;
}

// ---------------------------------------------------------------------------------------------------------------
// Rendering

/**
 * @callback Refs Replaces references in comment text ("docs/HANDBOOK.md \"Web push\"", "protocol/VOICE.md") by
 *   links; `hold` protects the inserted Markdown from the escaping that follows.
 * @param {string} text @param {(markdown: string) => string} hold @returns {string}
 */

/**
 * Markdown of a comment text for a table cell: tokens with URLs, addresses, paths or placeholders become code,
 * variable names code (linked when they are in the reference), the rest is escaped.
 * @param {string} text @param {Set<string>} known @param {Refs} [refs]
 */
export function commentToMarkdown(text, known, refs) {
  /** @type {string[]} */
  const kept = [];
  const hold = (/** @type {string} */ markdown) => {
    kept.push(markdown);
    return `\uE000${kept.length - 1}\uE001`;
  };
  let s = text.replace(/`[^`]*`/g, (code) => hold(code.replace(/\|/g, "\\|")));
  if (refs) s = refs(s, hold);
  s = s
    .split(/(\s+)/)
    .map((token) => {
      if (token === "" || /^\s+$/.test(token)) return token;
      const m = /^([("]*)(.*?)([)",.;:]*)$/.exec(token);
      const [lead, core, trail] = [m?.[1] ?? "", m?.[2] ?? token, m?.[3] ?? ""];
      if (/^[A-Z][A-Z0-9_]*[A-Z0-9]$/.test(core) && core.includes("_")) {
        return `${lead}${hold(known.has(core) ? `[\`${core}\`](#${core})` : `\`${core}\``)}${trail}`;
      }
      if (!core.includes("\uE000") && /:\/\/|@|<[^>]*>|^\.{0,2}\/[\w./-]+$|^\/\w/.test(core)) {
        return `${lead}${hold(`\`${core.replace(/\|/g, "\\|")}\``)}${trail}`;
      }
      return token;
    })
    .join("")
    .replace(/[\\*_[\]<>|]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "|": "\\|" })[c] ?? `\\${c}`);
  return s.replace(/\uE000(\d+)\uE001/g, (_, n) => kept[Number(n)] ?? "");
}

/** The comment lines as Markdown: example lines (indented in the comment) as code, the rest as one paragraph. */
function describe(/** @type {string[]} */ lines, /** @type {Set<string>} */ known, /** @type {Refs | undefined} */ refs) {
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  let text = [];
  const flush = () => {
    if (text.length > 0) out.push(commentToMarkdown(text.join(" ").replace(/\s+/g, " ").trim(), known, refs));
    text = [];
  };
  for (const line of lines) {
    if (/^\s{2,}\S/.test(line)) {
      flush();
      out.push(`Example: \`${line.trim().replace(/\|/g, "\\|")}\``);
    } else {
      text.push(line.trim());
    }
  }
  flush();
  return out.filter(Boolean);
}

/**
 * @typedef {{ display?: string, value?: string }} Override
 * @param {EnvSection[]} sections
 * @param {{ title: string, description: string, slug: string, label: string, order: number, editUrl: string,
 *           sourceUrl: string, source: string, license: string, overrides?: Record<string, Override>,
 *           configurationRoute?: string, fallbacks?: Map<string, string>, refs?: Refs }} options
 */
export function renderEnvReference(sections, options) {
  const known = new Set(sections.flatMap((s) => s.vars.map((v) => v.name)));
  const active = sections.flatMap((s) => s.vars).filter((v) => v.values.some((x) => !x.commented)).length;
  const lines = [
    "---",
    `# Generated by scripts/gen-env-reference.mjs from ${options.source}. Do not edit; change the source instead.`,
    `title: ${JSON.stringify(options.title)}`,
    `description: ${JSON.stringify(options.description)}`,
    `slug: ${options.slug}`,
    `editUrl: ${JSON.stringify(options.editUrl)}`,
    "sidebar:",
    `  label: ${JSON.stringify(options.label)}`,
    `  order: ${options.order}`,
    "---",
    "",
    `This page lists all ${known.size} variables of the node's [\`.env.example\`](${options.sourceUrl}), grouped as`,
    `in the file: ${active} are set there, the others are commented out. Copy the file to \`.env\` next to`,
    "`docker-compose.yml` and change what you need; the node checks the whole configuration at start and names",
    "every problem.",
    "",
    "The middle column shows the value in the example file. A line that is commented out there shows the built-in",
    "default or an example: leave it commented out to keep the default.",
  ];
  if (options.configurationRoute) {
    lines.push(
      "",
      `How the configuration is loaded, and what the settings of each area mean, is explained on the [Configuration](${options.configurationRoute}) page.`,
    );
  }
  for (const section of sections) {
    lines.push("", `## ${section.title}`, "");
    const intro = describe(section.intro, known, options.refs);
    if (intro.length > 0) lines.push(...intro.flatMap((p) => [p, ""]));
    lines.push("| Variable | Value in `.env.example` | Description |", "|---|---|---|");
    for (const v of section.vars) {
      const override = options.overrides?.[v.name];
      const value = v.values
        .map(({ value: raw, commented }) => {
          const shown = override?.display
            ? commentToMarkdown(override.display, known)
            : (override?.value ?? raw) === ""
              ? "*empty*"
              : `\`${(override?.value ?? raw).replace(/\|/g, "\\|")}\``;
          return commented ? `${shown} (commented out)` : shown;
        })
        .join(" or ");
      const own = [...describe(v.description, known, options.refs), ...v.notes.map((n) => commentToMarkdown(n, known, options.refs))];
      const fallback = options.fallbacks?.get(v.name);
      const body = own.length > 0 ? own : fallback ? [fallback] : [];
      const leadIn = describe(v.leadIn, known, options.refs).map((t) => (body.length > 0 ? t : t.replace(/:$/, ".")));
      const text = [...leadIn, ...body];
      const description =
        text.length > 0 ? text.join("<br />") : intro.length > 0 ? "See the introduction of this section." : "–";
      lines.push(`| <a id="${v.name}" href="#${v.name}"><code>${v.name}</code></a> | ${value} | ${description} |`);
    }
  }
  lines.push(
    "",
    "---",
    "",
    `*This page is generated from [${options.source}](${options.sourceUrl}) (${options.license}) when the website is built.*`,
  );
  return `${lines.join("\n")}\n`;
}

/**
 * The descriptions of the variable tables of a Markdown document (the handbook's "Configuration"):
 * `| \`NAME\` | default | description |` or `| \`NAME\` | description |`.
 * @param {string} markdown @returns {Map<string, string>}
 */
export function tableDescriptions(markdown) {
  const found = new Map();
  for (const line of markdown.split("\n")) {
    const cells = line
      .trim()
      .replace(/^\||\|$/g, "")
      .split(/(?<!\\)\|/)
      .map((c) => c.trim());
    const name = /^`([A-Z][A-Z0-9_]*)`$/.exec(cells[0] ?? "")?.[1];
    if (!name || cells.length < 2 || found.has(name)) continue;
    const description = cells.at(-1) ?? "";
    if (description && !/^-+$/.test(description)) found.set(name, description);
  }
  return found;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const { ENV_REFERENCE, GITHUB, LICENSES } = await import("./docs-sources.mjs");
  const input = resolve(process.argv[2] ?? join(root, "sources", ENV_REFERENCE.repo, ENV_REFERENCE.path));
  const sections = parseEnvExample(readFileSync(input, "utf8"), { sections: ENV_REFERENCE.sections });
  process.stdout.write(
    renderEnvReference(sections, {
      title: "Configuration reference",
      description: "Every environment variable of a tavrn node.",
      slug: ENV_REFERENCE.slug,
      label: ENV_REFERENCE.label,
      order: 0,
      editUrl: `${GITHUB}/${ENV_REFERENCE.repo}/edit/main/${ENV_REFERENCE.path}`,
      sourceUrl: `${GITHUB}/${ENV_REFERENCE.repo}/blob/main/${ENV_REFERENCE.path}`,
      source: `${ENV_REFERENCE.repo}/${ENV_REFERENCE.path}`,
      license: LICENSES[ENV_REFERENCE.repo] ?? "",
      overrides: ENV_REFERENCE.overrides,
    }),
  );
}
