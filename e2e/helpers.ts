// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The Content-Security-Policy exactly as deploy/Caddyfile sends it: the inline-script hashes of the build
 * ({file.…}) and the defaults of the environment variables ({$VAR:default}) filled in.
 */
export function productionCsp(): string {
  const caddyfile = readFileSync(join(root, "deploy/Caddyfile"), "utf8");
  const line = /Content-Security-Policy "([^"]+)"/.exec(caddyfile)?.[1];
  if (!line) throw new Error("no Content-Security-Policy in deploy/Caddyfile");
  const hashes = readFileSync(join(root, "csp-script-hashes.txt"), "utf8");
  return line
    .replace(/\{file\.[^}]+\}/g, hashes)
    .replace(/\{\$[A-Z_]+:([^}]*)\}/g, "$1")
    .replace(/\{\$[A-Z_]+\}/g, "");
}

/** Serves every response of the site with the production CSP and records violations in the page. */
export async function enforceProductionCsp(page: Page): Promise<() => Promise<string[]>> {
  const csp = productionCsp();
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective}: ${e.blockedURI || "inline"} (${e.sourceFile}:${e.lineNumber})`);
    });
  });
  await page.route("**/*", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), "content-security-policy": csp } });
  });
  return () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
}

/** Scrolls through the page so the scroll-reveal has shown every section, then back to the top. */
export async function revealAll(page: Page): Promise<void> {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += Math.max(200, innerHeight / 2)) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 40));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(600);
}

/** The default of TAVRN_NODE_URL in deploy/Caddyfile: the node the production CSP's connect-src allows. */
export function defaultNodeUrl(): string {
  const caddyfile = readFileSync(join(root, "deploy/Caddyfile"), "utf8");
  const url = /\{\$TAVRN_NODE_URL:([^}]+)\}/.exec(caddyfile)?.[1];
  if (!url) throw new Error("no TAVRN_NODE_URL default in deploy/Caddyfile");
  return url;
}

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

/** Starlight's search button in the docs header. */
const SEARCH_BUTTON = "site-search button[data-open-modal]";

/**
 * The serious and critical axe findings of the page, as "rule (impact): targets".
 *
 * One known exception: axe-core 4.14 enables label-content-name-mismatch by default, and at desktop width it flags
 * Starlight's search button, whose visible "Search Ctrl K" is longer than its aria-label "Search". The shortcut is a
 * supplementary hint that the button exposes through aria-keyshortcuts (asserted here, the exception rests on it),
 * so Starlight keeps the markup (https://github.com/withastro/starlight/issues/4260; axe-core also joins the visible
 * text without whitespace, https://github.com/dequelabs/axe-core/issues/5458). Only that rule on only that button is
 * dropped; any other node of the rule still fails. Remove the exception when upstream changes.
 */
export async function seriousAxeFindings(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  const findings: string[] = [];
  for (const v of results.violations) {
    if (v.impact !== "serious" && v.impact !== "critical") continue;
    let nodes = v.nodes;
    if (v.id === "label-content-name-mismatch") {
      const isSearch = await Promise.all(
        nodes.map((n) =>
          n.target.length === 1 && typeof n.target[0] === "string"
            ? page.evaluate(([t, s]) => document.querySelector(t)?.matches(s) ?? false, [n.target[0], SEARCH_BUTTON] as const)
            : false,
        ),
      );
      if (isSearch.some(Boolean)) await expect(page.locator(SEARCH_BUTTON)).toHaveAttribute("aria-keyshortcuts", /\S/);
      nodes = nodes.filter((_, i) => !isSearch[i]);
      if (nodes.length === 0) continue;
    }
    findings.push(`${v.id} (${v.impact}): ${nodes.map((n) => n.target.join(" ")).slice(0, 5).join(", ")}`);
  }
  return findings;
}
