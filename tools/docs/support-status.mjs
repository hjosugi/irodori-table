#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const engineRegistryPath = resolve(root, "apps/desktop/src-tauri/src/db/engine.rs");
const dbRegistryPath = resolve(root, "apps/desktop/src-tauri/src/db.rs");
const enginesJsonPath = resolve(root, "knowledge/engines.json");
const supportStatusPath = resolve(root, "docs/data-source-support-status.md");

function main() {
  const engineSource = read(engineRegistryPath);
  const dbSource = read(dbRegistryPath);
  const enginesJson = JSON.parse(read(enginesJsonPath));
  const supportStatus = read(supportStatusPath);

  const registryIds = parseDbEngineIds(engineSource);
  const engineRows = enginesJson.engines ?? [];
  const jsonIds = new Set(engineRows.map((engine) => engine.id));
  const recognizedNoConnectorIds = new Set(
    engineRows
      .filter((engine) => engine.status === "recognized_no_connector")
      .map((engine) => engine.id),
  );
  const unimplementedWireIds = parseUnimplementedWires(dbSource).map(camelId);
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
    ...setDiff(expectedNoConnectorIds, recognizedNoConnectorIds).map(
      (id) => `engine '${id}' is rejected by is_unimplemented_wire() but is not marked recognized_no_connector`,
    ),
    ...setDiff(recognizedNoConnectorIds, expectedNoConnectorIds).map(
      (id) => `engine '${id}' is marked recognized_no_connector but is not rejected by is_unimplemented_wire()`,
    ),
    ...[...jsonIds]
      .filter((id) => !supportStatus.includes(`\`${id}\``))
      .map((id) => `docs/data-source-support-status.md does not mention engine id '${id}'`),
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

function setDiff(left, right) {
  return [...left].filter((item) => !right.has(item)).sort();
}

main();
