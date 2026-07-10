#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

import {
  assert,
  extensionsRoot,
  parsePositiveInteger,
  readConnectorRepositories,
  readExtensionCatalog,
  readJson,
  readText,
  selectRepositories,
} from "./lib/tooling.mjs";

const REQUIRED_ENTRYPOINTS = [
  "irodori_extension_abi_version",
  "irodori_connector_engine_json",
  "irodori_extension_manifest_json",
  "irodori_connector_config_json",
  "irodori_connector_call_json",
  "irodori_connector_free_buffer",
];
const REQUIRED_CALLS = ["health", "describe", "manifest", "config", "connect", "query", "metadata", "close"];
const DUCKDB_RUNTIME_ENGINES = new Set([
  "duckdb",
  "motherduck",
  "deltaLake",
  "hive",
  "hudi",
  "iceberg",
  "s3Tables",
]);

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}

const connectorRepositories = readConnectorRepositories();
const catalog = readExtensionCatalog();
const catalogById = new Map((catalog.extensions ?? []).map((entry) => [entry.id, entry]));
const selectedRepositories = selectRepositories(connectorRepositories, options);

if (selectedRepositories.length === 0) {
  throw new Error("No extension repositories matched the requested filters.");
}

if (options.list) {
  for (const repo of selectedRepositories) {
    console.log(`${repo.name}\t${repo.extensionId}\t${(repo.engines ?? []).join(",")}`);
  }
  process.exit(0);
}

console.log("Irodori extension scenario tests");
console.log(`  extensions root: ${extensionsRoot}`);
console.log(`  repositories: ${selectedRepositories.length}`);
console.log(`  make check: ${options.skipCheck ? "skip" : "run"}`);
console.log(`  make package: ${options.skipPackage ? "skip" : "run"}`);
console.log(`  archive gate: ${options.requireArchive ? "required" : "warning"}`);

const failures = [];
const warnings = [];

for (const [index, repo] of selectedRepositories.entries()) {
  const startedAt = Date.now();
  const repoWarnings = [];
  console.log(`\n[${index + 1}/${selectedRepositories.length}] ${repo.name}`);
  try {
    await runScenario(repo, repoWarnings);
    warnings.push(...repoWarnings.map((warning) => `${repo.name}: ${warning}`));
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`  PASS ${repo.name} (${seconds}s)`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${repo.name}: ${message}`);
    console.error(`  FAIL ${repo.name}: ${message}`);
  }
}

if (warnings.length > 0) {
  console.log(`\nWarnings (${warnings.length})`);
  for (const warning of warnings.slice(0, 50)) {
    console.log(`  - ${warning}`);
  }
  if (warnings.length > 50) {
    console.log(`  - ... ${warnings.length - 50} more`);
  }
}

if (failures.length > 0) {
  console.error(`\nFailures (${failures.length})`);
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.log(`\nExtension scenarios passed: ${selectedRepositories.length} repo(s).`);

async function runScenario(repo, warnings) {
  const repoDir = resolve(extensionsRoot, repo.name);
  assert(existsSync(repoDir), `repository checkout not found: ${repoDir}`);

  const distSnapshot = snapshotTree(resolve(repoDir, "dist"));
  try {
    const manifest = readJson(resolve(repoDir, "irodori.extension.json"));
    const config = readJson(resolve(repoDir, "connector.config.json"));
    const cargoToml = readText(resolve(repoDir, "Cargo.toml"));
    const cargoLibName = parseCargoLibName(cargoToml);
    const catalogEntry = catalogById.get(repo.extensionId);

    validateStaticContract({ repo, manifest, config, cargoLibName, catalogEntry });

    if (!options.skipCheck) {
      await runCommand("make", ["check"], repoDir);
    }

    if (!options.skipPackage) {
      await runCommand("make", ["package"], repoDir);
      validatePackage({ repoDir, config, cargoLibName, catalogEntry, warnings });
    }
  } finally {
    if (!options.keepDist && !options.skipPackage) {
      cleanupGeneratedFiles(resolve(repoDir, "dist"), distSnapshot);
    }
  }
}

function validateStaticContract({ repo, manifest, config, cargoLibName, catalogEntry }) {
  assertEqual(manifest.id, repo.extensionId, "manifest.id");
  assertEqual(config.extensionId, repo.extensionId, "connector.config extensionId");
  assert(catalogEntry, `catalog index is missing ${repo.extensionId}`);
  assertEqual(catalogEntry.id, repo.extensionId, "catalog id");
  assertEqual(catalogEntry.version, manifest.version, "catalog version");
  assertSameArray(catalogEntry.engines ?? [], repo.engines ?? [], "catalog engines");

  assertEqual(manifest.runtime, "native", "manifest runtime");
  assertEqual(manifest.entry, "dist/native", "manifest entry");
  assertIncludes(manifest.permissions ?? [], "native", "manifest permissions");
  assertIncludes(manifest.permissions ?? [], "connectors", "manifest permissions");

  const manifestConnectors = manifest.contributes?.connectors ?? [];
  assertEqual(manifestConnectors.length, 1, "manifest connector count");
  const manifestConnector = manifestConnectors[0];
  const configConnector = config.connector;
  assert(configConnector && typeof configConnector === "object", "connector.config connector is missing");

  assertIncludes(repo.engines ?? [], configConnector.engine, "connector repository engines");
  assertEqual(manifestConnector.id, configConnector.id, "connector id");
  assertEqual(manifestConnector.engine, configConnector.engine, "connector engine");
  assertEqual(manifestConnector.module, configConnector.module, "connector module");
  assertEqual(manifestConnector.wire, configConnector.wire, "connector wire");
  assertEqual(configConnector.connection?.defaults?.engine, configConnector.engine, "connection default engine");
  assertEqual(configConnector.connection?.defaults?.wire, configConnector.wire, "connection default wire");

  const nativeModules = manifest.capabilities?.nativeModules ?? [];
  const manifestNativeModule = nativeModules.find((module) => module.id === configConnector.module);
  assert(manifestNativeModule, `manifest native module is missing ${configConnector.module}`);
  assertEqual(manifestNativeModule.path, "dist/native", "manifest native module path");
  assertSameArray(manifestNativeModule.platforms ?? [], config.runtime?.module?.platforms ?? [], "native platforms");

  assertEqual(config.runtime?.abi, "irodori.connector.native.v1", "runtime abi");
  assertEqual(config.runtime?.module?.id, configConnector.module, "runtime module id");
  assertEqual(config.runtime?.module?.path, "dist/native", "runtime module path");
  assertEqual(config.runtime?.crate, cargoLibName, "runtime crate");
  assertEqual(config.runtime?.driverLinked, true, "runtime driverLinked");
  assertIncludesAll(config.runtime?.entrypoints ?? [], REQUIRED_ENTRYPOINTS, "runtime entrypoints");
  assertIncludesAll(config.runtime?.supportedCalls ?? [], REQUIRED_CALLS, "runtime supportedCalls");
}

function validatePackage({ repoDir, config, cargoLibName, catalogEntry, warnings }) {
  const nativeDir = resolve(repoDir, config.runtime.module.path);
  assert(existsSync(nativeDir), `native package directory not found: ${nativeDir}`);

  const expectedLibrary = currentPlatformLibraryName(cargoLibName);
  assert(existsSync(resolve(nativeDir, expectedLibrary)), `native package is missing ${expectedLibrary}`);
  const runtimeLibraries = runtimeLibraryNames(config);
  for (const runtimeLibrary of runtimeLibraries) {
    assert(
      existsSync(resolve(nativeDir, runtimeLibrary)),
      `native package is missing runtime dependency ${runtimeLibrary}`,
    );
  }

  const dynamicLibraries = listFiles(nativeDir).filter((file) => isDynamicLibrary(file));
  const allowedLibraries = new Set([expectedLibrary, ...runtimeLibraries]);
  const extraLibraries = dynamicLibraries.filter((file) => !allowedLibraries.has(file));
  if (extraLibraries.length > 0) {
    const message = `native package contains ${extraLibraries.length} extra dynamic librar${
      extraLibraries.length === 1 ? "y" : "ies"
    }`;
    if (options.strictPackage) {
      throw new Error(`${message}: ${extraLibraries.join(", ")}`);
    }
    warnings.push(`${message}; rerun with --strict-package to gate this`);
  }

  const assetName = catalogInstallAsset(catalogEntry)?.name;
  if (assetName) {
    const archivePath = resolve(repoDir, "dist", assetName);
    if (!existsSync(archivePath)) {
      const message = `catalog install asset is not produced: dist/${assetName}`;
      if (options.requireArchive) {
        throw new Error(message);
      }
      warnings.push(`${message}; rerun with --require-archive to gate this`);
    } else {
      validateArchiveContents({ archivePath, expectedLibrary, runtimeLibraries, catalogEntry });
      validateArchiveInstall({ archivePath, expectedLibrary, runtimeLibraries, catalogEntry });
    }
  }
}

function catalogInstallAsset(catalogEntry) {
  return catalogEntry?.install?.assets?.[nativeTargetLabel()];
}

function nativeTargetLabel() {
  const arch =
    process.arch === "x64"
      ? "x86_64"
      : process.arch === "arm64"
        ? "aarch64"
        : process.arch;
  const platform = process.platform === "darwin" ? "macos" : process.platform;
  return `${arch}-${platform}`;
}

function validateArchiveContents({ archivePath, expectedLibrary, runtimeLibraries, catalogEntry }) {
  const result = spawnSync("tar", ["-tzf", archivePath], { encoding: "utf8" });
  assert(result.status === 0, `catalog archive cannot be listed: ${archivePath}`);
  const entries = new Set(
    result.stdout
      .split(/\r?\n/)
      .map((entry) => entry.replace(/^\.\//, ""))
      .filter(Boolean),
  );
  const manifestPath = catalogEntry?.install?.manifestPath ?? "irodori.extension.json";
  assert(entries.has(manifestPath), `catalog archive is missing ${manifestPath}`);
  assert(entries.has("connector.config.json"), "catalog archive is missing connector.config.json");
  assert(
    entries.has(`dist/native/${expectedLibrary}`),
    `catalog archive is missing dist/native/${expectedLibrary}`,
  );
  for (const runtimeLibrary of runtimeLibraries) {
    assert(
      entries.has(`dist/native/${runtimeLibrary}`),
      `catalog archive is missing dist/native/${runtimeLibrary}`,
    );
  }
}

function validateArchiveInstall({ archivePath, expectedLibrary, runtimeLibraries, catalogEntry }) {
  const installRoot = mkdtempSync(resolve(tmpdir(), "irodori-extension-install-"));
  try {
    const checksum = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
    const expectedChecksum = catalogEntry?.install?.sha256 ?? catalogEntry?.install?.checksum;
    if (expectedChecksum) {
      assertEqual(checksum, expectedChecksum, "catalog archive sha256");
    }

    const result = spawnSync("tar", ["-xzf", archivePath, "-C", installRoot], { encoding: "utf8" });
    assert(result.status === 0, `catalog archive cannot be extracted: ${archivePath}`);

    const manifestPath = catalogEntry?.install?.manifestPath ?? "irodori.extension.json";
    const installedManifestPath = resolveInstallPath(installRoot, manifestPath);
    const manifest = readJson(installedManifestPath);
    assertEqual(manifest.id, catalogEntry.id, "installed manifest id");
    assertEqual(manifest.runtime, "native", "installed manifest runtime");
    assertIncludes(manifest.permissions ?? [], "native", "installed manifest permissions");
    assertIncludes(manifest.permissions ?? [], "connectors", "installed manifest permissions");

    const installedConfig = readJson(resolveInstallPath(installRoot, "connector.config.json"));
    assertEqual(installedConfig.extensionId, manifest.id, "installed connector.config extensionId");

    const connector = manifest.contributes?.connectors?.[0];
    assert(connector && typeof connector === "object", "installed manifest connector is missing");
    const nativeModule = (manifest.capabilities?.nativeModules ?? []).find(
      (module) => module.id === connector.module,
    );
    assert(nativeModule, `installed manifest native module is missing ${connector.module}`);
    assertEqual(installedConfig.connector?.module, nativeModule.id, "installed connector module");
    assertEqual(installedConfig.runtime?.module?.path, nativeModule.path, "installed runtime module path");

    const entryDir = resolveInstallPath(installRoot, manifest.entry);
    assert(existsSync(entryDir), `installed manifest entry is missing: ${manifest.entry}`);
    const nativeModuleDir = resolveInstallPath(installRoot, nativeModule.path);
    assert(existsSync(nativeModuleDir), `installed native module path is missing: ${nativeModule.path}`);
    assert(
      existsSync(resolve(nativeModuleDir, expectedLibrary)),
      `installed native module is missing ${expectedLibrary}`,
    );
    for (const runtimeLibrary of runtimeLibraries) {
      assert(
        existsSync(resolve(nativeModuleDir, runtimeLibrary)),
        `installed native module is missing runtime dependency ${runtimeLibrary}`,
      );
    }
  } finally {
    rmSync(installRoot, { force: true, recursive: true });
  }
}

function resolveInstallPath(installRoot, path) {
  assert(typeof path === "string" && path.length > 0, "installed archive path is missing");
  const resolved = resolve(installRoot, path);
  const rel = relative(installRoot, resolved);
  assert(
    rel && rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\"),
    `installed archive path escapes root: ${path}`,
  );
  return resolved;
}

function parseArgs(args) {
  const parsed = {
    all: false,
    engines: new Set(),
    help: false,
    keepDist: false,
    limit: null,
    list: false,
    repos: new Set(),
    requireArchive: false,
    skipCheck: false,
    skipPackage: false,
    strictPackage: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--all") {
      parsed.all = true;
    } else if (arg === "--list") {
      parsed.list = true;
    } else if (arg === "--skip-check") {
      parsed.skipCheck = true;
    } else if (arg === "--skip-package") {
      parsed.skipPackage = true;
    } else if (arg === "--require-archive") {
      parsed.requireArchive = true;
    } else if (arg === "--strict-package") {
      parsed.strictPackage = true;
    } else if (arg === "--keep-dist") {
      parsed.keepDist = true;
    } else if (arg === "--repo" || arg === "--engine" || arg === "--limit") {
      const value = args[index + 1];
      assert(value && !value.startsWith("--"), `${arg} requires a value`);
      index += 1;
      assignArg(parsed, arg, value);
    } else if (arg.startsWith("--repo=") || arg.startsWith("--engine=") || arg.startsWith("--limit=")) {
      const [name, value] = arg.split("=", 2);
      assert(value, `${name} requires a value`);
      assignArg(parsed, name, value);
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      parsed.repos.add(arg);
    }
  }

  return parsed;
}

function assignArg(parsed, name, value) {
  if (name === "--repo") {
    parsed.repos.add(value);
  } else if (name === "--engine") {
    parsed.engines.add(value);
  } else if (name === "--limit") {
    parsed.limit = parsePositiveInteger(value, "--limit");
  }
}

function parseCargoLibName(cargoToml) {
  const match = cargoToml.match(/^\[lib\][\s\S]*?^name\s*=\s*"([^"]+)"/m);
  assert(match, "Cargo.toml is missing [lib] name");
  assert(/crate-type\s*=\s*\[[^\]]*"cdylib"/.test(cargoToml), "Cargo.toml [lib] crate-type must include cdylib");
  return match[1];
}

function currentPlatformLibraryName(libName) {
  if (process.platform === "win32") {
    return `${libName}.dll`;
  }
  if (process.platform === "darwin") {
    return `lib${libName}.dylib`;
  }
  return `lib${libName}.so`;
}

function runtimeLibraryNames(config) {
  if (!DUCKDB_RUNTIME_ENGINES.has(config.connector?.engine)) {
    return [];
  }
  if (process.platform === "win32") {
    return ["duckdb.dll"];
  }
  if (process.platform === "darwin") {
    return ["libduckdb.dylib"];
  }
  return ["libduckdb.so"];
}

function isDynamicLibrary(file) {
  if (file.endsWith(".dll")) {
    return true;
  }
  if (file.endsWith(".dylib")) {
    return true;
  }
  return file.endsWith(".so");
}

function listFiles(root) {
  if (!existsSync(root)) {
    return [];
  }
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(path).map((file) => join(entry.name, file)));
    } else {
      files.push(entry.name);
    }
  }
  return files;
}

function snapshotTree(root) {
  const snapshot = { rootExisted: existsSync(root), files: new Set(), dirs: new Set() };
  if (!snapshot.rootExisted) {
    return snapshot;
  }
  for (const path of walk(root)) {
    const rel = relative(root, path);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      snapshot.dirs.add(rel);
    } else {
      snapshot.files.add(rel);
    }
  }
  return snapshot;
}

function cleanupGeneratedFiles(root, before) {
  if (!existsSync(root)) {
    return;
  }
  for (const path of walk(root).reverse()) {
    const rel = relative(root, path);
    const stat = statSync(path);
    if (!stat.isDirectory() && !before.files.has(rel)) {
      rmSync(path, { force: true });
    }
  }
  for (const path of walk(root).reverse()) {
    const rel = relative(root, path);
    if (rel && !before.dirs.has(rel) && isDirectoryEmpty(path)) {
      rmSync(path, { force: true, recursive: true });
    }
  }
  if (!before.rootExisted && existsSync(root) && isDirectoryEmpty(root)) {
    rmSync(root, { force: true, recursive: true });
  }
}

function walk(root) {
  if (!existsSync(root)) {
    return [];
  }
  const paths = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    paths.push(path);
    if (entry.isDirectory()) {
      paths.push(...walk(path));
    }
  }
  return paths;
}

function isDirectoryEmpty(path) {
  return existsSync(path) && statSync(path).isDirectory() && readdirSync(path).length === 0;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertIncludes(values, expected, label) {
  assert(Array.isArray(values), `${label}: expected an array`);
  if (!values.includes(expected)) {
    throw new Error(`${label}: missing ${JSON.stringify(expected)}`);
  }
}

function assertIncludesAll(values, expectedValues, label) {
  assert(Array.isArray(values), `${label}: expected an array`);
  for (const expected of expectedValues) {
    assertIncludes(values, expected, label);
  }
}

function assertSameArray(actual, expected, label) {
  assert(Array.isArray(actual), `${label}: expected actual array`);
  assert(Array.isArray(expected), `${label}: expected comparison array`);
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  if (JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expectedSorted)}, got ${JSON.stringify(actualSorted)}`,
    );
  }
}

function runCommand(command, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        CARGO_TERM_COLOR: process.env.CARGO_TERM_COLOR ?? "always",
      },
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${command} ${args.join(" ")} terminated by ${signal}`));
        return;
      }
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`));
    });
  });
}

function printHelp() {
  console.log(`Usage: node tools/extensions/scenario-test.mjs [options] [repo-or-extension-id...]

Runs catalog-ordered scenario checks for native connector extensions.

Options:
  --all              Select all catalog connector repositories (default)
  --repo <name|id>   Select one repository name or extension id; repeatable
  --engine <engine>  Select repositories by engine id; repeatable
  --limit <n>        Run only the first n selected repositories
  --skip-check       Skip connector repo make check
  --skip-package     Skip connector repo make package and native artifact checks
  --require-archive  Fail when catalog .tar.gz install assets are not produced
  --strict-package   Fail when dist/native contains undeclared dynamic libraries
  --keep-dist        Keep dist artifacts produced by make package
  --list             Print selected repositories and exit
  --help             Show this help
`);
}
