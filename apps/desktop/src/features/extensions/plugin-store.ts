import bundledCatalogJson from "./bundled-catalog.json";

export const defaultPluginStoreCatalogUrl =
  "https://raw.githubusercontent.com/hjosugi/irodori-table/main/registry/catalog/index.json";

export type PluginStoreInstallKind = "githubRelease" | "git";

export type PluginStoreInstallAsset = {
  name: string;
  sha256: string;
};

export type PluginStoreInstallSource = {
  kind: PluginStoreInstallKind;
  url: string;
  tag: string;
  manifestPath?: string;
  assets: Record<string, PluginStoreInstallAsset>;
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
    cache: "no-store",
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

export function resolvePluginStoreInstallAsset(
  extension: PluginStoreExtension,
  target: string,
): PluginStoreInstallAsset | undefined {
  return extension.install?.assets[target];
}

/**
 * Typed early failure for a catalog entry whose `install.kind` the installer
 * cannot handle (#160). Only pinned GitHub release archives are installable
 * today; a git installer is deliberately out of scope until the registry
 * actually ships such an entry. Failing here — before the permission prompt
 * and before any IPC — replaces the misleading download/manifest errors that
 * mishandling the entry as a GitHub release would produce.
 */
export class UnsupportedInstallKindError extends Error {
  readonly kind: PluginStoreInstallKind;

  constructor(kind: PluginStoreInstallKind) {
    super(
      `extension install kind \`${kind}\` is not supported yet; only pinned GitHub release archives (\`githubRelease\`) can be installed`,
    );
    this.name = "UnsupportedInstallKindError";
    this.kind = kind;
  }
}

/** Throw {@link UnsupportedInstallKindError} unless the source is installable. */
export function assertSupportedInstallKind(
  install: PluginStoreInstallSource,
): void {
  if (install.kind !== "githubRelease") {
    throw new UnsupportedInstallKindError(install.kind);
  }
}

export function compareExtensionVersions(left: string, right: string): number {
  const leftVersion = parseVersion(left);
  const rightVersion = parseVersion(right);
  const length = Math.max(leftVersion.core.length, rightVersion.core.length);

  for (let index = 0; index < length; index += 1) {
    const difference =
      (leftVersion.core[index] ?? 0) - (rightVersion.core[index] ?? 0);
    if (difference !== 0) {
      return Math.sign(difference);
    }
  }

  if (leftVersion.prerelease.length === 0) {
    return rightVersion.prerelease.length === 0 ? 0 : 1;
  }
  if (rightVersion.prerelease.length === 0) {
    return -1;
  }

  const prereleaseLength = Math.max(
    leftVersion.prerelease.length,
    rightVersion.prerelease.length,
  );
  for (let index = 0; index < prereleaseLength; index += 1) {
    const leftPart = leftVersion.prerelease[index];
    const rightPart = rightVersion.prerelease[index];
    if (leftPart === undefined) {
      return -1;
    }
    if (rightPart === undefined) {
      return 1;
    }
    if (leftPart === rightPart) {
      continue;
    }
    const leftNumber = numericVersionPart(leftPart);
    const rightNumber = numericVersionPart(rightPart);
    if (leftNumber !== null && rightNumber !== null) {
      return Math.sign(leftNumber - rightNumber);
    }
    if (leftNumber !== null) {
      return -1;
    }
    if (rightNumber !== null) {
      return 1;
    }
    return leftPart.localeCompare(rightPart);
  }
  return 0;
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
  const assets = normalizeInstallAssets(raw.assets);
  if (Object.keys(assets).length === 0) {
    throw new Error("install assets are required");
  }
  return {
    kind: requiredString(raw.kind, "install kind") as PluginStoreInstallKind,
    url: requiredString(raw.url, "install url"),
    tag: requiredString(raw.tag, "install tag"),
    manifestPath: optionalString(raw.manifestPath),
    assets,
  };
}

function normalizeInstallAssets(
  value: unknown,
): Record<string, PluginStoreInstallAsset> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).map(([target, asset]) => {
      if (!asset || typeof asset !== "object" || Array.isArray(asset)) {
        throw new Error(`install asset ${target} must be an object`);
      }
      const raw = asset as Partial<PluginStoreInstallAsset>;
      return [
        requiredString(target, "install target"),
        {
          name: requiredString(raw.name, `install asset ${target} name`),
          sha256: requiredSha256(raw.sha256, `install asset ${target} sha256`),
        },
      ];
    }),
  );
}

function requiredSha256(value: unknown, label: string): string {
  const digest = requiredString(value, label).replace(/^sha256:/i, "");
  if (!/^[a-f0-9]{64}$/i.test(digest)) {
    throw new Error(`${label} must be a 64-character SHA-256 digest`);
  }
  return `sha256:${digest.toLowerCase()}`;
}

function parseVersion(value: string): {
  core: number[];
  prerelease: string[];
} {
  const normalized = value.trim().replace(/^v/i, "").split("+", 1)[0] ?? "";
  const [core = "", prerelease = ""] = normalized.split("-", 2);
  return {
    core: core.split(".").map((part) => numericVersionPart(part) ?? 0),
    prerelease: prerelease ? prerelease.split(".") : [],
  };
}

function numericVersionPart(value: string): number | null {
  return /^\d+$/.test(value) ? Number.parseInt(value, 10) : null;
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
