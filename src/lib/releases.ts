// SPDX-License-Identifier: Apache-2.0
/**
 * The release data of the download page: the classifier that turns the assets of a GitHub release of tavrn-web into
 * download entries (operating system, desktop shell, format, architecture, checksum, updater signature), and the
 * shape of src/data/downloads.json with its validator. Pure functions only: scripts/fetch-releases.mjs does the
 * network part (Node.js runs this file directly, so it uses erasable TypeScript only and imports with file
 * extensions).
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

/** The fields of a GitHub release the fetcher reads. */
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

export interface WebRelease {
  version: string;
  tag: string;
  publishedAt: string | null;
  notes_url: string;
  assets: DownloadAsset[];
}

export interface NodeRelease {
  version: string;
  tag: string;
  image: string;
}

export interface Downloads {
  generatedAt: string;
  /** Example data committed before the first public release: the page shows disabled buttons and a note. */
  example?: boolean;
  web: WebRelease;
  node: NodeRelease;
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
 * Whether an asset is a checksum file whose text the fetcher should download: <name>.sha256, SHA256SUMS, and the
 * electron-updater feeds with their SHA-512 values.
 */
export function isChecksumFile(name: string): boolean {
  return /\.sha256(sum)?$/i.test(name) || /^sha256sums(\.txt)?$/i.test(name) || isUpdaterFeed(name);
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
 * The download entries of a release. `checksumTexts` maps the names of checksum files (see isChecksumFile) to their
 * contents; the GitHub `digest` of an asset is used when no file names a checksum. Ignored: the updater feeds
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
    const digest = /^sha256:([a-f0-9]{64})$/i.exec(asset.digest ?? "")?.[1];
    const checksum = sums.get(asset.name) ?? digest?.toLowerCase();
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

export function webReleaseFrom(release: GithubRelease, checksumTexts: Record<string, string> = {}): WebRelease {
  return {
    version: versionOf(release.tag_name),
    tag: release.tag_name,
    publishedAt: release.published_at,
    notes_url: release.html_url,
    assets: classifyAssets(release.assets, checksumTexts),
  };
}

/** The node's container image is tagged with the version without "v" (the organization's docker-publish.yml). */
export function nodeReleaseFrom(release: Pick<GithubRelease, "tag_name">, org = "just-tavrn"): NodeRelease {
  const version = versionOf(release.tag_name);
  return { version, tag: release.tag_name, image: `ghcr.io/${org}/tavrn-node:${version}` };
}

const OSES: Os[] = ["windows", "linux", "macos", "android", "ios"];
const ARCHES: (Arch | null)[] = ["x64", "arm64", "x86", "universal", null];

/** Checks the shape of downloads.json; throws with the path of the first problem. */
export function parseDownloads(value: unknown): Downloads {
  const fail = (path: string, what: string): never => {
    throw new Error(`downloads.json: ${path} ${what}`);
  };
  const obj = (v: unknown, path: string) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : fail(path, "is not an object"));
  const str = (v: unknown, path: string) => (typeof v === "string" && v.length > 0 ? v : fail(path, "is not a non-empty string"));
  const root = obj(value, "(root)");
  str(root.generatedAt, "generatedAt");
  if (root.example !== undefined && typeof root.example !== "boolean") fail("example", "is not a boolean");
  const web = obj(root.web, "web");
  str(web.version, "web.version");
  str(web.tag, "web.tag");
  if (web.publishedAt !== null && typeof web.publishedAt !== "string") fail("web.publishedAt", "is not a string or null");
  if (!/^https:\/\//.test(str(web.notes_url, "web.notes_url"))) fail("web.notes_url", "is not an https URL");
  if (!Array.isArray(web.assets)) fail("web.assets", "is not an array");
  (web.assets as unknown[]).forEach((a, i) => {
    const p = `web.assets[${i}]`;
    const asset = obj(a, p);
    const name = str(asset.name, `${p}.name`);
    if (!/^https:\/\//.test(str(asset.url, `${p}.url`))) fail(`${p}.url`, "is not an https URL");
    if (typeof asset.size !== "number" || asset.size < 0) fail(`${p}.size`, "is not a size");
    if (!KIND_ORDER.includes(asset.kind as AssetKind)) fail(`${p}.kind`, "is unknown");
    if (!OSES.includes(asset.os as Os)) fail(`${p}.os`, "is unknown");
    if (asset.shell !== shellOf(name, asset.os as Os)) fail(`${p}.shell`, "does not match the name and system");
    if (!ARCHES.includes(asset.arch as Arch | null)) fail(`${p}.arch`, "is unknown");
    if (asset.checksum !== undefined && !/^[a-f0-9]{64}$/.test(String(asset.checksum))) fail(`${p}.checksum`, "is not a SHA-256");
    if (asset.sha512 !== undefined && !/^[A-Za-z0-9+/]{86}==$/.test(String(asset.sha512))) fail(`${p}.sha512`, "is not a base64 SHA-512");
    if (asset.signature !== undefined && !/^https:\/\//.test(String(asset.signature))) fail(`${p}.signature`, "is not an https URL");
    if (formatOf(name)?.kind !== asset.kind) fail(`${p}.kind`, "does not match the file name");
  });
  const node = obj(root.node, "node");
  str(node.version, "node.version");
  str(node.tag, "node.tag");
  if (!/^ghcr\.io\/[\w.-]+\/tavrn-node:[\w.-]+$/.test(str(node.image, "node.image"))) fail("node.image", "is not a tavrn-node image");
  return value as Downloads;
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
