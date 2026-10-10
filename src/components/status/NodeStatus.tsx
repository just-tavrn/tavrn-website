// SPDX-License-Identifier: Apache-2.0
/**
 * The live status of the official node (an island on /status only, client:load; written against the React API and
 * rendered by Preact through preact/compat, astro.config.mjs). Reads /config.json, then asks the node for /healthz,
 * /readyz and /api/v1/node on mount, every 60 seconds and on "Refresh now", each with an 8-second timeout. When
 * Uptime Kuma is configured, the uptime history comes through the site's own proxy (/uptime/…, deploy/Caddyfile).
 * Nothing is stored in the browser. Strings come from the page (src/i18n).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { assess, type Assessment, fetchJson, fill, type Message, parseRuntimeConfig, type RuntimeConfig } from "../../lib/node-status";
import { noTranslate } from "./no-translate";
import UptimeHistory from "./UptimeHistory";

const INTERVAL_MS = 60_000;

export interface Props {
  strings: Record<string, string>;
  locale: string;
}

type Config = { kind: "loading" } | { kind: "missing" } | { kind: "ready"; config: RuntimeConfig };

interface Check {
  assessment: Assessment;
  at: Date;
}

export default function NodeStatus({ strings, locale }: Props) {
  const s = useCallback((key: string, params?: Message["params"]) => fill(strings[key] ?? key, params), [strings]);
  const [config, setConfig] = useState<Config>({ kind: "loading" });
  const [check, setCheck] = useState<Check | null>(null);
  const [busy, setBusy] = useState(false);
  const [round, setRound] = useState(0);
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetchJson("/config.json").then((r) => {
      if (cancelled) return;
      const parsed = r.ok ? parseRuntimeConfig(r.data) : null;
      setConfig(parsed ? { kind: "ready", config: parsed } : { kind: "missing" });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const run = useCallback(async (cfg: RuntimeConfig) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    const [healthz, readyz, node] = await Promise.all([
      fetchJson(`${cfg.nodeUrl}/healthz`),
      fetchJson(`${cfg.nodeUrl}/readyz`),
      fetchJson(`${cfg.nodeUrl}/api/v1/node`),
    ]);
    setCheck({ assessment: assess(healthz, readyz, node), at: new Date() });
    setRound((n) => n + 1);
    setBusy(false);
    inFlight.current = false;
  }, []);

  useEffect(() => {
    if (config.kind !== "ready") return;
    void run(config.config);
    const timer = setInterval(() => void run(config.config), INTERVAL_MS);
    return () => clearInterval(timer);
  }, [config, run]);

  const a = check?.assessment;
  const state = config.kind === "missing" ? "unknown" : (a?.state ?? "checking");
  const stateText =
    config.kind === "missing" ? s("status.no_config") : a ? s(`status.${a.state}`) : s("status.checking");
  const info = a?.info;
  const health = a?.health;
  const ready = a?.readiness;
  const time = check ? new Intl.DateTimeFormat(locale, { timeStyle: "medium" }).format(check.at) : null;
  const dash = "—";
  const [lastBefore = "", lastAfter = ""] = (strings["status.last_checked"] ?? "{time}").split("{time}");

  const registration = info?.registration ? (strings[`status.registration.${info.registration}`] ?? info.registration) : dash;
  const voice = health ? (strings[`status.voice.${health.voice}`] ?? health.voice) : dash;
  const checkValue = (v: boolean | null | undefined): { tone: string; text: string } =>
    v === true
      ? { tone: "ok", text: s("status.check.ok") }
      : v === false
        ? { tone: "danger", text: s("status.check.failed") }
        : v === null
          ? { tone: "off", text: s("status.check.off") }
          : { tone: "unknown", text: s("status.check.unknown") };

  return (
    <div className="node-status" data-state={state} data-round={round}>
      <div className="ns-card ns-head">
        <p className="ns-label">{s("status.node_label")}</p>
        <p className="ns-state" aria-live="polite" data-ns-state>
          <span className="ns-dot" aria-hidden="true" />
          <span>{stateText}</span>
        </p>
        <p className="ns-node">
          {info ? (
            <>
              <span className="ns-node-name" ref={noTranslate}>{info.name}</span>
              {info.name !== info.domain && <span className="ns-node-domain" ref={noTranslate}>{info.domain}</span>}
            </>
          ) : (
            <span className="ns-node-domain" ref={noTranslate}>
              {config.kind === "ready" ? new URL(config.config.nodeUrl).host : " "}
            </span>
          )}
        </p>
        <div className="ns-messages" data-ns-messages>
          {a && a.reasons.length > 0 ? (
            <ul>
              {a.reasons.map((r) => (
                <li key={r.key}>{s(r.key, r.params)}</li>
              ))}
            </ul>
          ) : (
            <p>{config.kind === "missing" ? "" : s("status.auto_refresh")}</p>
          )}
        </div>
        <div className="ns-actions">
          <button
            type="button"
            className="btn btn-secondary ns-refresh"
            onClick={() => config.kind === "ready" && void run(config.config)}
            disabled={config.kind !== "ready"}
            aria-busy={busy}
          >
            {busy ? s("status.refreshing") : s("status.refresh")}
          </button>
          <p className="ns-time">
            {check && time ? (
              <>
                {lastBefore}
                <time dateTime={check.at.toISOString()}>{time}</time>
                {lastAfter}
              </>
            ) : (
              " "
            )}
          </p>
        </div>
      </div>

      <section className="ns-card" aria-labelledby="ns-details">
        <h2 id="ns-details" className="ns-h2">
          {s("status.details")}
        </h2>
        <dl className="ns-fields">
          <div>
            <dt>{s("status.field.domain")}</dt>
            <dd ref={noTranslate}>{info?.domain ?? (config.kind === "ready" && config.config.nodeDomain ? config.config.nodeDomain : dash)}</dd>
          </div>
          <div>
            <dt>{s("status.field.software")}</dt>
            <dd ref={noTranslate}>{info?.version ?? dash}</dd>
          </div>
          <div>
            <dt>{s("status.field.protocol")}</dt>
            <dd ref={noTranslate}>{info && Number.isFinite(info.protocol) ? info.protocol : dash}</dd>
          </div>
          <div>
            <dt>{s("status.field.registration")}</dt>
            <dd>{registration}</dd>
          </div>
          <div>
            <dt>{s("status.field.voice")}</dt>
            <dd data-voice={health?.voice ?? ""}>{voice}</dd>
          </div>
          <div>
            <dt>{s("status.field.checks")}</dt>
            <dd>
              <ul className="ns-checks">
                {(["database", "livekit", "cache"] as const).map((k) => {
                  const v = checkValue(ready ? ready[k] : undefined);
                  return (
                    <li key={k} data-check={k} data-tone={v.tone}>
                      <span className="ns-check-dot" aria-hidden="true" />
                      {s(`status.check.${k}`)}: {v.text}
                    </li>
                  );
                })}
              </ul>
            </dd>
          </div>
        </dl>
        <details className="ns-caps">
          <summary>{s("status.capabilities", { count: info ? info.capabilities.length : dash })}</summary>
          <p className="ns-caps-hint">{s("status.capabilities_hint")}</p>
          <ul ref={noTranslate}>
            {(info?.capabilities ?? []).map((c) => (
              <li key={c}>
                <code>{c}</code>
              </li>
            ))}
          </ul>
        </details>
      </section>

      <UptimeHistory config={config.kind === "ready" ? config.config : null} configMissing={config.kind === "missing"} round={round} s={s} strings={strings} locale={locale} />
    </div>
  );
}
