// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { APPIMAGE_SHA256, INSTALLER_SHA256, nodeRelease, repository, scenarios, webRelease } from "../../e2e/fixtures/gh-releases";
import {
  archFromName,
  classifyAssets,
  downloadView,
  type Fetched,
  formatOf,
  formatSize,
  type GithubAsset,
  type GithubRelease,
  nodeImageFrom,
  parseChecksumList,
  parseReleaseList,
  parseUpdaterFeed,
  selectNodeImage,
  selectWebReleases,
  sha256FromDigest,
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
});

describe("release blocks", () => {
  it("builds the web block from a release", () => {
    const web = webReleaseFrom({
      tag_name: "v0.3.0",
      html_url: "https://github.com/just-tavrn/tavrn-web/releases/tag/v0.3.0",
      published_at: "2026-11-01T10:00:00Z",
      assets: [asset("tavrn_0.3.0_amd64.deb")],
    });
    expect(web).toMatchObject({ version: "0.3.0", tag: "v0.3.0", publishedAt: "2026-11-01T10:00:00Z", prerelease: false });
    expect(web.assets).toHaveLength(1);
  });

  it("names the node image like the organization's image workflow tags it", () => {
    expect(nodeImageFrom({ tag_name: "v0.3.1" })).toEqual({ version: "0.3.1", channel: "stable", image: "ghcr.io/just-tavrn/tavrn-node:0.3.1" });
    expect(nodeImageFrom({ tag_name: "v0.4.0-rc.1", prerelease: true }, "example-org")).toEqual({
      version: "0.4.0-rc.1",
      channel: "prerelease",
      image: "ghcr.io/example-org/tavrn-node:0.4.0-rc.1",
    });
    expect(nodeImageFrom(null)).toEqual({ version: null, channel: "edge", image: "ghcr.io/just-tavrn/tavrn-node:edge" });
  });
});

describe("sha256FromDigest", () => {
  it("reads GitHub's asset digest", () => {
    expect(sha256FromDigest(`sha256:${HEX_A.toUpperCase()}`)).toBe(HEX_A);
    for (const bad of [null, undefined, "", HEX_A, `sha512:${HEX_A}`, `sha256:${HEX_A.slice(1)}`, `sha256:${HEX_A}0`]) {
      expect(sha256FromDigest(bad), String(bad)).toBeUndefined();
    }
  });

  it("is the checksum of every installer of a real release", () => {
    const entries = classifyAssets(webRelease("v0.3.0-rc.1", { fixtureDigests: true }).assets);
    const by = Object.fromEntries(entries.map((e) => [e.name, e]));
    expect(by["Tavrn_0.3.0-rc.1_x64-setup.exe"]!.checksum).toBe(INSTALLER_SHA256);
    expect(by["Tavrn-0.3.0-rc.1.AppImage"]!.checksum).toBe(APPIMAGE_SHA256);
    for (const e of entries) expect(e.checksum, e.name).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("parseReleaseList", () => {
  it("keeps the fields the page reads", () => {
    const [release] = parseReleaseList([webRelease("v0.3.0-rc.1", { prerelease: true })])!;
    expect(release).toMatchObject({ tag_name: "v0.3.0-rc.1", prerelease: true, draft: false, published_at: "2026-10-10T12:00:00Z" });
    expect(release!.assets.map((a) => a.name)).toContain("Tavrn_0.3.0-rc.1_x64-setup.exe");
    expect(Object.keys(release!.assets[0]!).sort()).toEqual(["browser_download_url", "digest", "name", "size"]);
  });

  it("is null for anything that is not a list", () => {
    for (const bad of [null, {}, "[]", { message: "Not Found" }, 3]) expect(parseReleaseList(bad), JSON.stringify(bad)).toBeNull();
    expect(parseReleaseList([])).toEqual([]);
  });

  it("drops entries and assets with odd fields or links outside github.com", () => {
    const good = webRelease("v0.3.0");
    const list = parseReleaseList([
      { ...good, tag_name: 3 },
      { ...good, tag_name: "v1 <script>" },
      { ...good, html_url: "javascript:alert(1)" },
      { ...good, html_url: "https://evil.example/x" },
      null,
      {
        ...good,
        assets: [
          { ...good.assets[0], browser_download_url: "https://evil.example/Tavrn-0.3.0.AppImage" },
          { ...good.assets[0], browser_download_url: 'https://github.com/x" onclick="y' },
          { ...good.assets[0], name: "" },
          { ...good.assets[2], size: "big" },
          "junk",
        ],
      },
    ])!;
    expect(list).toHaveLength(1);
    expect(list[0]!.assets).toEqual([{ name: good.assets[2]!.name, browser_download_url: good.assets[2]!.browser_download_url, size: 0, digest: good.assets[2]!.digest }]);
  });

  it("treats a missing or unreadable publication date as unknown", () => {
    const [a, b] = parseReleaseList([{ ...webRelease("v1.0.0"), published_at: "soon" }, { ...webRelease("v1.0.1"), published_at: undefined }])!;
    expect(a!.published_at).toBeNull();
    expect(b!.published_at).toBeNull();
  });
});

const parsed = (list: unknown) => parseReleaseList(list) as GithubRelease[];

describe("selectWebReleases", () => {
  it("stable only: the newest stable release, no beta", () => {
    const { stable, beta } = selectWebReleases(parsed(scenarios.stableOnly()));
    expect(stable?.tag).toBe("v0.3.0");
    expect(beta).toBeNull();
  });

  it("pre-release only: the beta, no stable", () => {
    const { stable, beta } = selectWebReleases(parsed(scenarios.betaOnly()));
    expect(stable).toBeNull();
    expect(beta).toMatchObject({ tag: "v0.3.0-rc.1", version: "0.3.0-rc.1", prerelease: true });
  });

  it("stable and a newer pre-release: both, the newest of each", () => {
    const { stable, beta } = selectWebReleases(parsed(scenarios.both()));
    expect(stable?.tag).toBe("v0.3.0");
    expect(beta?.tag).toBe("v0.4.0-beta.1");
  });

  it("stable and only older pre-releases: no beta", () => {
    const { stable, beta } = selectWebReleases(parsed(scenarios.stableNewerThanBeta()));
    expect(stable?.tag).toBe("v0.3.0");
    expect(beta).toBeNull();
  });

  it("orders by publication date, not by the order of the answer or the version", () => {
    const list = parsed([
      webRelease("v0.2.5", { published: "2026-09-01T00:00:00Z" }),
      webRelease("v0.3.0-rc.2", { prerelease: true, published: "2026-10-02T00:00:00Z" }),
      webRelease("v0.2.6", { published: "2026-09-20T00:00:00Z" }),
      webRelease("v0.3.0-rc.1", { prerelease: true, published: "2026-09-15T00:00:00Z" }),
    ]);
    const { stable, beta } = selectWebReleases(list);
    expect(stable?.tag).toBe("v0.2.6");
    expect(beta?.tag).toBe("v0.3.0-rc.2");
  });

  it("ignores releases without installers, also when they are newer", () => {
    const list = parsed([
      webRelease("v0.5.0", { published: "2026-12-01T00:00:00Z", webOnly: true }),
      webRelease("v0.5.0-rc.1", { prerelease: true, published: "2026-11-25T00:00:00Z", webOnly: true }),
      webRelease("v0.4.0", { published: "2026-11-01T00:00:00Z" }),
    ]);
    expect(selectWebReleases(list)).toMatchObject({ stable: { tag: "v0.4.0" }, beta: null });
    expect(selectWebReleases(parsed([webRelease("v0.2.0", { webOnly: true })]))).toEqual({ stable: null, beta: null });
  });

  it("ignores drafts", () => {
    const list = parsed([
      webRelease("v0.5.0", { draft: true }),
      webRelease("v0.5.0-rc.1", { draft: true, prerelease: true }),
      webRelease("v0.4.0", { published: "2026-11-01T00:00:00Z" }),
    ]);
    expect(selectWebReleases(list)).toMatchObject({ stable: { tag: "v0.4.0" }, beta: null });
    expect(selectWebReleases(parsed(scenarios.none()))).toEqual({ stable: null, beta: null });
  });

  it("classifies the installers of the chosen releases", () => {
    const { beta } = selectWebReleases(parsed(scenarios.betaOnly()));
    expect(beta!.assets.map((a) => a.name)).toEqual([
      "Tavrn_0.3.0-rc.1_x64-setup.exe",
      "Tavrn_0.3.0-rc.1_x64_en-US.msi",
      "tavrn-electron_0.3.0-rc.1_x64-setup.exe",
      "Tavrn-0.3.0-rc.1.AppImage",
      "tavrn_0.3.0-rc.1_amd64.deb",
    ]);
    expect(beta!.assets.find((a) => a.kind === "msi")!.signature).toMatch(/\.msi\.sig$/);
  });
});

describe("selectNodeImage", () => {
  it("prefers the newest stable tag, also over a newer pre-release", () => {
    expect(selectNodeImage(parsed(scenarios.nodeStable()))).toEqual({ image: "ghcr.io/just-tavrn/tavrn-node:0.2.0", channel: "stable", version: "0.2.0" });
  });

  it("falls back to the newest pre-release, marked as such", () => {
    const list = parsed([
      nodeRelease("v0.3.0-rc.1", { prerelease: true, published: "2026-10-01T00:00:00Z" }),
      nodeRelease("v0.3.0-rc.2", { prerelease: true, published: "2026-10-08T00:00:00Z" }),
      nodeRelease("v0.4.0", { draft: true }),
    ]);
    expect(selectNodeImage(list, "example-org")).toEqual({ image: "ghcr.io/example-org/tavrn-node:0.3.0-rc.2", channel: "prerelease", version: "0.3.0-rc.2" });
  });

  it("falls back to edge without any published release", () => {
    expect(selectNodeImage([])).toEqual({ image: "ghcr.io/just-tavrn/tavrn-node:edge", channel: "edge", version: null });
    expect(selectNodeImage(parsed([nodeRelease("v1.0.0", { draft: true })])).channel).toBe("edge");
  });
});

describe("downloadView", () => {
  const ok = (body: unknown): Fetched => ({ ok: true, body });
  const status = (code: number): Fetched => ({ ok: false, status: code });
  const answers = (web: Fetched, node: Fetched = ok(scenarios.nodeStable()), repo: Fetched = ok(repository(false))) => ({ web, node, repo });

  it("names the mode of every scenario", () => {
    expect(downloadView(answers(ok(scenarios.both()))).mode).toBe("both");
    expect(downloadView(answers(ok(scenarios.stableOnly()))).mode).toBe("stable");
    expect(downloadView(answers(ok(scenarios.stableNewerThanBeta()))).mode).toBe("stable");
    expect(downloadView(answers(ok(scenarios.betaOnly()))).mode).toBe("beta");
    expect(downloadView(answers(ok(scenarios.none()))).mode).toBe("none");
    expect(downloadView(answers(ok([]))).mode).toBe("none");
  });

  it("401, 403 and 404 from the proxy are the quiet \"no release yet\"; server errors and no answer say so", () => {
    for (const code of [401, 403, 404]) expect(downloadView(answers(status(code)))).toMatchObject({ mode: "none", loadError: false });
    for (const code of [500, 502, 503, 0]) expect(downloadView(answers(status(code)))).toMatchObject({ mode: "none", loadError: true });
    expect(downloadView(answers(ok({ message: "Bad credentials" })))).toMatchObject({ mode: "none", loadError: true });
    expect(downloadView(answers(ok(scenarios.none())))).toMatchObject({ mode: "none", loadError: false });
  });

  it("reads whether tavrn-web is private; unknown counts as public", () => {
    expect(downloadView(answers(ok(scenarios.betaOnly()), undefined, ok(repository(true)))).private).toBe(true);
    expect(downloadView(answers(ok(scenarios.betaOnly()), undefined, ok(repository(false)))).private).toBe(false);
    expect(downloadView(answers(ok(scenarios.betaOnly()), undefined, status(404))).private).toBe(false);
    expect(downloadView(answers(ok(scenarios.betaOnly()), undefined, ok({ private: "yes" }))).private).toBe(false);
  });

  it("picks the node image independently of the web releases", () => {
    expect(downloadView(answers(status(404), ok(scenarios.nodeStable()))).node.image).toBe("ghcr.io/just-tavrn/tavrn-node:0.2.0");
    expect(downloadView(answers(ok(scenarios.both()), ok(scenarios.nodeBetaOnly()), ok(repository(false))), "example-org").node).toEqual({
      image: "ghcr.io/example-org/tavrn-node:0.3.0-rc.1",
      channel: "prerelease",
      version: "0.3.0-rc.1",
    });
    expect(downloadView(answers(ok(scenarios.both()), status(503))).node.channel).toBe("edge");
    expect(downloadView(answers(ok(scenarios.both()), ok("nonsense"))).node.channel).toBe("edge");
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

  it("attaches them to the assets", () => {
    const entries = classifyAssets([asset("Tavrn-0.3.0.AppImage"), asset("tavrn_0.3.0_amd64.deb"), asset("latest-linux.yml")], {
      "latest-linux.yml": feed,
    });
    expect(entries.map((e) => e.sha512)).toEqual([SHA, OTHER]);
  });

  it("ignores values that are not SHA-512 base64", () => {
    expect(parseUpdaterFeed("files:\n  - url: x.AppImage\n    sha512: short\n").size).toBe(0);
  });
});
