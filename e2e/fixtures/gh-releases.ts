// SPDX-License-Identifier: Apache-2.0
// Answers of GitHub's REST API as the site's /gh/releases/web, /gh/releases/node and /gh/repos/web proxies pass them
// on (deploy/Caddyfile), for the unit tests of src/lib/releases.ts and the end-to-end tests of the download page.
// The assets of a tavrn-web release are named exactly like those of v0.3.0-rc.1 (installers, .sha256 files, Tauri
// .sig files, electron-builder's blockmap and feeds, the web bundle). With `fixtureDigests` the Tauri installer and
// the AppImage carry the SHA-256 of e2e/fixtures/example-installer.bin and example-appimage.bin as GitHub `digest`,
// so the verifier can match those files; every other digest is derived from the file name and matches nothing.
import { createHash } from "node:crypto";

export const ORG = "just-tavrn";
/** SHA-256 of e2e/fixtures/example-installer.bin (src/lib/verify.test.ts checks it). */
export const INSTALLER_SHA256 = "b98d1f0a8666b218b996cecef147ac7427716691ab8efa070afb1a98f128b683";
/** SHA-256 of e2e/fixtures/example-appimage.bin (src/lib/verify.test.ts checks it). */
export const APPIMAGE_SHA256 = "663fd48b9181b5b3126bd1e10dbb3e32ca4b225622f7bbeece2e90888f2e1f56";

export interface GhAsset {
  name: string;
  browser_download_url: string;
  size: number;
  digest: string | null;
  content_type: string;
}

export interface GhRelease {
  tag_name: string;
  name: string;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  created_at: string;
  published_at: string | null;
  assets: GhAsset[];
}

const fakeSha256 = (text: string) => createHash("sha256").update(text).digest("hex");

export interface ReleaseOptions {
  prerelease?: boolean;
  draft?: boolean;
  /** ISO date of publication (null for drafts). */
  published?: string | null;
  /** Only the web bundle tarball (like v0.2.0): no installer at all. */
  webOnly?: boolean;
  /** The Tauri installer and the AppImage carry the SHA-256 of the e2e fixtures. */
  fixtureDigests?: boolean;
  repo?: string;
}

/** A release of tavrn-web (or, with `repo`, another repository) with the asset list of v0.3.0-rc.1. */
export function webRelease(tag: string, options: ReleaseOptions = {}): GhRelease {
  const version = tag.replace(/^v/, "");
  const repo = options.repo ?? "tavrn-web";
  const base = `https://github.com/${ORG}/${repo}/releases/download/${tag}`;
  const asset = (name: string, size: number, digest?: string): GhAsset => ({
    name,
    browser_download_url: `${base}/${name}`,
    size,
    digest: `sha256:${digest ?? fakeSha256(`${tag}/${name}`)}`,
    content_type: "application/octet-stream",
  });
  const setup = `Tavrn_${version}_x64-setup.exe`;
  const msi = `Tavrn_${version}_x64_en-US.msi`;
  const appImage = `Tavrn-${version}.AppImage`;
  const deb = `tavrn_${version}_amd64.deb`;
  const electron = `tavrn-electron_${version}_x64-setup.exe`;
  const bundle = `tavrn-web-${version}.tar.gz`;
  const installers = options.webOnly
    ? []
    : [
        asset(appImage, 118_000_000, options.fixtureDigests ? APPIMAGE_SHA256 : undefined),
        asset(`${appImage}.sha256`, 90),
        asset(deb, 82_300_000),
        asset(`${deb}.sha256`, 90),
        asset(setup, 9_800_000, options.fixtureDigests ? INSTALLER_SHA256 : undefined),
        asset(`${setup}.sha256`, 92),
        asset(`${setup}.sig`, 420),
        asset(msi, 12_600_000),
        asset(`${msi}.sha256`, 92),
        asset(`${msi}.sig`, 420),
        asset(electron, 96_400_000),
        asset(`${electron}.sha256`, 100),
        asset(`${electron}.blockmap`, 102_000),
        asset("latest.yml", 360),
        asset("latest-linux.yml", 520),
        asset("latest-linux.yml.minisig", 300),
        asset("latest.json", 1_900),
      ];
  const published = options.draft ? null : (options.published ?? "2026-10-10T12:00:00Z");
  return {
    tag_name: tag,
    name: tag,
    html_url: `https://github.com/${ORG}/${repo}/releases/tag/${tag}`,
    draft: options.draft ?? false,
    prerelease: options.prerelease ?? false,
    created_at: published ?? "2026-10-10T11:00:00Z",
    published_at: published,
    assets: [...installers, asset(bundle, 4_200_000), asset(`${bundle}.sha256`, 84)],
  };
}

/** A release of tavrn-node: the image is built from the tag, the release carries no assets. */
export function nodeRelease(tag: string, options: Pick<ReleaseOptions, "prerelease" | "draft" | "published"> = {}): GhRelease {
  const published = options.draft ? null : (options.published ?? "2026-10-01T12:00:00Z");
  return {
    tag_name: tag,
    name: tag,
    html_url: `https://github.com/${ORG}/tavrn-node/releases/tag/${tag}`,
    draft: options.draft ?? false,
    prerelease: options.prerelease ?? false,
    created_at: published ?? "2026-10-01T11:00:00Z",
    published_at: published,
    assets: [],
  };
}

/** GitHub's "Get a repository" answer, reduced to what the page reads and a few fields around it. */
export function repository(isPrivate: boolean) {
  return {
    id: 1,
    name: "tavrn-web",
    full_name: `${ORG}/tavrn-web`,
    private: isPrivate,
    visibility: isPrivate ? "private" : "public",
    html_url: `https://github.com/${ORG}/tavrn-web`,
  };
}

/** The scenarios of the download page. */
export const scenarios = {
  /** Today's state on GitHub: v0.3.0-rc.1 (pre-release with installers) and v0.2.0 (only the web bundle). */
  betaOnly: () => [
    webRelease("v0.3.0-rc.1", { prerelease: true, published: "2026-10-10T12:00:00Z", fixtureDigests: true }),
    webRelease("v0.2.0", { published: "2026-09-01T12:00:00Z", webOnly: true }),
  ],
  stableOnly: () => [webRelease("v0.3.0", { published: "2026-11-01T12:00:00Z", fixtureDigests: true })],
  /** A stable release and a newer beta: the tabs. The fixtures match the stable installers only. */
  both: () => [
    webRelease("v0.4.0-beta.1", { prerelease: true, published: "2026-11-20T12:00:00Z" }),
    webRelease("v0.3.0", { published: "2026-11-01T12:00:00Z", fixtureDigests: true }),
    webRelease("v0.3.0-rc.1", { prerelease: true, published: "2026-10-10T12:00:00Z" }),
  ],
  /** A stable release newer than every beta: no tabs. */
  stableNewerThanBeta: () => [
    webRelease("v0.3.0", { published: "2026-11-01T12:00:00Z", fixtureDigests: true }),
    webRelease("v0.3.0-rc.1", { prerelease: true, published: "2026-10-10T12:00:00Z" }),
  ],
  /** Nothing usable: a draft and a release with only the web bundle. */
  none: () => [webRelease("v0.4.0", { draft: true }), webRelease("v0.2.0", { published: "2026-09-01T12:00:00Z", webOnly: true })],
  nodeStable: () => [nodeRelease("v0.3.0-rc.1", { prerelease: true, published: "2026-10-05T12:00:00Z" }), nodeRelease("v0.2.0")],
  nodeBetaOnly: () => [nodeRelease("v0.3.0-rc.1", { prerelease: true })],
};
