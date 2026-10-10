// SPDX-License-Identifier: Apache-2.0
/**
 * The pure part of the download page's checksum verifier: normalising pasted checksums (hex or base64, SHA-256 or
 * SHA-512, whitespace and "sha256:" prefixes tolerated), the index of the release's known checksums by hash, and the
 * comparison. The page computes the digests with crypto.subtle on the visitor's device; nothing is uploaded.
 */

export type Algo = "sha256" | "sha512";

/** Files above this size are not read into memory; the card's command line check is the way for them. */
export const MAX_BYTES = 1024 ** 3;

export interface Digests {
  sha256: string;
  sha512?: string;
}

/** A known checksum of the release, both values as lowercase hex. */
export interface KnownFile {
  name: string;
  sha256?: string;
  sha512?: string;
}

const HEX_LENGTH: Record<number, Algo> = { 64: "sha256", 128: "sha512" };
const BYTE_LENGTH: Record<number, Algo> = { 32: "sha256", 64: "sha512" };

export function bytesToHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let hex = "";
  for (const b of view) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/** Standard or URL-safe base64, with or without padding, to bytes; null when it is not base64. */
export function base64ToBytes(value: string): Uint8Array | null {
  const clean = value.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  if (!/^[A-Za-z0-9+/]+$/.test(clean) || clean.length % 4 === 1) return null;
  try {
    const binary = atob(clean + "=".repeat((4 - (clean.length % 4)) % 4));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export function hexToBase64(hex: string): string {
  const pairs = hex.match(/../g) ?? [];
  return btoa(String.fromCharCode(...pairs.map((p) => parseInt(p, 16))));
}

/**
 * A pasted checksum as algorithm and lowercase hex: whitespace anywhere, a leading "sha256:"/"sha512:" (also
 * "SHA256=", "sha-256 ") and surrounding quotes are ignored; 64/128 hex digits or base64 of 32/64 bytes. A pasted
 * sha256sum line ("<hex>  <name>") yields its hash. Null for anything else.
 */
export function normalizeChecksum(input: string): { algo: Algo; hex: string } | null {
  let value = input.trim().replace(/^["'`]|["'`]$/g, "");
  const line = /^([a-f0-9]{64}|[a-f0-9]{128})\s+\*?\S/i.exec(value);
  if (line) value = line[1]!;
  value = value.replace(/^sha-?(256|512)\s*[:=]?\s*/i, "").replace(/\s+/g, "");
  if (/^[a-f0-9]+$/i.test(value) && HEX_LENGTH[value.length]) return { algo: HEX_LENGTH[value.length]!, hex: value.toLowerCase() };
  const bytes = base64ToBytes(value);
  if (bytes && BYTE_LENGTH[bytes.length]) return { algo: BYTE_LENGTH[bytes.length]!, hex: bytesToHex(bytes) };
  return null;
}

/** The known checksums of downloads.json's assets (SHA-256 hex, SHA-512 base64) as hex, without empty entries. */
export function buildIndex(assets: { name: string; checksum?: string; sha512?: string }[]): KnownFile[] {
  const index: KnownFile[] = [];
  for (const a of assets) {
    const entry: KnownFile = { name: a.name };
    if (a.checksum) entry.sha256 = normalizeChecksum(a.checksum)?.hex;
    if (a.sha512) entry.sha512 = normalizeChecksum(a.sha512)?.hex;
    if (entry.sha256 || entry.sha512) index.push(entry);
  }
  return index;
}

/** Whether any known file has a SHA-512, i.e. whether the page should compute it too. */
export function needsSha512(index: KnownFile[]): boolean {
  return index.some((f) => f.sha512);
}

/** The known file whose checksum equals the computed one, SHA-256 first, then SHA-512. */
export function findMatch(index: KnownFile[], digests: Digests): { name: string; algo: Algo } | null {
  const by256 = index.find((f) => f.sha256 && f.sha256 === digests.sha256);
  if (by256) return { name: by256.name, algo: "sha256" };
  const by512 = digests.sha512 ? index.find((f) => f.sha512 && f.sha512 === digests.sha512) : undefined;
  return by512 ? { name: by512.name, algo: "sha512" } : null;
}

/** Whether a normalised pasted checksum equals the computed digest of its algorithm (false when not computed). */
export function matchesExpected(expected: { algo: Algo; hex: string }, digests: Digests): boolean {
  const computed = expected.algo === "sha256" ? digests.sha256 : digests.sha512;
  return computed !== undefined && computed === expected.hex;
}

/** "SHA-256" / "SHA-512" for messages. */
export function algoLabel(algo: Algo): string {
  return algo === "sha256" ? "SHA-256" : "SHA-512";
}
