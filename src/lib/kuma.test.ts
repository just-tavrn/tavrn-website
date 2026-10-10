// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import heartbeat from "../../e2e/fixtures/kuma-heartbeat.json";
import page from "../../e2e/fixtures/kuma-status-page.json";
import { parseKuma, parseKumaTime } from "./kuma";

describe("parseKumaTime", () => {
  it("reads Kuma's UTC timestamps", () => {
    expect(parseKumaTime("2026-10-10 08:15:00")?.toISOString()).toBe("2026-10-10T08:15:00.000Z");
    expect(parseKumaTime("2026-10-10 08:15:00.123")?.toISOString()).toBe("2026-10-10T08:15:00.123Z");
    expect(parseKumaTime("2026-10-10T08:15:00+02:00")?.toISOString()).toBe("2026-10-10T06:15:00.000Z");
    expect(parseKumaTime("yesterday")).toBeNull();
    expect(parseKumaTime(null)).toBeNull();
  });
});

describe("parseKuma", () => {
  const history = parseKuma(page, heartbeat)!;

  it("lists the public monitors with their uptime", () => {
    expect(history.monitors.map((m) => [m.name, m.uptime24h, m.uptime30d])).toEqual([
      ["Node API", 0.9712, undefined],
      ["Web app", 1, undefined],
    ]);
  });

  it("keeps the newest 90 heartbeats, oldest first, with their states", () => {
    const api = history.monitors[0]!;
    expect(api.beats).toHaveLength(90);
    expect(api.beats[0]!.time?.toISOString()).toBe("2026-10-10T06:10:00.000Z");
    expect(api.beats.filter((b) => b.status === "down")).toHaveLength(2);
    expect(api.beats.filter((b) => b.status === "pending")).toHaveLength(1);
    expect(history.monitors[1]!.beats.at(-1)!.status).toBe("maintenance");
  });

  it("reads the active incidents of Kuma 2 and the single incident of Kuma 1", () => {
    expect(history.incidents).toHaveLength(1);
    expect(history.incidents[0]).toMatchObject({ title: "Voice degraded in Europe", style: "warning" });
    expect(history.incidents[0]!.created?.toISOString()).toBe("2026-10-10T08:15:00.000Z");
    const v1 = parseKuma({ ...page, incidents: undefined, incident: page.incidents[0] }, heartbeat)!;
    expect(v1.incidents).toHaveLength(1);
    expect(parseKuma({ ...page, incidents: undefined, incident: null }, heartbeat)!.incidents).toEqual([]);
  });

  it("reads a 30-day uptime when an instance reports one, and percentages defensively", () => {
    const h = parseKuma(page, { ...heartbeat, uptimeList: { "1_24": 99.5, "1_720": 0.999 } })!;
    expect(h.monitors[0]!.uptime24h).toBeCloseTo(0.995);
    expect(h.monitors[0]!.uptime30d).toBe(0.999);
  });

  it("maps unknown heartbeat states to unknown and tolerates missing lists", () => {
    const h = parseKuma(page, { heartbeatList: { "1": [{ status: 9, time: "x" }] } })!;
    expect(h.monitors[0]!.beats).toEqual([{ status: "unknown", time: null }]);
    expect(h.monitors[1]!.beats).toEqual([]);
  });

  it("returns null for shapes that are not Kuma's", () => {
    expect(parseKuma({}, heartbeat)).toBeNull();
    expect(parseKuma(page, { heartbeats: [] })).toBeNull();
    expect(parseKuma("<html>", "<html>")).toBeNull();
  });
});
