// SPDX-License-Identifier: Apache-2.0
/**
 * The uptime history of the status page from Uptime Kuma's public status-page API (checked against Uptime Kuma's
 * server/routers/status-page-router.js and its models, 1.23 and 2.x):
 *
 *   GET /api/status-page/<slug>            { config, incidents: [..] (2.x) | incident: {..} | null (1.x),
 *                                            publicGroupList: [{ name, monitorList: [{ id, name }] }], maintenanceList }
 *   GET /api/status-page/heartbeat/<slug>  { heartbeatList: { "<id>": [{ status, time, msg, ping }] (oldest first,
 *                                            up to 100) }, uptimeList: { "<id>_24": 0.998 } }
 *
 * Heartbeat status: 0 down, 1 up, 2 pending, 3 maintenance. Times are UTC as "YYYY-MM-DD HH:mm:ss(.SSS)". Kuma
 * reports the 24-hour uptime only; a 30-day value ("<id>_720") is shown when an instance provides it. Kuma sends
 * no CORS headers outside development, so the site's own Caddy proxies these two paths (deploy/Caddyfile).
 * Unknown shapes give null and the page hides the section.
 */

export type BeatStatus = "up" | "down" | "pending" | "maintenance" | "unknown";

export interface Beat {
  status: BeatStatus;
  time: Date | null;
}

export interface KumaMonitor {
  id: string;
  name: string;
  /** Ratios 0..1, undefined when Kuma does not report them. */
  uptime24h?: number;
  uptime30d?: number;
  beats: Beat[];
}

export interface KumaIncident {
  title: string;
  content: string;
  style: string;
  created: Date | null;
  updated: Date | null;
}

export interface KumaHistory {
  monitors: KumaMonitor[];
  incidents: KumaIncident[];
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const STATUS: Record<number, BeatStatus> = { 0: "down", 1: "up", 2: "pending", 3: "maintenance" };

/** Kuma's UTC timestamps ("2026-10-10 12:00:00.123", also ISO strings with a zone). */
export function parseKumaTime(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  let s = value.trim().replace(" ", "T");
  if (!/[zZ]|[+-]\d\d:?\d\d$/.test(s)) s += "Z";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function ratio(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return undefined;
  return n > 1 ? Math.min(n / 100, 1) : n;
}

function parseIncident(value: unknown): KumaIncident | null {
  if (!isObj(value) || typeof value.title !== "string") return null;
  return {
    title: value.title,
    content: typeof value.content === "string" ? value.content : "",
    style: typeof value.style === "string" ? value.style : "info",
    created: parseKumaTime(value.createdDate),
    updated: parseKumaTime(value.lastUpdatedDate),
  };
}

/** Both answers combined; `limit` keeps the newest heartbeats per monitor. Null when the shape is not Kuma's. */
export function parseKuma(page: unknown, heartbeat: unknown, limit = 90): KumaHistory | null {
  if (!isObj(page) || !Array.isArray(page.publicGroupList) || !isObj(heartbeat) || !isObj(heartbeat.heartbeatList)) return null;
  const beatsById = heartbeat.heartbeatList;
  const uptime = isObj(heartbeat.uptimeList) ? heartbeat.uptimeList : {};

  const monitors: KumaMonitor[] = [];
  const seen = new Set<string>();
  for (const group of page.publicGroupList) {
    if (!isObj(group) || !Array.isArray(group.monitorList)) continue;
    for (const m of group.monitorList) {
      if (!isObj(m) || (typeof m.id !== "number" && typeof m.id !== "string") || typeof m.name !== "string") continue;
      const id = String(m.id);
      if (seen.has(id)) continue;
      seen.add(id);
      const list = Array.isArray(beatsById[id]) ? (beatsById[id] as unknown[]) : [];
      const beats = list
        .filter(isObj)
        .map((b): Beat => ({ status: STATUS[b.status as number] ?? "unknown", time: parseKumaTime(b.time) }))
        .slice(-limit);
      const monitor: KumaMonitor = { id, name: m.name, beats };
      const day = ratio(uptime[`${id}_24`]);
      const month = ratio(uptime[`${id}_720`]);
      if (day !== undefined) monitor.uptime24h = day;
      if (month !== undefined) monitor.uptime30d = month;
      monitors.push(monitor);
    }
  }

  const rawIncidents = Array.isArray(page.incidents) ? page.incidents : page.incident ? [page.incident] : [];
  const incidents = rawIncidents.map(parseIncident).filter((i): i is KumaIncident => i !== null);
  return { monitors, incidents };
}
