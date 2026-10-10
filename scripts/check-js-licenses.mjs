// SPDX-License-Identifier: Apache-2.0
// Checks the licenses of the production dependencies of the website (`pnpm licenses list --prod`) against the
// allow-list. Only a small part ends up in the built site (Astro's and Starlight's client code, Preact for the
// status island, Pagefind, the Inter font and Lucide's icon paths), but the whole build stays on permissive licenses.
// (A)GPL/LGPL is refused; an unknown license fails until it is verified by hand and recorded in VERIFIED below.
// Usage: node scripts/check-js-licenses.mjs [--table]   (--table prints every direct dependency)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWED = new Set([
  "MIT", "MIT-0", "0BSD", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "MPL-2.0", "Zlib", "CC0-1.0",
  "Unlicense", "BlueOak-1.0.0", "Python-2.0",
  // The Inter typeface (@fontsource-variable/inter), bundled into the site as woff2 files (LICENSE.md, NOTICE).
  "OFL-1.1",
]);
// Packages whose metadata carries no SPDX license, verified against their license file.
const VERIFIED = {
  // Mermaid's colour library: MIT, as its license file says.
  khroma: "MIT",
};
// Single packages allowed with a license outside the list, with the reason. Nothing of them reaches the site.
const EXCEPTIONS = {
  // Browser usage data (attribution licence) read by browserslist inside Babel, which @astrojs/preact's Vite preset
  // runs at build time only.
  "caniuse-lite": "CC-BY-4.0",
  // Mermaid's ELK layout engine: astro.config.mjs replaces the chunk that imports it by a stub (the docs draw with
  // dagre), so it is installed but never bundled.
  elkjs: "EPL-2.0",
};

/** True when the SPDX expression is satisfiable with allowed licenses (OR: one side, AND: both sides). */
function allowed(expr) {
  const clean = expr.replace(/[()]/g, " ").trim();
  return clean.split(/\s+OR\s+/).some((alt) => alt.split(/\s+AND\s+/).every((l) => ALLOWED.has(l.trim())));
}

const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const out = execFileSync("pnpm", ["licenses", "list", "--prod", "--json"], { cwd: root, encoding: "utf8" });
const byLicense = JSON.parse(out || "{}");
const direct = new Set(Object.keys(manifest.dependencies ?? {}));
const table = process.argv.includes("--table");
let failures = 0;
let count = 0;
for (const [license, entries] of Object.entries(byLicense)) {
  for (const e of entries) {
    count++;
    const effective = license === "Unknown" ? (VERIFIED[e.name] ?? "Unknown") : license;
    if (!allowed(effective) && EXCEPTIONS[e.name] !== effective) {
      failures++;
      console.error(`${e.name}@${e.versions.join(",")} has license '${license}', not allowed`);
    }
    if (table && direct.has(e.name)) console.log(`| ${e.name} | ${e.versions.join(", ")} | ${effective} |`);
  }
}
if (failures > 0) {
  console.error(`JS license check failed: ${failures} dependencies with licenses outside the allow-list`);
  process.exit(1);
}
if (!table) console.log(`${manifest.name} (${manifest.license}): ${count} production dependencies checked\nJS licenses ok`);
