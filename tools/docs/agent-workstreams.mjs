#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const workstreamsPath = resolve(root, "docs/agent-workstreams.json");
const connectorRepositoriesPath = resolve(
  root,
  "docs/extension-marketplace/connector-repositories.json",
);

function main() {
  const spec = JSON.parse(read(workstreamsPath));
  const connectorRepositories = JSON.parse(read(connectorRepositoriesPath));
  const contracts = spec.sharedContracts ?? [];
  const workstreams = spec.workstreams ?? [];
  const connectorRepoRows = connectorRepositories.repositories ?? [];
  const contractIds = new Set(contracts.map((contract) => contract.id));
  const errors = [];

  if (spec.schemaVersion !== 1) {
    errors.push("docs/agent-workstreams.json schemaVersion must be 1");
  }
  if (!Array.isArray(spec.rules) || spec.rules.length === 0) {
    errors.push("docs/agent-workstreams.json must declare coordination rules");
  }
  errors.push(...validateUniqueIds("shared contract", contracts));
  errors.push(...validateUniqueIds("workstream", workstreams));

  for (const contract of contracts) {
    requireString(contract, "id", errors);
    requireString(contract, "owner", errors);
    requireStringList(contract, "paths", errors);
    requireStringList(contract, "checks", errors);
  }

  for (const workstream of workstreams) {
    requireString(workstream, "id", errors);
    requireString(workstream, "title", errors);
    requireString(workstream, "owner", errors);
    requireString(workstream, "mergeRule", errors);
    requireStringList(workstream, "exclusiveWriteGlobs", errors);
    requireStringList(workstream, "coordinatorWriteGlobs", errors);
    requireStringList(workstream, "checks", errors);
    for (const contractId of workstream.sharedContracts ?? []) {
      if (!contractIds.has(contractId)) {
        errors.push(`workstream '${workstream.id}' references unknown shared contract '${contractId}'`);
      }
    }
  }

  const connectorWorkstream = workstreams.find((workstream) => workstream.id === "connector-extension");
  if (!connectorWorkstream) {
    errors.push("docs/agent-workstreams.json must define connector-extension workstream");
  } else {
    if (connectorWorkstream.source !== "docs/extension-marketplace/connector-repositories.json") {
      errors.push("connector-extension workstream must source connector-repositories.json");
    }
    if (!connectorWorkstream.repeatable) {
      errors.push("connector-extension workstream must be repeatable");
    }
    if (!connectorWorkstream.exclusiveWriteGlobs.some((glob) => glob.includes("{repository}"))) {
      errors.push("connector-extension exclusiveWriteGlobs must include {repository}");
    }
  }

  for (const repo of connectorRepoRows) {
    if (!repo.name || !repo.extensionId || !Array.isArray(repo.engines) || repo.engines.length === 0) {
      errors.push(`connector repository row is incomplete: ${JSON.stringify(repo)}`);
    }
  }

  const exactExclusiveOwners = new Map();
  for (const workstream of workstreams.filter((workstream) => !workstream.repeatable)) {
    for (const glob of workstream.exclusiveWriteGlobs ?? []) {
      const existing = exactExclusiveOwners.get(glob);
      if (existing) {
        errors.push(
          `exclusive write glob '${glob}' is owned by both '${existing}' and '${workstream.id}'`,
        );
      }
      exactExclusiveOwners.set(glob, workstream.id);
    }
  }

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`agent-workstreams: ${error}`);
    }
    process.exit(1);
  }

  console.log(
    `agent-workstreams: ok (${workstreams.length} workstreams, ${contracts.length} shared contracts, ${connectorRepoRows.length} connector shards)`,
  );
}

function read(path) {
  return readFileSync(path, "utf8");
}

function validateUniqueIds(label, rows) {
  const errors = [];
  const seen = new Set();
  for (const row of rows) {
    if (!row?.id) {
      errors.push(`${label} is missing id`);
      continue;
    }
    if (seen.has(row.id)) {
      errors.push(`${label} '${row.id}' is duplicated`);
    }
    seen.add(row.id);
  }
  return errors;
}

function requireString(row, key, errors) {
  if (typeof row?.[key] !== "string" || row[key].trim() === "") {
    errors.push(`${row?.id ?? "entry"} must define non-empty string '${key}'`);
  }
}

function requireStringList(row, key, errors) {
  if (!Array.isArray(row?.[key]) || row[key].length === 0) {
    errors.push(`${row?.id ?? "entry"} must define non-empty array '${key}'`);
    return;
  }
  for (const value of row[key]) {
    if (typeof value !== "string" || value.trim() === "") {
      errors.push(`${row?.id ?? "entry"} has invalid '${key}' value`);
    }
  }
}

main();
