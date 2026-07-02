#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../..");
const defaultExtensionsRoot = firstExistingPath([
  resolve(repoRoot, "../irodori-extensions"),
  resolve(repoRoot, "../../irodori-extensions"),
]);
const extensionsRoot = process.env.IRODORI_EXTENSIONS_ROOT ?? defaultExtensionsRoot;

const REQUIRED_ENTRYPOINTS = [
  "irodori_extension_abi_version",
  "irodori_connector_engine_json",
  "irodori_extension_manifest_json",
  "irodori_connector_config_json",
  "irodori_connector_call_json",
  "irodori_connector_free_buffer",
];
const REQUIRED_CALLS = ["health", "describe", "manifest", "config", "connect", "query", "metadata", "close"];
const DYNAMIC_LIBRARY_EXTENSIONS = new Set([".dll", ".dylib", ".so"]);

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}

const connectorRepositories = readJson(resolve(repoRoot, "registry/catalog/connector-repositories.json"));
const catalog = readJson(resolve(repoRoot, "registry/catalog/index.json"));
const catalogById = new Map((catalog.extensions ?? []).map((entry) => [entry.id, entry]));
const selectedRepositories = selectRepositories(connectorRepositories.repositories ?? [], options);

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
    const cargoToml = readFileSync(resolve(repoDir, "Cargo.toml"), "utf8");
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

  const dynamicLibraries = listFiles(nativeDir).filter((file) => isDynamicLibrary(file));
  const extraLibraries = dynamicLibraries.filter((file) => file !== expectedLibrary);
  if (extraLibraries.length > 0) {
    const message = `native package contains ${extraLibraries.length} extra dynamic librar${
      extraLibraries.length === 1 ? "y" : "ies"
    }`;
    if (options.strictPackage) {
      throw new Error(`${message}: ${extraLibraries.join(", ")}`);
    }
    warnings.push(`${message}; rerun with --strict-package to gate this`);
  }

  const assetName = catalogEntry?.install?.assetName;
  if (assetName) {
    const archivePath = resolve(repoDir, "dist", assetName);
    if (!existsSync(archivePath)) {
      const message = `catalog install asset is not produced: dist/${assetName}`;
      if (options.requireArchive) {
        throw new Error(message);
      }
      warnings.push(`${message}; rerun with --require-archive to gate this`);
    }
  }
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
    const limit = Number.parseInt(value, 10);
    assert(Number.isInteger(limit) && limit > 0, "--limit must be a positive integer");
    parsed.limit = limit;
  }
}

function selectRepositories(repositories, parsed) {
  let selected = repositories;
  if (parsed.repos.size > 0) {
    selected = selected.filter(
      (repo) => parsed.repos.has(repo.name) || parsed.repos.has(repo.extensionId),
    );
  }
  if (parsed.engines.size > 0) {
    selected = selected.filter((repo) => (repo.engines ?? []).some((engine) => parsed.engines.has(engine)));
  }
  if (parsed.limit !== null) {
    selected = selected.slice(0, parsed.limit);
  }
  return selected;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read JSON ${path}: ${message}`);
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

function firstExistingPath(paths) {
  return paths.find((path) => existsSync(path)) ?? paths[0];
}

function assert(value, message) {
  if (!value) {
    throw new Error(message);
  }
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
  --strict-package   Fail when dist/native contains dynamic libraries for other connectors
  --keep-dist        Keep dist artifacts produced by make package
  --list             Print selected repositories and exit
  --help             Show this help
`);
}
