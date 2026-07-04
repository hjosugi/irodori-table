export const heavyExtensionCatalogFields = ["description", "install", "permissions"];
const jsonPrintWidth = 80;

export function buildExtensionCatalog(index, options = {}) {
  if (!index || typeof index !== "object") {
    throw new Error("extension marketplace index must be an object");
  }
  const sourceTypeContracts = sourceTypeContractsByEngine(options.engines);
  return {
    schemaVersion: 1,
    updatedAt: stringOr(index.updatedAt, new Date().toISOString()),
    source: "prebuilt-extension-catalog",
    extensions: arrayOrEmpty(index.extensions).map((extension) =>
      toCatalogExtension(extension, sourceTypeContracts),
    ),
  };
}

export function buildBundledPluginStoreCatalog(index, options = {}) {
  if (!index || typeof index !== "object") {
    throw new Error("extension marketplace index must be an object");
  }
  const sourceTypeContracts = sourceTypeContractsByEngine(options.engines);
  return {
    schemaVersion: 1,
    updatedAt: stringOr(index.updatedAt, new Date().toISOString()),
    source: "bundled-extension-catalog",
    extensions: arrayOrEmpty(index.extensions).map((extension) =>
      toBundledExtension(extension, sourceTypeContracts),
    ),
  };
}

export function serializeExtensionCatalog(catalog) {
  return `${formatJsonValue(catalog, 0, 0)}\n`;
}

export function hasHeavyExtensionCatalogFields(extension) {
  return heavyExtensionCatalogFields.some((field) =>
    Object.prototype.hasOwnProperty.call(extension, field),
  );
}

function toCatalogExtension(extension, sourceTypeContracts) {
  if (!extension || typeof extension !== "object") {
    throw new Error("extension marketplace entry must be an object");
  }
  const homepage = optionalString(extension.homepage);
  const contributes = extensionContributions(extension, sourceTypeContracts);
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
    topics: stringList(extension.topics),
    engines: stringList(extension.engines),
    ...(contributes ? { contributes } : {}),
    runtime: requiredString(extension.runtime, "extension runtime"),
    verified: Boolean(extension.verified),
    publishedAt: requiredString(extension.publishedAt, "extension publishedAt"),
  };
}

function toBundledExtension(extension, sourceTypeContracts) {
  if (!extension || typeof extension !== "object") {
    throw new Error("extension marketplace entry must be an object");
  }
  const description = optionalString(extension.description);
  const homepage = optionalString(extension.homepage);
  const detailsUrl = optionalString(extension.detailsUrl);
  const install = optionalInstallSource(extension.install);
  const contributes = extensionContributions(extension, sourceTypeContracts);
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
    topics: stringList(extension.topics),
    engines: stringList(extension.engines),
    ...(contributes ? { contributes } : {}),
    permissions: stringList(extension.permissions),
    runtime: requiredString(extension.runtime, "extension runtime"),
    verified: Boolean(extension.verified),
    publishedAt: requiredString(extension.publishedAt, "extension publishedAt"),
    ...(install ? { install } : {}),
  };
}

function sourceTypeContractsByEngine(engines) {
  return new Map(
    arrayOrEmpty(engines)
      .filter((engine) => engine && typeof engine === "object")
      .flatMap((engine) => {
        const id = optionalString(engine.id);
        const contract = normalizedSourceTypeContract(engine.sourceTypeContract);
        return id && contract ? [[id, contract]] : [];
      }),
  );
}

function extensionContributions(extension, sourceTypeContracts) {
  const sourceTypes = stringList(extension.engines).flatMap((engine) => {
    const contract = sourceTypeContracts.get(engine);
    return contract ? [{ engine, ...contract }] : [];
  });
  return sourceTypes.length > 0 ? { sourceTypes } : undefined;
}

function normalizedSourceTypeContract(contract) {
  if (!contract || typeof contract !== "object") {
    return undefined;
  }
  const kind = optionalString(contract.kind);
  if (!kind) {
    return undefined;
  }
  const result = {
    kind,
    objectTypes: stringList(contract.objectTypes),
    workflows: stringList(contract.workflows),
    resultViews: stringList(contract.resultViews),
    queryTemplates: stringList(contract.queryTemplates),
  };
  const executionBackends = stringList(contract.executionBackends);
  const tableFormats = stringList(contract.tableFormats);
  return {
    ...result,
    ...(executionBackends.length > 0 ? { executionBackends } : {}),
    ...(tableFormats.length > 0 ? { tableFormats } : {}),
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

function formatJsonValue(value, indent, inlinePrefixLength) {
  if (Array.isArray(value)) {
    return formatJsonArray(value, indent, inlinePrefixLength);
  }
  if (value && typeof value === "object") {
    return formatJsonObject(value, indent);
  }
  return JSON.stringify(value);
}

function formatJsonObject(value, indent) {
  const entries = Object.entries(value);
  if (entries.length === 0) {
    return "{}";
  }
  const currentIndent = " ".repeat(indent);
  const nextIndent = " ".repeat(indent + 2);
  const lines = entries.map(([key, entryValue], index) => {
    const keyPrefix = `${JSON.stringify(key)}: `;
    const formattedValue = formatJsonValue(
      entryValue,
      indent + 2,
      nextIndent.length + keyPrefix.length,
    );
    const comma = index === entries.length - 1 ? "" : ",";
    return `${nextIndent}${keyPrefix}${formattedValue}${comma}`;
  });
  return `{\n${lines.join("\n")}\n${currentIndent}}`;
}

function formatJsonArray(value, indent, inlinePrefixLength) {
  if (value.length === 0) {
    return "[]";
  }
  if (value.every(isJsonPrimitive)) {
    const inline = `[${value.map((item) => JSON.stringify(item)).join(", ")}]`;
    if (inlinePrefixLength + inline.length < jsonPrintWidth) {
      return inline;
    }
  }
  const currentIndent = " ".repeat(indent);
  const nextIndent = " ".repeat(indent + 2);
  const lines = value.map((item, index) => {
    const comma = index === value.length - 1 ? "" : ",";
    return `${nextIndent}${formatJsonValue(item, indent + 2, nextIndent.length)}${comma}`;
  });
  return `[\n${lines.join("\n")}\n${currentIndent}]`;
}

function isJsonPrimitive(value) {
  return value === null || typeof value !== "object";
}
