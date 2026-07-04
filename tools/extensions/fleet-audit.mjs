#!/usr/bin/env node
import { existsSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

import {
  assert,
  extensionsRoot,
  parsePositiveInteger,
  readConnectorRepositories,
  readExtensionCatalog,
  readText,
  selectRepositories,
} from "./lib/tooling.mjs";

const duckDbBackedRepos = new Set([
  "irodori-extension-duckdb",
  "irodori-extension-motherduck",
  "irodori-extension-delta-lake",
  "irodori-extension-hive",
  "irodori-extension-hudi",
  "irodori-extension-iceberg",
  "irodori-extension-s3-tables",
]);

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}

const repositories = selectRepositories(
  readConnectorRepositories(),
  options,
);
if (repositories.length === 0) {
  throw new Error("No extension repositories matched the requested filters.");
}

const failures = [];
const warnings = [];
const abiPins = new Map();
const catalog = readExtensionCatalog();
const catalogById = new Map((catalog.extensions ?? []).map((entry) => [entry.id, entry]));

console.log("Irodori extension fleet audit");
console.log(`  extensions root: ${extensionsRoot}`);
console.log(`  repositories: ${repositories.length}`);

for (const repo of repositories) {
  const repoDir = resolve(extensionsRoot, repo.name);
  const repoFailures = [];
  const repoWarnings = [];
  auditRepository(repo, repoDir, repoFailures, repoWarnings, abiPins, catalogById.get(repo.extensionId));
  if (repoFailures.length > 0) {
    failures.push(...repoFailures.map((failure) => `${repo.name}: ${failure}`));
  }
  if (repoWarnings.length > 0) {
    warnings.push(...repoWarnings.map((warning) => `${repo.name}: ${warning}`));
  }
  const status = repoFailures.length > 0 ? "FAIL" : "ok";
  console.log(`  ${status.padEnd(4)} ${repo.name}`);
}

auditSharedPins(abiPins, options.strictAbi ? failures : warnings);
auditCatalogManifests(repositories, failures);

if (warnings.length > 0) {
  console.log(`\nWarnings (${warnings.length})`);
  for (const warning of warnings) {
    console.log(`  - ${warning}`);
  }
}

if (failures.length > 0) {
  console.error(`\nFailures (${failures.length})`);
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.log("\nExtension fleet audit passed.");

function auditRepository(repo, repoDir, failures, warnings, abiPins, catalogEntry) {
  if (!existsSync(repoDir)) {
    failures.push(`repository checkout not found: ${repoDir}`);
    return;
  }

  const cargoTomlPath = resolve(repoDir, "Cargo.toml");
  const libPath = resolve(repoDir, "src/lib.rs");
  const abiPath = resolve(repoDir, "src/abi.rs");
  const workflowDir = resolve(repoDir, ".github/workflows");
  const makefilePath = resolve(repoDir, "Makefile");

  const cargoToml = readText(cargoTomlPath);
  const libRs = readText(libPath);
  const makefile = readText(makefilePath);
  const workflows = listWorkflowFiles(workflowDir).map((path) => ({
    path,
    text: readText(path),
  }));

  const abiFailures = [];
  if (existsSync(abiPath)) {
    abiFailures.push("src/abi.rs still exists");
  }
  if (!libRs.includes("irodori_export_connector!")) {
    abiFailures.push("src/lib.rs does not call irodori_export_connector!");
  }
  if (!libRs.includes("irodori_connector_abi")) {
    abiFailures.push("src/lib.rs does not reference irodori_connector_abi");
  }

  const abiPin = parseAbiPin(cargoToml);
  if (!abiPin) {
    abiFailures.push("Cargo.toml does not depend on irodori-connector-abi");
  } else {
    abiPins.set(repo.name, abiPin);
    if (!abiPin.includes("git = ") || !abiPin.includes("tag = ")) {
      abiFailures.push("irodori-connector-abi dependency is not pinned by git tag");
    }
  }
  if (abiFailures.length > 0) {
    const target = options.strictAbi ? failures : warnings;
    target.push(...abiFailures.map((failure) => `ABI migration pending: ${failure}`));
  }

  const vendoredMetadataToolFiles = findFiles(repoDir, (path) => {
    const name = path.split(/[\\/]/).pop();
    return name === "generate_connector_metadata.py" || name === "connector_metadata_presets.json";
  });
  if (vendoredMetadataToolFiles.length > 0) {
    failures.push(
      `vendored metadata generator files still present: ${vendoredMetadataToolFiles
        .map((path) => relative(repoDir, path))
        .join(", ")}`,
    );
  }

  auditSnapshotDestinations(repoDir, failures, warnings);
  auditPackageTarget(makefile, catalogEntry, failures);

  if (workflows.length === 0) {
    failures.push("no GitHub Actions workflow found");
  } else {
    const reusableWorkflows = workflows.filter((workflow) => usesReusableWorkflow(workflow.text));
    if (reusableWorkflows.length === 0) {
      failures.push("workflow does not call the reusable extension CI workflow");
    } else {
      if (!reusableWorkflows.some((workflow) => hasManifestValidationInput(workflow.text))) {
        failures.push("reusable workflow caller does not pass manifest validation input");
      }
      if (!reusableWorkflows.some((workflow) => hasPackageCommandInput(workflow.text))) {
        failures.push("reusable workflow caller does not pass package command input");
      }
      const expectedDuckDbBacked = duckDbBackedRepos.has(repo.name);
      const duckDbFlags = reusableWorkflows.map((workflow) => parseDuckDbBackedFlag(workflow.text));
      if (duckDbFlags.every((flag) => flag === null)) {
        failures.push("reusable workflow caller does not pass duckdb-backed flag");
      } else if (!duckDbFlags.some((flag) => flag === expectedDuckDbBacked)) {
        failures.push(`reusable workflow duckdb-backed flag is not ${expectedDuckDbBacked}`);
      }
    }
  }

  if (findFiles(repoDir, (path) => path.includes(`${repo.name}/${repo.name}/`)).length > 0) {
    warnings.push("nested duplicate repo tree may still exist");
  }
}

function auditSnapshotDestinations(repoDir, failures, warnings) {
  const configPath = resolve(repoDir, "connector.config.json");
  if (!existsSync(configPath)) {
    failures.push("connector.config.json not found");
    return;
  }
  const config = JSON.parse(readText(configPath));
  const snapshots = config.source?.snapshots ?? [];
  for (const snapshot of snapshots) {
    const destination = String(snapshot.destination ?? "");
    if (destination.includes("../") || destination.startsWith("..")) {
      failures.push(`snapshot destination contains a parent traversal: ${destination}`);
    }
    if (destination.includes("native/source/irodori-table/crates/")) {
      warnings.push(`snapshot destination still uses the pre-split crates layout: ${destination}`);
    }
  }
}

function auditPackageTarget(makefile, catalogEntry, failures) {
  const assetName = catalogEntry?.install?.assetName;
  if (!assetName) {
    return;
  }
  if (!/^package:/m.test(makefile)) {
    failures.push("Makefile does not define a package target");
    return;
  }
  if (!makefile.includes(`EXTENSION_PACKAGE := ${assetName}`)) {
    failures.push(`Makefile EXTENSION_PACKAGE does not match catalog assetName ${assetName}`);
  }
  if (!/tar\s+-czf\s+dist\/(?:\$\(EXTENSION_PACKAGE\)|[^\s]+)/.test(makefile)) {
    failures.push("Makefile package target does not create a dist/*.tar.gz archive");
  }
}

function auditSharedPins(abiPins, failures) {
  const uniquePins = new Map();
  for (const [repoName, pin] of abiPins) {
    const repos = uniquePins.get(pin) ?? [];
    repos.push(repoName);
    uniquePins.set(pin, repos);
  }
  if (uniquePins.size > 1) {
    failures.push(
      `irodori-connector-abi pins differ across repos: ${[...uniquePins.entries()]
        .map(([pin, repos]) => `${pin} (${repos.length})`)
        .join("; ")}`,
    );
  }
}

function auditCatalogManifests(repositories, failures) {
  const manifestCount = repositories.filter((repo) =>
    existsSync(resolve(extensionsRoot, repo.name, "irodori.extension.json")),
  ).length;
  const expectedMinimum = Number.parseInt(
    process.env.IRODORI_EXPECTED_EXTENSION_MANIFESTS ?? String(repositories.length),
    10,
  );
  if (manifestCount < expectedMinimum) {
    failures.push(
      `fleet manifest count is ${manifestCount}; expected at least ${expectedMinimum} before #44 can close`,
    );
  }
}

function parseAbiPin(cargoToml) {
  const line = cargoToml
    .split("\n")
    .find((candidate) => candidate.trim().startsWith("irodori-connector-abi"));
  return line?.trim() ?? "";
}

function usesReusableWorkflow(text) {
  return /uses:\s+.*irodori.*extension.*(ci|workflow)/i.test(text);
}

function hasManifestValidationInput(text) {
  return /^\s*(manifest-root|manifest_roots|validate-manifest)\s*:/im.test(text);
}

function hasPackageCommandInput(text) {
  return /^\s*(package-command|package_command|package)\s*:/im.test(text);
}

function parseDuckDbBackedFlag(text) {
  const match = text.match(/^\s*duckdb-backed\s*:\s*(true|false)\s*$/im);
  if (!match) {
    return null;
  }
  return match[1] === "true";
}

function listWorkflowFiles(workflowDir) {
  if (!existsSync(workflowDir)) {
    return [];
  }
  return readdirSync(workflowDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && [".yml", ".yaml"].includes(extname(entry.name)))
    .map((entry) => resolve(workflowDir, entry.name));
}

function findFiles(root, predicate) {
  const matches = [];
  walk(root);
  return matches;

  function walk(dir) {
    if (!existsSync(dir)) {
      return;
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!["target", ".git", "dist"].includes(entry.name)) {
          walk(path);
        }
      } else if (predicate(path)) {
        matches.push(path);
      }
    }
  }
}

function parseArgs(args) {
  const parsed = {
    help: false,
    limit: null,
    repos: new Set(),
    strictAbi: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--strict-abi") {
      parsed.strictAbi = true;
    } else if (arg === "--repo" || arg === "--limit") {
      const value = args[index + 1];
      assert(value && !value.startsWith("--"), `${arg} requires a value`);
      index += 1;
      assignArg(parsed, arg, value);
    } else if (arg.startsWith("--repo=") || arg.startsWith("--limit=")) {
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
  } else if (name === "--limit") {
    parsed.limit = parsePositiveInteger(value, "--limit");
  }
}

function printHelp() {
  console.log(
    [
      "Usage: node tools/extensions/fleet-audit.mjs [--repo <name>] [--limit <n>] [--strict-abi]",
      "",
      "Audits the post-migration connector fleet checklist tracked by irodori-table#44.",
      "Use this with `make extension-manifests` for the SDK/template manifests and `make extension-scenarios` for package assets.",
      "Set IRODORI_EXTENSIONS_ROOT to point at the directory containing irodori-extension-* checkouts.",
      "Set IRODORI_EXPECTED_EXTENSION_MANIFESTS to override the selected-repository manifest count.",
      "Pass --strict-abi to fail on pending shared ABI migration items instead of warning.",
    ].join("\n"),
  );
}
