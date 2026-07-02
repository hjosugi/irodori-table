import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const extensionLibDir = dirname(fileURLToPath(import.meta.url));

export const repoRoot = resolve(extensionLibDir, "../../..");
export const defaultExtensionsRoot = firstExistingPath([
  resolve(repoRoot, "../irodori-extensions"),
  resolve(repoRoot, "../../irodori-extensions"),
]);
export const extensionsRoot = process.env.IRODORI_EXTENSIONS_ROOT ?? defaultExtensionsRoot;

export function readConnectorRepositories() {
  return readJson(resolve(repoRoot, "registry/catalog/connector-repositories.json")).repositories ?? [];
}

export function readExtensionCatalog() {
  return readJson(resolve(repoRoot, "registry/catalog/index.json"));
}

export function selectRepositories(repositories, options) {
  let selected = repositories;
  if (options.repos?.size > 0) {
    selected = selected.filter(
      (repo) => options.repos.has(repo.name) || options.repos.has(repo.extensionId),
    );
  }
  if (options.engines?.size > 0) {
    selected = selected.filter((repo) =>
      (repo.engines ?? []).some((engine) => options.engines.has(engine)),
    );
  }
  if (options.limit !== null && options.limit !== undefined) {
    selected = selected.slice(0, options.limit);
  }
  return selected;
}

export function parsePositiveInteger(value, optionName) {
  const parsed = Number.parseInt(value, 10);
  assert(Number.isInteger(parsed) && parsed > 0, `${optionName} must be a positive integer`);
  return parsed;
}

export function readJson(path) {
  try {
    return JSON.parse(readText(path));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read JSON ${path}: ${message}`);
  }
}

export function readText(path) {
  return readFileSync(path, "utf8");
}

export function firstExistingPath(paths) {
  return paths.find((path) => path && existsSync(path)) ?? paths[0];
}

export function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
