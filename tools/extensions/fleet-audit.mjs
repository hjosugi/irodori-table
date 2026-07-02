#!/usr/bin/env node
import { existsSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

import {
  assert,
  extensionsRoot,
  parsePositiveInteger,
  readConnectorRepositories,
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

console.log("Irodori extension fleet audit");
console.log(`  extensions root: ${extensionsRoot}`);
console.log(`  repositories: ${repositories.length}`);

for (const repo of repositories) {
  const repoDir = resolve(extensionsRoot, repo.name);
  const repoFailures = [];
  const repoWarnings = [];
  auditRepository(repo, repoDir, repoFailures, repoWarnings, abiPins);
  if (repoFailures.length > 0) {
    failures.push(...repoFailures.map((failure) => `${repo.name}: ${failure}`));
  }
  if (repoWarnings.length > 0) {
    warnings.push(...repoWarnings.map((warning) => `${repo.name}: ${warning}`));
  }
  const status = repoFailures.length > 0 ? "FAIL" : "ok";
  console.log(`  ${status.padEnd(4)} ${repo.name}`);
}

auditSharedPins(abiPins, failures);
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

function auditRepository(repo, repoDir, failures, warnings, abiPins) {
  if (!existsSync(repoDir)) {
    failures.push(`repository checkout not found: ${repoDir}`);
    return;
  }

  const cargoTomlPath = resolve(repoDir, "Cargo.toml");
  const libPath = resolve(repoDir, "src/lib.rs");
  const abiPath = resolve(repoDir, "src/abi.rs");
  const workflowDir = resolve(repoDir, ".github/workflows");

  const cargoToml = readText(cargoTomlPath);
  const libRs = readText(libPath);
  const workflows = listWorkflowFiles(workflowDir).map((path) => ({
    path,
    text: readText(path),
  }));

  if (existsSync(abiPath)) {
    failures.push("src/abi.rs still exists");
  }
  if (!libRs.includes("irodori_export_connector!")) {
    failures.push("src/lib.rs does not call irodori_export_connector!");
  }
  if (!libRs.includes("irodori_connector_abi")) {
    failures.push("src/lib.rs does not reference irodori_connector_abi");
  }

  const abiPin = parseAbiPin(cargoToml);
  if (!abiPin) {
    failures.push("Cargo.toml does not depend on irodori-connector-abi");
  } else {
    abiPins.set(repo.name, abiPin);
    if (!abiPin.includes("git = ") || !abiPin.includes("tag = ")) {
      failures.push("irodori-connector-abi dependency is not pinned by git tag");
    }
  }

  const vendoredToolFiles = findFiles(repoDir, (path) => {
    const name = path.split(/[\\/]/).pop();
    return name === "generate_connector_metadata.py";
  });
  if (vendoredToolFiles.length > 0) {
    failures.push(
      `vendored generate_connector_metadata.py still present: ${vendoredToolFiles
        .map((path) => relative(repoDir, path))
        .join(", ")}`,
    );
  }

  if (workflows.length === 0) {
    failures.push("no GitHub Actions workflow found");
  } else if (!workflows.some((workflow) => usesReusableWorkflow(workflow.text))) {
    failures.push("workflow does not call the reusable extension CI workflow");
  }

  if (
    duckDbBackedRepos.has(repo.name) &&
    !workflows.some((workflow) => /duckdb/i.test(workflow.text))
  ) {
    failures.push("duckdb-backed repo workflow does not pass a duckdb variant flag");
  }

  if (findFiles(repoDir, (path) => path.includes(`${repo.name}/${repo.name}/`)).length > 0) {
    warnings.push("nested duplicate repo tree may still exist");
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
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
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
      "Usage: node tools/extensions/fleet-audit.mjs [--repo <name>] [--limit <n>]",
      "",
      "Audits the post-migration connector fleet checklist tracked by irodori-table#44.",
      "Use this with `make extension-manifests` for the SDK/template manifests and `make extension-scenarios` for package assets.",
      "Set IRODORI_EXTENSIONS_ROOT to point at the directory containing irodori-extension-* checkouts.",
      "Set IRODORI_EXPECTED_EXTENSION_MANIFESTS to override the selected-repository manifest count.",
    ].join("\n"),
  );
}
