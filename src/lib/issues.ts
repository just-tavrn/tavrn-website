// SPDX-License-Identifier: Apache-2.0
/**
 * The model of the known-issues page (/issues): the answer of GitHub's issue search, which the site's own server
 * fetches and serves as /gh/issues (deploy/Caddyfile; the browser never contacts GitHub), checked against
 * https://docs.github.com/en/rest/search/search#search-issues-and-pull-requests:
 *
 *   { total_count, incomplete_results, items: [{ html_url, number, title, repository_url, labels: [{ name, color }],
 *     assignees: [..], type: { name } | null, comments, created_at, updated_at, state, pull_request? }] }
 *
 * Every issue gets an area (the part of tavrn it is about), a type and a status; issues that are not interesting
 * to users (CI, dependency updates, …) and pull requests are left out. The configuration right below decides all
 * of that; the display names of the areas, types and statuses are UI strings (src/i18n/en.json, `issues.area.*`,
 * `issues.type.*`, `issues.status.*`). Pure functions only; src/components/issues/KnownIssues.tsx renders them.
 */

// ---------------------------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------------------------

/** Issues carrying any of these labels are internal work and not listed (compared case-insensitively). */
export const HIDDEN_LABELS: readonly string[] = ["ci", "dependencies", "roadmap", "chore", "internal", "duplicate", "invalid", "wontfix"];

/** Repositories whose issues are not listed at all (short names, e.g. "cla-signatures"). */
export const EXCLUDED_REPOS: readonly string[] = [];

export interface AreaRule {
  /** Stable id; the heading is the UI string `issues.area.<id>`. */
  id: string;
  /** Labels that put an issue into this area. */
  labels?: readonly string[];
  /** Repositories whose issues land here when no label decided. */
  repos?: readonly string[];
}

/**
 * The areas in the order the page shows them. An issue's labels are checked first, against every area in this
 * order (the first area with a matching label wins); only when no label matches does its repository decide.
 * Issues of other repositories land in FALLBACK_AREA.
 */
export const AREAS: readonly AreaRule[] = [
  { id: "desktop", labels: ["desktop"] },
  { id: "voice", labels: ["voice"] },
  { id: "encryption", labels: ["encryption"] },
  { id: "federation", labels: ["federation"] },
  { id: "protocol", labels: ["protocol", "spec-change"], repos: ["tavrn-protocol"] },
  { id: "web", repos: ["tavrn-web"] },
  { id: "node", repos: ["tavrn-node"] },
  { id: "sdk", repos: ["tavrn-js"] },
  { id: "crypto", repos: ["tavrn-crypto"] },
  { id: "website", labels: ["documentation"], repos: ["tavrn-website"] },
  { id: "project", repos: ["tavrn"] },
];
export const FALLBACK_AREA = "project";

/** Issue types: GitHub's own issue type when set (its name, case-insensitive), else the first matching label. */
export const TYPES = ["bug", "feature", "docs", "task"] as const;
export type IssueType = (typeof TYPES)[number];
const TYPE_NAMES: Record<string, IssueType> = { bug: "bug", feature: "feature", enhancement: "feature", task: "task", docs: "docs", documentation: "docs" };
const TYPE_LABELS: readonly [string, IssueType][] = [
  ["bug", "bug"],
  ["enhancement", "feature"],
  ["documentation", "docs"],
];
const DEFAULT_TYPE: IssueType = "task";

/** Status: "progress" with an assignee or a matching label, "triage" with a triage label, else "open". */
export type IssueStatus = "open" | "progress" | "triage";
const PROGRESS_LABEL = /in[- ]?progress|\bwip\b/i;
const TRIAGE_LABELS: readonly string[] = ["needs-triage", "triage"];

/** Small extra badges for labels that invite contributions (id = UI string `issues.badge.<id>`). */
export const BADGES: readonly { id: string; label: string }[] = [
  { id: "good_first_issue", label: "good first issue" },
  { id: "help_wanted", label: "help wanted" },
];

// ---------------------------------------------------------------------------------------------------------------

export interface IssueLabel {
  name: string;
  /** Six hex digits without "#", or null when GitHub sent something else. */
  color: string | null;
}

export interface Issue {
  /** Short repository name ("tavrn-web"). */
  repo: string;
  number: number;
  title: string;
  /** The issue on github.com. */
  url: string;
  labels: IssueLabel[];
  area: string;
  type: IssueType;
  status: IssueStatus;
  /** Ids of BADGES the issue carries. */
  badges: string[];
  comments: number;
  created: Date | null;
  updated: Date | null;
}

export interface IssueList {
  issues: Issue[];
  /** GitHub's count of all open issues of the search (internal ones included). */
  total: number;
  /** How many items GitHub returned (at most 100). */
  received: number;
  /** True when GitHub returned fewer items than it found (more than 100, or a search that timed out). */
  partial: boolean;
}

export interface IssueFilter {
  /** Free text: every word must appear in the title, a label, the repository or the number ("#12" or "12"). */
  text: string;
  /** Areas to show (any of them); empty: all. */
  areas: ReadonlySet<string>;
  /** Types to show (any of them); empty: all. */
  types: ReadonlySet<string>;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const lower = (s: string) => s.toLowerCase();
const hasLabel = (labels: readonly IssueLabel[], names: readonly string[]) => labels.some((l) => names.some((n) => lower(n) === lower(l.name)));

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The short repository name from repository_url (".../repos/<owner>/<repo>") or, failing that, html_url. */
function repoName(item: Record<string, unknown>): string | null {
  for (const [key, re] of [
    ["repository_url", /\/repos\/[^/]+\/([^/?#]+)\/?$/],
    ["html_url", /^https:\/\/github\.com\/[^/]+\/([^/?#]+)\//],
  ] as const) {
    const value = item[key];
    const m = typeof value === "string" ? re.exec(value) : null;
    if (m) return decodeURIComponent(m[1]!);
  }
  return null;
}

function parseLabel(value: unknown): IssueLabel | null {
  if (typeof value === "string") return value ? { name: value, color: null } : null;
  if (!isObj(value) || typeof value.name !== "string" || !value.name) return null;
  const color = typeof value.color === "string" && /^[0-9a-f]{6}$/i.test(value.color) ? value.color.toLowerCase() : null;
  return { name: value.name, color };
}

/** The area of an issue: a label of any area first (in AREAS order), then its repository, then FALLBACK_AREA. */
export function areaOf(repo: string, labels: readonly IssueLabel[]): string {
  for (const area of AREAS) if (area.labels && hasLabel(labels, area.labels)) return area.id;
  for (const area of AREAS) if (area.repos?.some((r) => lower(r) === lower(repo))) return area.id;
  return FALLBACK_AREA;
}

/** The type: GitHub's issue type when it is set and known, else from the labels, else DEFAULT_TYPE. */
export function typeOf(githubType: unknown, labels: readonly IssueLabel[]): IssueType {
  const name = isObj(githubType) && typeof githubType.name === "string" ? TYPE_NAMES[lower(githubType.name)] : undefined;
  if (name) return name;
  for (const [label, type] of TYPE_LABELS) if (hasLabel(labels, [label])) return type;
  return DEFAULT_TYPE;
}

export function statusOf(assigned: boolean, labels: readonly IssueLabel[]): IssueStatus {
  if (assigned || labels.some((l) => PROGRESS_LABEL.test(l.name))) return "progress";
  if (hasLabel(labels, TRIAGE_LABELS)) return "triage";
  return "open";
}

/** Whether an issue is for this list at all: not internal work, not from an excluded repository. */
export function isRelevant(repo: string, labels: readonly IssueLabel[]): boolean {
  return !EXCLUDED_REPOS.some((r) => lower(r) === lower(repo)) && !hasLabel(labels, HIDDEN_LABELS);
}

/** One search item as an issue, or null for pull requests, closed items, internal work and anything malformed. */
export function parseIssue(value: unknown): Issue | null {
  if (!isObj(value) || "pull_request" in value) return null;
  if (typeof value.state === "string" && value.state !== "open") return null;
  const { html_url: url, number, title } = value;
  if (typeof url !== "string" || !url.startsWith("https://github.com/") || /\/pull\/\d+/.test(url)) return null;
  if (typeof number !== "number" || !Number.isInteger(number) || typeof title !== "string") return null;
  const repo = repoName(value);
  if (!repo) return null;
  const labels = Array.isArray(value.labels) ? value.labels.map(parseLabel).filter((l): l is IssueLabel => l !== null) : [];
  if (!isRelevant(repo, labels)) return null;
  const assigned = (Array.isArray(value.assignees) && value.assignees.length > 0) || isObj(value.assignee);
  return {
    repo,
    number,
    title,
    url,
    labels,
    area: areaOf(repo, labels),
    type: typeOf(value.type, labels),
    status: statusOf(assigned, labels),
    badges: BADGES.filter((b) => hasLabel(labels, [b.label])).map((b) => b.id),
    comments: typeof value.comments === "number" && value.comments >= 0 ? value.comments : 0,
    created: parseDate(value.created_at),
    updated: parseDate(value.updated_at),
  };
}

/** The search answer, newest update first; null when it is not a search answer at all. */
export function parseSearch(value: unknown): IssueList | null {
  if (!isObj(value) || !Array.isArray(value.items)) return null;
  const items = value.items as unknown[];
  const issues = items.map(parseIssue).filter((i): i is Issue => i !== null);
  issues.sort(byUpdated);
  const total = typeof value.total_count === "number" && value.total_count >= 0 ? value.total_count : items.length;
  return { issues, total, received: items.length, partial: value.incomplete_results === true || total > items.length };
}

function byUpdated(a: Issue, b: Issue): number {
  return (b.updated?.getTime() ?? 0) - (a.updated?.getTime() ?? 0) || a.repo.localeCompare(b.repo) || b.number - a.number;
}

const areaRank = (id: string) => {
  const i = AREAS.findIndex((a) => a.id === id);
  return i < 0 ? AREAS.length : i;
};

/** The issues per area, areas in AREAS order, newest update first inside each. */
export function groupByArea(issues: readonly Issue[]): { area: string; issues: Issue[] }[] {
  const groups = new Map<string, Issue[]>();
  for (const issue of issues) {
    const list = groups.get(issue.area);
    if (list) list.push(issue);
    else groups.set(issue.area, [issue]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => areaRank(a) - areaRank(b))
    .map(([area, list]) => ({ area, issues: [...list].sort(byUpdated) }));
}

/** The areas that occur, in AREAS order, with their issue counts. */
export function areasIn(issues: readonly Issue[]): { id: string; count: number }[] {
  return groupByArea(issues).map((g) => ({ id: g.area, count: g.issues.length }));
}

/** The types that occur, in TYPES order, with their issue counts. */
export function typesIn(issues: readonly Issue[]): { id: IssueType; count: number }[] {
  return TYPES.map((id) => ({ id, count: issues.filter((i) => i.type === id).length })).filter((t) => t.count > 0);
}

const fold = (s: string) => s.toLocaleLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

/** The words of the search text, folded for comparison. */
export function searchWords(text: string): string[] {
  return fold(text).split(/\s+/).filter(Boolean);
}

/** Whether an issue passes the filter (see IssueFilter). */
export function matches(issue: Issue, filter: IssueFilter): boolean {
  if (filter.areas.size > 0 && !filter.areas.has(issue.area)) return false;
  if (filter.types.size > 0 && !filter.types.has(issue.type)) return false;
  const words = searchWords(filter.text);
  if (words.length === 0) return true;
  const haystack = fold([issue.title, issue.repo, ...issue.labels.map((l) => l.name)].join(" "));
  return words.every((w) => {
    const num = /^#?(\d+)$/.exec(w);
    return (num && Number(num[1]) === issue.number) || haystack.includes(w.replace(/^#/, ""));
  });
}

export function filterIssues(issues: readonly Issue[], filter: IssueFilter): Issue[] {
  return issues.filter((i) => matches(i, filter));
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/** "3 days ago", "yesterday", "now" in the given language. */
export function relativeTime(date: Date, now: Date, locale: string): string {
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.trunc(seconds / size), unit);
  }
  return rtf.format(0, "second");
}

/**
 * GitHub's own issue search for the organization with the visitor's search text: a normal link (the visitor
 * chooses to go to GitHub), never fetched by the page.
 */
export function githubSearchUrl(org: string, text: string): string {
  const q = ["org:" + org, "is:issue", "is:open", ...text.trim().split(/\s+/).filter(Boolean)].join(" ");
  const encoded = encodeURIComponent(q).replace(/%20/g, "+").replace(/%3A/gi, ":");
  return `https://github.com/search?q=${encoded}&type=issues`;
}
