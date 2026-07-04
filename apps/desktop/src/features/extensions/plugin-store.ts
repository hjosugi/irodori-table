import bundledCatalogJson from "./bundled-catalog.json";

export const defaultPluginStoreCatalogUrl =
  "https://raw.githubusercontent.com/hjosugi/irodori-table/main/registry/catalog/index.json";

export type PluginStoreInstallKind = "githubRelease" | "git";

export type PluginStoreInstallSource = {
  kind: PluginStoreInstallKind;
  url: string;
  assetName?: string;
  manifestPath?: string;
  sha256?: string;
};

export type PluginStoreSourceTypeKind = "vector" | "lakehouse";

export type PluginStoreSourceTypeContribution = {
  engine: string;
  kind: PluginStoreSourceTypeKind;
  objectTypes: string[];
  workflows: string[];
  resultViews: string[];
  queryTemplates: string[];
  executionBackends?: string[];
  tableFormats?: string[];
};

export type PluginStoreContributions = {
  sourceTypes: PluginStoreSourceTypeContribution[];
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
  topics: string[];
  engines: string[];
  contributes?: PluginStoreContributions;
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
    topics: stringList(raw.topics),
    engines: stringList(raw.engines),
    contributes: raw.contributes
      ? normalizeContributions(raw.contributes)
      : undefined,
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

function normalizeContributions(value: unknown): PluginStoreContributions {
  if (!value || typeof value !== "object") {
    throw new Error("extension contributions must be an object");
  }
  const raw = value as Partial<PluginStoreContributions>;
  return {
    sourceTypes: Array.isArray(raw.sourceTypes)
      ? raw.sourceTypes.map(normalizeSourceTypeContribution)
      : [],
  };
}

function normalizeSourceTypeContribution(
  value: unknown,
): PluginStoreSourceTypeContribution {
  if (!value || typeof value !== "object") {
    throw new Error("extension sourceType contribution must be an object");
  }
  const raw = value as Partial<PluginStoreSourceTypeContribution>;
  return {
    engine: requiredString(raw.engine, "sourceType engine"),
    kind: requiredString(
      raw.kind,
      "sourceType kind",
    ) as PluginStoreSourceTypeKind,
    objectTypes: stringList(raw.objectTypes),
    workflows: stringList(raw.workflows),
    resultViews: stringList(raw.resultViews),
    queryTemplates: stringList(raw.queryTemplates),
    executionBackends: optionalStringList(raw.executionBackends),
    tableFormats: optionalStringList(raw.tableFormats),
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

function optionalStringList(value: unknown): string[] | undefined {
  const items = stringList(value);
  return items.length > 0 ? items : undefined;
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
