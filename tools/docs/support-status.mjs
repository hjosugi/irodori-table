#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildBundledPluginStoreCatalog,
  buildExtensionCatalog,
  hasHeavyExtensionCatalogFields,
  serializeExtensionCatalog,
} from "./extension-catalog.mjs";

const root = resolve(import.meta.dirname, "../..");
const engineRegistryPath = resolve(root, "apps/desktop/src-tauri/src/db/engine.rs");
const dbProfilePath = resolve(root, "apps/desktop/src-tauri/src/db/profile.rs");
const enginesJsonPath = resolve(root, "knowledge/engines.json");
const sourcesJsonPath = resolve(root, "knowledge/sources.json");
const marketplaceIndexPath = resolve(root, "registry/catalog/index.json");
const marketplaceCatalogPath = resolve(root, "registry/catalog/catalog.json");
const bundledCatalogPath = resolve(
  root,
  "apps/desktop/src/features/extensions/bundled-catalog.json",
);
const connectorRepositoriesPath = resolve(
  root,
  "registry/catalog/connector-repositories.json",
);
const supportStatusPath = resolve(root, "registry/data-source-support-status.md");

function main() {
  const engineSource = read(engineRegistryPath);
  const dbProfileSource = read(dbProfilePath);
  const enginesJson = JSON.parse(read(enginesJsonPath));
  const sourcesJson = JSON.parse(read(sourcesJsonPath));
  const marketplaceIndex = JSON.parse(read(marketplaceIndexPath));
  const engineRows = enginesJson.engines ?? [];
  const marketplaceCatalogSource = read(marketplaceCatalogPath);
  const marketplaceCatalog = JSON.parse(marketplaceCatalogSource);
  const expectedMarketplaceCatalog = buildExtensionCatalog(marketplaceIndex, {
    engines: engineRows,
  });
  const bundledCatalogSource = read(bundledCatalogPath);
  const expectedBundledCatalog = buildBundledPluginStoreCatalog(marketplaceIndex, {
    engines: engineRows,
  });
  const connectorRepositories = JSON.parse(read(connectorRepositoriesPath));
  const supportStatus = read(supportStatusPath);

  const registryIds = parseDbEngineIds(engineSource);
  const jsonIds = new Set(engineRows.map((engine) => engine.id));
  const sourceProducts = new Set(sourcesJson.map((source) => sourceProductKey(source.product)));
  const marketplaceExtensions = marketplaceIndex.extensions ?? [];
  const marketplaceCatalogExtensions = marketplaceCatalog.extensions ?? [];
  const marketplaceEngineIds = new Set(
    marketplaceExtensions.flatMap((extension) => extension.engines ?? []),
  );
  const marketplaceExtensionIdByEngine = new Map(
    marketplaceExtensions.flatMap((extension) =>
      (extension.engines ?? []).map((engine) => [engine, extension.id]),
    ),
  );
  const marketplaceExtensionByEngine = new Map(
    marketplaceExtensions.flatMap((extension) =>
      (extension.engines ?? []).map((engine) => [engine, extension]),
    ),
  );
  const catalogExtensionById = new Map(
    marketplaceCatalogExtensions.map((extension) => [extension.id, extension]),
  );
  const marketplaceCatalogEngineIds = new Set(
    marketplaceCatalogExtensions.flatMap((extension) => extension.engines ?? []),
  );
  const marketplaceExtensionIds = new Set(marketplaceExtensions.map((extension) => extension.id));
  const marketplaceCatalogExtensionIds = new Set(
    marketplaceCatalogExtensions.map((extension) => extension.id),
  );
  const engineRowsById = new Map(engineRows.map((engine) => [engine.id, engine]));
  const repositoryExtensionIds = new Set(
    (connectorRepositories.repositories ?? []).map((repository) => repository.extensionId),
  );
  const recognizedNoConnectorIds = new Set(
    engineRows
      .filter((engine) => engine.status === "recognized_no_connector")
      .map((engine) => engine.id),
  );
  const recognizedNoConnectorMarketplaceIds = new Set(
    engineRows
      .filter((engine) => engine.status === "recognized_no_connector" && engine.extensionId)
      .map((engine) => engine.id),
  );
  const unimplementedWireIds = parseUnimplementedWires(dbProfileSource).map(camelId);
  const expectedNoConnectorIds = new Set(
    engineRows
      .filter((engine) => unimplementedWireIds.includes(engine.wire))
      .map((engine) => engine.id),
  );

  const errors = [
    ...setDiff(registryIds, jsonIds).map(
      (id) => `knowledge/engines.json is missing registered engine '${id}'`,
    ),
    ...setDiff(jsonIds, registryIds).map(
      (id) => `knowledge/engines.json lists unknown engine '${id}'`,
    ),
    ...setDiff(marketplaceEngineIds, jsonIds).map(
      (id) => `registry/catalog/index.json lists engine '${id}' missing from knowledge/engines.json`,
    ),
    ...(marketplaceCatalogSource === serializeExtensionCatalog(expectedMarketplaceCatalog)
      ? []
      : [
          "registry/catalog/catalog.json is stale; run node tools/docs/build-extension-catalog.mjs",
        ]),
    ...(bundledCatalogSource === serializeExtensionCatalog(expectedBundledCatalog)
      ? []
      : [
          "apps/desktop/src/features/extensions/bundled-catalog.json is stale; run node tools/docs/build-extension-catalog.mjs",
        ]),
    ...setDiff(marketplaceCatalogEngineIds, jsonIds).map(
      (id) => `registry/catalog/catalog.json lists engine '${id}' missing from knowledge/engines.json`,
    ),
    ...setDiff(marketplaceExtensionIds, marketplaceCatalogExtensionIds).map(
      (id) => `registry/catalog/catalog.json is missing extension '${id}' from index.json`,
    ),
    ...setDiff(marketplaceCatalogExtensionIds, marketplaceExtensionIds).map(
      (id) => `registry/catalog/catalog.json lists unknown extension '${id}'`,
    ),
    ...marketplaceCatalogExtensions
      .filter(hasHeavyExtensionCatalogFields)
      .map(
        (extension) =>
          `registry/catalog/catalog.json includes heavy detail fields for extension '${extension.id}'`,
      ),
    ...setDiff(marketplaceExtensionIds, repositoryExtensionIds).map(
      (id) => `registry/catalog/connector-repositories.json is missing extension '${id}'`,
    ),
    ...setDiff(recognizedNoConnectorMarketplaceIds, marketplaceEngineIds).map(
      (id) => `recognized/no-connector engine '${id}' has no marketplace extension`,
    ),
    ...engineRows
      .filter((engine) => engine.status === "recognized_no_connector")
      .filter((engine) => engine.extensionId)
      .filter((engine) => engine.extensionId !== marketplaceExtensionIdByEngine.get(engine.id))
      .map(
        (engine) =>
          `recognized/no-connector engine '${engine.id}' extensionId must match marketplace extension '${marketplaceExtensionIdByEngine.get(engine.id)}'`,
      ),
    ...engineRows
      .filter((engine) => !hasSourceCoverage(engine, sourceProducts))
      .map(
        (engine) =>
          `knowledge/sources.json has no source coverage for engine '${engine.id}' (${engine.label})`,
      ),
    ...engineRows.flatMap((engine) =>
      validateSourceTypeContract(engine, marketplaceExtensionByEngine.get(engine.id)),
    ),
    ...marketplaceExtensions.flatMap((extension) =>
      validateSourceTypeCatalogProjection(
        extension,
        catalogExtensionById.get(extension.id),
        engineRowsById,
      ),
    ),
    ...setDiff(expectedNoConnectorIds, recognizedNoConnectorIds).map(
      (id) => `engine '${id}' is rejected by is_unimplemented_wire() but is not marked recognized_no_connector`,
    ),
    ...setDiff(recognizedNoConnectorIds, expectedNoConnectorIds).map(
      (id) => `engine '${id}' is marked recognized_no_connector but is not rejected by is_unimplemented_wire()`,
    ),
    ...[...jsonIds]
      .filter((id) => !supportStatus.includes(`\`${id}\``))
      .map((id) => `registry/data-source-support-status.md does not mention engine id '${id}'`),
  ];

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`support-status: ${error}`);
    }
    process.exit(1);
  }

  console.log(
    `support-status: ok (${registryIds.size} registered engines, ${recognizedNoConnectorIds.size} recognized/no-connector)`,
  );
}

function read(path) {
  return readFileSync(path, "utf8");
}

function parseDbEngineIds(source) {
  const enumBody = source.match(/pub enum DbEngine \{([\s\S]*?)\n\}/)?.[1];
  if (!enumBody) {
    throw new Error("Could not parse DbEngine enum");
  }
  const ids = new Set();
  let serdeRename = null;
  for (const rawLine of enumBody.split("\n")) {
    const line = rawLine.trim();
    const rename = line.match(/#\[serde\(rename = "([^"]+)"\)\]/);
    if (rename) {
      serdeRename = rename[1];
      continue;
    }
    if (line.startsWith("#") || line.startsWith("//") || line === "") {
      continue;
    }
    const variant = line.match(/^([A-Z][A-Za-z0-9]*),/)?.[1];
    if (!variant) {
      continue;
    }
    ids.add(serdeRename ?? camelId(variant));
    serdeRename = null;
  }
  return ids;
}

function parseUnimplementedWires(source) {
  const body = source.match(
    /fn is_unimplemented_wire\(wire: Wire\) -> bool \{([\s\S]*?)\n\}/,
  )?.[1];
  if (!body) {
    throw new Error("Could not parse is_unimplemented_wire()");
  }
  return [...body.matchAll(/Wire::([A-Za-z0-9]+)/g)].map((match) => match[1]);
}

function camelId(value) {
  return value[0].toLowerCase() + value.slice(1);
}

function hasSourceCoverage(engine, sourceProducts) {
  const products = [engine.label, ...(engine.sourceProducts ?? [])];
  return products.some((product) => sourceProducts.has(sourceProductKey(product)));
}

function validateSourceTypeContract(engine, marketplaceExtension) {
  const expectedKind = expectedSourceTypeKind(engine, marketplaceExtension);
  const contract = engine.sourceTypeContract;
  if (!expectedKind && contract === undefined) {
    return [];
  }
  const label = `engine '${engine.id}' sourceTypeContract`;
  const errors = [];
  if (!contract || typeof contract !== "object") {
    return expectedKind ? [`${label} is required for ${expectedKind} engines`] : [];
  }
  if (expectedKind && contract.kind !== expectedKind) {
    errors.push(`${label}.kind must be '${expectedKind}'`);
  }
  if (contract.kind !== "vector" && contract.kind !== "lakehouse") {
    errors.push(`${label}.kind must be 'vector' or 'lakehouse'`);
  }
  for (const key of ["objectTypes", "workflows", "resultViews", "queryTemplates"]) {
    if (!hasNonEmptyStringList(contract[key])) {
      errors.push(`${label}.${key} must be a non-empty string array`);
    }
  }
  if (contract.kind === "vector") {
    errors.push(
      ...requireItems(label, "workflows", contract.workflows, [
        "collectionBrowsing",
        "vectorMetadata",
        "similaritySearch",
        "filteredSearch",
        "hybridSearch",
      ]),
      ...requireItems(label, "resultViews", contract.resultViews, ["vectorNeighbors"]),
      ...requireItems(label, "queryTemplates", contract.queryTemplates, [
        "vector-similarity",
        "vector-filtered",
        "vector-health",
      ]),
    );
  }
  if (contract.kind === "lakehouse") {
    errors.push(
      ...requireItems(label, "workflows", contract.workflows, [
        "catalogBrowsing",
        "tableFormatMetadata",
        "executionBackendSelection",
        "catalogCredentials",
        "queryTemplates",
      ]),
      ...requireItems(label, "resultViews", contract.resultViews, ["table"]),
      ...requireItems(label, "queryTemplates", contract.queryTemplates, [
        "lakehouse-preview",
        "lakehouse-catalog",
        "lakehouse-maintenance",
      ]),
    );
    if (!hasNonEmptyStringList(contract.executionBackends)) {
      errors.push(`${label}.executionBackends must be a non-empty string array`);
    }
    if (!hasNonEmptyStringList(contract.tableFormats)) {
      errors.push(`${label}.tableFormats must be a non-empty string array`);
    }
  }
  return errors;
}

function validateSourceTypeCatalogProjection(indexExtension, catalogExtension, engineRowsById) {
  const expectedSourceTypes = (indexExtension.engines ?? []).filter(
    (engine) => engineRowsById.get(engine)?.sourceTypeContract,
  );
  const actualSourceTypes = new Set(
    catalogExtension?.contributes?.sourceTypes?.map((sourceType) => sourceType.engine) ?? [],
  );
  const missingSourceTypes = expectedSourceTypes.filter(
    (engine) => !actualSourceTypes.has(engine),
  );
  if (missingSourceTypes.length > 0) {
    return missingSourceTypes.map(
      (engine) =>
        `registry/catalog/catalog.json extension '${indexExtension.id}' is missing sourceType projection for engine '${engine}'`,
    );
  }
  return [];
}

function expectedSourceTypeKind(engine, marketplaceExtension) {
  const family = String(engine.family ?? "").toLowerCase();
  const wire = String(engine.wire ?? "").toLowerCase();
  const categories = (marketplaceExtension?.categories ?? []).map((item) =>
    String(item).toLowerCase(),
  );
  const topics = (marketplaceExtension?.topics ?? []).map((item) =>
    String(item).toLowerCase(),
  );
  if (family.includes("vector") || categories.includes("vector")) {
    return "vector";
  }
  if (
    family.includes("lakehouse") ||
    wire === "lakehouse" ||
    categories.includes("lakehouse") ||
    topics.includes("lakehouse")
  ) {
    return "lakehouse";
  }
  return null;
}

function hasNonEmptyStringList(value) {
  return Array.isArray(value) && value.some((item) => typeof item === "string" && item);
}

function requireItems(label, key, actual, expected) {
  const values = new Set(Array.isArray(actual) ? actual : []);
  return expected
    .filter((item) => !values.has(item))
    .map((item) => `${label}.${key} is missing '${item}'`);
}

function sourceProductKey(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function setDiff(left, right) {
  return [...left].filter((item) => !right.has(item)).sort();
}

main();
