// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import search from "../../e2e/fixtures/gh-issues.json";
import {
  AREAS,
  areaOf,
  areasIn,
  filterIssues,
  githubSearchUrl,
  groupByArea,
  type IssueFilter,
  type IssueLabel,
  isRelevant,
  parseIssue,
  parseSearch,
  relativeTime,
  statusOf,
  typeOf,
  typesIn,
} from "./issues";

const list = parseSearch(search)!;
const none: IssueFilter = { text: "", areas: new Set(), types: new Set() };
const numbers = (issues: { repo: string; number: number }[]) => issues.map((i) => `${i.repo}#${i.number}`);
const labels = (...names: string[]): IssueLabel[] => names.map((name) => ({ name, color: null }));

describe("parseSearch", () => {
  it("reads the issues, newest update first, without the pull request and internal work", () => {
    expect(numbers(list.issues)).toEqual([
      "tavrn-web#142",
      "tavrn-node#87",
      "tavrn-web#150",
      "tavrn-protocol#7",
      "tavrn-web#139",
      "tavrn-crypto#12",
      "tavrn-node#80",
    ]);
    expect(list.total).toBe(10);
    expect(list.received).toBe(10);
    expect(list.partial).toBe(false);
  });

  it("keeps title, link, labels with their colours, area, type, status, comments and dates", () => {
    expect(list.issues[1]).toEqual({
      repo: "tavrn-node",
      number: 87,
      title: "Federation invite fails when the remote node uses a delegated domain",
      url: "https://github.com/just-tavrn/tavrn-node/issues/87",
      labels: [
        { name: "bug", color: "d73a4a" },
        { name: "federation", color: "1d76db" },
      ],
      area: "federation",
      type: "bug",
      status: "progress",
      badges: [],
      comments: 7,
      created: new Date("2026-09-20T12:00:00Z"),
      updated: new Date("2026-10-09T17:45:00Z"),
    });
  });

  it("derives area, type, status and badges for the fixture", () => {
    expect(list.issues.map((i) => [i.number, i.area, i.type, i.status, i.badges.join(",")])).toEqual([
      [142, "web", "bug", "triage", ""],
      [87, "federation", "bug", "progress", ""],
      [150, "desktop", "feature", "open", ""],
      [7, "protocol", "task", "progress", ""],
      [139, "web", "feature", "open", "good_first_issue"],
      [12, "website", "docs", "open", "help_wanted"],
      [80, "node", "bug", "open", ""],
    ]);
  });

  it("marks an answer that was cut at 100 items or timed out on GitHub's side", () => {
    expect(parseSearch({ ...search, total_count: 240 })!.partial).toBe(true);
    expect(parseSearch({ ...search, incomplete_results: true })!.partial).toBe(true);
  });

  it("rejects what is not a search answer", () => {
    expect(parseSearch(null)).toBeNull();
    expect(parseSearch({ message: "Bad credentials" })).toBeNull();
    expect(parseSearch([])).toBeNull();
    expect(parseSearch({ items: [] })).toEqual({ issues: [], total: 0, received: 0, partial: false });
  });
});

describe("parseIssue", () => {
  const base = search.items[0]!;

  it("drops pull requests, closed items and links outside github.com", () => {
    expect(parseIssue(search.items.find((i) => "pull_request" in i))).toBeNull();
    expect(parseIssue({ ...base, state: "closed" })).toBeNull();
    expect(parseIssue({ ...base, html_url: "javascript:alert(1)" })).toBeNull();
    expect(parseIssue({ ...base, html_url: "https://evil.example/just-tavrn/tavrn-web/issues/142" })).toBeNull();
    expect(parseIssue({ ...base, html_url: "https://github.com/just-tavrn/tavrn-web/pull/142" })).toBeNull();
    expect(parseIssue({ ...base, number: "142" })).toBeNull();
  });

  it("takes the repository from html_url when repository_url is missing, and ignores odd label colours", () => {
    const issue = parseIssue({ ...base, repository_url: undefined, labels: [{ name: "bug", color: "red" }, "plain", { color: "fff" }] })!;
    expect(issue.repo).toBe("tavrn-web");
    expect(issue.labels).toEqual([
      { name: "bug", color: null },
      { name: "plain", color: null },
    ]);
  });

  it("survives missing dates, comment counts, assignees and types", () => {
    const issue = parseIssue({ ...base, created_at: "soon", updated_at: undefined, comments: -1, assignees: undefined, type: "Bug" })!;
    expect(issue.created).toBeNull();
    expect(issue.updated).toBeNull();
    expect(issue.comments).toBe(0);
    expect(issue.type).toBe("bug");
  });

  it("counts a single assignee as work in progress", () => {
    expect(parseIssue({ ...base, assignees: [], assignee: { login: "a" } })!.status).toBe("progress");
  });
});

describe("areaOf", () => {
  it("lets a label beat the repository", () => {
    expect(areaOf("tavrn-web", labels("desktop", "enhancement"))).toBe("desktop");
    expect(areaOf("tavrn-node", labels("voice"))).toBe("voice");
    expect(areaOf("tavrn-crypto", labels("documentation"))).toBe("website");
    expect(areaOf("tavrn-web", labels("spec-change"))).toBe("protocol");
  });

  it("takes the first matching area in the configured order", () => {
    expect(areaOf("tavrn-node", labels("federation", "desktop"))).toBe("desktop");
    expect(areaOf("tavrn-node", labels("Encryption"))).toBe("encryption");
  });

  it("falls back to the repository, then to the project area", () => {
    expect(areaOf("tavrn-web", labels("bug"))).toBe("web");
    expect(areaOf("tavrn-protocol", [])).toBe("protocol");
    expect(areaOf("tavrn-js", [])).toBe("sdk");
    expect(areaOf("tavrn-crypto", [])).toBe("crypto");
    expect(areaOf("tavrn-website", [])).toBe("website");
    expect(areaOf("tavrn", [])).toBe("project");
    expect(areaOf(".github", [])).toBe("project");
  });

  it("has unique area ids", () => {
    expect(new Set(AREAS.map((a) => a.id)).size).toBe(AREAS.length);
  });
});

describe("typeOf", () => {
  it("prefers GitHub's issue type", () => {
    expect(typeOf({ name: "Bug" }, labels("enhancement"))).toBe("bug");
    expect(typeOf({ name: "Feature" }, [])).toBe("feature");
    expect(typeOf({ name: "Task" }, labels("bug"))).toBe("task");
  });

  it("falls back to the labels, then to a task", () => {
    expect(typeOf(null, labels("bug"))).toBe("bug");
    expect(typeOf(null, labels("enhancement"))).toBe("feature");
    expect(typeOf(null, labels("documentation"))).toBe("docs");
    expect(typeOf({ name: "Epic" }, labels("question"))).toBe("task");
    expect(typeOf(undefined, [])).toBe("task");
  });
});

describe("statusOf", () => {
  it("is in progress with an assignee or a progress label, needs triage with a triage label, else open", () => {
    expect(statusOf(true, labels("needs-triage"))).toBe("progress");
    expect(statusOf(false, labels("in progress"))).toBe("progress");
    expect(statusOf(false, labels("in-progress"))).toBe("progress");
    expect(statusOf(false, labels("WIP"))).toBe("progress");
    expect(statusOf(false, labels("needs-triage"))).toBe("triage");
    expect(statusOf(false, labels("triage"))).toBe("triage");
    expect(statusOf(false, labels("bug", "wipe-out"))).toBe("open");
  });
});

describe("isRelevant", () => {
  it("leaves out internal work", () => {
    for (const l of ["ci", "dependencies", "roadmap", "chore", "internal", "duplicate", "invalid", "wontfix", "CI"]) {
      expect(isRelevant("tavrn-node", labels("bug", l)), l).toBe(false);
    }
    expect(isRelevant("tavrn-node", labels("bug", "enhancement"))).toBe(true);
  });
});

describe("grouping and facets", () => {
  it("groups by area in the configured order, newest update first inside", () => {
    expect(groupByArea(list.issues).map((g) => [g.area, g.issues.map((i) => i.number)])).toEqual([
      ["desktop", [150]],
      ["federation", [87]],
      ["protocol", [7]],
      ["web", [142, 139]],
      ["node", [80]],
      ["website", [12]],
    ]);
  });

  it("lists the areas and types that occur with their counts", () => {
    expect(areasIn(list.issues)).toEqual([
      { id: "desktop", count: 1 },
      { id: "federation", count: 1 },
      { id: "protocol", count: 1 },
      { id: "web", count: 2 },
      { id: "node", count: 1 },
      { id: "website", count: 1 },
    ]);
    expect(typesIn(list.issues)).toEqual([
      { id: "bug", count: 3 },
      { id: "feature", count: 2 },
      { id: "docs", count: 1 },
      { id: "task", count: 1 },
    ]);
  });
});

describe("filterIssues", () => {
  const f = (patch: Partial<IssueFilter>) => numbers(filterIssues(list.issues, { ...none, ...patch }));

  it("passes everything without a filter", () => {
    expect(f({})).toHaveLength(7);
  });

  it("matches every word of the text against title, labels and repository, ignoring case and accents", () => {
    expect(f({ text: "VOICE" })).toEqual(["tavrn-web#142"]);
    expect(f({ text: "  federation   délégated " })).toEqual(["tavrn-node#87"]);
    expect(f({ text: "good first" })).toEqual(["tavrn-web#139"]);
    expect(f({ text: "crypto" })).toEqual(["tavrn-crypto#12"]);
    expect(f({ text: "nothing like this" })).toEqual([]);
  });

  it("finds an issue by its number, with or without #", () => {
    expect(f({ text: "#87" })).toEqual(["tavrn-node#87"]);
    expect(f({ text: "139" })).toEqual(["tavrn-web#139"]);
  });

  it("shows any of the chosen areas and any of the chosen types, both together", () => {
    expect(f({ areas: new Set(["web", "node"]) })).toEqual(["tavrn-web#142", "tavrn-web#139", "tavrn-node#80"]);
    expect(f({ types: new Set(["feature"]) })).toEqual(["tavrn-web#150", "tavrn-web#139"]);
    expect(f({ types: new Set(["bug"]), areas: new Set(["web"]) })).toEqual(["tavrn-web#142"]);
    expect(f({ types: new Set(["bug"]), areas: new Set(["web"]), text: "keyboard" })).toEqual([]);
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  it("says how long ago, in words of the language", () => {
    expect(relativeTime(new Date("2026-10-10T11:59:40Z"), now, "en")).toBe("now");
    expect(relativeTime(new Date("2026-10-10T11:55:00Z"), now, "en")).toBe("5 minutes ago");
    expect(relativeTime(new Date("2026-10-10T09:00:00Z"), now, "en")).toBe("3 hours ago");
    expect(relativeTime(new Date("2026-10-09T10:00:00Z"), now, "en")).toBe("yesterday");
    expect(relativeTime(new Date("2026-09-28T12:00:00Z"), now, "en")).toBe("last week");
    expect(relativeTime(new Date("2026-08-01T12:00:00Z"), now, "en")).toBe("2 months ago");
    expect(relativeTime(new Date("2024-09-01T12:00:00Z"), now, "en")).toBe("2 years ago");
    expect(relativeTime(new Date("2026-10-08T12:00:00Z"), now, "de")).toBe("vorgestern");
  });
});

describe("githubSearchUrl", () => {
  it("carries the search text into GitHub's issue search of the organization", () => {
    expect(githubSearchUrl("just-tavrn", "")).toBe("https://github.com/search?q=org:just-tavrn+is:issue+is:open&type=issues");
    expect(githubSearchUrl("just-tavrn", "  voice  bar ")).toBe(
      "https://github.com/search?q=org:just-tavrn+is:issue+is:open+voice+bar&type=issues",
    );
    expect(githubSearchUrl("just-tavrn", "a&b #12")).toBe(
      "https://github.com/search?q=org:just-tavrn+is:issue+is:open+a%26b+%2312&type=issues",
    );
  });
});
