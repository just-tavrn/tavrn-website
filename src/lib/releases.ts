// SPDX-License-Identifier: Apache-2.0
/**
 * The release data of the download page, read in the browser at runtime from the site's own GitHub proxies
 * (/gh/releases/web, /gh/releases/node, /gh/repos/web; deploy/Caddyfile): the classifier that turns the assets of a
 * GitHub release of tavrn-web into download entries (operating system, desktop shell, format, architecture,
 * checksum, updater signature), the checks of GitHub's answers, and the rules that pick the stable and the beta
 * release and the node image. Pure functions only: src/components/download/Releases.astro does the fetching and
 * rendering.
 */

export type Os = "windows" | "linux" | "macos" | "android" | "ios";
export type Arch = "x64" | "arm64" | "x86" | "universal";
/** The file format, which decides how a file is installed. */
export type AssetKind = "nsis" | "msi" | "appimage" | "deb" | "dmg" | "app-tar" | "apk";
/**
 * The desktop shell around the web client (tavrn-web, docs/DESKTOP.md): Tauri for Windows (and later macOS, mobile),
 * Electron for Linux, plus an optional Electron build for Windows whose file name must contain "electron".
 */
export type Shell = "tauri" | "electron";

/** The fields of a GitHub release asset the classifier reads (REST API, "List release assets"). */
export interface GithubAsset {
  name: string;
  browser_download_url: string;
  size: number;
  /** "sha256:<hex>", set by GitHub for assets uploaded since mid-2025. */
  digest?: string | null;
}

/** The fields of a GitHub release the page reads (REST API, "List releases"). */
export interface GithubRelease {
  tag_name: string;
  html_url: string;
  published_at: string | null;
  draft?: boolean;
  prerelease?: boolean;
  assets: GithubAsset[];
}

export interface DownloadAsset {
  name: string;
  url: string;
  size: number;
  kind: AssetKind;
  os: Os;
  shell: Shell;
  arch: Arch | null;
  /** SHA-256 as lowercase hex. */
  checksum?: string;
  /** SHA-512 as base64, from electron-updater's feed (latest.yml, latest-linux.yml). */
  sha512?: string;
  /** URL of the Tauri updater signature (<asset>.sig). */
  signature?: string;
}

/** Installer formats with their operating system; the order is the order on the page. */
const FORMATS: { kind: AssetKind; os: Os; test: RegExp }[] = [
  // Tauri's NSIS installer (…_x64-setup.exe) and the optional Electron build for Windows (…electron….exe).
  { kind: "nsis", os: "windows", test: /-setup\.exe$|electron.*\.exe$/i },
  { kind: "msi", os: "windows", test: /\.msi$/i },
  { kind: "appimage", os: "linux", test: /\.appimage$/i },
  { kind: "deb", os: "linux", test: /\.deb$/i },
  { kind: "dmg", os: "macos", test: /\.dmg$/i },
  { kind: "app-tar", os: "macos", test: /\.app\.tar\.gz$/i },
  { kind: "apk", os: "android", test: /\.apk$/i },
];

const KIND_ORDER = FORMATS.map((f) => f.kind);
const ARCH_ORDER: (Arch | null)[] = ["x64", "arm64", "universal", "x86", null];
const SHELL_ORDER: Shell[] = ["tauri", "electron"];

const SHA256 = /\b[a-f0-9]{64}\b/i;

/** The SHA-256 (lowercase hex) of GitHub's asset digest ("sha256:<hex>"), or undefined for anything else. */
export function sha256FromDigest(digest: string | null | undefined): string | undefined {
  return /^sha256:([a-f0-9]{64})$/i.exec(digest ?? "")?.[1]?.toLowerCase();
}

/** The architecture named in a file name: x64/x86_64/amd64, arm64/aarch64, universal, x86/i686. */
export function archFromName(name: string): Arch | null {
  const lower = name.toLowerCase();
  const token = (t: string) => new RegExp(`(^|[^a-z0-9])(${t})([^a-z0-9]|$)`).test(lower);
  if (token("aarch64|arm64")) return "arm64";
  if (/x86[_-]64/.test(lower) || token("x64|amd64")) return "x64";
  if (token("universal")) return "universal";
  if (token("i686|i386|x86")) return "x86";
  return null;
}

/**
 * The format and operating system of an installer, or null for everything else: updater files (Tauri's .sig and
 * latest.json, electron-updater's latest.yml / latest-linux.yml), sums, the web bundle, sources, and formats the
 * releases no longer carry (.rpm).
 */
export function formatOf(name: string): { kind: AssetKind; os: Os } | null {
  const format = FORMATS.find((f) => f.test.test(name));
  return format ? { kind: format.kind, os: format.os } : null;
}

/** Checksums from a SHA256SUMS-style text ("<hex>  <name>" or "<hex> *<name>" per line). */
export function parseChecksumList(text: string): Map<string, string> {
  const sums = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([a-f0-9]{64})\s+\*?(.+?)\s*$/i.exec(line.trim());
    if (m) sums.set(m[2]!.replace(/^.*[\\/]/, ""), m[1]!.toLowerCase());
  }
  return sums;
}

/** The shell of an installer: every Linux package and anything named "electron" is Electron, the rest Tauri. */
export function shellOf(name: string, os: Os): Shell {
  return os === "linux" || /electron/i.test(name) ? "electron" : "tauri";
}

/** Whether an asset is an electron-updater feed (latest.yml, latest-linux.yml, latest-mac.yml, …). */
export function isUpdaterFeed(name: string): boolean {
  return /^latest(-[a-z0-9]+)*\.yml$/i.test(name);
}

/**
 * The SHA-512 values (base64) of an electron-updater feed, by file name. The feed is YAML written by electron-builder:
 * a `files:` list of `- url: <name>` entries with `sha512: <base64>`, plus a top-level `path`/`sha512` pair for the
 * main file. A line parser is enough for that fixed shape; anything else is skipped.
 */
export function parseUpdaterFeed(text: string): Map<string, string> {
  const sums = new Map<string, string>();
  const unquote = (v: string) => v.trim().replace(/^(['"])(.*)\1$/, "$2");
  let current: string | null = null;
  let topPath: string | null = null;
  let topSha: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const item = /^\s*-\s+url:\s*(.+)$/.exec(raw);
    if (item) {
      current = unquote(item[1]!);
      continue;
    }
    const indented = /^\s+sha512:\s*(.+)$/.exec(raw);
    if (indented && current) {
      sums.set(current, unquote(indented[1]!));
      current = null;
      continue;
    }
    const top = /^(path|sha512):\s*(.+)$/.exec(raw);
    if (top) {
      current = null;
      if (top[1] === "path") topPath = unquote(top[2]!);
      else topSha = unquote(top[2]!);
    }
  }
  if (topPath && topSha && !sums.has(topPath)) sums.set(topPath, topSha);
  for (const [name, value] of sums) if (!/^[A-Za-z0-9+/]{86}==$/.test(value)) sums.delete(name);
  return sums;
}

/**
 * The download entries of a release. The checksum is GitHub's `digest` of the asset, which is all the page has: the
 * browser never fetches release files. `checksumTexts` (optional) maps the names of checksum files (<name>.sha256,
 * SHA256SUMS, the electron-updater feeds latest*.yml) to their contents, for a caller that has them; a checksum named
 * there wins over the digest. Ignored: the updater feeds
 * (latest.json, latest.yml, latest-linux.yml), updater archives (.nsis.zip, .AppImage.tar.gz), the web bundle and
 * source archives, and anything unknown. electron-builder leaves the architecture out of x64 AppImage names
 * (Tavrn-0.2.0.AppImage), so a Linux package without one counts as x64.
 */
export function classifyAssets(assets: GithubAsset[], checksumTexts: Record<string, string> = {}): DownloadAsset[] {
  const byName = new Map(assets.map((a) => [a.name, a]));
  const sums = new Map<string, string>();
  const sha512s = new Map<string, string>();
  for (const [file, text] of Object.entries(checksumTexts)) {
    if (isUpdaterFeed(file)) {
      for (const [name, value] of parseUpdaterFeed(text)) sha512s.set(name, value);
    } else if (/\.sha256(sum)?$/i.test(file)) {
      const target = file.replace(/\.sha256(sum)?$/i, "");
      const listed = parseChecksumList(text);
      const hex = listed.get(target) ?? SHA256.exec(text)?.[0];
      if (hex) sums.set(target, hex.toLowerCase());
    } else {
      for (const [name, hex] of parseChecksumList(text)) if (!sums.has(name)) sums.set(name, hex);
    }
  }

  const entries: DownloadAsset[] = [];
  for (const asset of assets) {
    const format = formatOf(asset.name);
    if (!format) continue;
    const shell = shellOf(asset.name, format.os);
    const entry: DownloadAsset = {
      name: asset.name,
      url: asset.browser_download_url,
      size: asset.size,
      kind: format.kind,
      os: format.os,
      shell,
      arch: archFromName(asset.name) ?? (format.os === "linux" ? "x64" : null),
    };
    const checksum = sums.get(asset.name) ?? sha256FromDigest(asset.digest);
    if (checksum) entry.checksum = checksum;
    const sha512 = sha512s.get(asset.name);
    if (sha512) entry.sha512 = sha512;
    const sig = byName.get(`${asset.name}.sig`);
    if (sig) entry.signature = sig.browser_download_url;
    entries.push(entry);
  }
  return entries.sort(
    (a, b) =>
      SHELL_ORDER.indexOf(a.shell) - SHELL_ORDER.indexOf(b.shell) ||
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      ARCH_ORDER.indexOf(a.arch) - ARCH_ORDER.indexOf(b.arch) ||
      a.name.localeCompare(b.name),
  );
}

/** "v0.2.0" -> "0.2.0". */
export function versionOf(tag: string): string {
  return tag.replace(/^v(?=\d)/, "");
}

/** One release of tavrn-web as the download page shows it. */
export interface WebRelease {
  version: string;
  tag: string;
  publishedAt: string | null;
  notes_url: string;
  /** GitHub's pre-release flag: the page calls these releases "Beta". */
  prerelease: boolean;
  assets: DownloadAsset[];
}

export function webReleaseFrom(release: GithubRelease, checksumTexts: Record<string, string> = {}): WebRelease {
  return {
    version: versionOf(release.tag_name),
    tag: release.tag_name,
    publishedAt: release.published_at,
    notes_url: release.html_url,
    prerelease: release.prerelease === true,
    assets: classifyAssets(release.assets, checksumTexts),
  };
}

/** The container image of tavrn-node for the self-host card. */
export interface NodeImage {
  image: string;
  /** "stable": the newest release; "prerelease": no release yet, the newest pre-release; "edge": neither. */
  channel: "stable" | "prerelease" | "edge";
  version: string | null;
}

/** The node's container image is tagged with the version without "v" (the organization's docker-publish.yml). */
export function nodeImageFrom(release: Pick<GithubRelease, "tag_name" | "prerelease"> | null, org = "just-tavrn"): NodeImage {
  if (!release) return { image: `ghcr.io/${org}/tavrn-node:edge`, channel: "edge", version: null };
  const version = versionOf(release.tag_name);
  return { image: `ghcr.io/${org}/tavrn-node:${version}`, channel: release.prerelease ? "prerelease" : "stable", version };
}

/** GitHub's links, which the page puts into href attributes: only https://github.com/… gets through. */
const GITHUB_URL = /^https:\/\/github\.com\/[^\s"'<>]+$/;
/** What a tag may look like before it becomes part of an image name. */
const TAG = /^[\w.+-]{1,128}$/;

/**
 * The releases in an answer of GitHub's "List releases" (through the site's /gh/releases/* proxy), checked field by
 * field because the page renders them: entries or assets with missing or odd fields are dropped, links must point to
 * github.com. Anything that is not a list yields null.
 */
export function parseReleaseList(value: unknown): GithubRelease[] | null {
  if (!Array.isArray(value)) return null;
  const releases: GithubRelease[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.tag_name !== "string" || !TAG.test(r.tag_name)) continue;
    if (typeof r.html_url !== "string" || !GITHUB_URL.test(r.html_url)) continue;
    const publishedAt = typeof r.published_at === "string" && !Number.isNaN(Date.parse(r.published_at)) ? r.published_at : null;
    const assets: GithubAsset[] = [];
    for (const a of Array.isArray(r.assets) ? r.assets : []) {
      if (!a || typeof a !== "object") continue;
      const asset = a as Record<string, unknown>;
      if (typeof asset.name !== "string" || asset.name.length === 0 || asset.name.length > 200) continue;
      if (typeof asset.browser_download_url !== "string" || !GITHUB_URL.test(asset.browser_download_url)) continue;
      const size = typeof asset.size === "number" && Number.isFinite(asset.size) && asset.size >= 0 ? asset.size : 0;
      assets.push({ name: asset.name, browser_download_url: asset.browser_download_url, size, digest: typeof asset.digest === "string" ? asset.digest : null });
    }
    releases.push({ tag_name: r.tag_name, html_url: r.html_url, published_at: publishedAt, draft: r.draft === true, prerelease: r.prerelease === true, assets });
  }
  return releases;
}

const time = (r: { published_at?: string | null; publishedAt?: string | null }) => {
  const at = r.published_at ?? r.publishedAt;
  return at ? Date.parse(at) : Number.NEGATIVE_INFINITY;
};
const newestFirst = <T extends { published_at?: string | null; publishedAt?: string | null }>(list: T[]) => [...list].sort((a, b) => time(b) - time(a));

/**
 * The two channels of the download page from the releases of tavrn-web. Drafts are ignored, and so is every release
 * without an installer (one with only the web bundle does not count). `stable` is the newest release that is not a
 * pre-release (by publication date); `beta` the newest pre-release published after it, or the newest pre-release at
 * all when there is no stable release.
 */
export function selectWebReleases(releases: GithubRelease[]): { stable: WebRelease | null; beta: WebRelease | null } {
  const usable = newestFirst(releases.filter((r) => !r.draft))
    .map((r) => webReleaseFrom(r))
    .filter((r) => r.assets.length > 0);
  const stable = usable.find((r) => !r.prerelease) ?? null;
  const beta = usable.find((r) => r.prerelease && (!stable || time(r) > time(stable))) ?? null;
  return { stable, beta };
}

/** The image for the self-host card: the newest stable release of tavrn-node, else its newest pre-release, else edge. */
export function selectNodeImage(releases: GithubRelease[], org = "just-tavrn"): NodeImage {
  const published = newestFirst(releases.filter((r) => !r.draft));
  return nodeImageFrom(published.find((r) => !r.prerelease) ?? published.find((r) => r.prerelease) ?? null, org);
}

/** What a request to one of the site's /gh/ proxies gave: the parsed JSON, or the HTTP status (0: no answer). */
export type Fetched = { ok: true; body: unknown } | { ok: false; status: number };

/**
 * How the download page shows the releases:
 * - "both": a stable release and a newer beta, as two tabs (stable selected);
 * - "stable": only a stable release;
 * - "beta": only a beta, shown with a "Beta" badge and a note that there is no stable release yet;
 * - "none": no usable release (also when the list is not available: 401/403/404 from the proxy mean a private
 *   repository, no token or a token without access), with a link to GitHub.
 */
export type ReleaseMode = "both" | "stable" | "beta" | "none";

export interface DownloadView {
  mode: ReleaseMode;
  stable: WebRelease | null;
  beta: WebRelease | null;
  /** tavrn-web is a private repository: visitors cannot download the assets, so the page shows no download buttons. */
  private: boolean;
  /** The release list could not be loaded (a server error, no answer, or an answer that is not a release list). */
  loadError: boolean;
  node: NodeImage;
}

/** The view model of the download page from the answers of /gh/releases/web, /gh/releases/node and /gh/repos/web. */
export function downloadView(answers: { web: Fetched; node: Fetched; repo: Fetched }, org = "just-tavrn"): DownloadView {
  const webList = answers.web.ok ? parseReleaseList(answers.web.body) : null;
  const unavailable = !answers.web.ok && [401, 403, 404].includes(answers.web.status);
  const { stable, beta } = selectWebReleases(webList ?? []);
  const nodeList = answers.node.ok ? parseReleaseList(answers.node.body) : null;
  const repo = answers.repo.ok ? answers.repo.body : null;
  return {
    mode: stable && beta ? "both" : stable ? "stable" : beta ? "beta" : "none",
    stable,
    beta,
    private: !!repo && typeof repo === "object" && (repo as Record<string, unknown>).private === true,
    loadError: webList === null && !unavailable,
    node: selectNodeImage(nodeList ?? [], org),
  };
}

/** "84.2 MB" (decimal units, like the operating systems show them). */
export function formatSize(bytes: number, locale = "en"): string {
  const units = ["B", "kB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value)} ${units[unit]}`;
}
