import type { DbEngine } from "@/generated/irodori-api";

export type EngineConnectionInputMode = "url" | "fields";

export type EngineConnectionSettings = {
  preferredMode: EngineConnectionInputMode;
  urlLabel: string;
  urlPlaceholder: string;
  fieldsLabel: string;
  hostLabel: string;
  hostPlaceholder: string;
  portLabel: string;
  userLabel: string;
  userPlaceholder: string;
  passwordLabel: string;
  passwordPlaceholder: string;
  databaseLabel: string;
  databasePlaceholder: string;
  showHost: boolean;
  showPort: boolean;
  showUser: boolean;
  showPassword: boolean;
  transportLabel: string;
};

const tcpDatabaseSettings: EngineConnectionSettings = {
  preferredMode: "fields",
  urlLabel: "URL / DSN",
  urlPlaceholder: "driver://user:password@host:port/database",
  fieldsLabel: "Fields",
  hostLabel: "Host",
  hostPlaceholder: "localhost",
  portLabel: "Port",
  userLabel: "User",
  userPlaceholder: "username",
  passwordLabel: "Password",
  passwordPlaceholder: "Session only",
  databaseLabel: "Database",
  databasePlaceholder: "database name",
  showHost: true,
  showPort: true,
  showUser: true,
  showPassword: true,
  transportLabel: "Direct TCP",
};

export function engineConnectionSettings(engine: DbEngine): EngineConnectionSettings {
  switch (engine) {
    case "postgres":
    case "timescaledb":
    case "neon":
    case "cockroachdb":
    case "yugabytedb":
    case "redshift":
      return {
        ...tcpDatabaseSettings,
        urlPlaceholder: "postgres://user:password@host:5432/database",
        databaseLabel: "Database",
        databasePlaceholder: "database name",
      };
    case "mysql":
    case "mariadb":
    case "tidb":
      return {
        ...tcpDatabaseSettings,
        urlPlaceholder: "mysql://user:password@host:3306/database",
      };
    case "sqlite":
      return {
        ...tcpDatabaseSettings,
        preferredMode: "fields",
        urlPlaceholder: "sqlite:///absolute/path/to/database.sqlite",
        fieldsLabel: "File",
        hostLabel: "File",
        hostPlaceholder: "",
        databaseLabel: "SQLite file / :memory:",
        databasePlaceholder: "/path/to/database.sqlite or :memory:",
        showHost: false,
        showPort: false,
        showUser: false,
        showPassword: false,
        transportLabel: "Local file",
      };
    case "duckdb":
      return {
        ...tcpDatabaseSettings,
        preferredMode: "fields",
        urlPlaceholder: ":memory: or /absolute/path/to/database.duckdb",
        fieldsLabel: "File",
        databaseLabel: "DuckDB file / :memory:",
        databasePlaceholder: "/path/to/database.duckdb or :memory:",
        showHost: false,
        showPort: false,
        showUser: false,
        showPassword: false,
        transportLabel: "Local file",
      };
    case "motherduck":
      return {
        ...tcpDatabaseSettings,
        preferredMode: "url",
        urlLabel: "MotherDuck DSN",
        urlPlaceholder: "md: or motherduck://token@md/database",
        fieldsLabel: "MotherDuck",
        hostLabel: "Account",
        hostPlaceholder: "md",
        portLabel: "API port",
        userLabel: "Token user",
        userPlaceholder: "token",
        passwordLabel: "MotherDuck token",
        databaseLabel: "Database",
        databasePlaceholder: "database name",
        showPort: false,
        transportLabel: "DuckDB extension",
      };
    case "oracle":
      return {
        ...tcpDatabaseSettings,
        urlPlaceholder: "oracle://user:password@host:1521/service",
        databaseLabel: "Service name / SID",
        databasePlaceholder: "ORCLPDB1",
      };
    case "sqlserver":
      return {
        ...tcpDatabaseSettings,
        urlPlaceholder: "sqlserver://user:password@host:1433;databaseName=database",
        hostLabel: "Server",
      };
    case "h2":
      return {
        ...tcpDatabaseSettings,
        urlPlaceholder: "jdbc:h2:tcp://host:5435/~/database or jdbc:h2:file:./database",
        databaseLabel: "Database path / name",
        databasePlaceholder: "~/database",
        transportLabel: "JDBC / TCP",
      };
    case "mongodb":
      return {
        ...tcpDatabaseSettings,
        urlPlaceholder: "mongodb://user:password@host:27017/database",
        databaseLabel: "Database / auth source",
      };
    case "redis":
      return {
        ...tcpDatabaseSettings,
        urlPlaceholder: "redis://:password@host:6379/0",
        userLabel: "Username",
        userPlaceholder: "default",
        databaseLabel: "Database index",
        databasePlaceholder: "0",
      };
    case "snowflake":
      return {
        ...tcpDatabaseSettings,
        urlLabel: "Base URL",
        urlPlaceholder: "https://org-account.snowflakecomputing.com",
        hostLabel: "Account / host",
        hostPlaceholder: "org-account or org-account.region.snowflakecomputing.com",
        userLabel: "Login name",
        passwordLabel: "Password",
        databaseLabel: "Database / schema",
        databasePlaceholder: "DATABASE/SCHEMA",
        showPort: false,
        transportLabel: "Snowflake HTTPS API",
      };
    case "bigquery":
      return {
        ...tcpDatabaseSettings,
        preferredMode: "url",
        urlLabel: "Project / credentials JSON / DSN",
        urlPlaceholder: "bigquery://project/dataset or credentials JSON path",
        hostLabel: "Project",
        hostPlaceholder: "project-id",
        portLabel: "API port",
        userLabel: "Service account",
        passwordLabel: "Token / key",
        databaseLabel: "Dataset",
        showPort: false,
        transportLabel: "Google API",
      };
    case "athena":
      return {
        ...tcpDatabaseSettings,
        preferredMode: "url",
        urlLabel: "Athena DSN / AWS profile",
        urlPlaceholder:
          "athena://profile@us-east-1/AwsDataCatalog/default?workgroup=primary&output=s3://bucket/query-results/",
        fieldsLabel: "AWS",
        hostLabel: "Region",
        hostPlaceholder: "us-east-1",
        portLabel: "API port",
        userLabel: "AWS profile / access key",
        userPlaceholder: "default",
        passwordLabel: "Secret / session token",
        databaseLabel: "Catalog / database",
        databasePlaceholder: "AwsDataCatalog/default",
        showPort: false,
        transportLabel: "AWS Athena API",
      };
    case "bigtable":
    case "cloudSpanner":
      return {
        ...tcpDatabaseSettings,
        preferredMode: "url",
        urlLabel: "Project / instance / credentials",
        urlPlaceholder:
          engine === "cloudSpanner"
            ? "spanner://project/instance/database or credentials JSON path"
            : "bigtable://project/instance or credentials JSON path",
        hostLabel: "Project / instance",
        hostPlaceholder: "project/instance",
        userLabel: "Service account",
        passwordLabel: "Token / key",
        databaseLabel:
          engine === "cloudSpanner" ? "Database" : "Table / app profile",
        showPort: false,
        transportLabel: "Google API",
      };
    case "databricks":
      return {
        ...tcpDatabaseSettings,
        urlPlaceholder: "databricks://token@workspace-host/sql/warehouse",
        hostLabel: "Workspace host",
        userLabel: "Token user",
        passwordLabel: "Access token",
        databaseLabel: "Catalog / schema",
        transportLabel: "HTTPS",
      };
    case "clickhouse":
      return {
        ...tcpDatabaseSettings,
        urlPlaceholder: "clickhouse://user:password@host:8123/database",
        transportLabel: "HTTP / Native",
      };
    case "questdb":
      return {
        ...tcpDatabaseSettings,
        urlPlaceholder: "postgres://user:password@host:8812/qdb",
        databaseLabel: "Database",
        transportLabel: "PostgreSQL wire / HTTP",
      };
    case "iotdb":
      return {
        ...tcpDatabaseSettings,
        urlPlaceholder: "iotdb://user:password@host:6667/root",
        databaseLabel: "Storage group / database",
        databasePlaceholder: "root",
        transportLabel: "IoTDB native",
      };
    case "neo4j":
    case "memgraph":
      return {
        ...tcpDatabaseSettings,
        urlPlaceholder: "bolt://user:password@host:7687",
        databaseLabel: "Graph database",
        databasePlaceholder: "neo4j",
        transportLabel: "Bolt",
      };
    case "influxdb":
      return {
        ...tcpDatabaseSettings,
        urlPlaceholder: "http://host:8086?org=...&bucket=...",
        userLabel: "Org",
        passwordLabel: "Token",
        databaseLabel: "Bucket / database",
        transportLabel: "HTTP API",
      };
    case "qdrant":
    case "milvus":
    case "pinecone":
      return {
        ...tcpDatabaseSettings,
        preferredMode: "url",
        urlPlaceholder: `${engine}://host`,
        userLabel: "Project / user",
        passwordLabel: "API key / token",
        databaseLabel: "Collection / namespace",
        transportLabel: "Vector API",
      };
    case "elasticsearch":
    case "couchbase":
    case "arangodb":
      return {
        ...tcpDatabaseSettings,
        urlPlaceholder: "https://user:password@host:port",
        databaseLabel: "Index / bucket / database",
        transportLabel: "HTTP API",
      };
    case "dynamodb":
    case "kvStore":
    case "s3Tables":
    case "objectStore":
      return {
        ...tcpDatabaseSettings,
        preferredMode: "url",
        urlPlaceholder:
          engine === "kvStore"
            ? "kv://provider/profile/namespace"
            : "aws://profile/region/resource",
        hostLabel: "Region",
        hostPlaceholder: "us-east-1",
        userLabel: "Access key",
        passwordLabel: "Secret / token",
        databaseLabel: "Table / bucket",
        showPort: false,
        transportLabel: "Cloud API",
      };
    case "trinoPresto":
    case "hive":
      return {
        ...tcpDatabaseSettings,
        urlPlaceholder: "trino://user@host:8080/catalog/schema",
        databaseLabel: "Catalog / schema",
      };
    case "cassandra":
    case "scylladb":
      return {
        ...tcpDatabaseSettings,
        urlPlaceholder: "cassandra://user:password@host:9042/keyspace",
        databaseLabel: "Keyspace",
      };
    case "firebird":
      return {
        ...tcpDatabaseSettings,
        urlPlaceholder: "firebird://user:password@host:3050/path/to/database.fdb",
        databaseLabel: "Database path",
      };
    case "deltaLake":
    case "hudi":
    case "iceberg":
      return {
        ...tcpDatabaseSettings,
        preferredMode: "url",
        urlLabel: "Catalog URI / table path",
        urlPlaceholder:
          "iceberg+rest://catalog.example.com/warehouse/namespace or s3://bucket/table",
        fieldsLabel: "Catalog",
        hostLabel: "Catalog endpoint / region",
        hostPlaceholder: "catalog.example.com or us-east-1",
        userLabel: "Credential / profile",
        passwordLabel: "Secret / token",
        databaseLabel: "Warehouse / namespace / table path",
        databasePlaceholder: "warehouse.namespace.table or s3://bucket/table",
        showHost: false,
        showPort: false,
        showUser: false,
        showPassword: false,
        transportLabel: "Lakehouse catalog",
      };
    default:
      return {
        ...tcpDatabaseSettings,
        portLabel: defaultPort(engine) ? "Port" : "Port (optional)",
      };
  }
}

export function defaultPort(engine: DbEngine) {
  switch (engine) {
    case "postgres":
    case "timescaledb":
    case "neon":
      return "5432";
    case "cockroachdb":
      return "26257";
    case "yugabytedb":
      return "5433";
    case "redshift":
      return "5439";
    case "h2":
      return "5435";
    case "clickhouse":
      return "8123";
    case "snowflake":
    case "bigquery":
    case "cloudSpanner":
    case "athena":
    case "motherduck":
      return "443";
    case "redis":
      return "6379";
    case "cassandra":
    case "scylladb":
      return "9042";
    case "neo4j":
    case "memgraph":
      return "7687";
    case "influxdb":
      return "8086";
    case "qdrant":
      return "6333";
    case "milvus":
      return "19530";
    case "mysql":
    case "mariadb":
      return "3306";
    case "tidb":
      return "4000";
    case "sqlserver":
      return "1433";
    case "mongodb":
      return "27017";
    case "trinoPresto":
      return "8080";
    case "firebird":
      return "3050";
    case "databricks":
    case "dynamodb":
    case "kvStore":
    case "iceberg":
    case "s3Tables":
    case "objectStore":
    case "deltaLake":
    case "hudi":
      return "443";
    case "elasticsearch":
      return "9200";
    case "couchbase":
      return "8091";
    case "arangodb":
      return "8529";
    case "questdb":
      return "8812";
    case "iotdb":
      return "6667";
    case "hive":
      return "10000";
    case "oracle":
      return "1521";
    default:
      return "";
  }
}
