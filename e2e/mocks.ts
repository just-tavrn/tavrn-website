// SPDX-License-Identifier: Apache-2.0
// Hermetic stand-ins for what the container and the official node answer at runtime: /config.json (Caddy), the
// node's /healthz, /readyz and /api/v1/node, Uptime Kuma's status-page API behind the site's /uptime/ proxy,
// GitHub's issue search behind the site's /gh/issues proxy, and GitHub's release lists and repository behind
// /gh/releases/web, /gh/releases/node and /gh/repos/web (fixtures in e2e/fixtures/gh-releases.ts).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page, Route } from "@playwright/test";
import { repository, scenarios } from "./fixtures/gh-releases";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
export const kumaPage = JSON.parse(readFileSync(join(fixtures, "kuma-status-page.json"), "utf8"));
export const kumaHeartbeat = JSON.parse(readFileSync(join(fixtures, "kuma-heartbeat.json"), "utf8"));
/** GitHub's issue search answer as the site's /gh/issues proxy passes it on: three repositories and one pull request. */
export const ghIssues = JSON.parse(readFileSync(join(fixtures, "gh-issues.json"), "utf8"));

export const NODE = "https://node.example";

export const HEALTH_OK = { status: "ok", voice: "running" };
export const READY_OK = { ready: true, database: true, livekit: true, cache: null };
export const NODE_INFO = {
  domain: "tavrn.org",
  name: "tavrn official",
  description: "The official node",
  protocol: 1,
  version: "0.2.0",
  capabilities: ["content.v1", "mls.v1", "reactions", "attachments", "federation"],
  registration: "invite",
  dm_policy: "friends",
  voice: { enabled: true, max_bitrate_kbps: 96, max_participants: 25 },
};

export type Answer = { status?: number; body?: unknown; delay?: Promise<void> } | "abort";

export interface NodeMock {
  healthz?: Answer;
  readyz?: Answer;
  node?: Answer;
}

export interface Mocks extends NodeMock {
  nodeUrl?: string;
  kuma?: boolean;
  /** /config.json answers 404 (like `astro preview`). */
  noConfig?: boolean;
}

const json = (route: Route, answer: Answer) =>
  answer === "abort"
    ? route.abort("failed")
    : route.fulfill({
        status: answer.status ?? 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify(answer.body),
      });

/**
 * Routes /config.json, the node and (with `kuma`) the uptime proxy. Returns a handle to change the node's answers
 * between checks and to count the requests the node received.
 */
export async function mockRuntime(page: Page, mocks: Mocks = {}) {
  const nodeUrl = mocks.nodeUrl ?? NODE;
  const state: Required<NodeMock> = {
    healthz: mocks.healthz ?? { body: HEALTH_OK },
    readyz: mocks.readyz ?? { body: READY_OK },
    node: mocks.node ?? { body: NODE_INFO },
  };
  const hits: Record<string, number> = { healthz: 0, readyz: 0, node: 0 };

  await page.route("**/config.json", (route) =>
    mocks.noConfig
      ? route.fulfill({ status: 404, body: "not found" })
      : route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            appUrl: "https://app.example",
            nodeUrl,
            nodeDomain: "tavrn.org",
            uptimeKumaUrl: mocks.kuma ? "https://status.example" : "",
            uptimeKumaPage: mocks.kuma ? "tavrn" : "",
          }),
        }),
  );
  await page.route(`${nodeUrl}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    const key = path === "/healthz" ? "healthz" : path === "/readyz" ? "readyz" : path === "/api/v1/node" ? "node" : null;
    if (!key) return route.fulfill({ status: 404, body: "" });
    hits[key]! += 1;
    return json(route, state[key]);
  });
  if (mocks.kuma) {
    await page.route("**/uptime/api/status-page/heartbeat/tavrn", (route) => json(route, { body: kumaHeartbeat }));
    await page.route("**/uptime/api/status-page/tavrn", (route) => json(route, { body: kumaPage }));
  }
  return {
    nodeUrl,
    hits,
    set(next: NodeMock) {
      Object.assign(state, next);
    },
  };
}

/**
 * Routes /gh/issues (the site's proxy to GitHub's issue search, deploy/Caddyfile): the fixture by default, another
 * body, a status without body (404: no token configured), or a network failure. Returns the request count.
 */
export async function mockIssues(page: Page, answer: Answer = { body: ghIssues }) {
  const hits = { count: 0 };
  await page.route("**/gh/issues", (route) => {
    hits.count += 1;
    if (answer === "abort") return route.abort("failed");
    return route.fulfill({
      status: answer.status ?? 200,
      contentType: "application/json",
      headers: { "cache-control": "public, max-age=300" },
      body: JSON.stringify(answer.body),
    });
  });
  return hits;
}

export interface ReleaseMocks {
  /** /gh/releases/web: today's state on GitHub by default (a beta with installers, an older release without). */
  web?: Answer;
  /** /gh/releases/node: a stable release and a newer pre-release by default. */
  node?: Answer;
  /** /gh/repos/web: a public repository by default. */
  repo?: Answer;
}

/**
 * Routes the download page's three proxies (deploy/Caddyfile): each answer is a body, a status without body (404:
 * no token configured), a network failure, or held back until `delay` resolves. Returns the request counts.
 */
export async function mockReleases(page: Page, mocks: ReleaseMocks = {}) {
  const hits: Record<string, number> = { web: 0, node: 0, repo: 0 };
  const answers: Required<ReleaseMocks> = {
    web: mocks.web ?? { body: scenarios.betaOnly() },
    node: mocks.node ?? { body: scenarios.nodeStable() },
    repo: mocks.repo ?? { body: repository(false) },
  };
  const paths = { web: "/gh/releases/web", node: "/gh/releases/node", repo: "/gh/repos/web" } as const;
  for (const key of ["web", "node", "repo"] as const) {
    await page.route(`**${paths[key]}`, async (route) => {
      hits[key]! += 1;
      const answer = answers[key];
      if (answer === "abort") return route.abort("failed");
      await answer.delay;
      return route.fulfill({
        status: answer.status ?? 200,
        contentType: "application/json",
        headers: { "cache-control": "public, max-age=300" },
        body: answer.body === undefined ? "" : JSON.stringify(answer.body),
      });
    });
  }
  return hits;
}
