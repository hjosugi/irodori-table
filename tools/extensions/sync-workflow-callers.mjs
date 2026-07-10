#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { readConnectorRepositories } from "./lib/tooling.mjs";

const root = resolve(import.meta.dirname, "../..");
const extensionsRoot = resolve(
  process.env.IRODORI_EXTENSIONS_ROOT ?? resolve(root, "../irodori-extensions"),
);
const check = process.argv.includes("--check");
const write = process.argv.includes("--write");

if (check === write) {
  throw new Error("pass exactly one of --check or --write");
}

const duckDbBacked = new Set([
  "irodori-extension-duckdb",
  "irodori-extension-motherduck",
  "irodori-extension-delta-lake",
  "irodori-extension-hive",
  "irodori-extension-hudi",
  "irodori-extension-iceberg",
  "irodori-extension-s3-tables",
]);
const stale = [];

for (const repository of readConnectorRepositories()) {
  const repoRoot = resolve(extensionsRoot, repository.name);
  if (!existsSync(repoRoot)) {
    throw new Error(`extension checkout not found: ${repoRoot}`);
  }
  syncFile(
    resolve(repoRoot, ".github/workflows/ci.yml"),
    ciWorkflow(duckDbBacked.has(repository.name)),
  );
  syncFile(
    resolve(repoRoot, ".github/workflows/release.yml"),
    releaseWorkflow(duckDbBacked.has(repository.name)),
  );
}

if (stale.length > 0) {
  throw new Error(
    `extension workflow callers are stale:\n${stale.map((path) => `  - ${path}`).join("\n")}`,
  );
}
console.log(
  `extension-workflows: ${check ? "ok" : "synchronized"} (${readConnectorRepositories().length} repositories)`,
);

function syncFile(path, expected) {
  const current = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (current === expected) {
    return;
  }
  if (check) {
    stale.push(path);
  } else {
    writeFileSync(path, expected);
  }
}

function ciWorkflow(isDuckDbBacked) {
  return `name: CI

on:
  push:
    branches:
      - main
  pull_request:

permissions:
  contents: read

jobs:
  extension-ci:
    uses: hjosugi/irodori-kit/.github/workflows/extension-ci.yml@v0.6.8
    with:
      manifest-root: "."
      package-command: "make package"
      duckdb-backed: ${isDuckDbBacked}
`;
}

function releaseWorkflow(isDuckDbBacked) {
  return `name: Release

on:
  push:
    tags:
      - "v*"
  workflow_dispatch:
    inputs:
      release_tag:
        description: "Existing v* tag to rebuild and publish"
        required: true
        type: string

permissions:
  contents: write

jobs:
  extension-release:
    uses: hjosugi/irodori-kit/.github/workflows/extension-release.yml@v0.6.8
    with:
      release_tag: \${{ inputs.release_tag || github.ref_name }}
      duckdb_backed: ${isDuckDbBacked}
    secrets:
      catalog_token: \${{ secrets.IRODORI_CATALOG_TOKEN }}
`;
}
