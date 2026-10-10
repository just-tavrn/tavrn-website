// SPDX-License-Identifier: Apache-2.0
// The report page: the checklist, the one button to the umbrella repository's issue chooser, the separate security
// card with private vulnerability reporting, the hints, no JavaScript of its own, and accessibility.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];
const GH = "https://github.com/just-tavrn";

test("the checklist comes first and links the known issues and the download page", async ({ page }) => {
  await page.goto("/report");
  const checklist = page.locator(".rp-checklist li");
  await expect(checklist).toHaveCount(6);
  await expect(checklist.first().getByRole("link", { name: "known issues" })).toHaveAttribute("href", "/issues");
  await expect(checklist.nth(1).getByRole("link", { name: "latest version" })).toHaveAttribute("href", "/download");
  await expect(page.locator(".rp-checklist")).toContainText("no passwords, recovery keys");
  await expect(page.locator(".rp-checklist")).toContainText("Reports are public");
  await expect(page.locator(".rp-checklist")).toContainText("You need a GitHub account");
});

test("one button opens the umbrella repository's issue chooser", async ({ page }) => {
  await page.goto("/report");
  const button = page.locator("[data-report-github]");
  await expect(button).toHaveCount(1);
  await expect(button).toHaveAccessibleName("Report on GitHub (opens GitHub)");
  await expect(button).toHaveAttribute("href", `${GH}/tavrn/issues/new/choose`);
  await expect(button).toHaveAttribute("rel", "noopener");
  await expect(page.locator("main").getByRole("link", { name: /^Discussions/ })).toHaveAttribute("href", `${GH}/tavrn/discussions`);
  // No per-repository forms: the chooser routes.
  await expect(page.locator('a[href*="/issues/new?"]')).toHaveCount(0);
});

test("security problems go to private advisories, never to a public issue", async ({ page }) => {
  await page.goto("/report");
  const card = page.locator("[data-report-security]");
  await expect(card.getByRole("heading", { level: 2 })).toHaveText("Found a security problem?");
  await expect(card).toContainText("Do not open a public issue");
  const advisories = card.locator(".rp-advisories a");
  await expect(advisories).toHaveCount(5);
  for (const repo of ["tavrn-node", "tavrn-web", "tavrn-crypto", "tavrn-js", "tavrn-protocol"]) {
    await expect(card.locator(`a[href="${GH}/${repo}/security/advisories/new"]`)).toHaveCount(1);
  }
  await expect(card.getByRole("link", { name: /security policy/ })).toHaveAttribute("href", `${GH}/.github/blob/main/SECURITY.md`);
  await expect(card.getByRole("link", { name: "security@tavrn.org" })).toHaveAttribute("href", "mailto:security@tavrn.org");
  await expect(card.locator('a[href*="/issues"]')).toHaveCount(0);
});

test("names where to find the version and the logs per platform", async ({ page }) => {
  await page.goto("/report");
  const hints = page.locator(".rp-hints");
  await expect(hints.locator("dt")).toHaveText(["Web app", "Desktop app (Windows, Linux)", "Your own node"]);
  await expect(hints).toContainText("Settings → App");
  await expect(hints).toContainText("docker compose logs --since 1h tavrn");
  await expect(hints.getByRole("link", { name: "status page" })).toHaveAttribute("href", "/status");
});

test("the page runs no script of its own", async ({ page }) => {
  await page.goto("/report");
  await expect(page.locator("main script, main astro-island")).toHaveCount(0);
});

test("the footer links both pages and the status page links the known issues", async ({ page }) => {
  await page.goto("/report");
  const project = page.locator("#site-footer").getByRole("navigation", { name: "Project" });
  await expect(project.getByRole("link", { name: "Known issues" })).toHaveAttribute("href", "/issues");
  await expect(project.getByRole("link", { name: "Report a problem" })).toHaveAttribute("href", "/report");
  await page.goto("/status");
  await expect(page.locator("main").getByRole("link", { name: "known issues" })).toHaveAttribute("href", "/issues");
});

test("has no serious axe findings", async ({ page }) => {
  await page.goto("/report");
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const serious = results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
  expect(serious).toEqual([]);
});
