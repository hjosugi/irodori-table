#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { delimiter, dirname, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const schemaPath = resolve(root, "extension.schema.json");
const manifestRoots = [
  resolve(root, "packages/extension-sdk/templates"),
  resolve(root, "examples/extensions"),
  ...extraManifestRoots(),
];

const schema = JSON.parse(read(schemaPath));
const defs = schema.$defs ?? {};
const runtimeValues = new Set(defs.runtime?.enum ?? []);
const permissionValues = new Set(defs.permission?.enum ?? []);
const nativePlatforms = new Set(
  defs.nativeModule?.properties?.platforms?.items?.enum ?? [],
);
const topLevelKeys = new Set(Object.keys(schema.properties ?? {}));
const requiredTopLevelKeys = schema.required ?? [];
const contributionShapes = {
  commands: defs.command,
  keybindings: defs.keybinding,
  resultGridActions: defs.resultGridAction,
  resultGridRenderers: defs.resultGridRenderer,
  statusBarItems: defs.statusBarItem,
  themes: defs.themeContribution,
  sqlDialects: defs.sqlDialectContribution,
  connectors: defs.connectorContribution,
};
const capabilityShapes = {
  wasmModules: defs.wasmModule,
  nativeModules: defs.nativeModule,
};
const contributionPermissionRules = [
  ["commands", "commands"],
  ["keybindings", "keybindings"],
  ["resultGridActions", "resultRenderers"],
  ["resultGridRenderers", "resultRenderers"],
  ["statusBarItems", "statusBar"],
  ["themes", "themes"],
  ["sqlDialects", "sqlDialects"],
  ["connectors", "connectors"],
];
const capabilityPermissionRules = [
  ["wasmModules", "wasm"],
  ["nativeModules", "native"],
];

const manifestPaths = manifestRoots.flatMap(findManifests).sort();
const errors = [];

for (const manifestPath of manifestPaths) {
  validateManifest(manifestPath, JSON.parse(read(manifestPath)));
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`extension-manifest: ${error}`);
  }
  process.exit(1);
}

console.log(`extension-manifest: ok (${manifestPaths.length} manifests)`);

function validateManifest(manifestPath, manifest) {
  const label = relative(root, manifestPath);
  const dir = dirname(manifestPath);

  requireObject(manifest, label);
  rejectUnknownKeys(manifest, topLevelKeys, label);
  requireKeys(manifest, requiredTopLevelKeys, label);

  if (manifest.$schema !== undefined) {
    requireString(manifest.$schema, `${label}.$schema`);
    const schemaRef = isHttpUrl(manifest.$schema) ? null : resolve(dir, manifest.$schema);
    if (schemaRef && !existsSync(schemaRef)) {
      error(`${label}.$schema points to missing file ${manifest.$schema}`);
    }
  }

  requireConst(manifest.manifestVersion, schema.properties.manifestVersion.const, `${label}.manifestVersion`);
  requirePattern(manifest.id, schema.properties.id.pattern, `${label}.id`);
  requireNonEmptyString(manifest.name, `${label}.name`);
  requirePattern(manifest.version, schema.properties.version.pattern, `${label}.version`);
  requireNonEmptyString(manifest.license, `${label}.license`);
  if (manifest.license !== "MIT OR 0BSD") {
    error(`${label}.license should be MIT OR 0BSD`);
  }
  requirePattern(manifest.apiVersion, schema.properties.apiVersion.pattern, `${label}.apiVersion`);
  requireEnum(manifest.runtime, runtimeValues, `${label}.runtime`);
  requireRelativePath(manifest.entry, `${label}.entry`);
  validatePermissions(manifest.permissions, `${label}.permissions`);
  validateContributes(manifestPath, manifest.contributes, manifest.permissions ?? [], label);
  validateCapabilities(manifest.capabilities, manifest.permissions ?? [], label);
  validateDevConfig(manifest.dev, label);
}

function validatePermissions(value, label) {
  requireArray(value, label);
  validateUniqueStrings(value, label);
  for (const permission of value ?? []) {
    requireEnum(permission, permissionValues, `${label}[]`);
  }
}

function validateContributes(manifestPath, contributes, permissions, label) {
  if (contributes === undefined) {
    return;
  }
  requireObject(contributes, `${label}.contributes`);
  rejectUnknownKeys(contributes, new Set(Object.keys(contributionShapes)), `${label}.contributes`);

  for (const [key, shape] of Object.entries(contributionShapes)) {
    const items = contributes[key];
    if (items === undefined) {
      continue;
    }
    requireArray(items, `${label}.contributes.${key}`);
    for (const [index, item] of items.entries()) {
      validateContributionItem(manifestPath, item, shape, `${label}.contributes.${key}[${index}]`);
    }
  }

  const declared = new Set(permissions);
  for (const [key, permission] of contributionPermissionRules) {
    if ((contributes[key]?.length ?? 0) > 0 && !declared.has(permission)) {
      error(`${label}.contributes.${key} requires permissions: ${permission}`);
    }
  }
}

function validateContributionItem(manifestPath, item, shape, label) {
  requireObject(item, label);
  rejectUnknownKeys(item, new Set(Object.keys(shape.properties ?? {})), label);
  requireKeys(item, shape.required ?? [], label);

  for (const [key, property] of Object.entries(shape.properties ?? {})) {
    const value = item[key];
    if (value === undefined) {
      continue;
    }
    validateProperty(value, property, `${label}.${key}`);
    if (key === "path") {
      requireExistingRelativePath(manifestPath, value, `${label}.${key}`);
    }
  }
}

function validateCapabilities(capabilities, permissions, label) {
  if (capabilities === undefined) {
    return;
  }
  requireObject(capabilities, `${label}.capabilities`);
  rejectUnknownKeys(capabilities, new Set(Object.keys(capabilityShapes)), `${label}.capabilities`);

  for (const [key, shape] of Object.entries(capabilityShapes)) {
    const items = capabilities[key];
    if (items === undefined) {
      continue;
    }
    requireArray(items, `${label}.capabilities.${key}`);
    for (const [index, item] of items.entries()) {
      validateCapabilityItem(item, shape, `${label}.capabilities.${key}[${index}]`);
    }
  }

  const declared = new Set(permissions);
  for (const [key, permission] of capabilityPermissionRules) {
    if ((capabilities[key]?.length ?? 0) > 0 && !declared.has(permission)) {
      error(`${label}.capabilities.${key} requires permissions: ${permission}`);
    }
  }
}

function validateCapabilityItem(item, shape, label) {
  requireObject(item, label);
  rejectUnknownKeys(item, new Set(Object.keys(shape.properties ?? {})), label);
  requireKeys(item, shape.required ?? [], label);

  for (const [key, property] of Object.entries(shape.properties ?? {})) {
    const value = item[key];
    if (value === undefined) {
      continue;
    }
    validateProperty(value, property, `${label}.${key}`);
    if (key === "platforms") {
      for (const platform of value ?? []) {
        requireEnum(platform, nativePlatforms, `${label}.${key}[]`);
      }
    }
  }
}

function validateDevConfig(dev, label) {
  if (dev === undefined) {
    return;
  }
  requireObject(dev, `${label}.dev`);
  rejectUnknownKeys(dev, new Set(Object.keys(defs.devConfig?.properties ?? {})), `${label}.dev`);

  if (dev.watch !== undefined) {
    requireArray(dev.watch, `${label}.dev.watch`);
    validateUniqueStrings(dev.watch, `${label}.dev.watch`);
    for (const path of dev.watch) {
      requireRelativePath(path, `${label}.dev.watch[]`);
    }
  }
  if (dev.logFile !== undefined) {
    requireRelativePath(dev.logFile, `${label}.dev.logFile`);
  }
  if (dev.fixtures !== undefined) {
    requireArray(dev.fixtures, `${label}.dev.fixtures`);
    for (const [index, fixture] of dev.fixtures.entries()) {
      validateFakeDatabaseFixture(fixture, `${label}.dev.fixtures[${index}]`);
    }
  }
}

function validateFakeDatabaseFixture(fixture, label) {
  requireObject(fixture, label);
  rejectUnknownKeys(fixture, new Set(Object.keys(defs.fakeDatabaseFixture.properties ?? {})), label);
  requireKeys(fixture, defs.fakeDatabaseFixture.required ?? [], label);
  requireNonEmptyString(fixture.id, `${label}.id`);
  requireNonEmptyString(fixture.engine, `${label}.engine`);
  if (fixture.schemas !== undefined) {
    requireArray(fixture.schemas, `${label}.schemas`);
    for (const [schemaIndex, schemaFixture] of fixture.schemas.entries()) {
      validateFakeSchemaFixture(schemaFixture, `${label}.schemas[${schemaIndex}]`);
    }
  }
}

function validateFakeSchemaFixture(schemaFixture, label) {
  requireObject(schemaFixture, label);
  rejectUnknownKeys(schemaFixture, new Set(Object.keys(defs.fakeSchemaFixture.properties ?? {})), label);
  requireKeys(schemaFixture, defs.fakeSchemaFixture.required ?? [], label);
  requireNonEmptyString(schemaFixture.name, `${label}.name`);
  if (schemaFixture.tables !== undefined) {
    requireArray(schemaFixture.tables, `${label}.tables`);
    for (const [tableIndex, tableFixture] of schemaFixture.tables.entries()) {
      validateFakeTableFixture(tableFixture, `${label}.tables[${tableIndex}]`);
    }
  }
}

function validateFakeTableFixture(tableFixture, label) {
  requireObject(tableFixture, label);
  rejectUnknownKeys(tableFixture, new Set(Object.keys(defs.fakeTableFixture.properties ?? {})), label);
  requireKeys(tableFixture, defs.fakeTableFixture.required ?? [], label);
  requireNonEmptyString(tableFixture.name, `${label}.name`);
  if (tableFixture.columns !== undefined) {
    requireArray(tableFixture.columns, `${label}.columns`);
    for (const [columnIndex, columnFixture] of tableFixture.columns.entries()) {
      requireObject(columnFixture, `${label}.columns[${columnIndex}]`);
      rejectUnknownKeys(
        columnFixture,
        new Set(Object.keys(defs.fakeColumnFixture.properties ?? {})),
        `${label}.columns[${columnIndex}]`,
      );
      requireKeys(columnFixture, defs.fakeColumnFixture.required ?? [], `${label}.columns[${columnIndex}]`);
      requireNonEmptyString(columnFixture.name, `${label}.columns[${columnIndex}].name`);
      requireNonEmptyString(columnFixture.dataType, `${label}.columns[${columnIndex}].dataType`);
      if (
        columnFixture.nullable !== undefined &&
        typeof columnFixture.nullable !== "boolean"
      ) {
        error(`${label}.columns[${columnIndex}].nullable must be a boolean`);
      }
    }
  }
  if (tableFixture.rows !== undefined) {
    requireArray(tableFixture.rows, `${label}.rows`);
    for (const [rowIndex, row] of tableFixture.rows.entries()) {
      requireObject(row, `${label}.rows[${rowIndex}]`);
      for (const [key, value] of Object.entries(row)) {
        if (typeof value !== "string") {
          error(`${label}.rows[${rowIndex}].${key} must be a string`);
        }
      }
    }
  }
}

function validateProperty(value, property, label) {
  if (property.$ref === "#/$defs/contributionId") {
    requirePattern(value, defs.contributionId.pattern, label);
    return;
  }
  if (property.$ref === "#/$defs/relativePath") {
    requireRelativePath(value, label);
    return;
  }
  if (property.$ref) {
    const resolved = resolveSchemaRef(property.$ref);
    if (resolved) {
      validateProperty(value, resolved, label);
    } else {
      error(`${label} references unsupported schema ${property.$ref}`);
    }
    return;
  }
  if (property.const !== undefined) {
    requireConst(value, property.const, label);
    return;
  }
  if (property.type === "string") {
    requireString(value, label);
    if ((property.minLength ?? 0) > 0 && value.length === 0) {
      error(`${label} must be non-empty`);
    }
    if (property.pattern) {
      requirePattern(value, property.pattern, label);
    }
    if (property.enum) {
      requireEnum(value, new Set(property.enum), label);
    }
    return;
  }
  if (property.type === "array") {
    requireArray(value, label);
    if (property.minItems !== undefined && value.length < property.minItems) {
      error(`${label} must have at least ${property.minItems} item(s)`);
    }
    if (property.uniqueItems) {
      validateUniqueStrings(value, label);
    }
    for (const item of value) {
      validateProperty(item, property.items ?? {}, `${label}[]`);
    }
    return;
  }
  if (property.type === "object") {
    requireObject(value, label);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return;
    }
    const properties = property.properties ?? {};
    if (property.additionalProperties === false) {
      rejectUnknownKeys(value, new Set(Object.keys(properties)), label);
    }
    requireKeys(value, property.required ?? [], label);
    for (const [key, childProperty] of Object.entries(properties)) {
      if (value[key] !== undefined) {
        validateProperty(value[key], childProperty, `${label}.${key}`);
      }
    }
    if (
      property.additionalProperties &&
      typeof property.additionalProperties === "object"
    ) {
      for (const [key, childValue] of Object.entries(value)) {
        if (properties[key] === undefined) {
          validateProperty(childValue, property.additionalProperties, `${label}.${key}`);
        }
      }
    }
    return;
  }
  if (property.type === "boolean" && typeof value !== "boolean") {
    error(`${label} must be a boolean`);
  }
  if (property.type === "integer") {
    if (!Number.isInteger(value)) {
      error(`${label} must be an integer`);
    } else {
      if (property.minimum !== undefined && value < property.minimum) {
        error(`${label} must be >= ${property.minimum}`);
      }
      if (property.maximum !== undefined && value > property.maximum) {
        error(`${label} must be <= ${property.maximum}`);
      }
    }
    return;
  }
  if (property.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      error(`${label} must be a number`);
    }
    return;
  }
}

function resolveSchemaRef(ref) {
  const prefix = "#/$defs/";
  if (!ref.startsWith(prefix)) {
    return null;
  }
  return defs[ref.slice(prefix.length)] ?? null;
}

function requireKeys(value, required, label) {
  for (const key of required) {
    if (value[key] === undefined) {
      error(`${label} is missing required field ${key}`);
    }
  }
}

function rejectUnknownKeys(value, allowed, label) {
  for (const key of Object.keys(value ?? {})) {
    if (!allowed.has(key)) {
      error(`${label} has unknown field ${key}`);
    }
  }
}

function requireObject(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    error(`${label} must be an object`);
  }
}

function requireArray(value, label) {
  if (!Array.isArray(value)) {
    error(`${label} must be an array`);
  }
}

function requireString(value, label) {
  if (typeof value !== "string") {
    error(`${label} must be a string`);
  }
}

function requireNonEmptyString(value, label) {
  requireString(value, label);
  if (typeof value === "string" && value.trim() === "") {
    error(`${label} must be non-empty`);
  }
}

function requireConst(value, expected, label) {
  if (value !== expected) {
    error(`${label} must be ${JSON.stringify(expected)}`);
  }
}

function requireEnum(value, allowed, label) {
  if (!allowed.has(value)) {
    error(`${label} must be one of: ${[...allowed].join(", ")}`);
  }
}

function requirePattern(value, pattern, label) {
  requireString(value, label);
  if (typeof value === "string" && !new RegExp(pattern).test(value)) {
    error(`${label} does not match /${pattern}/`);
  }
}

function requireRelativePath(value, label) {
  requirePattern(value, defs.relativePath.pattern ?? "^.+$", label);
  if (typeof value !== "string" || value.length === 0) {
    return;
  }
  if (value.startsWith("/") || /^[A-Za-z]:/.test(value) || /(^|[/\\])\.\.([/\\]|$)/.test(value)) {
    error(`${label} must be a safe relative path`);
  }
}

function requireExistingRelativePath(manifestPath, value, label) {
  requireRelativePath(value, label);
  if (typeof value !== "string") {
    return;
  }
  const target = resolve(dirname(manifestPath), value);
  if (!existsSync(target)) {
    error(`${label} points to missing file ${value}`);
  }
}

function validateUniqueStrings(value, label) {
  if (!Array.isArray(value)) {
    return;
  }
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== "string") {
      error(`${label} items must be strings`);
      continue;
    }
    if (seen.has(item)) {
      error(`${label} contains duplicate item ${item}`);
    }
    seen.add(item);
  }
}

function findManifests(dir) {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      return findManifests(path);
    }
    return entry.isFile() && entry.name === "irodori.extension.json" ? [path] : [];
  });
}

function extraManifestRoots() {
  return (process.env.IRODORI_EXTENSION_MANIFEST_ROOTS ?? "")
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => resolve(root, entry));
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(value);
}

function read(path) {
  return readFileSync(path, "utf8");
}

function error(message) {
  errors.push(message);
}
