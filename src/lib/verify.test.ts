// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import downloads from "../data/downloads.json";
import {
  base64ToBytes,
  buildIndex,
  bytesToHex,
  findMatch,
  hexToBase64,
  matchesExpected,
  needsSha512,
  normalizeChecksum,
} from "./verify";

const installer = readFileSync(new URL("../../e2e/fixtures/example-installer.bin", import.meta.url));
const appImage = readFileSync(new URL("../../e2e/fixtures/example-appimage.bin", import.meta.url));
const hex = (algo: string, data: Buffer) => createHash(algo).update(data).digest("hex");
const b64 = (algo: string, data: Buffer) => createHash(algo).update(data).digest("base64");

describe("hex and base64", () => {
  it("round-trips", () => {
    const h = hex("sha256", installer);
    expect(bytesToHex(base64ToBytes(hexToBase64(h))!)).toBe(h);
    expect(bytesToHex(new Uint8Array([0, 15, 255]))).toBe("000fff");
  });

  it("accepts URL-safe and unpadded base64, rejects the rest", () => {
    expect(base64ToBytes("-_8")).toEqual(new Uint8Array([251, 255]));
    expect(base64ToBytes("not base64!")).toBeNull();
    expect(base64ToBytes("a")).toBeNull();
  });
});

describe("normalizeChecksum", () => {
  const h256 = hex("sha256", installer);
  const h512 = hex("sha512", appImage);

  it("reads hex of both lengths, any case, with whitespace", () => {
    expect(normalizeChecksum(h256.toUpperCase())).toEqual({ algo: "sha256", hex: h256 });
    expect(normalizeChecksum(`  ${h256.slice(0, 32)}\n ${h256.slice(32)}  `)).toEqual({ algo: "sha256", hex: h256 });
    expect(normalizeChecksum(h512)).toEqual({ algo: "sha512", hex: h512 });
  });

  it("reads base64 (electron-updater's SHA-512, GitHub's base64 digests)", () => {
    expect(normalizeChecksum(b64("sha512", appImage))).toEqual({ algo: "sha512", hex: h512 });
    expect(normalizeChecksum(b64("sha256", installer))).toEqual({ algo: "sha256", hex: h256 });
  });

  it("ignores prefixes, quotes and the file name of a sha256sum line", () => {
    expect(normalizeChecksum(`sha256:${h256}`)).toEqual({ algo: "sha256", hex: h256 });
    expect(normalizeChecksum(`SHA256=${h256}`)).toEqual({ algo: "sha256", hex: h256 });
    expect(normalizeChecksum(`"${h256}"`)).toEqual({ algo: "sha256", hex: h256 });
    expect(normalizeChecksum(`${h256}  Tavrn_0.2.0_x64-setup.exe`)).toEqual({ algo: "sha256", hex: h256 });
    expect(normalizeChecksum(`sha512: ${b64("sha512", appImage)}`)).toEqual({ algo: "sha512", hex: h512 });
  });

  it("rejects values of the wrong length or alphabet", () => {
    expect(normalizeChecksum("")).toBeNull();
    expect(normalizeChecksum(h256.slice(1))).toBeNull();
    expect(normalizeChecksum("z".repeat(64))).toBeNull();
    expect(normalizeChecksum("hello world")).toBeNull();
  });
});

describe("index, lookup and comparison", () => {
  const index = buildIndex(downloads.web.assets);

  it("holds the example checksums, which are the e2e fixtures' (src/data/downloads.json)", () => {
    expect(index.find((f) => f.name === "Tavrn_0.2.0_x64-setup.exe")?.sha256).toBe(hex("sha256", installer));
    expect(index.find((f) => f.name === "Tavrn-0.2.0.AppImage")?.sha512).toBe(hex("sha512", appImage));
    expect(needsSha512(index)).toBe(true);
    expect(needsSha512(index.filter((f) => !f.sha512))).toBe(false);
  });

  it("finds a file by SHA-256 first, then by SHA-512", () => {
    expect(findMatch(index, { sha256: hex("sha256", installer) })).toEqual({ name: "Tavrn_0.2.0_x64-setup.exe", algo: "sha256" });
    expect(findMatch(index, { sha256: hex("sha256", appImage), sha512: hex("sha512", appImage) })).toEqual({
      name: "Tavrn-0.2.0.AppImage",
      algo: "sha512",
    });
    expect(findMatch(index, { sha256: "0".repeat(64), sha512: "0".repeat(128) })).toBeNull();
  });

  it("compares a pasted value with the digest of its algorithm", () => {
    const digests = { sha256: hex("sha256", installer), sha512: hex("sha512", installer) };
    expect(matchesExpected(normalizeChecksum(b64("sha512", installer))!, digests)).toBe(true);
    expect(matchesExpected(normalizeChecksum(hex("sha256", installer))!, digests)).toBe(true);
    expect(matchesExpected(normalizeChecksum(hex("sha256", appImage))!, digests)).toBe(false);
    expect(matchesExpected(normalizeChecksum(hex("sha512", installer))!, { sha256: digests.sha256 })).toBe(false);
  });
});
