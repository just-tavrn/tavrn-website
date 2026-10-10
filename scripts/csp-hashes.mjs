#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Collects the SHA-256 hashes of every inline <script> in the built site (dist/) and writes them, space-separated
// in CSP source syntax, to csp-script-hashes.txt next to dist/. The container copies the file to
// /etc/caddy/csp-script-hashes.txt, and the Caddyfile adds its content to script-src. Our own scripts are bundled
// files (vite.build.assetsInlineLimit = 0); the only inline script is Starlight's search shortcut label.
// Usage: node scripts/csp-hashes.mjs [dist] [output]
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(process.argv[2] ?? join(root, "dist"));
const output = resolve(process.argv[3] ?? join(root, "csp-script-hashes.txt"));

/** Every .html file below dir. */
function htmlFiles(dir) {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith(".html"))
    .map((e) => join(e.parentPath ?? e.path, e.name));
}

/** Executable inline scripts of one page (no src, a JavaScript type or none). */
export function inlineScripts(html) {
  const scripts = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1] ?? "";
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1]?.toLowerCase();
    if (type && !["module", "text/javascript", "application/javascript"].includes(type)) continue;
    scripts.push(m[2] ?? "");
  }
  return scripts;
}

export function cspHash(source) {
  return `'sha256-${createHash("sha256").update(source, "utf8").digest("base64")}'`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const hashes = new Set();
  for (const file of htmlFiles(dist)) for (const s of inlineScripts(readFileSync(file, "utf8"))) hashes.add(cspHash(s));
  const list = [...hashes].sort().join(" ");
  // No trailing newline: Caddy inserts the file's content into the header as it is.
  writeFileSync(output, list);
  console.log(`csp-hashes: ${hashes.size} inline script hash(es) -> ${output}`);
}
