// SPDX-License-Identifier: Apache-2.0
/**
 * The list of known issues (an island on /issues only, client:load; written against the React API and rendered by
 * Preact through preact/compat, like the status page). It reads /gh/issues, which the site's own server fetches
 * from GitHub's issue search (deploy/Caddyfile): the browser never contacts GitHub. Issues are grouped by area,
 * with a type badge and a status (src/lib/issues.ts decides both); search, area and type filters and the order
 * work on the loaded list, instantly and without storing anything. 404 means the server has no GitHub token yet:
 * the page then points to GitHub. Strings come from the page (src/i18n).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  areasIn,
  filterIssues,
  githubSearchUrl,
  groupByArea,
  type Issue,
  type IssueList,
  parseSearch,
  relativeTime,
  typesIn,
} from "../../lib/issues";
import { fill } from "../../lib/node-status";
import { noTranslate } from "../status/no-translate";

/** The site's own proxy to GitHub's issue search (deploy/Caddyfile). */
export const ISSUES_PROXY = "/gh/issues";
const TIMEOUT_MS = 15_000;

export interface Props {
  strings: Record<string, string>;
  locale: string;
  /** The GitHub organization (build-time PUBLIC_GITHUB_ORG) for the links to GitHub. */
  org: string;
}

type Load = { kind: "loading" } | { kind: "unavailable" } | { kind: "error" } | { kind: "ready"; list: IssueList; now: Date };
type Order = "area" | "updated";

async function load(): Promise<Load> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // The browser may use its cached copy: the server marks the answer cacheable for five minutes.
    const response = await fetch(ISSUES_PROXY, {
      signal: controller.signal,
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: { Accept: "application/json" },
    });
    if (response.status === 404) return { kind: "unavailable" };
    if (!response.ok) return { kind: "error" };
    const list = parseSearch(await response.json());
    return list ? { kind: "ready", list, now: new Date() } : { kind: "error" };
  } catch {
    return { kind: "error" };
  } finally {
    clearTimeout(timer);
  }
}

function toggle(set: ReadonlySet<string>, value: string): Set<string> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export default function KnownIssues({ strings, locale, org }: Props) {
  const s = useCallback((key: string, params?: Record<string, string | number>) => fill(strings[key] ?? key, params), [strings]);
  const plural = useMemo(() => new Intl.PluralRules(locale), [locale]);
  const sp = (key: string, count: number, params?: Record<string, string | number>) => {
    const form = `${key}.${plural.select(count)}`;
    return s(strings[form] !== undefined ? form : `${key}.other`, { count, ...params });
  };

  const [state, setState] = useState<Load>({ kind: "loading" });
  const [text, setText] = useState("");
  const [areas, setAreas] = useState<ReadonlySet<string>>(new Set());
  const [types, setTypes] = useState<ReadonlySet<string>>(new Set());
  const [order, setOrder] = useState<Order>("area");

  const run = useCallback(() => {
    setState({ kind: "loading" });
    void load().then(setState);
  }, []);
  useEffect(run, [run]);

  const all = state.kind === "ready" ? state.list.issues : [];
  const areaFacets = useMemo(() => areasIn(all), [all]);
  const typeFacets = useMemo(() => typesIn(all), [all]);
  const shown = useMemo(() => filterIssues(all, { text, areas, types }), [all, text, areas, types]);
  const filtered = text.trim() !== "" || areas.size > 0 || types.size > 0;
  const clear = () => {
    setText("");
    setAreas(new Set());
    setTypes(new Set());
  };

  const githubLink = (label: string, query = "") => (
    <a className="link" href={githubSearchUrl(org, query)} rel="noopener">
      {label}
      <span className="sr-only"> {s("issues.external")}</span>
    </a>
  );

  const dateFormat = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short" }), [locale]);
  const when = (key: string, date: Date | null, now: Date) => {
    if (!date) return null;
    const [before = "", after = ""] = s(key).split("{time}");
    return (
      <span>
        {before}
        <time dateTime={date.toISOString()} title={dateFormat.format(date)}>
          {relativeTime(date, now, locale)}
        </time>
        {after}
      </span>
    );
  };

  const issueItem = (issue: Issue, now: Date, showArea: boolean) => (
    <li key={`${issue.repo}#${issue.number}`} className="ki-issue" data-type={issue.type} data-status={issue.status}>
      <div className="ki-issue-head">
        <span className="ki-type" data-type={issue.type}>
          {s(`issues.type.${issue.type}`)}
        </span>
        <a className="ki-issue-title" href={issue.url} rel="noopener">
          {issue.title}
        </a>
      </div>
      <p className="ki-issue-meta">
        <span className="ki-status" data-status={issue.status}>
          <span className="sr-only">{s("issues.status_label")} </span>
          {s(`issues.status.${issue.status}`)}
        </span>
        {issue.badges.map((b) => (
          <span key={b} className="ki-badge">
            {s(`issues.badge.${b}`)}
          </span>
        ))}
        <span className="ki-ref">
          {showArea && <>{s(`issues.area.${issue.area}`)} · </>}
          <span ref={noTranslate}>{issue.repo}</span> #{issue.number}
        </span>
        {when("issues.opened", issue.created, now)}
        {when("issues.updated", issue.updated, now)}
        <span>{sp("issues.comments", issue.comments)}</span>
      </p>
      {issue.labels.length > 0 && (
        <ul className="ki-labels" aria-label={s("issues.labels")}>
          {issue.labels.map((l) => (
            <li key={l.name} className="ki-label">
              <span className="ki-dot" aria-hidden="true" style={l.color ? { background: `#${l.color}` } : undefined} />
              {l.name}
            </li>
          ))}
        </ul>
      )}
    </li>
  );

  if (state.kind === "loading") {
    return (
      <div className="known-issues" data-state="loading" aria-busy="true">
        <p className="ki-message">{s("issues.loading")}</p>
      </div>
    );
  }
  if (state.kind === "unavailable") {
    return (
      <div className="known-issues" data-state="unavailable">
        <p className="ki-message">{s("issues.unavailable")}</p>
        <p className="ki-message">{githubLink(s("issues.unavailable_link"))}</p>
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="known-issues" data-state="error">
        <p className="ki-message" role="alert">
          {s("issues.error")}
        </p>
        <div className="ki-actions">
          <button type="button" className="btn btn-secondary" onClick={run}>
            {s("issues.retry")}
          </button>
          {githubLink(s("issues.unavailable_link"))}
        </div>
      </div>
    );
  }

  const { list, now } = state;
  const count = filtered ? s("issues.count_filtered", { shown: shown.length, total: all.length }) : sp("issues.count_all", all.length);

  return (
    <div className="known-issues" data-state="ready">
      <div className="ki-search">
        <label htmlFor="ki-search-input" className="ki-search-label">
          {s("issues.search_label")}
        </label>
        <div className="ki-search-row">
          <input
            id="ki-search-input"
            type="search"
            className="ki-input"
            value={text}
            onInput={(e) => setText((e.target as HTMLInputElement).value)}
            aria-describedby="ki-search-hint"
            autoComplete="off"
            spellcheck={false}
          />
          {githubLink(s("issues.search_github"), text)}
        </div>
        <p id="ki-search-hint" className="ki-hint">
          {s("issues.search_hint")}
        </p>
      </div>

      {areaFacets.length > 1 && (
        <div className="ki-chips" role="group" aria-labelledby="ki-areas-label">
          <span id="ki-areas-label" className="ki-chips-label">
            {s("issues.filter_areas")}
          </span>
          {areaFacets.map((a) => (
            <button key={a.id} type="button" className="ki-chip" aria-pressed={areas.has(a.id)} onClick={() => setAreas(toggle(areas, a.id))}>
              {s(`issues.area.${a.id}`)}
              <span className="ki-chip-count">{a.count}</span>
            </button>
          ))}
        </div>
      )}
      {typeFacets.length > 1 && (
        <div className="ki-chips" role="group" aria-labelledby="ki-types-label">
          <span id="ki-types-label" className="ki-chips-label">
            {s("issues.filter_types")}
          </span>
          {typeFacets.map((t) => (
            <button key={t.id} type="button" className="ki-chip" aria-pressed={types.has(t.id)} onClick={() => setTypes(toggle(types, t.id))}>
              <span className="ki-type-dot" data-type={t.id} aria-hidden="true" />
              {s(`issues.type.${t.id}`)}
              <span className="ki-chip-count">{t.count}</span>
            </button>
          ))}
        </div>
      )}

      <div className="ki-toolbar">
        <p className="ki-count" aria-live="polite" data-ki-count>
          {count}
        </p>
        <div className="ki-order" role="group" aria-labelledby="ki-order-label">
          <span id="ki-order-label" className="ki-chips-label">
            {s("issues.order")}
          </span>
          {(["area", "updated"] as const).map((o) => (
            <button key={o} type="button" className="ki-chip" aria-pressed={order === o} onClick={() => setOrder(o)}>
              {s(`issues.order_${o}`)}
            </button>
          ))}
        </div>
        {filtered && (
          <button type="button" className="btn btn-secondary ki-clear" onClick={clear}>
            {s("issues.clear")}
          </button>
        )}
      </div>

      {list.partial && <p className="ki-note">{s("issues.partial", { count: list.received, total: list.total })}</p>}

      {all.length === 0 ? (
        <p className="ki-message">{s("issues.empty")}</p>
      ) : shown.length === 0 ? (
        <p className="ki-message">{s("issues.no_match")}</p>
      ) : order === "area" ? (
        groupByArea(shown).map((g) => (
          <section key={g.area} className="ki-group" aria-labelledby={`ki-area-${g.area}`}>
            <h2 id={`ki-area-${g.area}`} className="ki-group-title">
              {s(`issues.area.${g.area}`)} <span className="ki-group-count">({g.issues.length})</span>
            </h2>
            <ul className="ki-list">{g.issues.map((i) => issueItem(i, now, false))}</ul>
          </section>
        ))
      ) : (
        <ul className="ki-list">{shown.map((i) => issueItem(i, now, true))}</ul>
      )}
    </div>
  );
}
