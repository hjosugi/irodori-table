#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
// DB sample fixtures + catalog live in the sibling irodori-samples repo.
const sampleRoot = process.env.IRODORI_SAMPLES
  ? resolve(process.env.IRODORI_SAMPLES)
  : resolve(root, "../irodori-samples");
const catalogPath = resolve(sampleRoot, "db-feature-samples.json");
const enginesPath = resolve(root, "knowledge/engines.json");
const projectRoot = resolve(sampleRoot, "projects");

function main() {
  const catalog = JSON.parse(read(catalogPath));
  const engines = JSON.parse(read(enginesPath)).engines ?? [];
  const engineIds = new Set(engines.map((engine) => engine.id));
  const engineStatus = new Map(engines.map((engine) => [engine.id, engine.status]));
  const entries = catalog.engines ?? [];
  const catalogIds = new Set(entries.map((engine) => engine.id));
  const featureIds = new Set();
  const errors = [];

  for (const id of setDiff(engineIds, catalogIds)) {
    errors.push(`samples/db-feature-samples.json is missing engine '${id}'`);
  }
  for (const id of setDiff(catalogIds, engineIds)) {
    errors.push(`samples/db-feature-samples.json lists unknown engine '${id}'`);
  }

  for (const engine of entries) {
    const where = `engine '${engine.id}'`;
    validateCatalogEntry(errors, featureIds, engine, where, {
      requireFamily: true,
      requireIrodoriStatus: true,
    });

    if (engineStatus.has(engine.id) && engineStatus.get(engine.id) !== engine.irodoriStatus) {
      errors.push(
        `${where} irodoriStatus '${engine.irodoriStatus}' does not match knowledge/engines.json '${engineStatus.get(engine.id)}'`,
      );
    }

    if (engine.sampleProject) {
      const project = engine.sampleProject;
      requireString(errors, project.kind, `${where} sampleProject.kind`);
      requireString(errors, project.directory, `${where} sampleProject.directory`);
      requireString(errors, project.queryFile, `${where} sampleProject.queryFile`);
      requireString(errors, project.testCommand, `${where} sampleProject.testCommand`);
      checkDirectory(errors, project.directory, `${where} sampleProject.directory`);
      checkFile(errors, project.queryFile, `${where} sampleProject.queryFile`);
      if (project.directory && project.queryFile && !project.queryFile.startsWith(`${project.directory}/`)) {
        errors.push(`${where} sampleProject.queryFile should live under sampleProject.directory`);
      }
      if (project.kind === "container") {
        checkFile(errors, `samples/${engine.id}/compose.yaml`, `${where} container compose`);
      }
    }
  }

  for (const target of catalog.managedTargets ?? []) {
    validateCatalogEntry(errors, featureIds, target, `managed target '${target.id}'`, {
      requireRoutesThrough: true,
      requireStatus: true,
    });
  }

  for (const target of catalog.lakehouseTargets ?? []) {
    validateCatalogEntry(errors, featureIds, target, `lakehouse target '${target.id}'`, {
      requireStatus: true,
    });
  }

  for (const projectDir of projectDirectories()) {
    if (!catalogIds.has(projectDir)) {
      errors.push(`samples/projects/${projectDir} has no catalog entry`);
    }
    const entry = entries.find((engine) => engine.id === projectDir);
    if (entry && !entry.sampleProject) {
      errors.push(`samples/projects/${projectDir} exists but catalog entry has no sampleProject`);
    }
  }

  for (const sampleDir of containerSampleDirectories()) {
    const entry = entries.find((engine) => engine.id === sampleDir);
    if (!entry) {
      errors.push(`samples/${sampleDir}/compose.yaml has no catalog entry`);
    } else if (!entry.sampleProject) {
      errors.push(`samples/${sampleDir}/compose.yaml exists but catalog entry has no sampleProject`);
    }
  }

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`db-feature-samples: ${error}`);
    }
    process.exit(1);
  }

  console.log(
    `db-feature-samples: ok (${entries.length} engines, ${featureIds.size} features, ${projectDirectories().length} sample projects)`,
  );
}

function read(path) {
  return readFileSync(path, "utf8");
}

function requireString(errors, value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${label} must be a non-empty string`);
  }
}

function validateCatalogEntry(errors, featureIds, entry, where, options = {}) {
  requireString(errors, entry.id, `${where} id`);
  requireString(errors, entry.label, `${where} label`);
  if (options.requireFamily) {
    requireString(errors, entry.family, `${where} family`);
  }
  if (options.requireIrodoriStatus) {
    requireString(errors, entry.irodoriStatus, `${where} irodoriStatus`);
  }
  if (options.requireStatus) {
    requireString(errors, entry.status, `${where} status`);
  }
  if (options.requireRoutesThrough) {
    requireString(errors, entry.routesThrough, `${where} routesThrough`);
  }
  if (!Array.isArray(entry.whatYouCanDo) || entry.whatYouCanDo.length === 0) {
    errors.push(`${where} needs at least one whatYouCanDo item`);
  }
  if (!Array.isArray(entry.resources) || entry.resources.length === 0) {
    errors.push(`${where} needs at least one official resource`);
  }
  for (const resource of entry.resources ?? []) {
    requireString(errors, resource.label, `${where} resource label`);
    requireString(errors, resource.url, `${where} resource url`);
    if (typeof resource.url === "string" && !resource.url.startsWith("https://")) {
      errors.push(`${where} resource '${resource.label ?? "(unknown)"}' must use https`);
    }
  }
  if (!Array.isArray(entry.features) || entry.features.length === 0) {
    errors.push(`${where} needs at least one feature`);
  }
  for (const feature of entry.features ?? []) {
    requireString(errors, feature.id, `${where} feature id`);
    requireString(errors, feature.title, `${where} feature title`);
    if (feature.id) {
      if (featureIds.has(feature.id)) {
        errors.push(`duplicate feature id '${feature.id}'`);
      }
      featureIds.add(feature.id);
    }
    if (!feature.queryFile && feature.referenceOnly !== true) {
      errors.push(`${where} feature '${feature.id}' needs queryFile or referenceOnly=true`);
    }
    if (feature.queryFile) {
      checkFile(errors, feature.queryFile, `${where} feature '${feature.id}' queryFile`);
    }
  }
}

// Catalog paths keep their historical "samples/" prefix; resolve them against
// the sibling irodori-samples repo (sampleRoot) instead of the table root.
function resolveSample(relativePath) {
  return resolve(sampleRoot, relativePath.replace(/^samples\//, ""));
}

function checkFile(errors, relativePath, label) {
  if (!relativePath) {
    return;
  }
  const path = resolveSample(relativePath);
  if (!existsSync(path) || !statSync(path).isFile()) {
    errors.push(`${label} '${relativePath}' does not exist`);
  }
}

function checkDirectory(errors, relativePath, label) {
  if (!relativePath) {
    return;
  }
  const path = resolveSample(relativePath);
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    errors.push(`${label} '${relativePath}' does not exist`);
  }
}

function projectDirectories() {
  return readdirSync(projectRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function containerSampleDirectories() {
  return readdirSync(sampleRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name !== "projects")
    .filter((name) => existsSync(resolve(sampleRoot, name, "compose.yaml")))
    .sort();
}

function setDiff(left, right) {
  return [...left].filter((item) => !right.has(item)).sort();
}

main();
