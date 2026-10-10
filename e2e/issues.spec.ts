// SPDX-License-Identifier: Apache-2.0
// The known-issues page against a mocked /gh/issues (e2e/mocks.ts, fixture e2e/fixtures/gh-issues.json): the list
// grouped by area with types and statuses, internal work left out, search, filter chips, order, empty result, the
// unavailable state (404: no token on the server), a network error, accessibility, and that the browser never
// contacts GitHub itself.
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { enforceProductionCsp } from "./helpers";
import { ghIssues, mockIssues, mockRuntime } from "./mocks";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];
const island = (page: Page) => page.locator(".known-issues");
const count = (page: Page) => page.locator("[data-ki-count]");
const titles = (page: Page) => island(page).locator(".ki-issue-title");
const search = (page: Page) => page.getByRole("searchbox", { name: "Search the known issues" });
const chip = (page: Page, group: string, name: string | RegExp) =>
  page.getByRole("group", { name: group }).getByRole("button", { name });

async function seriousAxe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.map((n) => `${n.target.join(" ")} ${n.failureSummary ?? ""}`).slice(0, 3).join(" | ")}`);
}

test.beforeEach(async ({ page }) => {
  await mockRuntime(page);
});

test("lists the open issues grouped by area, without the pull request and internal work", async ({ page }) => {
  await mockIssues(page);
  await page.goto("/issues");
  await expect(island(page)).toHaveAttribute("data-state", "ready");
  await expect(count(page)).toHaveText("7 open issues");
  await expect(count(page)).toHaveAttribute("aria-live", "polite");
  await expect(island(page).locator(".ki-group-title")).toHaveText([
    "Desktop apps (1)",
    "Federation (1)",
    "Protocol (1)",
    "Web client (2)",
    "Node server (1)",
    "Website and docs (1)",
  ]);
  await expect(titles(page)).toHaveCount(7);
  await expect(page.getByText("Bot runtime: reconnect after token rotation")).toHaveCount(0);
  await expect(page.getByText("Move the CI runner to the new image")).toHaveCount(0);
  await expect(page.getByText("Update the test dependencies")).toHaveCount(0);

  const issue = island(page).locator(".ki-issue", { hasText: "Federation invite fails" });
  const link = issue.getByRole("link", { name: "Federation invite fails when the remote node uses a delegated domain" });
  await expect(link).toHaveAttribute("href", "https://github.com/just-tavrn/tavrn-node/issues/87");
  await expect(link).toHaveAttribute("rel", "noopener");
  await expect(issue.locator(".ki-type")).toHaveText("Bug");
  // Assigned: in progress.
  await expect(issue.locator(".ki-status")).toHaveText("Status: In progress");
  await expect(issue.locator(".ki-ref")).toHaveText("tavrn-node #87");
  await expect(issue.locator(".ki-ref [translate]")).toHaveAttribute("translate", "no");
  await expect(issue.locator(".ki-label")).toHaveText(["bug", "federation"]);
  await expect(issue).toContainText("7 comments");
  const times = issue.locator("time");
  await expect(times).toHaveCount(2);
  await expect(times.first()).toHaveAttribute("datetime", "2026-09-20T12:00:00.000Z");

  // GitHub's issue type wins; without one the labels decide.
  await expect(island(page).locator(".ki-issue", { hasText: "Readiness check" }).locator(".ki-type")).toHaveText("Bug");
  const desktop = island(page).locator(".ki-issue", { hasText: "Start minimised to the tray" });
  await expect(desktop.locator(".ki-type")).toHaveText("Feature");
  await expect(desktop.locator(".ki-status")).toHaveText("Status: Open");
  await expect(island(page).locator(".ki-issue", { hasText: "Voice bar overlaps" }).locator(".ki-status")).toHaveText("Status: Needs triage");
  await expect(island(page).locator(".ki-issue", { hasText: "Keyboard shortcut" }).locator(".ki-badge")).toHaveText("Good first issue");
  await expect(island(page).locator(".ki-issue", { hasText: "Keyboard shortcut" })).toContainText("0 comments");
  await expect(island(page).locator(".ki-issue", { hasText: "Document the WebAssembly" }).locator(".ki-badge")).toHaveText("Help wanted");
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
});

test("the page says what is listed and links the full list on GitHub", async ({ page }) => {
  await mockIssues(page);
  await page.goto("/issues");
  await expect(page.locator("main")).toContainText("Internal work such as CI and dependency updates is left out.");
  await expect(page.locator("main").getByRole("link", { name: /All open issues on GitHub/ })).toHaveAttribute(
    "href",
    "https://github.com/search?q=org:just-tavrn+is:issue+is:open&type=issues",
  );
  await expect(page.locator("main").getByRole("link", { name: "Report a problem" })).toHaveAttribute("href", "/report");
});

test("the search filters instantly and carries its text into the GitHub search link", async ({ page }) => {
  await mockIssues(page);
  await page.goto("/issues");
  await expect(count(page)).toHaveText("7 open issues");
  await search(page).fill("voice");
  await expect(count(page)).toHaveText("Showing 1 of 7 open issues");
  await expect(titles(page)).toHaveText(["Voice bar overlaps the composer on small phones"]);
  await search(page).fill("#87");
  await expect(titles(page)).toHaveText(["Federation invite fails when the remote node uses a delegated domain"]);
  await search(page).fill("tray");
  await expect(titles(page)).toHaveCount(1);
  const github = page.getByRole("link", { name: /Search on GitHub/ });
  await expect(github).toHaveAttribute("href", "https://github.com/search?q=org:just-tavrn+is:issue+is:open+tray&type=issues");
  await expect(search(page)).toHaveAttribute("aria-describedby", "ki-search-hint");
});

test("area and type chips toggle with the keyboard and combine", async ({ page }) => {
  await mockIssues(page);
  await page.goto("/issues");
  const web = chip(page, "Area", /^Web client/);
  const bug = chip(page, "Type", /^Bug/);
  await expect(web).toHaveAttribute("aria-pressed", "false");
  await web.focus();
  await page.keyboard.press("Enter");
  await expect(web).toHaveAttribute("aria-pressed", "true");
  await expect(count(page)).toHaveText("Showing 2 of 7 open issues");
  await bug.focus();
  await page.keyboard.press("Space");
  await expect(bug).toHaveAttribute("aria-pressed", "true");
  await expect(titles(page)).toHaveText(["Voice bar overlaps the composer on small phones"]);
  await chip(page, "Area", /^Node server/).click();
  await expect(count(page)).toHaveText("Showing 2 of 7 open issues");
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(count(page)).toHaveText("7 open issues");
  await expect(web).toHaveAttribute("aria-pressed", "false");
  // The label colour from GitHub is only a small dot; the text keeps the site's colours.
  const dot = island(page).locator(".ki-issue", { hasText: "Voice bar" }).locator(".ki-label .ki-dot").first();
  await expect(dot).toHaveCSS("background-color", "rgb(215, 58, 74)");
});

test("ordered by the last update, each issue names its area and repository", async ({ page }) => {
  await mockIssues(page);
  await page.goto("/issues");
  await chip(page, "Order", "Recently updated").click();
  await expect(chip(page, "Order", "Recently updated")).toHaveAttribute("aria-pressed", "true");
  await expect(island(page).locator(".ki-group-title")).toHaveCount(0);
  await expect(island(page).locator(".ki-ref")).toHaveText([
    "Web client · tavrn-web #142",
    "Federation · tavrn-node #87",
    "Desktop apps · tavrn-web #150",
    "Protocol · tavrn-protocol #7",
    "Web client · tavrn-web #139",
    "Website and docs · tavrn-crypto #12",
    "Node server · tavrn-node #80",
  ]);
});

test("a search without results says so", async ({ page }) => {
  await mockIssues(page);
  await page.goto("/issues");
  await search(page).fill("nothing like this anywhere");
  await expect(count(page)).toHaveText("Showing 0 of 7 open issues");
  await expect(island(page)).toContainText("No open issues match your search.");
});

test("no open issues at all", async ({ page }) => {
  await mockIssues(page, { body: { total_count: 0, incomplete_results: false, items: [] } });
  await page.goto("/issues");
  await expect(island(page)).toContainText("There are no open issues right now.");
});

test("a list cut at 100 issues says how many there are", async ({ page }) => {
  await mockIssues(page, { body: { ...ghIssues, total_count: 240 } });
  await page.goto("/issues");
  await expect(island(page).locator(".ki-note")).toHaveText(
    "GitHub returned the 10 most recently updated of 240 open issues. Search on GitHub to find older ones.",
  );
});

test("without a token on the server (404) the page points to GitHub", async ({ page }) => {
  await mockIssues(page, { status: 404, body: "" });
  await page.goto("/issues");
  await expect(island(page)).toHaveAttribute("data-state", "unavailable");
  await expect(island(page)).toContainText("The list of known issues is not available on this site yet.");
  await expect(island(page).getByRole("link", { name: /See the open issues on GitHub/ })).toHaveAttribute(
    "href",
    "https://github.com/search?q=org:just-tavrn+is:issue+is:open&type=issues",
  );
});

test("a network error is shown in words and can be retried", async ({ page }) => {
  const hits = await mockIssues(page, "abort");
  await page.goto("/issues");
  await expect(island(page)).toHaveAttribute("data-state", "error");
  await expect(page.getByRole("alert")).toHaveText("The known issues could not be loaded right now.");
  await page.unroute("**/gh/issues");
  await mockIssues(page);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(count(page)).toHaveText("7 open issues");
  expect(hits.count).toBe(1);
});

test("an answer GitHub could not serve (rate limit) is an error, not an empty list", async ({ page }) => {
  await mockIssues(page, { status: 403, body: { message: "API rate limit exceeded" } });
  await page.goto("/issues");
  await expect(island(page)).toHaveAttribute("data-state", "error");
});

test("the browser asks only this site for the issues, under the production CSP", async ({ page }) => {
  const violations = await enforceProductionCsp(page);
  await mockIssues(page);
  const github: string[] = [];
  page.on("request", (r) => {
    if (/github/.test(new URL(r.url()).hostname)) github.push(r.url());
  });
  await page.goto("/issues");
  await expect(count(page)).toHaveText("7 open issues");
  expect(github).toEqual([]);
  expect(await violations()).toEqual([]);
});

test("the loaded, filtered and empty states have no serious axe findings", async ({ page }) => {
  await mockIssues(page);
  await page.goto("/issues");
  await expect(count(page)).toHaveText("7 open issues");
  expect(await seriousAxe(page)).toEqual([]);
  await chip(page, "Type", /^Bug/).click();
  await search(page).fill("zzz");
  await expect(island(page)).toContainText("No open issues match your search.");
  expect(await seriousAxe(page)).toEqual([]);
});

test("the unavailable and error states have no serious axe findings", async ({ page }) => {
  await mockIssues(page, { status: 404, body: "" });
  await page.goto("/issues");
  await expect(island(page)).toHaveAttribute("data-state", "unavailable");
  expect(await seriousAxe(page)).toEqual([]);
});
