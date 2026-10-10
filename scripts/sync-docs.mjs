#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/**
 * The docs sync: copies the operator and developer documents from the pinned git submodules under sources/
 * (scripts/docs-sources.mjs says which) into the wiki, as Starlight pages with frontmatter, adapted links and
 * headings, plus the configuration reference generated from the node's .env.example. Runs before every build,
 * dev server and typecheck (package.json) and as `just sync-docs`.
 *
 *   node scripts/sync-docs.mjs            sync (fails with a clear message when a source file is missing)
 *   node scripts/sync-docs.mjs --check    exit 1 when a sync would change the generated files
 *
 * Output: src/content/docs/synced/ (wiped and rewritten, gitignored) and src/content/pages/roadmap.md. Files whose
 * content did not change are not touched, so a running dev server only reloads what changed.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ALIASES, DOCUMENTS, ENV_REFERENCE, GITHUB, LICENSES, OUT_DIR, PAGES } from "./docs-sources.mjs";
import { parseEnvExample, renderEnvReference, tableDescriptions } from "./gen-env-reference.mjs";
import { fileKey, githubSlug, planDocument, renderPage, rewriteLinks, route } from "./lib/docs-transform.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Plans and renders every page. Returns the files to write (path relative to the repository -> content).
 * @param {string} sourcesDir the directory that holds the checkouts (sources/)
 */
export function buildDocs(sourcesDir) {
  /** @type {string[]} */
  const warnings = [];
  const sourceFile = (/** @type {string} */ repo, /** @type {string} */ path) => join(sourcesDir, repo, path);

  const wanted = [
    ...DOCUMENTS.map((d) => [d.repo, d.path]),
    ...PAGES.map((p) => [p.repo, p.path]),
    [ENV_REFERENCE.repo, ENV_REFERENCE.path],
  ];
  const missing = wanted.filter(([repo, path]) => !existsSync(sourceFile(repo ?? "", path ?? "")));
  if (missing.length > 0) {
    const list = missing.map(([repo, path]) => `  - sources/${repo}/${path}`).join("\n");
    throw new Error(
      `sync-docs: ${missing.length} configured source file(s) missing:\n${list}\n` +
        "Fetch the submodules with `git submodule update --init`, or fix the list in scripts/docs-sources.mjs.",
    );
  }

  // Pass 1: every document's pages and anchors -> the registry of link targets.
  const plans = DOCUMENTS.map((doc) => {
    const plan = planDocument(readFileSync(sourceFile(doc.repo, doc.path), "utf8"), doc);
    warnings.push(...plan.warnings.map((w) => `${doc.repo}/${doc.path}: ${w}`));
    return { doc, plan };
  });
  /** @type {Map<string, import("./lib/docs-transform.mjs").RegistryEntry>} */
  const registry = new Map();
  for (const { doc, plan } of plans) {
    const first = plan.pages[0];
    if (first) registry.set(fileKey(doc.repo, doc.path), { route: route(first.slug), anchors: plan.anchors });
  }
  for (const [key, slug] of Object.entries(ALIASES)) registry.set(key, { route: route(slug) });
  registry.set(fileKey(ENV_REFERENCE.repo, ENV_REFERENCE.path), { route: route(ENV_REFERENCE.slug) });

  const slugs = new Set();
  for (const { plan } of plans) {
    for (const page of plan.pages) {
      if (slugs.has(page.slug)) throw new Error(`sync-docs: two pages with the slug ${page.slug}`);
      slugs.add(page.slug);
    }
  }

  const isDirectory = (/** @type {string} */ repo, /** @type {string} */ path) => {
    try {
      return statSync(sourceFile(repo, path)).isDirectory();
    } catch {
      return false;
    }
  };
  const fileFor = (/** @type {string} */ slug) => `${OUT_DIR}/${slug.replace(/^docs\//, "")}.md`;

  // Pass 2: the pages.
  /** @type {Map<string, string>} */
  const files = new Map();
  for (const { doc, plan } of plans) {
    for (const page of plan.pages) {
      const ctx = { repo: doc.repo, path: doc.path, pageRoute: route(page.slug), registry, github: GITHUB, isDirectory, warnings };
      files.set(
        fileFor(page.slug),
        renderPage(page, {
          ctx,
          editUrl: `${GITHUB}/${doc.repo}/edit/main/${doc.path}`,
          sourceUrl: `${GITHUB}/${doc.repo}/blob/main/${doc.path}`,
          source: `${doc.repo}/${doc.path}`,
          license: doc.license ?? LICENSES[doc.repo] ?? "",
          reworded: (doc.replacements ?? []).length > 0,
        }),
      );
    }
  }

  // The roadmap page outside the wiki keeps its H1 (src/pages/roadmap.astro renders the body as it is).
  for (const target of PAGES) {
    const doc = { repo: target.repo, path: target.path, slug: target.route, keepTitle: true, description: target.description };
    const plan = planDocument(readFileSync(sourceFile(doc.repo, doc.path), "utf8"), doc);
    const page = plan.pages[0];
    if (!page) continue;
    const ctx = { repo: doc.repo, path: doc.path, pageRoute: target.route, registry, github: GITHUB, isDirectory, warnings };
    files.set(
      target.file,
      renderPage(page, {
        ctx,
        editUrl: "",
        sourceUrl: `${GITHUB}/${doc.repo}/blob/main/${doc.path}`,
        source: `${doc.repo}/${doc.path}`,
        license: LICENSES[doc.repo] ?? "",
        keepTitle: true,
        frontmatter: "page",
      }),
    );
  }

  // The configuration reference, right after the page named in `after`.
  const after = plans.flatMap(({ plan }) => plan.pages).find((p) => p.slug === ENV_REFERENCE.after);
  if (!after) warnings.push(`configuration reference: the page ${ENV_REFERENCE.after} does not exist`);
  const sections = parseEnvExample(readFileSync(sourceFile(ENV_REFERENCE.repo, ENV_REFERENCE.path), "utf8"), {
    sections: ENV_REFERENCE.sections,
  });
  for (const s of ENV_REFERENCE.sections) {
    if (!sections.some((p) => p.title === s.title)) warnings.push(`configuration reference: section start ${s.first} not found`);
  }
  // Variables without a comment get the description of the handbook's tables; references become links.
  const handbookKey = fileKey(ENV_REFERENCE.repo, ENV_REFERENCE.handbook);
  const handbook = registry.get(handbookKey);
  const referenceCtx = {
    repo: ENV_REFERENCE.repo,
    path: ENV_REFERENCE.handbook,
    pageRoute: route(ENV_REFERENCE.slug),
    registry,
    github: GITHUB,
    isDirectory,
    warnings,
  };
  const fallbacks = new Map(
    [...tableDescriptions(readFileSync(sourceFile(ENV_REFERENCE.repo, ENV_REFERENCE.handbook), "utf8"))].map(
      ([name, text]) => [name, rewriteLinks(text, referenceCtx)],
    ),
  );
  /** @type {import("./gen-env-reference.mjs").Refs} */
  const refs = (text, hold) =>
    text
      .replace(/(?:docs\/)?HANDBOOK\.md "([^"]+)"/g, (whole, title) => {
        const anchor = handbook?.anchors?.get(githubSlug(title));
        return anchor ? hold(`[${title}](${anchor.id ? `${anchor.route}#${anchor.id}` : anchor.route})`) : whole;
      })
      .replace(/\b(?:protocol\/)?([A-Z]+\.md)\b/g, (whole, file) => {
        const entry = file === "README.md" ? undefined : registry.get(fileKey("tavrn-protocol", file));
        return entry ? hold(`[${file}](${entry.route})`) : whole;
      });
  files.set(
    fileFor(ENV_REFERENCE.slug),
    renderEnvReference(sections, {
      title: "Configuration reference",
      description: "Every environment variable of a tavrn node with its value in the example file and what it does.",
      slug: ENV_REFERENCE.slug,
      label: ENV_REFERENCE.label,
      order: (after?.order ?? 0) + 1,
      editUrl: `${GITHUB}/${ENV_REFERENCE.repo}/edit/main/${ENV_REFERENCE.path}`,
      sourceUrl: `${GITHUB}/${ENV_REFERENCE.repo}/blob/main/${ENV_REFERENCE.path}`,
      source: `${ENV_REFERENCE.repo}/${ENV_REFERENCE.path}`,
      license: LICENSES[ENV_REFERENCE.repo] ?? "",
      overrides: ENV_REFERENCE.overrides,
      configurationRoute: after ? route(after.slug) : undefined,
      fallbacks,
      refs,
    }),
  );
  return { files, warnings };
}

/** Every file below dir, relative to the repository root. */
function listFiles(/** @type {string} */ dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => relative(root, join(e.parentPath, e.name)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes("--check");
  let result;
  try {
    result = buildDocs(join(root, "sources"));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
  const { files, warnings } = result;
  for (const w of warnings) console.warn(`sync-docs: warning: ${w}`);
  const stale = listFiles(join(root, OUT_DIR)).filter((f) => !files.has(f));
  const changed = [...files].filter(([path, content]) => {
    const full = join(root, path);
    return !existsSync(full) || readFileSync(full, "utf8") !== content;
  });
  if (check) {
    if (changed.length + stale.length > 0) {
      console.error(`sync-docs: ${changed.length + stale.length} generated file(s) out of date; run \`just sync-docs\``);
      process.exit(1);
    }
    console.log("sync-docs: up to date");
  } else {
    for (const f of stale) rmSync(join(root, f));
    for (const [path, content] of changed) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    console.log(`sync-docs: ${files.size} pages (${changed.length} changed, ${stale.length} removed)`);
  }
}
