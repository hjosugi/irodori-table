export const heavyExtensionCatalogFields = ["description", "install", "permissions"];

export function buildExtensionCatalog(index) {
  if (!index || typeof index !== "object") {
    throw new Error("extension marketplace index must be an object");
  }
  return {
    schemaVersion: 1,
    updatedAt: stringOr(index.updatedAt, new Date().toISOString()),
    source: "prebuilt-extension-catalog",
    extensions: arrayOrEmpty(index.extensions).map(toCatalogExtension),
  };
}

export function buildBundledPluginStoreCatalog(index) {
  if (!index || typeof index !== "object") {
    throw new Error("extension marketplace index must be an object");
  }
  return {
    schemaVersion: 1,
    updatedAt: stringOr(index.updatedAt, new Date().toISOString()),
    source: "bundled-extension-catalog",
    extensions: arrayOrEmpty(index.extensions).map(toBundledExtension),
  };
}

export function serializeExtensionCatalog(catalog) {
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

export function hasHeavyExtensionCatalogFields(extension) {
  return heavyExtensionCatalogFields.some((field) =>
    Object.prototype.hasOwnProperty.call(extension, field),
  );
}

function toCatalogExtension(extension) {
  if (!extension || typeof extension !== "object") {
    throw new Error("extension marketplace entry must be an object");
  }
  const homepage = optionalString(extension.homepage);
  return {
    id: requiredString(extension.id, "extension id"),
    name: requiredString(extension.name, "extension name"),
    publisher: requiredString(extension.publisher, "extension publisher"),
    version: requiredString(extension.version, "extension version"),
    apiVersion: requiredString(extension.apiVersion, "extension apiVersion"),
    summary: requiredString(extension.summary, "extension summary"),
    license: requiredString(extension.license, "extension license"),
    repository: requiredString(extension.repository, "extension repository"),
    ...(homepage ? { homepage } : {}),
    categories: stringList(extension.categories),
    engines: stringList(extension.engines),
    runtime: requiredString(extension.runtime, "extension runtime"),
    verified: Boolean(extension.verified),
    publishedAt: requiredString(extension.publishedAt, "extension publishedAt"),
  };
}

function toBundledExtension(extension) {
  if (!extension || typeof extension !== "object") {
    throw new Error("extension marketplace entry must be an object");
  }
  const description = optionalString(extension.description);
  const homepage = optionalString(extension.homepage);
  const detailsUrl = optionalString(extension.detailsUrl);
  const install = optionalInstallSource(extension.install);
  return {
    id: requiredString(extension.id, "extension id"),
    name: requiredString(extension.name, "extension name"),
    publisher: requiredString(extension.publisher, "extension publisher"),
    version: requiredString(extension.version, "extension version"),
    apiVersion: requiredString(extension.apiVersion, "extension apiVersion"),
    summary: requiredString(extension.summary, "extension summary"),
    ...(description ? { description } : {}),
    license: requiredString(extension.license, "extension license"),
    repository: requiredString(extension.repository, "extension repository"),
    ...(homepage ? { homepage } : {}),
    ...(detailsUrl ? { detailsUrl } : {}),
    categories: stringList(extension.categories),
    engines: stringList(extension.engines),
    permissions: stringList(extension.permissions),
    runtime: requiredString(extension.runtime, "extension runtime"),
    verified: Boolean(extension.verified),
    publishedAt: requiredString(extension.publishedAt, "extension publishedAt"),
    ...(install ? { install } : {}),
  };
}

function optionalInstallSource(value) {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const install = {
    kind: requiredString(value.kind, "install kind"),
    url: requiredString(value.url, "install url"),
  };
  const assetName = optionalString(value.assetName);
  const manifestPath = optionalString(value.manifestPath);
  const sha256 = optionalString(value.sha256);
  return {
    ...install,
    ...(assetName ? { assetName } : {}),
    ...(manifestPath ? { manifestPath } : {}),
    ...(sha256 ? { sha256 } : {}),
  };
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function stringList(value) {
  return arrayOrEmpty(value).filter((item) => typeof item === "string");
}

function requiredString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required`);
  }
  return value;
}

function stringOr(value, fallback) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function optionalString(value) {
  return typeof value === "string" && value.trim() ? value : undefined;
}
