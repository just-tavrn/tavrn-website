// SPDX-License-Identifier: Apache-2.0
/**
 * The live status of the official node: the runtime configuration (/config.json, served by Caddy), the answers of
 * the node's /healthz, /readyz and /api/v1/node, and the assessment the status page and the live dot of the header's "Status" link show.
 * Pure functions plus a fetch helper with a timeout; nothing is stored.
 */

export const TIMEOUT_MS = 8000;

export interface RuntimeConfig {
  appUrl: string;
  /** Base URL of the node, without a trailing slash. */
  nodeUrl: string;
  nodeDomain: string;
  uptimeKumaUrl: string;
  uptimeKumaPage: string;
}

export type VoiceState = "disabled" | "stopped" | "starting" | "running" | "restarting";

export interface Health {
  status: string;
  voice: VoiceState | string;
  voice_problem?: string;
}

export interface Readiness {
  ready: boolean;
  database: boolean;
  /** null: voice is switched off. */
  livekit: boolean | null;
  /** null: no shared cache configured. */
  cache: boolean | null;
}

export interface NodeInfo {
  domain: string;
  name: string;
  description: string;
  protocol: number;
  version: string;
  capabilities: string[];
  registration: string;
  voiceEnabled: boolean | null;
}

export type FetchError = "timeout" | "network" | "http" | "invalid";

export type FetchResult = { ok: true; status: number; data: unknown } | { ok: false; error: FetchError; status?: number; data?: unknown };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const httpUrl = (v: unknown): string | null => {
  if (typeof v !== "string" || v === "") return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? v.replace(/\/+$/, "") : null;
  } catch {
    return null;
  }
};

/** /config.json; null when the node URL is missing or not an http(s) URL. Empty optional values stay "". */
export function parseRuntimeConfig(value: unknown): RuntimeConfig | null {
  if (!isObj(value)) return null;
  const nodeUrl = httpUrl(value.nodeUrl);
  if (!nodeUrl) return null;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  return {
    appUrl: httpUrl(value.appUrl) ?? "",
    nodeUrl,
    nodeDomain: str(value.nodeDomain),
    uptimeKumaUrl: httpUrl(value.uptimeKumaUrl) ?? "",
    uptimeKumaPage: /^[a-z0-9-]+$/i.test(str(value.uptimeKumaPage)) ? str(value.uptimeKumaPage) : "",
  };
}

export function parseHealth(value: unknown): Health | null {
  if (!isObj(value) || typeof value.status !== "string" || typeof value.voice !== "string") return null;
  const health: Health = { status: value.status, voice: value.voice };
  if (typeof value.voice_problem === "string" && value.voice_problem) health.voice_problem = value.voice_problem;
  return health;
}

const optBool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

export function parseReadiness(value: unknown): Readiness | null {
  if (!isObj(value) || typeof value.ready !== "boolean" || typeof value.database !== "boolean") return null;
  return { ready: value.ready, database: value.database, livekit: optBool(value.livekit), cache: optBool(value.cache) };
}

export function parseNodeInfo(value: unknown): NodeInfo | null {
  if (!isObj(value) || typeof value.domain !== "string" || typeof value.version !== "string") return null;
  const voice = isObj(value.voice) ? value.voice : {};
  return {
    domain: value.domain,
    name: typeof value.name === "string" && value.name ? value.name : value.domain,
    description: typeof value.description === "string" ? value.description : "",
    protocol: typeof value.protocol === "number" ? value.protocol : NaN,
    version: value.version,
    capabilities: Array.isArray(value.capabilities) ? value.capabilities.filter((c): c is string => typeof c === "string") : [],
    registration: typeof value.registration === "string" ? value.registration : "",
    voiceEnabled: optBool(voice.enabled),
  };
}

/**
 * GET a JSON document with a timeout. Non-2xx answers are errors but keep their parsed body (/readyz answers 503
 * with the same document). No credentials, no cache, no referrer.
 */
export async function fetchJson(url: string, timeoutMs = TIMEOUT_MS, fetchImpl: typeof fetch = fetch): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      headers: { Accept: "application/json" },
    });
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      return response.ok ? { ok: false, error: "invalid", status: response.status } : { ok: false, error: "http", status: response.status };
    }
    return response.ok ? { ok: true, status: response.status, data } : { ok: false, error: "http", status: response.status, data };
  } catch {
    return { ok: false, error: controller.signal.aborted ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}

export type NodeState = "operational" | "degraded" | "unreachable";

/** A message key of en.json (status.*) with its parameters. */
export interface Message {
  key: string;
  params?: Record<string, string | number>;
}

export interface Assessment {
  state: NodeState;
  /** Why the node is degraded or unreachable, in words. */
  reasons: Message[];
  health: Health | null;
  readiness: Readiness | null;
  info: NodeInfo | null;
}

function errorMessage(result: Extract<FetchResult, { ok: false }>): Message {
  if (result.error === "http") return { key: "status.error.http", params: { status: result.status ?? 0 } };
  return { key: `status.error.${result.error}` };
}

/**
 * The state from the three answers: unreachable when /healthz fails; degraded when the node is not ready, /readyz
 * does not answer, or voice is (re)starting or has a setup problem; operational otherwise. A missing
 * /api/v1/node only costs the details.
 */
export function assess(healthz: FetchResult, readyz: FetchResult, node: FetchResult): Assessment {
  const health = healthz.ok ? parseHealth(healthz.data) : null;
  const readiness = parseReadiness(readyz.data);
  const info = node.ok ? parseNodeInfo(node.data) : null;
  if (!healthz.ok) return { state: "unreachable", reasons: [errorMessage(healthz)], health: null, readiness: null, info };
  if (!health) return { state: "unreachable", reasons: [{ key: "status.error.invalid" }], health: null, readiness: null, info };

  const reasons: Message[] = [];
  if (readiness && !readiness.ready) reasons.push({ key: "status.reason.not_ready" });
  else if (!readiness) reasons.push({ key: "status.reason.ready_unknown" });
  if (health.voice === "restarting") reasons.push({ key: "status.reason.voice_restarting" });
  if (health.voice === "starting") reasons.push({ key: "status.reason.voice_starting" });
  if (health.voice_problem) reasons.push({ key: "status.reason.voice_problem", params: { problem: health.voice_problem } });
  const state: NodeState = reasons.length > 0 ? "degraded" : "operational";
  if (!info) reasons.push({ key: "status.reason.info_unknown" });
  return { state, reasons, health, readiness, info };
}

/** Fills {name} placeholders of a UI string. */
export function fill(template: string, params?: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (params && name in params ? String(params[name]) : whole));
}
