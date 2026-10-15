#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Collects the SHA-256 hashes of every inline <script> in the built site (dist/) and writes them, space-separated
// in CSP source syntax, to csp-script-hashes.txt next to dist/. The container copies the file to
// /etc/caddy/csp-script-hashes.txt, and the Caddyfile adds its content to script-src. Our own scripts are bundled
// files (vite.build.assetsInlineLimit = 0); the only inline script is Starlight's search shortcut label.
// It fails (exit 1) when dist/ holds no page, so a broken build never ships an empty or stale list.
// Usage: node scripts/csp-hashes.mjs [dist] [output]
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Every .html file below dir (none when dir does not exist). */
function htmlFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith(".html"))
    .map((e) => join(e.parentPath ?? e.path, e.name));
}

/** The value of attribute `name` in a start tag's attribute text, or undefined (never a data-<name> attribute). */
function attribute(attrs, name) {
  for (const m of attrs.matchAll(/(?:^|\s)([^\s"'=<>`/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    if (m[1].toLowerCase() === name) return m[2] ?? m[3] ?? m[4] ?? "";
  }
  return undefined;
}

/**
 * Executable inline scripts of one page (no src, a JavaScript type or none), with the text the browser hashes: the
 * HTML parser turns CR LF and lone CR into LF before a script runs.
 */
export function inlineScripts(html) {
  const scripts = [];
  // The start tag's attributes may hold quoted values with ">" in them.
  for (const m of html.matchAll(/<script\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attrs = m[1] ?? "";
    if (attribute(attrs, "src") !== undefined) continue;
    const type = attribute(attrs, "type")?.trim().toLowerCase();
    if (type && !["module", "text/javascript", "application/javascript"].includes(type)) continue;
    scripts.push((m[2] ?? "").replace(/\r\n?/g, "\n"));
  }
  return scripts;
}

export function cspHash(source) {
  return `'sha256-${createHash("sha256").update(source, "utf8").digest("base64")}'`;
}

/** Writes the hash list of every page below dist to output; returns the number of hashes. Throws without pages. */
export function writeHashes(dist, output) {
  const pages = htmlFiles(dist);
  if (pages.length === 0) throw new Error(`csp-hashes: no HTML pages in ${dist} (build the site first)`);
  const hashes = new Set();
  for (const file of pages) for (const s of inlineScripts(readFileSync(file, "utf8"))) hashes.add(cspHash(s));
  // No trailing newline: Caddy inserts the file's content into the header as it is.
  writeFileSync(output, [...hashes].sort().join(" "));
  return hashes.size;
}

// Run as a script (also through a symlink or a relative path, unlike a comparison of import.meta.url with argv[1]).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dist = resolve(process.argv[2] ?? join(root, "dist"));
  const output = resolve(process.argv[3] ?? join(root, "csp-script-hashes.txt"));
  try {
    const n = writeHashes(dist, output);
    console.log(`csp-hashes: ${n} inline script hash(es) -> ${output}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
