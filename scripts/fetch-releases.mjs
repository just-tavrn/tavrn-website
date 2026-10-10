#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// The release data of the download page (`just fetch-releases`; `pnpm build` runs it first). Reads the latest GitHub
// release of tavrn-web (the desktop installers) and of tavrn-node (the container image tag) through the REST API
// and writes src/data/downloads.json, the cache the page is built from.
//
// It never fails the build: without network, without a release, or while the repositories are private (404/403
// without a token), the committed cache stays as it is and a notice is printed. Both releases are needed; a partial
// answer also keeps the cache.
//
// Environment: GITHUB_TOKEN (optional; needed while the repositories are private), PUBLIC_GITHUB_ORG (default
// just-tavrn), FETCH_RELEASES=0 to skip the network entirely.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isChecksumFile, nodeReleaseFrom, parseDownloads, webReleaseFrom } from "../src/lib/releases.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cachePath = join(root, "src/data/downloads.json");
const org = process.env.PUBLIC_GITHUB_ORG || "just-tavrn";
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const TIMEOUT_MS = 8000;

const notice = (msg) => console.log(`fetch-releases: ${msg}`);

class Skip extends Error {}

async function github(path, accept = "application/vnd.github+json") {
  const url = path.startsWith("https://") ? path : `https://api.github.com${path}`;
  const headers = { Accept: accept, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": `${org}-website-build` };
  if (token) headers.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new Skip(`no answer from GitHub (${error?.name === "TimeoutError" ? "timeout" : error?.cause?.code || error?.message || error})`);
  }
  if (response.status === 404 || response.status === 403 || response.status === 401) {
    throw new Skip(`${url} answered ${response.status} (private repository, no release yet, or rate limit${token ? "" : "; GITHUB_TOKEN is not set"})`);
  }
  if (!response.ok) throw new Skip(`${url} answered ${response.status}`);
  return accept === "application/octet-stream" ? response.text() : response.json();
}

async function latest(repo) {
  return github(`/repos/${org}/${repo}/releases/latest`);
}

/** The texts of the small checksum files of a release (<name>.sha256, SHA256SUMS, latest*.yml), through the API. */
async function checksumTexts(release) {
  const texts = {};
  for (const asset of release.assets ?? []) {
    if (!isChecksumFile(asset.name) || asset.size > 64 * 1024) continue;
    try {
      texts[asset.name] = await github(asset.url, "application/octet-stream");
    } catch (error) {
      notice(`checksum file ${asset.name} skipped: ${error.message}`);
    }
  }
  return texts;
}

async function main() {
  if (process.env.FETCH_RELEASES === "0") {
    notice("FETCH_RELEASES=0, keeping src/data/downloads.json");
    return;
  }
  const previous = readFileSync(cachePath, "utf8");
  try {
    const [webRelease, nodeRelease] = await Promise.all([latest("tavrn-web"), latest("tavrn-node")]);
    const web = webReleaseFrom(webRelease, await checksumTexts(webRelease));
    if (web.assets.length === 0) throw new Skip(`release ${web.tag} of tavrn-web has no installers yet`);
    const data = parseDownloads({ generatedAt: new Date().toISOString(), web, node: nodeReleaseFrom(nodeRelease, org) });
    const next = `${JSON.stringify(data, null, 2)}\n`;
    // Same release as before: keep the file (and its generatedAt) so a build leaves the working tree clean.
    const old = JSON.parse(previous);
    if (!old.example && JSON.stringify({ ...old, generatedAt: 0 }) === JSON.stringify({ ...data, generatedAt: 0 })) {
      notice(`unchanged (tavrn-web ${web.tag}, tavrn-node ${data.node.tag})`);
      return;
    }
    writeFileSync(cachePath, next);
    notice(`wrote src/data/downloads.json: tavrn-web ${web.tag} (${web.assets.length} installers), tavrn-node ${data.node.tag}`);
  } catch (error) {
    if (!(error instanceof Skip) && !(error instanceof Error)) throw error;
    notice(`${error.message}; keeping the committed src/data/downloads.json${JSON.parse(previous).example ? " (example data)" : ""}`);
  }
}

// Whatever happens, the build goes on.
main().catch((error) => notice(`unexpected error, keeping the cache: ${error?.stack || error}`));
