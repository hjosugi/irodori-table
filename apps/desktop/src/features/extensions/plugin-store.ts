export const defaultPluginStoreCatalogUrl =
  "https://raw.githubusercontent.com/hjosugi/irodori-table/main/docs/extension-marketplace/catalog.json";

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

export const bundledPluginStoreCatalog: PluginStoreCatalog = {
  schemaVersion: 1,
  updatedAt: "2026-06-27T00:00:00Z",
  source: "bundled-extension-catalog",
  extensions: [
    connector("irodori.duckdb", "DuckDB Connector", ["duckdb"]),
    connector("irodori.motherduck", "MotherDuck Connector", ["motherduck"]),
    connector("irodori.hive", "Hive Connector", ["hive"]),
    connector("irodori.iceberg", "Iceberg Connector", ["iceberg"]),
    connector("irodori.s3-tables", "S3 Tables Connector", ["s3Tables"]),
    connector("irodori.athena", "Athena Connector", ["athena"]),
    connector("irodori.delta-lake", "Delta Lake Connector", ["deltaLake"]),
    connector("irodori.hudi", "Hudi Connector", ["hudi"]),
    connector("irodori.snowflake", "Snowflake Connector", ["snowflake"]),
    connector("irodori.bigquery", "BigQuery Connector", ["bigquery"]),
    connector("irodori.bigtable", "Bigtable Connector", ["bigtable"]),
    connector("irodori.cloud-spanner", "Cloud Spanner Connector", ["cloudSpanner"]),
    connector("irodori.redis", "Redis Connector", ["redis"]),
    connector("irodori.dynamodb", "DynamoDB Connector", ["dynamodb"]),
    connector("irodori.mongodb", "MongoDB Connector", ["mongodb"]),
    connector("irodori.clickhouse", "ClickHouse Connector", ["clickhouse"]),
    connector("irodori.cassandra", "Cassandra Connector", ["cassandra"]),
    connector("irodori.scylladb", "ScyllaDB Connector", ["scylladb"]),
    connector("irodori.neo4j", "Neo4j Connector", ["neo4j"]),
    connector("irodori.memgraph", "Memgraph Connector", ["memgraph"]),
    connector("irodori.elasticsearch", "Elasticsearch Connector", ["elasticsearch"]),
    connector("irodori.opensearch", "OpenSearch Connector", ["openSearch"]),
    connector("irodori.sqlserver", "SQL Server Connector", ["sqlserver"]),
    connector("irodori.oracle", "Oracle Connector", ["oracle"]),
    connector("irodori.influxdb", "InfluxDB Connector", ["influxdb"]),
    connector("irodori.qdrant", "Qdrant Connector", ["qdrant"]),
    connector("irodori.milvus", "Milvus Connector", ["milvus"]),
    connector("irodori.pinecone", "Pinecone Connector", ["pinecone"]),
    connector("irodori.couchbase", "Couchbase Connector", ["couchbase"]),
    connector("irodori.arangodb", "ArangoDB Connector", ["arangodb"]),
    connector("irodori.questdb", "QuestDB Connector", ["questdb"]),
    connector("irodori.iotdb", "IoTDB Connector", ["iotdb"]),
    connector("irodori.trino-presto", "Trino / Presto Connector", ["trinoPresto"]),
    connector("irodori.firebird", "Firebird Connector", ["firebird"]),
    connector("irodori.databricks", "Databricks Connector", ["databricks"]),
  ],
};

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

function normalizePluginStoreCatalog(value: unknown, source: string): PluginStoreCatalog {
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
    runtime: requiredString(raw.runtime, "extension runtime") as PluginStoreExtension["runtime"],
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

function connector(id: string, name: string, engines: string[]): PluginStoreExtension {
  const repoName = `irodori-extension-${id.replace("irodori.", "")}`;
  return {
    id,
    name,
    publisher: "irodori",
    version: "0.1.0",
    apiVersion: "0.1",
    summary: `Adds ${engines.join(", ")} connectivity as an installable connector extension.`,
    license: "MIT OR 0BSD",
    repository: `https://github.com/hjosugi/${repoName}`,
    categories: ["connector", "database"],
    engines,
    permissions: [],
    runtime: "native",
    verified: true,
    publishedAt: "2026-06-27T00:00:00Z",
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
