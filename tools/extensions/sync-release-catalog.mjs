#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const catalogPath = resolve(root, "registry/catalog/index.json");
const check = process.argv.includes("--check");
const write = process.argv.includes("--write");

for (const arg of process.argv.slice(2)) {
  if (arg !== "--check" && arg !== "--write") {
    throw new Error(`unknown argument: ${arg}`);
  }
}
if (check === write) {
  throw new Error("pass exactly one of --check or --write");
}

const currentText = readFileSync(catalogPath, "utf8");
const current = JSON.parse(currentText);
const extensions = await mapWithConcurrency(
  current.extensions ?? [],
  6,
  syncExtension,
);
const updatedAt = extensions
  .map((extension) => extension.publishedAt)
  .filter(Boolean)
  .sort()
  .at(-1);
const next = {
  ...current,
  updatedAt: updatedAt ?? current.updatedAt,
  extensions,
};
const nextText = `${JSON.stringify(next, null, 2)}\n`;

if (check) {
  if (currentText !== nextText) {
    throw new Error(
      "extension release catalog is stale; run node tools/extensions/sync-release-catalog.mjs --write",
    );
  }
  console.log(`extension-release-catalog: ok (${extensions.length} extensions)`);
} else {
  writeFileSync(catalogPath, nextText);
  console.log(
    `extension-release-catalog: synchronized ${extensions.length} extensions`,
  );
}

async function syncExtension(extension) {
  const repository = parseGitHubRepository(extension.repository);
  const releases = await githubJson(
    `https://api.github.com/repos/${repository}/releases?per_page=30`,
  );
  const release = releases
    .filter(
      (candidate) =>
        !candidate.draft &&
        candidate.tag_name &&
        candidate.assets?.some((asset) => asset.name?.endsWith(".tar.gz")),
    )
    .sort((left, right) => compareVersions(right.tag_name, left.tag_name))[0];
  if (!release) {
    throw new Error(`${repository}: no installable GitHub release found`);
  }
  const manifest = await releaseManifest(repository, release.tag_name);
  if (manifest.id !== extension.id) {
    throw new Error(
      `${repository}@${release.tag_name}: manifest id ${manifest.id} does not match ${extension.id}`,
    );
  }
  if (`v${manifest.version}` !== release.tag_name) {
    throw new Error(
      `${repository}@${release.tag_name}: manifest version is ${manifest.version}`,
    );
  }

  const assets = {};
  for (const asset of release.assets) {
    const target = releaseAssetTarget(repository.split("/")[1], asset.name);
    if (!target) {
      continue;
    }
    const digest = await releaseAssetDigest(asset);
    assets[target] = {
      name: asset.name,
      sha256: digest,
    };
  }
  if (Object.keys(assets).length === 0) {
    throw new Error(`${repository}@${release.tag_name}: no supported assets`);
  }

  return {
    ...extension,
    version: manifest.version,
    permissions: stringList(manifest.permissions),
    publishedAt: release.published_at ?? release.created_at,
    install: {
      kind: "githubRelease",
      url: release.html_url,
      tag: release.tag_name,
      manifestPath: extension.install?.manifestPath ?? "irodori.extension.json",
      assets: sortObject(assets),
    },
  };
}

async function releaseManifest(repository, tag) {
  const url = `https://raw.githubusercontent.com/${repository}/${encodeURIComponent(tag)}/irodori.extension.json`;
  const response = await fetch(url, {
    headers: { "user-agent": "irodori-release-catalog-sync" },
  });
  if (!response.ok) {
    throw new Error(`${repository}@${tag}: release manifest HTTP ${response.status}`);
  }
  return response.json();
}

function releaseAssetTarget(repositoryName, assetName) {
  const baseName = `${repositoryName}.tar.gz`;
  if (assetName === baseName) {
    // The first fleet release was produced by ubuntu-latest before target names
    // were added. Keep it installable on the platform it was actually built on.
    return "x86_64-linux";
  }
  const prefix = `${repositoryName}-`;
  if (!assetName.startsWith(prefix) || !assetName.endsWith(".tar.gz")) {
    return null;
  }
  const target = assetName.slice(prefix.length, -".tar.gz".length);
  return /^[a-z0-9_]+-(?:linux|macos|windows)$/.test(target) ? target : null;
}

async function releaseAssetDigest(asset) {
  const digest = String(asset.digest ?? "").replace(/^sha256:/i, "");
  if (/^[a-f0-9]{64}$/i.test(digest)) {
    return `sha256:${digest.toLowerCase()}`;
  }
  const response = await githubFetch(asset.browser_download_url, {
    headers: { accept: "application/octet-stream" },
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function githubJson(url) {
  const response = await githubFetch(url, {
    headers: { accept: "application/vnd.github+json" },
  });
  return response.json();
}

async function githubFetch(url, options = {}) {
  const headers = new Headers(options.headers);
  headers.set("user-agent", "irodori-release-catalog-sync");
  headers.set("x-github-api-version", "2022-11-28");
  if (process.env.GITHUB_TOKEN) {
    headers.set("authorization", `Bearer ${process.env.GITHUB_TOKEN}`);
  }
  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }
  return response;
}

function parseGitHubRepository(value) {
  const normalized = String(value)
    .trim()
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/^\/+|\/+$/g, "");
  if (!/^[^/]+\/[^/]+$/.test(normalized)) {
    throw new Error(`invalid GitHub repository: ${value}`);
  }
  return normalized;
}

function compareVersions(left, right) {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

function versionParts(value) {
  return String(value)
    .replace(/^v/i, "")
    .split(/[.+-]/)
    .map((part) => (/^\d+$/.test(part) ? Number.parseInt(part, 10) : 0));
}

function sortObject(value) {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function stringList(value) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === "string")
    : [];
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const output = new Array(values.length);
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        output[index] = await mapper(values[index]);
      }
    }),
  );
  return output;
}
