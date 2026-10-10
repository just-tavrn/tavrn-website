// SPDX-License-Identifier: Apache-2.0
/**
 * The visitor's operating system for the download page, from the three strings the browser offers anyway:
 * navigator.userAgentData.platform (Chromium), navigator.platform and the user agent. Nothing else is read, nothing
 * is stored or sent: the page only moves the matching card to the front.
 */
import type { Os } from "./releases.ts";

export interface PlatformHints {
  /** navigator.userAgentData?.platform: "Windows", "macOS", "Linux", "Android", "Chrome OS", "" (unknown). */
  uaPlatform?: string | null;
  /** navigator.platform: "Win32", "MacIntel", "Linux x86_64", "iPhone", … (deprecated, still everywhere). */
  platform?: string | null;
  userAgent?: string | null;
}

function fromPlatformName(value: string): Os | null {
  const v = value.toLowerCase();
  if (!v) return null;
  if (v.includes("android")) return "android";
  if (/iphone|ipad|ipod|\bios\b/.test(v)) return "ios";
  if (v.startsWith("win")) return "windows";
  if (v.startsWith("mac")) return "macos";
  // Chrome OS runs the Linux builds (Linux development environment) and Android apps; Linux is the closer fit.
  if (v.includes("linux") || v.includes("cros") || v.includes("chrome os") || v.includes("x11")) return "linux";
  return null;
}

function fromUserAgent(ua: string): Os | null {
  if (!ua) return null;
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Windows NT|Win64|Windows/i.test(ua)) return "windows";
  if (/Macintosh|Mac OS X/i.test(ua)) return "macos";
  if (/CrOS|Linux|X11/i.test(ua)) return "linux";
  return null;
}

/**
 * The operating system, or null when nothing is recognised. Client hints win when the browser offers them; then
 * the user agent (it keeps the OS token even in its reduced form), then navigator.platform.
 */
export function detectOs(hints: PlatformHints): Os | null {
  return fromPlatformName(hints.uaPlatform ?? "") ?? fromUserAgent(hints.userAgent ?? "") ?? fromPlatformName(hints.platform ?? "");
}
