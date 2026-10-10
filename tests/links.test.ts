// SPDX-License-Identifier: Apache-2.0
// The link checker of the built site (run `pnpm build` first; `just check` does): every internal href and src of
// every page resolves to a file in dist/, and every fragment to an id on the target page. External links are not
// fetched (the checks run offline).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const built = existsSync(join(dist, "index.html"));

/** Paths the container answers at runtime instead of files in dist/ (deploy/Caddyfile). */
const RUNTIME = new Set(["/app", "/config.json", "/.well-known/tavrn"]);

const pages = built
  ? readdirSync(dist, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".html"))
      .map((e) => join(e.parentPath, e.name).slice(dist.length).split("\\").join("/"))
  : [];

/** The URL path a page is served at (/docs/x/index.html -> /docs/x/). */
function servedAt(page: string): string {
  return page.endsWith("/index.html") ? page.slice(0, -"index.html".length) : page;
}

/** The file in dist/ that answers a path, or null. */
function fileFor(path: string): string | null {
  const candidates = path.endsWith("/") ? [`${path}index.html`] : [path, `${path}/index.html`, `${path}.html`];
  for (const c of candidates) {
    const full = join(dist, c);
    if (existsSync(full) && statSync(full).isFile()) return c;
  }
  return null;
}

const ids = new Map<string, Set<string>>();
function idsOf(file: string): Set<string> {
  let found = ids.get(file);
  if (!found) {
    const html = readFileSync(join(dist, file), "utf8");
    found = new Set([...html.matchAll(/\s(?:id|name)="([^"]+)"/g)].map((m) => m[1]!));
    ids.set(file, found);
  }
  return found;
}

/** Every internal reference of a page: href, src and the URLs of srcset. */
function references(html: string): string[] {
  const refs = [...html.matchAll(/\s(?:href|src)="([^"]*)"/g)].map((m) => m[1]!);
  for (const m of html.matchAll(/\ssrcset="([^"]*)"/g)) refs.push(...m[1]!.split(",").map((s) => s.trim().split(/\s+/)[0]!));
  return refs.filter((r) => r !== "" && !/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(r)).map((r) => r.replace(/&amp;/g, "&"));
}

describe.skipIf(!built)("links of the built site", () => {
  it("has pages to check", () => {
    expect(pages.length).toBeGreaterThan(50);
  });

  it("resolves every internal href and src to a file, and every fragment to an id", () => {
    const broken: string[] = [];
    for (const page of pages) {
      const html = readFileSync(join(dist, page), "utf8");
      for (const ref of new Set(references(html))) {
        const url = new URL(ref, `https://site.invalid${servedAt(page)}`);
        const path = decodeURIComponent(url.pathname);
        if (RUNTIME.has(path.replace(/\/$/, ""))) continue;
        const file = fileFor(path);
        if (!file) {
          broken.push(`${page}: ${ref} (no file)`);
          continue;
        }
        const fragment = decodeURIComponent(url.hash.slice(1));
        if (fragment && file.endsWith(".html") && !idsOf(file).has(fragment)) broken.push(`${page}: ${ref} (no #${fragment})`);
      }
    }
    expect(broken).toEqual([]);
  });
});
