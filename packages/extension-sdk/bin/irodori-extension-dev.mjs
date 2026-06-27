#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, watch, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cliOptions = parseCliOptions(process.argv.slice(2), process.cwd());
const manifestPath = join(cliOptions.extensionDir, "irodori.extension.json");

const sensitivePermissions = new Set([
  "connections:write",
  "queries:run",
  "queryResults:read",
  "queryResults:write",
  "files:write",
  "native",
  "wasm",
]);

const contributionPermissionRules = [
  ["commands", "commands", "contributes.commands requires permissions: commands"],
  ["keybindings", "keybindings", "contributes.keybindings requires permissions: keybindings"],
  ["resultGridActions", "resultRenderers", "contributes.resultGridActions requires permissions: resultRenderers"],
  ["resultGridRenderers", "resultRenderers", "contributes.resultGridRenderers requires permissions: resultRenderers"],
  ["statusBarItems", "statusBar", "contributes.statusBarItems requires permissions: statusBar"],
  ["themes", "themes", "contributes.themes requires permissions: themes"],
  ["sqlDialects", "sqlDialects", "contributes.sqlDialects requires permissions: sqlDialects"],
];

const capabilityPermissionRules = [
  ["wasmModules", "wasm", "capabilities.wasmModules requires permissions: wasm"],
  ["nativeModules", "native", "capabilities.nativeModules requires permissions: native"],
];

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main() {
  const manifest = readManifest(manifestPath);
  const logFile = resolve(cliOptions.extensionDir, manifest.dev?.logFile ?? ".irodori-dev/extension.log");
  mkdirSync(dirname(logFile), { recursive: true });
  appendLog(logFile, "info", `loaded ${manifest.id}@${manifest.version}`);

  const inspection = inspectPermissions(manifest);
  printSummary(manifest, inspection, logFile);

  const fixtures = loadFixtures(cliOptions.extensionDir, manifest);
  if (fixtures.length > 0) {
    appendLog(logFile, "info", `loaded ${fixtures.length} fake database fixture(s)`);
    console.log(`fixtures: ${fixtures.map((fixture) => fixture.id).join(", ")}`);
  }

  if (cliOptions.once) {
    return;
  }

  const watchPaths = collectWatchPaths(cliOptions.extensionDir, manifest);
  console.log("watching:");
  for (const watchPath of watchPaths) {
    console.log(`  ${watchPath}`);
  }

  for (const watchPath of watchPaths) {
    watchPathForReload(watchPath, logFile);
  }
}

function parseCliOptions(argv, cwd) {
  const targetArg = argv.find((arg) => !arg.startsWith("--"));
  return {
    once: argv.includes("--once"),
    extensionDir: resolve(cwd, targetArg ?? "."),
  };
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

  return {
    declared: [...declared],
    sensitive: [...declared].filter((scope) => sensitivePermissions.has(scope)),
    missingForContributions: missingPermissionMessages(manifest, declared),
  };
}

function missingPermissionMessages(manifest, declared) {
  const contributes = manifest.contributes ?? {};
  const capabilities = manifest.capabilities ?? {};
  const contributionMessages = contributionPermissionRules.flatMap(([key, permission, message]) =>
    (contributes[key]?.length ?? 0) > 0 && !declared.has(permission) ? [message] : [],
  );
  const capabilityMessages = capabilityPermissionRules.flatMap(([key, permission, message]) =>
    (capabilities[key]?.length ?? 0) > 0 && !declared.has(permission) ? [message] : [],
  );

  return [...contributionMessages, ...capabilityMessages];
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
    loaded.push(...normalizeFixtureList(parsed));
  }

  return loaded;
}

function normalizeFixtureList(parsed) {
  return Array.isArray(parsed) ? parsed : [parsed];
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
  const timestamp = new Date().toISOString();
  appendFileSync(logFile, `${JSON.stringify(formatLogEntry(level, message, timestamp))}\n`);
}

function formatLogEntry(level, message, timestamp) {
  return {
    level,
    message,
    target: "extension-dev",
    timestamp,
  };
}

function printSummary(manifest, inspection, logFile) {
  for (const line of formatSummaryLines(manifest, inspection, logFile)) {
    console.log(line);
  }
  for (const warning of formatPermissionWarnings(inspection)) {
    console.warn(warning);
  }
}

function formatSummaryLines(manifest, inspection, logFile) {
  return [
    `${manifest.name} (${manifest.id})`,
    `runtime: ${manifest.runtime}`,
    `entry: ${manifest.entry}`,
    `log: ${logFile}`,
    `permissions: ${inspection.declared.join(", ") || "(none)"}`,
    inspection.sensitive.length > 0 ? `sensitive: ${inspection.sensitive.join(", ")}` : null,
  ].filter(Boolean);
}

function formatPermissionWarnings(inspection) {
  return inspection.missingForContributions.map((missing) => `permission warning: ${missing}`);
}

export const __filename = fileURLToPath(import.meta.url);
