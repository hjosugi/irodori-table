#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

import {
  buildBundledPluginStoreCatalog,
  buildExtensionCatalog,
  serializeExtensionCatalog,
} from "./extension-catalog.mjs";
import { fromRepoRoot } from "../lib/paths.mjs";

const indexPath = fromRepoRoot("registry/catalog/index.json");
const enginesPath = fromRepoRoot("knowledge/engines.json");
const catalogPath = fromRepoRoot("registry/catalog/catalog.json");
const bundledCatalogPath = fromRepoRoot(
  "apps/desktop/src/features/extensions/bundled-catalog.json",
);
const check = process.argv.includes("--check");

for (const arg of process.argv.slice(2)) {
  if (arg !== "--check") {
    console.error(`Unknown argument: ${arg}`);
    process.exit(1);
  }
}

const index = JSON.parse(readFileSync(indexPath, "utf8"));
const engines = JSON.parse(readFileSync(enginesPath, "utf8")).engines ?? [];
const catalog = buildExtensionCatalog(index, { engines });
const next = serializeExtensionCatalog(catalog);
const bundledCatalog = buildBundledPluginStoreCatalog(index, { engines });
const nextBundled = serializeExtensionCatalog(bundledCatalog);

if (check) {
  const current = readFileSync(catalogPath, "utf8");
  const currentBundled = readFileSync(bundledCatalogPath, "utf8");
  if (current !== next) {
    console.error(
      "extension-catalog: registry/catalog/catalog.json is stale; run node tools/docs/build-extension-catalog.mjs",
    );
    process.exit(1);
  }
  if (currentBundled !== nextBundled) {
    console.error(
      "extension-catalog: apps/desktop/src/features/extensions/bundled-catalog.json is stale; run node tools/docs/build-extension-catalog.mjs",
    );
    process.exit(1);
  }
  console.log(`extension-catalog: ok (${catalog.extensions.length} extensions)`);
} else {
  writeFileSync(catalogPath, next);
  writeFileSync(bundledCatalogPath, nextBundled);
  console.log(`extension-catalog: wrote ${catalog.extensions.length} extensions`);
}
