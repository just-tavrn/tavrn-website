// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import downloads from "../data/downloads.json";
import {
  archFromName,
  classifyAssets,
  formatOf,
  isChecksumFile,
  formatSize,
  type GithubAsset,
  nodeReleaseFrom,
  parseChecksumList,
  parseDownloads,
  parseUpdaterFeed,
  webReleaseFrom,
} from "./releases";

const BASE = "https://github.com/just-tavrn/tavrn-web/releases/download/v0.3.0";
const asset = (name: string, extra: Partial<GithubAsset> = {}): GithubAsset => ({
  name,
  browser_download_url: `${BASE}/${name}`,
  size: 1000,
  ...extra,
});
const HEX_A = "a".repeat(64);
const HEX_B = "b".repeat(64);
const HEX_C = "c".repeat(64);

describe("archFromName", () => {
  it.each([
    ["Tavrn_0.3.0_x64-setup.exe", "x64"],
    ["Tavrn_0.3.0_x64_en-US.msi", "x64"],
    ["tavrn_0.3.0_amd64.AppImage", "x64"],
    ["tavrn-0.3.0-1.x86_64.rpm", "x64"],
    ["Tavrn-0.3.0-arm64.AppImage", "arm64"],
    ["tavrn-electron_0.3.0_x64-setup.exe", "x64"],
    ["Tavrn-0.3.0.AppImage", null],
    ["tavrn_0.3.0_arm64.deb", "arm64"],
    ["tavrn-0.3.0-1.aarch64.rpm", "arm64"],
    ["Tavrn_0.3.0_aarch64.dmg", "arm64"],
    ["Tavrn_0.3.0_universal.dmg", "universal"],
    ["tavrn-0.3.0-i686.AppImage", "x86"],
    ["tavrn-0.3.0.apk", null],
  ])("%s -> %s", (name, arch) => expect(archFromName(name)).toBe(arch));
});

describe("formatOf", () => {
  it("knows every installer format", () => {
    expect(formatOf("Tavrn_0.3.0_x64-setup.exe")).toEqual({ kind: "nsis", os: "windows" });
    expect(formatOf("Tavrn_0.3.0_x64_en-US.msi")).toEqual({ kind: "msi", os: "windows" });
    expect(formatOf("tavrn_0.3.0_amd64.AppImage")).toEqual({ kind: "appimage", os: "linux" });
    expect(formatOf("tavrn_0.3.0_amd64.deb")).toEqual({ kind: "deb", os: "linux" });
    expect(formatOf("Tavrn-0.3.0.AppImage")).toEqual({ kind: "appimage", os: "linux" });
    expect(formatOf("tavrn-electron_0.3.0_x64-setup.exe")).toEqual({ kind: "nsis", os: "windows" });
    expect(formatOf("tavrn-electron-0.3.0-x64.exe")).toEqual({ kind: "nsis", os: "windows" });
    expect(formatOf("Tavrn_0.3.0_aarch64.dmg")).toEqual({ kind: "dmg", os: "macos" });
    expect(formatOf("Tavrn_aarch64.app.tar.gz")).toEqual({ kind: "app-tar", os: "macos" });
    expect(formatOf("tavrn-0.3.0.apk")).toEqual({ kind: "apk", os: "android" });
  });

  it("ignores updater files, sums, the web bundle and sources", () => {
    for (const name of [
      "latest.json",
      "Tavrn_0.3.0_x64-setup.exe.sig",
      "Tavrn_0.3.0_x64-setup.nsis.zip",
      "tavrn_0.3.0_amd64.AppImage.tar.gz",
      "tavrn-web-0.3.0.tar.gz",
      "tavrn-web-0.3.0.tar.gz.sha256",
      "SHA256SUMS",
      "latest.yml",
      "latest-linux.yml",
      "Tavrn-0.3.0.AppImage.sha256",
      "tavrn-0.3.0-1.x86_64.rpm",
      "Tavrn-0.3.0.AppImage.blockmap",
      "tavrn-0.3.0.zip",
      "plain.exe",
    ]) {
      expect(formatOf(name), name).toBeNull();
    }
  });
});

describe("parseChecksumList", () => {
  it("reads sha256sum output in text and binary mode", () => {
    const sums = parseChecksumList(`${HEX_A}  tavrn_0.3.0_amd64.deb\n${HEX_B.toUpperCase()} *dist/Tavrn_0.3.0_x64-setup.exe\r\nnot a line\n`);
    expect(sums.get("tavrn_0.3.0_amd64.deb")).toBe(HEX_A);
    expect(sums.get("Tavrn_0.3.0_x64-setup.exe")).toBe(HEX_B);
    expect(sums.size).toBe(2);
  });
});

describe("classifyAssets", () => {
  const release = [
    asset("latest.json"),
    asset("tavrn_0.3.0_amd64.deb", { size: 42_000_000 }),
    asset("tavrn_0.3.0_amd64.AppImage", { size: 98_000_000, digest: `sha256:${HEX_C}` }),
    asset("tavrn_0.3.0_amd64.AppImage.sig"),
    asset("Tavrn_0.3.0_x64_en-US.msi"),
    asset("Tavrn_0.3.0_x64_en-US.msi.sig"),
    asset("Tavrn_0.3.0_x64-setup.exe", { digest: `sha256:${HEX_C}` }),
    asset("Tavrn_0.3.0_x64-setup.exe.sig"),
    asset("Tavrn_0.3.0_x64-setup.exe.sha256"),
    asset("SHA256SUMS"),
    asset("tavrn-web-0.3.0.tar.gz"),
    asset("tavrn-web-0.3.0.tar.gz.sha256"),
  ];
  const texts = {
    "Tavrn_0.3.0_x64-setup.exe.sha256": `${HEX_A}  Tavrn_0.3.0_x64-setup.exe\n`,
    SHA256SUMS: `${HEX_B}  tavrn_0.3.0_amd64.deb\n${HEX_B}  Tavrn_0.3.0_x64-setup.exe\n`,
  };
  const entries = classifyAssets(release, texts);

  it("keeps the installers only, in page order", () => {
    expect(entries.map((e) => e.name)).toEqual([
      "Tavrn_0.3.0_x64-setup.exe",
      "Tavrn_0.3.0_x64_en-US.msi",
      "tavrn_0.3.0_amd64.AppImage",
      "tavrn_0.3.0_amd64.deb",
    ]);
  });

  it("attaches the updater signatures", () => {
    const by = Object.fromEntries(entries.map((e) => [e.name, e]));
    expect(by["Tavrn_0.3.0_x64-setup.exe"]!.signature).toBe(`${BASE}/Tavrn_0.3.0_x64-setup.exe.sig`);
    expect(by["Tavrn_0.3.0_x64_en-US.msi"]!.signature).toBe(`${BASE}/Tavrn_0.3.0_x64_en-US.msi.sig`);
    expect(by["tavrn_0.3.0_amd64.deb"]!.signature).toBeUndefined();
  });

  it("takes checksums from <name>.sha256 first, then SHA256SUMS, then GitHub's digest", () => {
    const by = Object.fromEntries(entries.map((e) => [e.name, e]));
    expect(by["Tavrn_0.3.0_x64-setup.exe"]!.checksum).toBe(HEX_A);
    expect(by["tavrn_0.3.0_amd64.deb"]!.checksum).toBe(HEX_B);
    expect(by["tavrn_0.3.0_amd64.AppImage"]!.checksum).toBe(HEX_C);
    expect(by["Tavrn_0.3.0_x64_en-US.msi"]!.checksum).toBeUndefined();
  });

  it("fills os, kind, arch, size and url", () => {
    expect(entries[2]).toMatchObject({
      os: "linux",
      kind: "appimage",
      arch: "x64",
      size: 98_000_000,
      url: `${BASE}/tavrn_0.3.0_amd64.AppImage`,
    });
  });

  it("sorts architectures x64 before arm64 within a format", () => {
    const sorted = classifyAssets([asset("tavrn_0.3.0_arm64.deb"), asset("tavrn_0.3.0_amd64.deb")]);
    expect(sorted.map((e) => e.arch)).toEqual(["x64", "arm64"]);
  });
});

describe("shells", () => {
  const electronRelease = [
    asset("Tavrn_0.3.0_x64-setup.exe"),
    asset("tavrn-electron_0.3.0_x64-setup.exe"),
    asset("Tavrn-0.3.0.AppImage"),
    asset("Tavrn-0.3.0.AppImage.sha256"),
    asset("tavrn_0.3.0_amd64.deb"),
    asset("latest-linux.yml"),
    asset("latest.yml"),
  ];
  const entries = classifyAssets(electronRelease, { "Tavrn-0.3.0.AppImage.sha256": `${HEX_A}  Tavrn-0.3.0.AppImage\n` });

  it("marks every Linux package and anything named electron as Electron, the rest as Tauri", () => {
    expect(entries.map((e) => [e.name, e.shell])).toEqual([
      ["Tavrn_0.3.0_x64-setup.exe", "tauri"],
      ["tavrn-electron_0.3.0_x64-setup.exe", "electron"],
      ["Tavrn-0.3.0.AppImage", "electron"],
      ["tavrn_0.3.0_amd64.deb", "electron"],
    ]);
  });

  it("reads electron-builder's .sha256 files and treats an AppImage without architecture as x64", () => {
    const appImage = entries.find((e) => e.kind === "appimage")!;
    expect(appImage.checksum).toBe(HEX_A);
    expect(appImage.arch).toBe("x64");
  });

  it("rejects a shell that does not match the file name", () => {
    const bad = { ...downloads, web: { ...downloads.web, assets: [{ ...downloads.web.assets[0], shell: "electron" }] } };
    expect(() => parseDownloads(bad)).toThrow(/shell/);
  });
});

describe("release blocks", () => {
  it("builds the web block from a release", () => {
    const web = webReleaseFrom({
      tag_name: "v0.3.0",
      html_url: "https://github.com/just-tavrn/tavrn-web/releases/tag/v0.3.0",
      published_at: "2026-11-01T10:00:00Z",
      assets: [asset("tavrn_0.3.0_amd64.deb")],
    });
    expect(web).toMatchObject({ version: "0.3.0", tag: "v0.3.0", publishedAt: "2026-11-01T10:00:00Z" });
    expect(web.assets).toHaveLength(1);
  });

  it("names the node image like the organization's image workflow tags it", () => {
    expect(nodeReleaseFrom({ tag_name: "v0.3.1" })).toEqual({
      version: "0.3.1",
      tag: "v0.3.1",
      image: "ghcr.io/just-tavrn/tavrn-node:0.3.1",
    });
  });
});

describe("downloads.json", () => {
  it("has the expected shape", () => {
    expect(() => parseDownloads(downloads)).not.toThrow();
  });

  it("is marked as example data until the first public release", () => {
    // The committed cache is example data; scripts/fetch-releases.mjs replaces it with a real release.
    if (downloads.example) {
      for (const a of downloads.web.assets) expect(a.url).toMatch(/^https:\/\/github\.com\/just-tavrn\/tavrn-web\/releases\/download\/v0\.2\.0\//);
    }
  });

  it("rejects broken data with the path of the problem", () => {
    expect(() => parseDownloads({ ...downloads, web: { ...downloads.web, assets: [{ name: "x.deb" }] } })).toThrow(/web\.assets\[0\]\.url/);
    expect(() => parseDownloads({ ...downloads, node: { ...downloads.node, image: "docker.io/evil:1" } })).toThrow(/node\.image/);
    expect(() => parseDownloads({ ...downloads, example: "yes" })).toThrow(/example/);
    expect(() =>
      parseDownloads({ ...downloads, web: { ...downloads.web, assets: [{ ...downloads.web.assets[0], kind: "msi" }] } }),
    ).toThrow(/does not match/);
  });
});

describe("formatSize", () => {
  it("uses decimal units", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(84_213_000)).toBe("84.2 MB");
    expect(formatSize(5_400_000)).toBe("5.4 MB");
    expect(formatSize(1_250_000_000)).toBe("1.3 GB");
  });
});

describe("parseUpdaterFeed", () => {
  const SHA = "A8PX1U59N5OE8GOyYMGP+2x6fK9OdeeMSxJmXF8KmZwCsj2Fg407RKWsyvOi7Wta5w/R5cUCz9/pkm6AN7ZzGg==";
  const OTHER = `${"B".repeat(86)}==`;
  const feed = `version: 0.3.0
files:
  - url: Tavrn-0.3.0.AppImage
    sha512: ${SHA}
    size: 118000000
    blockMapSize: 123456
  - url: tavrn_0.3.0_amd64.deb
    sha512: '${OTHER}'
    size: 82300000
path: Tavrn-0.3.0.AppImage
sha512: ${SHA}
releaseDate: '2026-11-01T10:00:00.000Z'
`;

  it("reads the SHA-512 of every file", () => {
    const sums = parseUpdaterFeed(feed);
    expect(sums.get("Tavrn-0.3.0.AppImage")).toBe(SHA);
    expect(sums.get("tavrn_0.3.0_amd64.deb")).toBe(OTHER);
    expect(sums.size).toBe(2);
  });

  it("attaches them to the assets and validates them", () => {
    const entries = classifyAssets([asset("Tavrn-0.3.0.AppImage"), asset("tavrn_0.3.0_amd64.deb"), asset("latest-linux.yml")], {
      "latest-linux.yml": feed,
    });
    expect(entries.map((e) => e.sha512)).toEqual([SHA, OTHER]);
    expect(isChecksumFile("latest-linux.yml")).toBe(true);
    expect(isChecksumFile("latest.yml")).toBe(true);
    expect(() => parseDownloads({ ...downloads, web: { ...downloads.web, assets: [{ ...downloads.web.assets[3], sha512: "abc" }] } })).toThrow(/sha512/);
  });

  it("ignores values that are not SHA-512 base64", () => {
    expect(parseUpdaterFeed("files:\n  - url: x.AppImage\n    sha512: short\n").size).toBe(0);
  });
});
