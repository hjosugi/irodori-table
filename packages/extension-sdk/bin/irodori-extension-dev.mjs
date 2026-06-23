#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, watch, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const once = args.includes("--once");
const targetArg = args.find((arg) => !arg.startsWith("--"));
const extensionDir = resolve(process.cwd(), targetArg ?? ".");
const manifestPath = join(extensionDir, "irodori.extension.json");

const sensitivePermissions = new Set([
  "connections:write",
  "queries:run",
  "queryResults:read",
  "queryResults:write",
  "files:write",
  "native",
  "wasm",
]);

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main() {
  const manifest = readManifest(manifestPath);
  const logFile = resolve(extensionDir, manifest.dev?.logFile ?? ".irodori-dev/extension.log");
  mkdirSync(dirname(logFile), { recursive: true });
  appendLog(logFile, "info", `loaded ${manifest.id}@${manifest.version}`);

  const inspection = inspectPermissions(manifest);
  printSummary(manifest, inspection, logFile);

  const fixtures = loadFixtures(extensionDir, manifest);
  if (fixtures.length > 0) {
    appendLog(logFile, "info", `loaded ${fixtures.length} fake database fixture(s)`);
    console.log(`fixtures: ${fixtures.map((fixture) => fixture.id).join(", ")}`);
  }

  if (once) {
    return;
  }

  const watchPaths = collectWatchPaths(extensionDir, manifest);
  console.log("watching:");
  for (const watchPath of watchPaths) {
    console.log(`  ${watchPath}`);
  }

  for (const watchPath of watchPaths) {
    watchPathForReload(watchPath, logFile);
  }
}

function readManifest(path) {
  if (!existsSync(path)) {
    throw new Error(`missing manifest: ${path}`);
  }
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  const required = ["manifestVersion", "id", "name", "version", "license", "apiVersion", "runtime", "entry", "permissions"];
  for (const key of required) {
    if (manifest[key] === undefined) {
      throw new Error(`manifest is missing required field: ${key}`);
    }
  }
  if (manifest.manifestVersion !== 1) {
    throw new Error(`unsupported manifestVersion: ${manifest.manifestVersion}`);
  }
  if (!Array.isArray(manifest.permissions)) {
    throw new Error("manifest permissions must be an array");
  }
  return manifest;
}

function inspectPermissions(manifest) {
  const declared = new Set(manifest.permissions);
  const missing = [];
  const contributes = manifest.contributes ?? {};

  if ((contributes.commands?.length ?? 0) > 0 && !declared.has("commands")) {
    missing.push("contributes.commands requires permissions: commands");
  }
  if ((contributes.keybindings?.length ?? 0) > 0 && !declared.has("keybindings")) {
    missing.push("contributes.keybindings requires permissions: keybindings");
  }
  if ((contributes.resultGridActions?.length ?? 0) > 0 && !declared.has("resultRenderers")) {
    missing.push("contributes.resultGridActions requires permissions: resultRenderers");
  }
  if ((contributes.resultGridRenderers?.length ?? 0) > 0 && !declared.has("resultRenderers")) {
    missing.push("contributes.resultGridRenderers requires permissions: resultRenderers");
  }
  if ((contributes.themes?.length ?? 0) > 0 && !declared.has("themes")) {
    missing.push("contributes.themes requires permissions: themes");
  }
  if ((contributes.sqlDialects?.length ?? 0) > 0 && !declared.has("sqlDialects")) {
    missing.push("contributes.sqlDialects requires permissions: sqlDialects");
  }
  if ((manifest.capabilities?.wasmModules?.length ?? 0) > 0 && !declared.has("wasm")) {
    missing.push("capabilities.wasmModules requires permissions: wasm");
  }
  if ((manifest.capabilities?.nativeModules?.length ?? 0) > 0 && !declared.has("native")) {
    missing.push("capabilities.nativeModules requires permissions: native");
  }

  return {
    declared: [...declared],
    sensitive: [...declared].filter((scope) => sensitivePermissions.has(scope)),
    missingForContributions: missing,
  };
}

function loadFixtures(extensionDir, manifest) {
  const devFixtures = manifest.dev?.fixtures ?? [];
  const loaded = [];

  for (const fixture of devFixtures) {
    loaded.push(fixture);
  }

  const fixturePath = join(extensionDir, "fixtures", "fake-db.json");
  if (existsSync(fixturePath)) {
    const parsed = JSON.parse(readFileSync(fixturePath, "utf8"));
    if (Array.isArray(parsed)) {
      loaded.push(...parsed);
    } else {
      loaded.push(parsed);
    }
  }

  return loaded;
}

function collectWatchPaths(extensionDir, manifest) {
  const fromManifest = manifest.dev?.watch ?? [];
  const candidates = [
    "irodori.extension.json",
    manifest.entry,
    ...fromManifest,
    "fixtures/fake-db.json",
  ];

  return [...new Set(candidates)]
    .map((path) => resolve(extensionDir, path))
    .filter((path) => existsSync(path));
}

function watchPathForReload(path, logFile) {
  const target = statSync(path).isDirectory() ? path : dirname(path);
  watch(target, { persistent: true }, (_event, fileName) => {
    const detail = fileName ? `${target}/${fileName}` : target;
    appendLog(logFile, "info", `reload requested by ${detail}`);
    console.log(`reload: ${detail}`);
  });
}

function appendLog(logFile, level, message) {
  const entry = {
    level,
    message,
    target: "extension-dev",
    timestamp: new Date().toISOString(),
  };
  appendFileSync(logFile, `${JSON.stringify(entry)}\n`);
}

function printSummary(manifest, inspection, logFile) {
  console.log(`${manifest.name} (${manifest.id})`);
  console.log(`runtime: ${manifest.runtime}`);
  console.log(`entry: ${manifest.entry}`);
  console.log(`log: ${logFile}`);
  console.log(`permissions: ${inspection.declared.join(", ") || "(none)"}`);
  if (inspection.sensitive.length > 0) {
    console.log(`sensitive: ${inspection.sensitive.join(", ")}`);
  }
  if (inspection.missingForContributions.length > 0) {
    for (const missing of inspection.missingForContributions) {
      console.warn(`permission warning: ${missing}`);
    }
  }
}

export const __filename = fileURLToPath(import.meta.url);
