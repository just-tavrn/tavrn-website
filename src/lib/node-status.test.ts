// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import { assess, fetchJson, type FetchResult, fill, parseNodeInfo, parseRuntimeConfig } from "./node-status";

const ok = (data: unknown): FetchResult => ({ ok: true, status: 200, data });
const HEALTH = { status: "ok", voice: "running" };
const READY = { ready: true, database: true, livekit: true, cache: null };
const NODE = {
  domain: "tavrn.org",
  name: "tavrn",
  description: "The official node",
  protocol: 1,
  version: "0.2.0",
  capabilities: ["content.v1", "federation", 7],
  registration: "invite",
  voice: { enabled: true, max_bitrate_kbps: 96 },
};

describe("parseRuntimeConfig", () => {
  it("reads the values Caddy serves and trims trailing slashes", () => {
    expect(
      parseRuntimeConfig({
        appUrl: "https://app.example/",
        nodeUrl: "https://node.example/",
        nodeDomain: "example.org",
        uptimeKumaUrl: "https://status.example",
        uptimeKumaPage: "tavrn",
      }),
    ).toEqual({
      appUrl: "https://app.example",
      nodeUrl: "https://node.example",
      nodeDomain: "example.org",
      uptimeKumaUrl: "https://status.example",
      uptimeKumaPage: "tavrn",
    });
  });

  it("needs an http(s) node URL", () => {
    expect(parseRuntimeConfig({ nodeUrl: "javascript:alert(1)" })).toBeNull();
    expect(parseRuntimeConfig({ nodeUrl: "" })).toBeNull();
    expect(parseRuntimeConfig(null)).toBeNull();
    expect(parseRuntimeConfig("x")).toBeNull();
  });

  it("drops unusable optional values", () => {
    const c = parseRuntimeConfig({ nodeUrl: "https://n.example", uptimeKumaUrl: "ftp://x", uptimeKumaPage: "../admin" });
    expect(c?.uptimeKumaUrl).toBe("");
    expect(c?.uptimeKumaPage).toBe("");
  });
});

describe("parseNodeInfo", () => {
  it("keeps the fields the page shows", () => {
    expect(parseNodeInfo(NODE)).toEqual({
      domain: "tavrn.org",
      name: "tavrn",
      description: "The official node",
      protocol: 1,
      version: "0.2.0",
      capabilities: ["content.v1", "federation"],
      registration: "invite",
      voiceEnabled: true,
    });
    expect(parseNodeInfo({ domain: "x" })).toBeNull();
  });
});

describe("assess", () => {
  it("is operational when everything answers", () => {
    const a = assess(ok(HEALTH), ok(READY), ok(NODE));
    expect(a.state).toBe("operational");
    expect(a.reasons).toEqual([]);
    expect(a.info?.version).toBe("0.2.0");
  });

  it("is unreachable when /healthz fails, with the reason in words", () => {
    expect(assess({ ok: false, error: "timeout" }, { ok: false, error: "timeout" }, { ok: false, error: "timeout" })).toMatchObject({
      state: "unreachable",
      reasons: [{ key: "status.error.timeout" }],
    });
    expect(assess({ ok: false, error: "http", status: 502 }, ok(READY), ok(NODE)).reasons).toEqual([
      { key: "status.error.http", params: { status: 502 } },
    ]);
    expect(assess(ok({ nope: 1 }), ok(READY), ok(NODE))).toMatchObject({ state: "unreachable", reasons: [{ key: "status.error.invalid" }] });
  });

  it("is degraded when /readyz answers 503 and voice restarts", () => {
    const a = assess(ok({ status: "ok", voice: "restarting" }), { ok: false, error: "http", status: 503, data: { ...READY, ready: false, livekit: false } }, ok(NODE));
    expect(a.state).toBe("degraded");
    expect(a.reasons.map((r) => r.key)).toEqual(["status.reason.not_ready", "status.reason.voice_restarting"]);
    expect(a.readiness?.livekit).toBe(false);
  });

  it("is degraded with a voice setup problem or an unknown readiness", () => {
    const a = assess(ok({ ...HEALTH, voice_problem: "no address resolves" }), { ok: false, error: "network" }, ok(NODE));
    expect(a.state).toBe("degraded");
    expect(a.reasons).toEqual([
      { key: "status.reason.ready_unknown" },
      { key: "status.reason.voice_problem", params: { problem: "no address resolves" } },
    ]);
  });

  it("stays operational without the node details, but says so", () => {
    const a = assess(ok(HEALTH), ok(READY), { ok: false, error: "network" });
    expect(a.state).toBe("operational");
    expect(a.reasons).toEqual([{ key: "status.reason.info_unknown" }]);
  });

  it("does not count switched-off voice as a problem", () => {
    expect(assess(ok({ status: "ok", voice: "disabled" }), ok({ ...READY, livekit: null }), ok(NODE)).state).toBe("operational");
  });
});

describe("fetchJson", () => {
  const respond = (status: number, body: string) => vi.fn(async () => new Response(body, { status }));

  it("returns the parsed body", async () => {
    expect(await fetchJson("https://n.example/healthz", 1000, respond(200, '{"status":"ok"}'))).toEqual({ ok: true, status: 200, data: { status: "ok" } });
  });

  it("keeps the body of an error answer", async () => {
    expect(await fetchJson("https://n.example/readyz", 1000, respond(503, '{"ready":false}'))).toEqual({
      ok: false,
      error: "http",
      status: 503,
      data: { ready: false },
    });
  });

  it("reports invalid JSON, network errors and timeouts", async () => {
    expect(await fetchJson("x", 1000, respond(200, "<html>"))).toMatchObject({ ok: false, error: "invalid" });
    expect(await fetchJson("x", 1000, vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))))).toEqual({ ok: false, error: "network" });
    const hang = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
    );
    expect(await fetchJson("x", 20, hang as unknown as typeof fetch)).toEqual({ ok: false, error: "timeout" });
  });

  it("sends no credentials and no referrer", async () => {
    const f = respond(200, "{}");
    await fetchJson("https://n.example/healthz", 1000, f);
    expect(f.mock.calls[0]).toBeDefined();
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init).toMatchObject({ credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" });
  });
});

describe("fill", () => {
  it("fills placeholders and leaves unknown ones", () => {
    expect(fill("Last checked {time} {x}", { time: "12:00:01" })).toBe("Last checked 12:00:01 {x}");
  });
});
