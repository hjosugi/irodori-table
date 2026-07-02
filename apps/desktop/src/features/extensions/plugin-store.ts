import bundledCatalogJson from "./bundled-catalog.json";

export const defaultPluginStoreCatalogUrl =
  "https://raw.githubusercontent.com/hjosugi/irodori-table/main/registry/catalog/catalog.json";

export type PluginStoreInstallKind = "githubRelease" | "git";

export type PluginStoreInstallSource = {
  kind: PluginStoreInstallKind;
  url: string;
  assetName?: string;
  manifestPath?: string;
  sha256?: string;
};

export type PluginStoreExtension = {
  id: string;
  name: string;
  publisher: string;
  version: string;
  apiVersion: string;
  summary: string;
  description?: string;
  license: string;
  repository: string;
  homepage?: string;
  detailsUrl?: string;
  categories: string[];
  engines: string[];
  permissions: string[];
  runtime: "typescript" | "javascript" | "wasm" | "native";
  verified: boolean;
  publishedAt: string;
  install?: PluginStoreInstallSource;
};

export type PluginStoreCatalog = {
  schemaVersion: 1;
  updatedAt: string;
  source: string;
  extensions: PluginStoreExtension[];
};

export const bundledPluginStoreCatalog: PluginStoreCatalog =
  normalizePluginStoreCatalog(bundledCatalogJson, "bundled-extension-catalog");

export async function fetchPluginStoreCatalog(
  url = defaultPluginStoreCatalogUrl,
): Promise<PluginStoreCatalog> {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`plugin store request failed: HTTP ${response.status}`);
  }
  const parsed = (await response.json()) as unknown;
  return normalizePluginStoreCatalog(parsed, url);
}

function normalizePluginStoreCatalog(
  value: unknown,
  source: string,
): PluginStoreCatalog {
  if (!value || typeof value !== "object") {
    throw new Error("plugin store catalog must be an object");
  }
  const raw = value as Partial<PluginStoreCatalog>;
  if (raw.schemaVersion !== 1 || !Array.isArray(raw.extensions)) {
    throw new Error("plugin store catalog has an unsupported schema");
  }
  return {
    schemaVersion: 1,
    updatedAt: stringOr(raw.updatedAt, new Date().toISOString()),
    source: stringOr(raw.source, source),
    extensions: raw.extensions.map(normalizePluginStoreExtension),
  };
}

function normalizePluginStoreExtension(value: unknown): PluginStoreExtension {
  if (!value || typeof value !== "object") {
    throw new Error("plugin store extension entry must be an object");
  }
  const raw = value as Partial<PluginStoreExtension>;
  return {
    id: requiredString(raw.id, "extension id"),
    name: requiredString(raw.name, "extension name"),
    publisher: requiredString(raw.publisher, "extension publisher"),
    version: requiredString(raw.version, "extension version"),
    apiVersion: requiredString(raw.apiVersion, "extension apiVersion"),
    summary: requiredString(raw.summary, "extension summary"),
    description: optionalString(raw.description),
    license: requiredString(raw.license, "extension license"),
    repository: requiredString(raw.repository, "extension repository"),
    homepage: optionalString(raw.homepage),
    detailsUrl: optionalString(raw.detailsUrl),
    categories: stringList(raw.categories),
    engines: stringList(raw.engines),
    permissions: stringList(raw.permissions),
    runtime: requiredString(
      raw.runtime,
      "extension runtime",
    ) as PluginStoreExtension["runtime"],
    verified: Boolean(raw.verified),
    publishedAt: requiredString(raw.publishedAt, "extension publishedAt"),
    install: raw.install ? normalizeInstallSource(raw.install) : undefined,
  };
}

function normalizeInstallSource(value: unknown): PluginStoreInstallSource {
  if (!value || typeof value !== "object") {
    throw new Error("extension install source must be an object");
  }
  const raw = value as Partial<PluginStoreInstallSource>;
  return {
    kind: requiredString(raw.kind, "install kind") as PluginStoreInstallKind,
    url: requiredString(raw.url, "install url"),
    assetName: optionalString(raw.assetName),
    manifestPath: optionalString(raw.manifestPath),
    sha256: optionalString(raw.sha256),
  };
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required`);
  }
  return value;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
