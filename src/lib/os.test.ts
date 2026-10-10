// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { detectOs } from "./os";

const UA = {
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  linux: "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0",
  android: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  cros: "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
};

describe("detectOs", () => {
  it("reads the user agent", () => {
    expect(detectOs({ userAgent: UA.windows })).toBe("windows");
    expect(detectOs({ userAgent: UA.mac })).toBe("macos");
    expect(detectOs({ userAgent: UA.linux })).toBe("linux");
    expect(detectOs({ userAgent: UA.android })).toBe("android");
    expect(detectOs({ userAgent: UA.iphone })).toBe("ios");
    expect(detectOs({ userAgent: UA.cros })).toBe("linux");
  });

  it("prefers the client hint", () => {
    expect(detectOs({ uaPlatform: "Windows", userAgent: UA.linux })).toBe("windows");
    expect(detectOs({ uaPlatform: "macOS" })).toBe("macos");
    expect(detectOs({ uaPlatform: "Android", platform: "Linux armv8l" })).toBe("android");
    expect(detectOs({ uaPlatform: "Chrome OS" })).toBe("linux");
  });

  it("ignores an empty client hint (an overridden user agent) and uses the user agent", () => {
    expect(detectOs({ uaPlatform: "", platform: "Linux x86_64", userAgent: UA.windows })).toBe("windows");
  });

  it("falls back to navigator.platform", () => {
    expect(detectOs({ platform: "Win32" })).toBe("windows");
    expect(detectOs({ platform: "MacIntel" })).toBe("macos");
    expect(detectOs({ platform: "Linux x86_64" })).toBe("linux");
    expect(detectOs({ platform: "iPhone" })).toBe("ios");
  });

  it("returns null when nothing is recognised", () => {
    expect(detectOs({})).toBeNull();
    expect(detectOs({ uaPlatform: null, platform: "", userAgent: "curl/8.0" })).toBeNull();
    expect(detectOs({ platform: "FreeBSD amd64" })).toBeNull();
  });
});
