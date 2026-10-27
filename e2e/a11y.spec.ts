// SPDX-License-Identifier: Apache-2.0
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { revealAll, seriousAxeFindings } from "./helpers";
import { routes } from "./routes";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

for (const route of routes) {
  test(`${route.path} has no serious or critical axe findings`, async ({ page }) => {
    await page.goto(route.path);
    await revealAll(page);
    expect(await seriousAxeFindings(page)).toEqual([]);
  });
}

test("the landing page's interactive states have no axe findings either", async ({ page }) => {
  await page.goto("/");
  await revealAll(page);
  await page.getByRole("switch", { name: "Show what the node sees" }).click();
  await page.getByRole("button", { name: "A signed invite" }).click();
  await page.getByRole("tab", { name: "Voice" }).click();
  await page.waitForTimeout(500);
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const serious = results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.nodes.map((n) => `${n.target.join(" ")} ${n.failureSummary ?? ""}`).slice(0, 3).join(" | ")}`);
  expect(serious).toEqual([]);
});
