// SPDX-License-Identifier: Apache-2.0
// Checks of the built site in dist/ (run `pnpm build` first; `just check` does): the JavaScript budget of the
// landing page, the CSP hash list, that pages reference nothing outside the origin, and that only the two legal pages
// carry the template actions Caddy fills in at request time.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { cspHash, inlineScripts } from "../scripts/csp-hashes.mjs";
import { RUNTIME_VARS, type RuntimeVar, runtimeEnv } from "../src/lib/runtime-env";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const built = existsSync(join(dist, "index.html"));
const read = (path: string) => readFileSync(join(dist, path), "utf8");
const pages = built
  ? readdirSync(dist, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".html"))
      .map((e) => join(e.parentPath, e.name).slice(dist.length))
  : [];

/**
 * Every script file a page loads before any interaction: <script src>, modulepreload, the component and renderer of
 * Astro islands, and their static imports.
 */
function scriptGraph(html: string): Set<string> {
  const files = new Set<string>();
  const queue = [
    ...[...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]!),
    ...[...html.matchAll(/<link\b[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g)].map((m) => m[1]!),
    ...[...html.matchAll(/<astro-island\b[^>]*\b(?:component|renderer)-url="([^"]+)"/g)].map((m) => m[1]!),
  ];
  while (queue.length > 0) {
    const src = queue.shift()!;
    if (files.has(src)) continue;
    files.add(src);
    const code = read(src);
    for (const m of code.matchAll(/(?:\bimport|\bfrom)\s*["'](\.{1,2}\/[^"']+\.js)["']/g)) {
      queue.push(new URL(m[1]!, `https://x${src}`).pathname);
    }
  }
  return files;
}

describe.skipIf(!built)("built site", () => {
  it("keeps the landing page's JavaScript under 50 KB gzipped", () => {
    const files = scriptGraph(read("index.html"));
    const total = [...files].reduce((sum, f) => sum + gzipSync(read(f), { level: 9 }).length, 0);
    console.log(`landing JavaScript: ${files.size} files, ${(total / 1024).toFixed(1)} KB gzipped`);
    expect(total).toBeLessThan(50 * 1024);
    // No island framework on the landing page: Preact is for the status page's island only.
    for (const f of files) expect(read(f)).not.toMatch(/react\.production|__SECRET_INTERNALS|react-dom|preact/);
  });

  it("loads the island framework (Preact) on the status and known-issues pages only, under 60 KB gzipped there", () => {
    // Preact's chunks (preact.module, hooks.module, compat.module, signals.module), the island renderer that imports
    // them, and anything still naming React.
    const isFramework = (f: string) =>
      /\/(preact|hooks|compat|signals)\.module\.[\w-]+\.js$/.test(f) || /preact|react\.production|react-dom/.test(read(f));
    const islandPages = ["/status/index.html", "/issues/index.html"];
    for (const page of pages.filter((p) => !islandPages.includes(p))) {
      for (const f of scriptGraph(read(page))) expect(isFramework(f), `${page}: ${f}`).toBe(false);
    }
    for (const page of islandPages) {
      const files = scriptGraph(read(page));
      expect([...files].some(isFramework), page).toBe(true);
      const total = [...files].reduce((sum, f) => sum + gzipSync(read(f), { level: 9 }).length, 0);
      console.log(`${page} JavaScript: ${files.size} files, ${(total / 1024).toFixed(1)} KB gzipped`);
      expect(total, page).toBeLessThan(60 * 1024);
    }
  });

  it("keeps the Status link's live dot small and free of any island framework on every page", () => {
    const pill = [...scriptGraph(read("index.html"))].filter((f) => /StatusDot|node-status/.test(f));
    expect(pill.length).toBeGreaterThan(0);
    const total = pill.reduce((sum, f) => sum + gzipSync(read(f), { level: 9 }).length, 0);
    expect(total).toBeLessThan(3 * 1024);
  });

  it("keeps the download page's JavaScript (OS detection, checksum verifier) under 15 KB gzipped", () => {
    const files = scriptGraph(read("download/index.html"));
    const total = [...files].reduce((sum, f) => sum + gzipSync(read(f), { level: 9 }).length, 0);
    console.log(`download page JavaScript: ${files.size} files, ${(total / 1024).toFixed(1)} KB gzipped`);
    expect(total).toBeLessThan(15 * 1024);
  });

  it("loads Mermaid lazily, and only on pages with a diagram", () => {
    // Everything the renderer pulls in: its static imports and the chunks it (or Mermaid) imports dynamically.
    const renderer = readdirSync(join(dist, "_astro")).find((f) => /^mermaid-render\.[\w-]+\.js$/.test(f));
    expect(renderer).toBeTruthy();
    const lazy = new Set<string>();
    const queue = [`/_astro/${renderer}`];
    while (queue.length > 0) {
      const src = queue.shift()!;
      if (lazy.has(src) || !existsSync(join(dist, src))) continue;
      lazy.add(src);
      for (const m of read(src).matchAll(/["'`](\.{1,2}\/[^"'`]+\.js)["'`]/g)) queue.push(new URL(m[1]!, `https://x${src}`).pathname);
    }
    // The loader of the docs pages stays tiny and only names the renderer.
    const loaders = new Set<string>();
    for (const page of pages) {
      const graph = scriptGraph(read(page));
      for (const f of graph) expect(lazy.has(f) && !f.includes("preload-helper"), `${page} loads ${f} up front`).toBe(false);
      for (const f of graph) if (/MarkdownContent/.test(f)) loaders.add(f);
    }
    expect(loaders.size).toBe(1);
    for (const f of loaders) expect(gzipSync(read(f), { level: 9 }).length, f).toBeLessThan(1024);
    const total = [...lazy].reduce((sum, f) => sum + gzipSync(read(f), { level: 9 }).length, 0);
    console.log(`Mermaid (all lazy chunks, loaded in part on diagram pages): ${lazy.size} files, ${(total / 1024).toFixed(1)} KB gzipped`);
  });

  it("lists the hash of every inline script in csp-script-hashes.txt", () => {
    const list = readFileSync(join(root, "csp-script-hashes.txt"), "utf8");
    for (const page of pages) {
      for (const script of inlineScripts(read(page))) expect(list, page).toContain(cspHash(script));
    }
  });

  it("loads scripts, styles, images and fonts only from the site itself", () => {
    for (const page of pages) {
      const html = read(page);
      const refs = [
        ...html.matchAll(/<(?:script|img|source|iframe|video|audio)\b[^>]*\b(?:src|srcset)="([^"]+)"/g),
        ...html.matchAll(/<link\b(?![^>]*rel="(?:canonical|alternate|sitemap)")[^>]*\bhref="([^"]+)"/g),
      ].map((m) => m[1]!);
      for (const ref of refs) expect(ref, `${page}: ${ref}`).not.toMatch(/^(https?:)?\/\//);
    }
  });

  it("ships no browser storage (cookies, localStorage, sessionStorage) on any page", () => {
    for (const page of pages) {
      const html = read(page);
      // Inline scripts and event handlers; the text of a page may well talk about browser storage (the protocol docs).
      for (const script of inlineScripts(html)) expect(script, page).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
      expect(html.match(/\son\w+="[^"]*"/g)?.join(" ") ?? "", page).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
      for (const f of scriptGraph(html)) expect(read(f), `${page}: ${f}`).not.toMatch(/sessionStorage|document\.cookie/);
    }
  });

  it("puts the runtime template actions into the two legal pages only, and nothing else that Caddy would execute", () => {
    // deploy/Caddyfile runs exactly these two pages through its templates handler (@legal): every "{{" in them must
    // be one of the actions of src/lib/runtime-env.ts, and no other page may rely on one.
    const legal: Record<string, readonly RuntimeVar[]> = {
      "/legal/imprint/index.html": ["TAVRN_IMPRINT_NAME", "TAVRN_IMPRINT_STREET", "TAVRN_IMPRINT_CITY", "TAVRN_IMPRINT_COUNTRY", "TAVRN_CONTACT_EMAIL"],
      "/legal/privacy/index.html": RUNTIME_VARS,
    };
    const actions = new Set<string>(RUNTIME_VARS.map((name) => runtimeEnv(name)));
    for (const [page, names] of Object.entries(legal)) {
      const html = read(page);
      const found = html.match(/\{\{.*?\}\}/g) ?? [];
      expect(html.split("{{").length - 1, page).toBe(found.length);
      for (const action of found) expect(actions.has(action), `${page}: ${action}`).toBe(true);
      expect(new Set(found), page).toEqual(new Set(names.map(runtimeEnv)));
      // The contact address sits in a single-quoted href (the action's own quotes stay inside it).
      expect(html, page).toContain(`href='mailto:${runtimeEnv("TAVRN_CONTACT_EMAIL")}'`);
    }
    const withActions = pages.filter((page) => read(page).includes('{{env "'));
    expect(withActions.sort()).toEqual(Object.keys(legal).sort());
  });

  it("builds every route", () => {
    for (const p of ["/index.html", "/download/index.html", "/status/index.html", "/roadmap/index.html", "/404.html",
      "/legal/index.html", "/legal/imprint/index.html", "/legal/privacy/index.html", "/docs/index.html",
      "/issues/index.html", "/report/index.html"]) {
      expect(pages, p).toContain(p);
    }
  });
});
