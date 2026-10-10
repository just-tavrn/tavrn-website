// SPDX-License-Identifier: Apache-2.0
// Mermaid diagrams in the docs: drawn in the browser on pages that have one (src/lib/mermaid-render.ts), under the
// production CSP, without foreign requests or browser storage, accessible, and never wider than the page. Pages
// without a diagram do not load Mermaid at all.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { enforceProductionCsp } from "../helpers";

const DIAGRAMS = "/docs/developers/architecture/";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

test("the architecture page draws its diagrams with accessible names and keeps the source", async ({ page }) => {
  await page.goto(DIAGRAMS);
  const diagrams = page.locator(".mermaid-diagram");
  expect(await diagrams.count()).toBeGreaterThanOrEqual(3);
  const svg = diagrams.first().locator("svg").first();
  await expect(svg).toBeVisible({ timeout: 20_000 });
  await expect(svg).toHaveAttribute("role", "img");
  await expect(svg).toHaveAttribute("aria-label", "Diagram: flowchart");
  // Every diagram is drawn, the source stays in a closed <details>.
  await expect(page.locator(".mermaid-diagram[data-drawn='true']")).toHaveCount(await diagrams.count());
  await expect(page.locator(".mermaid-diagram svg[aria-label='Diagram: sequence diagram']").first()).toBeAttached();
  const details = diagrams.first().locator("details");
  await expect(details.locator("summary")).toHaveText("Diagram source");
  await expect(details.locator("pre.mermaid-source")).toContainText("flowchart");
  await expect(page.locator(".mermaid-note")).toHaveCount(0);
});

test("a hand-written page draws its diagram the same way", async ({ page }) => {
  await page.goto("/docs/users/getting-started/");
  const diagram = page.locator(".mermaid-diagram").first();
  await expect(diagram.locator("svg[role='img']")).toHaveAttribute("aria-label", "Diagram: flowchart", { timeout: 20_000 });
  await expect(diagram.locator("details pre.mermaid-source")).toContainText("vouches for you");
});

test("without JavaScript the diagram source shows like code", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(DIAGRAMS);
  const pre = page.locator(".mermaid-diagram pre.mermaid").first();
  await expect(pre).toBeVisible();
  await expect(pre).toContainText("flowchart");
  await context.close();
});

test("diagrams need nothing outside the production CSP, the origin or memory", async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const foreign: string[] = [];
  const scripts: string[] = [];
  page.on("request", (r) => {
    const url = r.url();
    if (r.resourceType() === "script") scripts.push(new URL(url).pathname);
    if (!url.startsWith(`${origin}/`) && !/^(data|blob):/.test(url)) foreign.push(url);
  });
  const violations = await enforceProductionCsp(page);
  await page.goto(DIAGRAMS);
  await expect(page.locator(".mermaid-diagram svg").first()).toBeVisible({ timeout: 20_000 });
  await page.waitForLoadState("networkidle");
  expect(await violations()).toEqual([]);
  expect(foreign).toEqual([]);
  // The renderer and the diagrams' own chunks only, never the 440 KB ELK layout (layout: "dagre").
  expect(scripts.some((s) => /mermaid-render/.test(s))).toBe(true);
  expect(scripts.filter((s) => /\/(elk|cytoscape|katex)[-.]/.test(s))).toEqual([]);
  expect(await context.cookies()).toEqual([]);
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
});

test("wide diagrams scroll inside their frame, not the page", async ({ page }) => {
  await page.goto(DIAGRAMS);
  await expect(page.locator(".mermaid-diagram[data-drawn='true']").first()).toBeAttached({ timeout: 20_000 });
  await expect(page.locator(".mermaid-diagram[data-drawn='pending']")).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  // A frame that scrolls can be reached with the keyboard.
  const frames = await page.locator(".mermaid-frame").evaluateAll((els) =>
    els.map((el) => ({ scrolls: el.scrollWidth > el.clientWidth + 1, focusable: el.getAttribute("tabindex") === "0" })),
  );
  for (const f of frames) expect(f.focusable).toBe(f.scrolls);
});

test("the diagram page has no serious or critical axe findings", async ({ page }) => {
  await page.goto(DIAGRAMS);
  await expect(page.locator(".mermaid-diagram[data-drawn='true']").first()).toBeAttached({ timeout: 20_000 });
  await expect(page.locator(".mermaid-diagram[data-drawn='pending']")).toHaveCount(0);
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".expressive-code pre")].every((pre) => pre.scrollWidth <= pre.clientWidth || pre.hasAttribute("tabindex")),
  );
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const serious = results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).slice(0, 5).join(", ")}`);
  expect(serious).toEqual([]);
});

test("a docs page without a diagram loads no Mermaid", async ({ page }) => {
  const scripts: string[] = [];
  page.on("request", (r) => {
    if (r.resourceType() === "script") scripts.push(new URL(r.url()).pathname);
  });
  await page.goto("/docs/users/account/");
  await page.waitForLoadState("networkidle");
  expect(scripts.filter((s) => /mermaid-render|cytoscape|elk|katex|Diagram-/i.test(s))).toEqual([]);
  expect(await page.locator(".mermaid-diagram").count()).toBe(0);
});
