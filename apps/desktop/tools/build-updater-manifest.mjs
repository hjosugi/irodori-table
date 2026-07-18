#!/usr/bin/env node
// Assemble the Tauri updater manifest (latest.json) from the signature assets
// the platform lanes uploaded, then write it for the caller to publish.
//
// tauri-action can write latest.json itself, but each lane *merges* into the
// existing asset: list, download, merge, delete, re-upload. That sequence is
// not atomic, so with the lanes running in parallel two of them can read the
// same manifest and the second write silently drops the first one's platform
// (tauri-action#1197). Building it once, after every lane has finished, removes
// the race by construction rather than retrying into it.
//
// Usage: RELEASE_TAG=v1.2.3 node tools/build-updater-manifest.mjs <out-path>

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const releaseTag = requiredEnv("RELEASE_TAG");
const repository = requiredEnv("GITHUB_REPOSITORY");
const outPath = process.argv[2];
if (!outPath) {
  throw new Error("usage: build-updater-manifest.mjs <out-path>");
}

const version = releaseTag.replace(/^v/, "");

// A universal macOS build serves both architectures from one artifact, so both
// darwin keys point at the same bundle. Updater clients look themselves up by
// exact key, so omitting one would strand those users.
const TARGETS = [
  { suffix: ".AppImage.sig", platforms: ["linux-x86_64"] },
  { suffix: ".app.tar.gz.sig", platforms: ["darwin-aarch64", "darwin-x86_64"] },
  { suffix: "-setup.exe.sig", platforms: ["windows-x86_64"] },
];

const assets = listAssets();
const platforms = {};

for (const target of TARGETS) {
  const sig = assets.find((asset) => asset.name.endsWith(target.suffix));
  if (!sig) {
    throw new Error(
      `no updater signature matching "${target.suffix}" in ${releaseTag}. ` +
        `The lane that produces it either failed or did not upload signatures.`,
    );
  }

  // The bundle sits next to its signature under the same name minus ".sig".
  const bundleName = sig.name.slice(0, -".sig".length);
  const bundle = assets.find((asset) => asset.name === bundleName);
  if (!bundle) {
    throw new Error(
      `signature ${sig.name} has no matching bundle ${bundleName} in ${releaseTag}.`,
    );
  }

  const signature = readAsset(sig.name).trim();
  if (!signature) {
    throw new Error(`signature asset ${sig.name} is empty.`);
  }

  for (const platform of target.platforms) {
    platforms[platform] = { signature, url: bundle.url };
  }
}

writeFileSync(
  outPath,
  `${JSON.stringify(
    {
      version,
      // Tauri compares versions, not dates, but clients surface pub_date.
      pub_date: new Date().toISOString(),
      platforms,
    },
    null,
    2,
  )}\n`,
);

console.log(
  `Updater manifest for ${releaseTag} written to ${outPath} (${Object.keys(platforms).join(", ")})`,
);

function listAssets() {
  // --jq keeps the payload small; releases carry large binaries we never read.
  const raw = gh([
    "release",
    "view",
    releaseTag,
    "--repo",
    repository,
    "--json",
    "assets",
    "--jq",
    ".assets[] | {name: .name, url: .url}",
  ]);
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function readAsset(name) {
  // `gh release download -O -` streams to stdout, avoiding a temp file.
  return gh([
    "release",
    "download",
    releaseTag,
    "--repo",
    repository,
    "--pattern",
    name,
    "-O",
    "-",
  ]);
}

function gh(args) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}
