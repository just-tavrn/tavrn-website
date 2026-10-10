// SPDX-License-Identifier: Apache-2.0
/**
 * The uptime history from Uptime Kuma (src/lib/kuma.ts): per monitor the 24-hour (and, if reported, 30-day) uptime
 * and a bar of the last 90 checks, plus the active incidents. Fetched through the site's proxy /uptime/… whenever
 * the live check runs; hidden with a one-line note when Kuma is not configured or answers something unexpected.
 */
import { useEffect, useState } from "react";
import { type Beat, type KumaHistory, parseKuma } from "../../lib/kuma";
import { fetchJson, type Message, type RuntimeConfig } from "../../lib/node-status";
import { noTranslate } from "./no-translate";

const BARS = 90;
/** The site's own proxy to Uptime Kuma's status-page API (deploy/Caddyfile: Kuma sends no CORS headers). */
export const KUMA_PROXY = "/uptime/api/status-page";

interface Props {
  config: RuntimeConfig | null;
  configMissing: boolean;
  round: number;
  s: (key: string, params?: Message["params"]) => string;
  strings: Record<string, string>;
  locale: string;
}

type State = { kind: "idle" } | { kind: "off" } | { kind: "error" } | { kind: "ready"; history: KumaHistory };

const TONE: Record<Beat["status"], string> = {
  up: "var(--color-ok)",
  down: "var(--color-danger)",
  pending: "var(--color-warn)",
  maintenance: "var(--color-accent)",
  unknown: "var(--color-line)",
};

export default function UptimeHistory({ config, configMissing, round, s, locale }: Props) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const enabled = !!config?.uptimeKumaUrl && !!config.uptimeKumaPage;

  useEffect(() => {
    if (!config) return;
    if (!enabled) {
      setState({ kind: "off" });
      return;
    }
    if (round === 0) return;
    let cancelled = false;
    const slug = encodeURIComponent(config.uptimeKumaPage);
    Promise.all([fetchJson(`${KUMA_PROXY}/${slug}`), fetchJson(`${KUMA_PROXY}/heartbeat/${slug}`)]).then(([page, beats]) => {
      if (cancelled) return;
      const history = page.ok && beats.ok ? parseKuma(page.data, beats.data, BARS) : null;
      // A failed refresh keeps the last good history on screen.
      setState((prev) => (history ? { kind: "ready", history } : prev.kind === "ready" ? prev : { kind: "error" }));
    });
    return () => {
      cancelled = true;
    };
  }, [config, enabled, round]);

  const pct = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 2 });
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const fmt = (d: Date | null) => (d ? dateTime.format(d) : "");
  const link = enabled && config && /^https:\/\//.test(config.uptimeKumaUrl) ? `${config.uptimeKumaUrl}/status/${encodeURIComponent(config.uptimeKumaPage)}` : null;

  let body;
  if (configMissing || state.kind === "off") body = <p className="ns-note">{s("status.history.unconfigured")}</p>;
  else if (state.kind === "error") body = <p className="ns-note">{s("status.history.unavailable")}</p>;
  else if (state.kind === "idle") body = <p className="ns-note">{" "}</p>;
  else if (state.history.monitors.length === 0 && state.history.incidents.length === 0) body = <p className="ns-note">{s("status.history.empty")}</p>;
  else {
    const { monitors, incidents } = state.history;
    const month = monitors.some((m) => m.uptime30d !== undefined);
    body = (
      <>
        {incidents.length > 0 && (
          <div className="ns-incidents">
            <h3 className="ns-h3">{s("status.history.incidents")}</h3>
            <ul>
              {incidents.map((i, n) => (
                <li key={n} className="ns-incident" data-style={i.style}>
                  <p className="ns-incident-title">{i.title}</p>
                  {i.content && <p className="ns-incident-text">{i.content}</p>}
                  <p className="ns-incident-date">
                    {i.created && <time dateTime={i.created.toISOString()}>{s("status.history.incident_date", { date: fmt(i.created) })}</time>}
                    {i.updated && i.updated.getTime() !== i.created?.getTime() && (
                      <>
                        {" · "}
                        <time dateTime={i.updated.toISOString()}>{s("status.history.incident_updated", { date: fmt(i.updated) })}</time>
                      </>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
        <ul className="ns-monitors">
          {monitors.map((m) => {
            const pad = Math.max(0, BARS - m.beats.length);
            const beats: Beat[] = [...Array.from({ length: pad }, (): Beat => ({ status: "unknown", time: null })), ...m.beats];
            const counts = m.beats.reduce<Record<string, number>>((c, b) => ({ ...c, [b.status]: (c[b.status] ?? 0) + 1 }), {});
            const summary = (["up", "down", "pending", "maintenance"] as const)
              .filter((k) => counts[k])
              .map((k) => `${counts[k]} ${s(`status.history.beat.${k}`)}`)
              .join(", ");
            return (
              <li key={m.id} className="ns-monitor" data-monitor={m.name}>
                <div className="ns-monitor-head">
                  <h3 className="ns-h3" ref={noTranslate}>
                    {m.name}
                  </h3>
                  <dl className="ns-uptime">
                    <div>
                      <dt>
                        {s("status.history.uptime_label")} {s("status.history.uptime_24h")}
                      </dt>
                      <dd>{m.uptime24h !== undefined ? pct.format(m.uptime24h) : "—"}</dd>
                    </div>
                    {month && (
                      <div>
                        <dt>
                          {s("status.history.uptime_label")} {s("status.history.uptime_30d")}
                        </dt>
                        <dd>{m.uptime30d !== undefined ? pct.format(m.uptime30d) : "—"}</dd>
                      </div>
                    )}
                  </dl>
                </div>
                <svg
                  className="ns-bar"
                  viewBox={`0 0 ${BARS * 6} 28`}
                  preserveAspectRatio="none"
                  role="img"
                  aria-label={`${s("status.history.bar_label", { count: m.beats.length, name: m.name })}${summary ? `: ${summary}` : ""}`}
                >
                  {beats.map((b, i) => (
                    <rect key={i} x={i * 6 + 1} y={0} width={4} height={28} rx={1.5} fill={TONE[b.status]} data-status={b.status}>
                      <title>{[s(`status.history.beat.${b.status}`), fmt(b.time)].filter(Boolean).join(" · ")}</title>
                    </rect>
                  ))}
                </svg>
              </li>
            );
          })}
        </ul>
        {link && (
          <p className="ns-more">
            <a className="link" href={link} rel="noopener">
              {s("status.history.more")}
            </a>
          </p>
        )}
      </>
    );
  }

  return (
    <section className="ns-card" aria-labelledby="ns-history" data-history={state.kind}>
      <h2 id="ns-history" className="ns-h2">
        {s("status.history.title")}
      </h2>
      {body}
    </section>
  );
}
