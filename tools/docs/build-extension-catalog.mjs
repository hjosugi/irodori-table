#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildExtensionCatalog,
  serializeExtensionCatalog,
} from "./extension-catalog.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "../..");
const indexPath = resolve(root, "docs/extension-marketplace/index.json");
const catalogPath = resolve(root, "docs/extension-marketplace/catalog.json");
const check = process.argv.includes("--check");

for (const arg of process.argv.slice(2)) {
  if (arg !== "--check") {
    console.error(`Unknown argument: ${arg}`);
    process.exit(1);
  }
}

const index = JSON.parse(readFileSync(indexPath, "utf8"));
const catalog = buildExtensionCatalog(index);
const next = serializeExtensionCatalog(catalog);

if (check) {
  const current = readFileSync(catalogPath, "utf8");
  if (current !== next) {
    console.error(
      "extension-catalog: docs/extension-marketplace/catalog.json is stale; run node tools/docs/build-extension-catalog.mjs",
    );
    process.exit(1);
  }
  console.log(`extension-catalog: ok (${catalog.extensions.length} extensions)`);
} else {
  writeFileSync(catalogPath, next);
  console.log(`extension-catalog: wrote ${catalog.extensions.length} extensions`);
}
