// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

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
