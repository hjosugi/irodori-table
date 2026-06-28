#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "../..");
const defaultExtensionsRoot = resolve(root, "../../irodori-extensions");
const extensionsRoot =
  process.env.IRODORI_EXTENSIONS_ROOT ?? defaultExtensionsRoot;

const index = JSON.parse(
  readFileSync(resolve(root, "docs/extension-marketplace/index.json"), "utf8"),
);
const engines = JSON.parse(readFileSync(resolve(root, "knowledge/engines.json"), "utf8"))
  .engines;
const enginesById = new Map(engines.map((engine) => [engine.id, engine]));
const platforms = [
  "windowsX64",
  "windowsArm64",
  "macosX64",
  "macosArm64",
  "linuxX64",
  "linuxArm64",
];
const linkedDriverEngines = new Set(
  (process.env.IRODORI_CONNECTOR_LINKED_DRIVERS ?? "")
    .split(",")
    .map((engine) => engine.trim())
    .filter(Boolean),
);
const linkDuckDbDrivers = process.env.IRODORI_CONNECTOR_LINK_DUCKDB !== "0";

const sharedMigrationSources = [
  {
    kind: "desktop-db-contract",
    path: "apps/desktop/src-tauri/src/db/connection.rs",
  },
  {
    kind: "desktop-db-contract",
    path: "apps/desktop/src-tauri/src/db/profile.rs",
  },
  {
    kind: "desktop-db-contract",
    path: "apps/desktop/src-tauri/src/db/transport.rs",
  },
  {
    kind: "desktop-db-contract",
    path: "apps/desktop/src-tauri/src/db/query.rs",
  },
  {
    kind: "desktop-db-contract",
    path: "apps/desktop/src-tauri/src/db/meta.rs",
  },
  {
    kind: "desktop-db-contract",
    path: "apps/desktop/src-tauri/src/db/explain.rs",
  },
  {
    kind: "portable-connection-contract",
    path: "crates/irodori-connection/src/lib.rs",
  },
  {
    kind: "portable-connection-contract",
    path: "crates/irodori-connection/src/portable.rs",
  },
  {
    kind: "secure-store-contract",
    path: "crates/irodori-secure-store/src/lib.rs",
  },
  {
    kind: "transport-contract",
    path: "crates/irodori-core/src/lib.rs",
  },
  {
    kind: "transport-runtime",
    path: "crates/irodori-proxy/src/lib.rs",
  },
  {
    kind: "transport-runtime",
    path: "crates/irodori-proxy/src/plan.rs",
  },
  {
    kind: "transport-runtime",
    path: "crates/irodori-proxy/src/resolved.rs",
  },
];

const excludedExtensionIds = new Set(["irodori.kv-store", "irodori.object-store"]);
const entries = index.extensions.filter((entry) => !excludedExtensionIds.has(entry.id));

for (const entry of entries) {
  writeConnectorRepo(entry);
}

console.log(
  `connector-scaffold: wrote ${entries.length} repos in ${extensionsRoot}`,
);

function writeConnectorRepo(entry) {
  const engine = entry.engines?.[0];
  if (!engine) {
    throw new Error(`${entry.id} has no engine`);
  }
  const engineMeta = enginesById.get(engine);
  if (!engineMeta) {
    throw new Error(`${entry.id} references unknown engine ${engine}`);
  }
  const repoName = repositoryName(entry);
  const repoDir = resolve(extensionsRoot, repoName);
  const crateName = repoName.replaceAll("-", "_");
  const connectorId = `${engine}.connector`;
  const moduleId = `${engine}.driver`;
  const label = connectorLabel(entry.name, engineMeta.label);
  const features = connectorFeatures(entry, engineMeta);
  const realDriverLinked =
    linkedDriverEngines.has(engine) || (linkDuckDbDrivers && isDuckDbBackedConnector(engine));
  const visibility = entry.visibility ?? "public";
  const permissions = unique([
    ...(entry.permissions ?? []),
    "connectors",
    "native",
  ]);
  const nativeModule = {
    id: moduleId,
    path: "dist/native",
    platforms,
  };
  const connection = connectionModel(entry, engineMeta);
  const connectorContribution = {
    id: connectorId,
    engine,
    label,
    aliases: unique([
      engine,
      kebabEngine(engine),
      engineMeta.label,
      ...nameAliases(entry.name),
    ]),
    defaultPort: engineMeta.defaultPort,
    wire: engineMeta.wire,
    module: moduleId,
    features,
    connection,
  };
  const adapter = engineMeta.adapter ?? engineMeta.routesThrough ?? null;
  const adapterSource = adapterSourceInfo(adapter);
  const migrationSources = migrationSourceInfo(adapterSource);
  const manifest = {
    $schema: "https://irodori.dev/schemas/irodori.extension.schema.json",
    manifestVersion: 1,
    id: entry.id,
    name: entry.name,
    version: entry.version,
    publisher: entry.publisher,
    description:
      entry.description ??
      `${entry.name} contributes the ${label} database connector through the native connector ABI.`,
    license: entry.license,
    repository: entry.repository,
    apiVersion: entry.apiVersion,
    runtime: "native",
    entry: "dist/native",
    permissions,
    contributes: {
      connectors: [connectorContribution],
    },
    capabilities: {
      nativeModules: [nativeModule],
    },
    dev: {
      watch: ["src", "connector.config.json", "irodori.extension.json"],
    },
  };
  const config = {
    schemaVersion: 1,
    visibility,
    extensionId: entry.id,
    connector: connectorContribution,
    runtime: {
      abi: "irodori.connector.native.v1",
      module: nativeModule,
      crate: crateName,
      entrypoints: [
        "irodori_extension_abi_version",
        "irodori_connector_engine_json",
        "irodori_extension_manifest_json",
        "irodori_connector_config_json",
        "irodori_connector_call_json",
        "irodori_connector_free_buffer",
      ],
      supportedCalls: realDriverLinked
        ? ["health", "describe", "manifest", "config", "connect", "query", "metadata", "close"]
        : ["health", "describe", "manifest", "config"],
      driverLinked: realDriverLinked,
    },
    source: {
      marketplaceId: entry.id,
      repository: entry.repository,
      knowledgeEngineStatus: engineMeta.status,
      adapter,
      adapterSha256: adapterSource?.sha256 ?? null,
      snapshots: migrationSources,
    },
    connection,
  };

  mkdirSync(resolve(repoDir, "src"), { recursive: true });
  mkdirSync(resolve(repoDir, "dist/native"), { recursive: true });
  mkdirSync(resolve(repoDir, "native/source"), { recursive: true });
  mkdirSync(resolve(repoDir, ".cargo"), { recursive: true });
  mkdirSync(resolve(repoDir, ".github/workflows"), { recursive: true });

  writeJson(resolve(repoDir, "irodori.extension.json"), manifest);
  writeJson(resolve(repoDir, "connector.config.json"), config);
  writeText(resolve(repoDir, "Cargo.toml"), cargoToml(repoName, crateName, realDriverLinked));
  writeText(resolve(repoDir, ".cargo/config.toml"), cargoConfig());
  writeText(resolve(repoDir, "src/lib.rs"), rustLib(engine, label, realDriverLinked));
  writeText(
    resolve(repoDir, "README.md"),
    readme(entry, engineMeta, visibility, realDriverLinked, connection),
  );
  writeText(
    resolve(repoDir, "native/source/README.md"),
    sourceReadme(entry, engineMeta, config.source.adapter, config.source.adapterSha256, migrationSources),
  );
  copyAdapterSource(repoDir, adapterSource);
  copyMigrationSources(repoDir, migrationSources);
  writeText(resolve(repoDir, "LICENSE-MIT"), licenseMit());
  writeText(resolve(repoDir, "LICENSE-0BSD"), licenseZeroBsd());
  writeText(resolve(repoDir, "Makefile"), makefile(realDriverLinked));
  writeText(resolve(repoDir, ".gitignore"), gitignore());
  writeText(resolve(repoDir, ".github/workflows/ci.yml"), ciWorkflow(realDriverLinked));
  writeText(resolve(repoDir, "dist/native/.gitkeep"), "");
}

function adapterSourceInfo(adapter) {
  if (!adapter) {
    return null;
  }
  const sourcePath = resolve(root, "apps/desktop/src-tauri/src", adapter);
  if (!existsSync(sourcePath)) {
    return null;
  }
  const bytes = readFileSync(sourcePath);
  return {
    adapter,
    sourcePath,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function migrationSourceInfo(adapterSource) {
  return [
    adapterSource
      ? sourceSnapshot(
          "desktop-db-adapter",
          `apps/desktop/src-tauri/src/${adapterSource.adapter}`,
          `native/source/irodori-table/apps/desktop/src-tauri/src/${adapterSource.adapter}`,
        )
      : null,
    ...sharedMigrationSources.map((source) =>
      sourceSnapshot(
        source.kind,
        source.path,
        `native/source/irodori-table/${source.path}`,
      ),
    ),
  ].filter(Boolean);
}

function sourceSnapshot(kind, path, destination) {
  const sourcePath = resolve(root, path);
  if (!existsSync(sourcePath)) {
    return null;
  }
  const bytes = readFileSync(sourcePath);
  return {
    kind,
    path,
    destination,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function copyAdapterSource(repoDir, adapterSource) {
  if (!adapterSource) {
    return;
  }
  copyFileSync(
    adapterSource.sourcePath,
    resolve(repoDir, "native/source", adapterSource.adapter.split("/").at(-1)),
  );
}

function copyMigrationSources(repoDir, snapshots) {
  for (const snapshot of snapshots) {
    const sourcePath = resolve(root, snapshot.path);
    const destination = resolve(repoDir, snapshot.destination);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(sourcePath, destination);
  }
}

function repositoryName(entry) {
  const fromUrl = entry.repository?.split("/").filter(Boolean).at(-1);
  if (fromUrl) {
    return fromUrl.replace(/\.git$/, "");
  }
  return `irodori-extension-${entry.id.replace(/^irodori\./, "")}`;
}

function connectorLabel(name, fallback) {
  return name.replace(/\s+Connector$/, "") || fallback;
}

function isDuckDbBackedConnector(engine) {
  return engine === "duckdb" || engine === "motherduck";
}

function connectorFeatures(entry, engineMeta) {
  const categories = new Set(entry.categories ?? []);
  const features = ["metadata"];
  if (isSqlLikeConnector(entry, engineMeta)) {
    features.push("sql");
  }
  if (
    ["verified", "wired", "extension"].includes(engineMeta.status) &&
    !categories.has("object-store")
  ) {
    features.push("streaming");
  }
  if (
    ["relational", "analytical", "warehouse", "distributed-sql"].some((family) =>
      String(engineMeta.family ?? "").includes(family),
    )
  ) {
    features.push("explain");
  }
  return unique(features);
}

function isSqlLikeConnector(entry, engineMeta) {
  const categories = new Set(entry.categories ?? []);
  if (
    ["document", "search", "vector", "key-value", "graph", "object-store"].some((category) =>
      categories.has(category),
    )
  ) {
    return false;
  }
  const family = String(engineMeta.family ?? "");
  const wire = String(engineMeta.wire ?? "");
  return (
    family.includes("sql") ||
    family.includes("relational") ||
    family.includes("warehouse") ||
    family.includes("analytical") ||
    family.includes("lakehouse") ||
    ["postgres", "mysql", "sqlite", "sqlserver", "duckdb", "oracle", "clickhouse", "snowflake", "bigquery", "jdbc", "lakehouse", "cloudSpanner"].includes(wire)
  );
}

function connectionModel(entry, engineMeta) {
  const engine = entry.engines[0];
  const authMethods = authMethodsForEngine(engine, engineMeta);
  return {
    schemaVersion: 1,
    inferEnvironmentFrom: ["name", "id", "host", "database", "url"],
    compatibility: {
      addsRequiredProfileFields: false,
      acceptsExistingProfiles: true,
    },
    defaults: {
      engine,
      wire: engineMeta.wire,
      port: engineMeta.defaultPort,
      readOnly: false,
    },
    endpoint: endpointModel(engine, engineMeta),
    profileFields: profileFields(engine, engineMeta),
    authMethods,
    secretPurposes: secretPurposes(authMethods),
    tls: tlsModel(engine, engineMeta),
    transports: transportModes(engine, engineMeta),
    optionNamespaces: optionNamespaces(engine, engineMeta),
    customDriverOptions: true,
  };
}

function endpointModel(engine, engineMeta) {
  if (engine === "duckdb") {
    return {
      modes: ["localFile", "inMemory", "connectionString"],
      defaultPort: 0,
      fields: [
        field("database", "Database file or :memory:", "path", {
          profileField: "database",
        }),
      ],
    };
  }
  if (engine === "motherduck") {
    return {
      modes: ["motherduckService", "localFile", "inMemory", "connectionString"],
      defaultPort: 443,
      fields: [
        field("database", "MotherDuck database or DuckDB file", "string", {
          profileField: "database",
        }),
        field("host", "MotherDuck endpoint", "string", {
          profileField: "host",
          default: "api.motherduck.com",
        }),
      ],
    };
  }
  if (["bigquery", "cloudSpanner"].includes(engine)) {
    return {
      modes: ["cloudResource", "connectionString"],
      defaultPort: engineMeta.defaultPort,
      fields: [
        field("projectId", "Google Cloud project", "string", {
          profileField: "database",
          required: true,
        }),
      ],
    };
  }
  if (engine === "bigtable") {
    return {
      modes: ["cloudResource", "connectionString"],
      defaultPort: 443,
      fields: [
        field("projectId", "Google Cloud project", "string", {
          profileField: "host",
          required: true,
        }),
        field("instanceId", "Bigtable instance", "string", {
          profileField: "database",
          required: true,
        }),
      ],
    };
  }
  if (["athena", "dynamodb", "s3Tables"].includes(engine)) {
    return {
      modes: ["cloudResource", "customEndpoint", "connectionString"],
      defaultPort: 443,
      fields: [
        field("region", "AWS region", "string", {
          option: "region",
          required: true,
        }),
        field("endpoint", "Custom endpoint", "uri", {
          profileField: "host",
        }),
      ],
    };
  }
  if (["iceberg", "deltaLake", "hudi", "hive"].includes(engine)) {
    return {
      modes: ["catalog", "objectStorage", "jdbc", "connectionString"],
      defaultPort: engineMeta.defaultPort,
      fields: [
        field("catalogUri", "Catalog URI", "uri", {
          option: "catalogUri",
        }),
        field("warehouse", "Warehouse path", "string", {
          option: "warehouse",
        }),
      ],
    };
  }
  if (engine === "pinecone") {
    return {
      modes: ["cloudResource", "customEndpoint"],
      defaultPort: 0,
      fields: [
        field("environment", "Pinecone environment or region", "string", {
          option: "environment",
        }),
        field("indexHost", "Index host", "uri", {
          profileField: "host",
        }),
      ],
    };
  }
  return {
    modes: ["hostPort", "connectionString"],
    defaultPort: engineMeta.defaultPort,
    fields: [
      field("host", "Host", "string", {
        profileField: "host",
        required: engineMeta.defaultPort !== 0,
      }),
      field("port", "Port", "number", {
        profileField: "port",
        default: engineMeta.defaultPort,
      }),
      field("database", databaseLabel(engine), "string", {
        profileField: "database",
      }),
    ],
  };
}

function profileFields(engine, engineMeta) {
  const fields = [
    field("id", "Connection ID", "string", { profileField: "id", required: true }),
    field("url", "Connection URL or DSN", "uri", { profileField: "url" }),
    field("user", "User", "string", { profileField: "user" }),
  ];
  if (engineMeta.defaultPort !== 0 || ["duckdb", "motherduck", "pinecone"].includes(engine)) {
    fields.push(...endpointModel(engine, engineMeta).fields);
  }
  fields.push(
    field("readOnly", "Read-only connection", "boolean", {
      profileField: "readOnly",
      default: false,
    }),
    field("options", "Driver options", "map", {
      profileField: "options",
    }),
  );
  return dedupeFields(fields);
}

function databaseLabel(engine) {
  if (["mongodb", "couchbase"].includes(engine)) {
    return "Database or bucket";
  }
  if (["neo4j", "memgraph"].includes(engine)) {
    return "Database";
  }
  if (["redis"].includes(engine)) {
    return "Database index";
  }
  if (["influxdb"].includes(engine)) {
    return "Organization or bucket";
  }
  return "Database";
}

function authMethodsForEngine(engine, engineMeta) {
  const methods = [authNone(), authConnectionString()];
  const add = (...items) => methods.push(...items);
  const wire = engineMeta.wire;

  if (["duckdb"].includes(engine)) {
    add(authToken("extensionCredential", "Extension or remote storage token"));
  } else if (["motherduck"].includes(engine)) {
    add(authToken("motherduckToken", "MotherDuck token"), authOauth2(), authBrowserSso());
  } else if (["bigquery", "bigtable", "cloudSpanner"].includes(engine)) {
    add(
      authToken("oauthAccessToken", "OAuth 2.0 access token"),
      authServiceAccountJson(),
      authPrivateKeyJwt("serviceAccountJwt", "Service account JWT private key"),
      authGoogleAdc(),
      authOauth2(),
      authWorkloadIdentity(),
    );
  } else if (["athena", "dynamodb", "s3Tables"].includes(engine)) {
    add(authAwsSigV4(), authAwsProfile(), authAwsSso(), authWebIdentity(), authToken("sessionToken", "AWS session token"));
  } else if (["iceberg", "deltaLake", "hudi"].includes(engine)) {
    add(
      authAwsSigV4(),
      authAwsProfile(),
      authOauth2(),
      authToken("catalogBearerToken", "Catalog bearer token"),
      authUserPassword("catalogPassword", "Catalog user/password"),
      authServiceAccountJson(),
      authAzureAd(),
      authSasToken(),
    );
  } else if (engine === "snowflake") {
    add(
      authUserPassword(),
      authPrivateKeyJwt("snowflakeKeyPair", "Key-pair JWT"),
      authOauth2(),
      authToken("snowflakeSessionToken", "Session token"),
      authBrowserSso(),
      authSaml(),
      authExternalBrowser(),
    );
  } else if (engine === "databricks") {
    add(
      authToken("personalAccessToken", "Personal access token"),
      authOauth2(),
      authAzureAd(),
      authServicePrincipal(),
      authManagedIdentity(),
      authBrowserSso(),
    );
  } else if (["trinoPresto", "hive"].includes(engine)) {
    add(authUserPassword(), authBasic(), authToken(), authOauth2(), authKerberos(), authLdap(), authClientCertificate());
  } else if (["cassandra", "scylladb"].includes(engine)) {
    add(authUserPassword(), authSaslPlain(), authSaslScram(), authClientCertificate(), authKerberos());
  } else if (engine === "mongodb") {
    add(authUserPassword("scram", "SCRAM user/password"), authClientCertificate("mongodbX509", "X.509 client certificate"), authAwsIam(), authKerberos(), authLdap(), authOauth2("oidc", "OIDC / workload identity"));
  } else if (engine === "sqlserver") {
    add(authUserPassword("sqlPassword", "SQL Server user/password"), authKerberos("windowsIntegrated", "Windows integrated / Kerberos"), authAzureAd(), authServicePrincipal(), authManagedIdentity(), authToken("accessToken", "Access token"));
  } else if (engine === "oracle") {
    add(authUserPassword(), authClientCertificate("oracleWallet", "Oracle wallet / mTLS"), authKerberos(), authToken("cloudIamToken", "Cloud IAM token"));
  } else if (engine === "clickhouse") {
    add(authUserPassword(), authToken("bearerToken", "Bearer token"), authClientCertificate());
  } else if (["neo4j", "memgraph"].includes(engine)) {
    add(authBasic(), authKerberos(), authToken("bearerToken", "Bearer token"), authClientCertificate());
  } else if (engine === "redis") {
    add(authUserPassword("aclUserPassword", "ACL user/password"), authToken("redisToken", "Token"), authClientCertificate());
  } else if (["elasticsearch", "openSearch"].includes(engine)) {
    add(authBasic(), authApiKey(), authToken(), authOauth2(), authClientCertificate());
    if (engine === "openSearch") {
      add(authAwsSigV4());
    }
  } else if (engine === "couchbase") {
    add(authUserPassword(), authClientCertificate(), authLdap(), authSaml(), authOauth2("oidc", "OIDC"));
  } else if (engine === "arangodb") {
    add(authBasic(), authToken("jwt", "JWT bearer token"), authClientCertificate());
  } else if (engine === "firebird") {
    add(authUserPassword("srp", "SRP user/password"), authKerberos(), authToken("pluginToken", "Plugin token"));
  } else if (engine === "questdb") {
    add(authUserPassword(), authToken("restToken", "REST / ILP token"), authClientCertificate());
  } else if (engine === "iotdb") {
    add(authUserPassword(), authToken(), authKerberos(), authClientCertificate());
  } else if (["qdrant", "milvus", "pinecone"].includes(engine)) {
    add(authApiKey(), authToken(), authClientCertificate());
    if (engine === "milvus") {
      add(authUserPassword());
    }
  } else if (wire === "jdbc" || isSqlLikeConnector({ categories: [] }, engineMeta)) {
    add(authUserPassword(), authToken(), authOauth2(), authKerberos(), authClientCertificate());
  } else {
    add(authUserPassword(), authToken(), authApiKey(), authClientCertificate());
  }

  add(authCustom());
  return uniqueBy(methods, (method) => method.id);
}

function authNone() {
  return authMethod("none", "No authentication", "none");
}

function authConnectionString() {
  return authMethod("connectionString", "Connection string / DSN", "connectionString", [], [
    field("url", "Connection URL or DSN", "uri", { profileField: "url", required: true }),
  ]);
}

function authUserPassword(id = "userPassword", label = "User/password") {
  return authMethod(id, label, "userPassword", ["password"], [
    field("user", "User", "string", { profileField: "user" }),
    field("password", "Password", "secret", {
      secretPurpose: "password",
      profileField: "password",
    }),
  ]);
}

function authBasic() {
  return authUserPassword("basic", "Basic authentication");
}

function authToken(id = "bearerToken", label = "Bearer token") {
  return authMethod(id, label, "token", ["token"], [
    field("token", "Token", "secret", { secretPurpose: "token" }),
  ]);
}

function authApiKey(id = "apiKey", label = "API key") {
  return authMethod(id, label, "apiKey", ["token"], [
    field("apiKey", "API key", "secret", { secretPurpose: "token" }),
  ]);
}

function authOauth2(id = "oauth2", label = "OAuth 2.0") {
  return authMethod(id, label, "oauth2", ["token"], [
    field("accessToken", "Access token", "secret", { secretPurpose: "token" }),
    field("refreshToken", "Refresh token", "secret", { secretPurpose: "token" }),
    field("clientId", "Client ID", "string"),
    field("clientSecret", "Client secret", "secret", { secretPurpose: "token" }),
  ]);
}

function authServiceAccountJson() {
  return authMethod("serviceAccountJson", "Service account JSON", "serviceAccount", ["privateKey"], [
    field("serviceAccountJson", "Service account JSON", "json", {
      secretPurpose: "privateKey",
    }),
  ]);
}

function authPrivateKeyJwt(id, label) {
  return authMethod(id, label, "privateKey", ["privateKey", "privateKeyPassphrase"], [
    field("user", "User or client email", "string", { profileField: "user" }),
    field("privateKey", "Private key", "pem", { secretPurpose: "privateKey" }),
    field("privateKeyPassphrase", "Private key passphrase", "secret", {
      secretPurpose: "privateKeyPassphrase",
    }),
  ]);
}

function authGoogleAdc() {
  return authMethod("googleApplicationDefaultCredentials", "Application Default Credentials", "iam");
}

function authWorkloadIdentity() {
  return authMethod("workloadIdentity", "Workload identity federation", "iam", ["token"], [
    field("credentialConfig", "Credential config", "json"),
    field("subjectToken", "Subject token", "secret", { secretPurpose: "token" }),
  ]);
}

function authAwsSigV4() {
  return authMethod("awsSigV4", "AWS SigV4", "iam", ["token"], [
    field("accessKeyId", "Access key ID", "string"),
    field("secretAccessKey", "Secret access key", "secret", { secretPurpose: "token" }),
    field("sessionToken", "Session token", "secret", { secretPurpose: "token" }),
    field("region", "Region", "string", { option: "region" }),
  ]);
}

function authAwsProfile() {
  return authMethod("awsProfile", "AWS shared config profile", "iam", [], [
    field("profile", "Profile", "string", { option: "awsProfile" }),
    field("region", "Region", "string", { option: "region" }),
  ]);
}

function authAwsSso() {
  return authMethod("awsSso", "AWS IAM Identity Center / SSO", "iam", ["token"], [
    field("ssoSession", "SSO session", "string", { option: "ssoSession" }),
    field("region", "Region", "string", { option: "region" }),
  ]);
}

function authWebIdentity() {
  return authMethod("webIdentity", "AWS web identity", "iam", ["token"], [
    field("roleArn", "Role ARN", "string", { option: "roleArn" }),
    field("webIdentityToken", "Web identity token", "secret", { secretPurpose: "token" }),
  ]);
}

function authAwsIam() {
  return authMethod("awsIam", "AWS IAM", "iam", ["token"], [
    field("accessKeyId", "Access key ID", "string"),
    field("secretAccessKey", "Secret access key", "secret", { secretPurpose: "token" }),
    field("sessionToken", "Session token", "secret", { secretPurpose: "token" }),
  ]);
}

function authAzureAd() {
  return authMethod("azureAd", "Azure AD / Entra ID", "azureAd", ["token"], [
    field("tenantId", "Tenant ID", "string"),
    field("clientId", "Client ID", "string"),
    field("clientSecret", "Client secret", "secret", { secretPurpose: "token" }),
    field("accessToken", "Access token", "secret", { secretPurpose: "token" }),
  ]);
}

function authServicePrincipal() {
  return authMethod("servicePrincipal", "Service principal", "oauth2", ["token"], [
    field("clientId", "Client ID", "string"),
    field("clientSecret", "Client secret", "secret", { secretPurpose: "token" }),
    field("tenantId", "Tenant ID", "string"),
  ]);
}

function authManagedIdentity() {
  return authMethod("managedIdentity", "Managed identity", "managedIdentity");
}

function authSasToken() {
  return authMethod("sasToken", "SAS token", "token", ["token"], [
    field("sasToken", "SAS token", "secret", { secretPurpose: "token" }),
  ]);
}

function authBrowserSso() {
  return authMethod("browserSso", "Browser SSO", "browserSso", ["token"]);
}

function authExternalBrowser() {
  return authMethod("externalBrowser", "External browser", "browserSso", ["token"]);
}

function authSaml(id = "saml", label = "SAML SSO") {
  return authMethod(id, label, "saml", ["token"], [
    field("idpUrl", "Identity provider URL", "uri"),
    field("assertion", "SAML assertion", "secret", { secretPurpose: "token" }),
  ]);
}

function authKerberos(id = "kerberos", label = "Kerberos / GSSAPI") {
  return authMethod(id, label, "kerberos", ["token"], [
    field("principal", "Principal", "string"),
    field("keytab", "Keytab", "path", { secretPurpose: "privateKey" }),
  ]);
}

function authLdap() {
  return authUserPassword("ldap", "LDAP user/password");
}

function authSaslPlain() {
  return authUserPassword("saslPlain", "SASL PLAIN");
}

function authSaslScram() {
  return authUserPassword("saslScram", "SASL SCRAM");
}

function authClientCertificate(id = "clientCertificate", label = "Client certificate / mTLS") {
  return authMethod(id, label, "certificate", ["privateKey", "privateKeyPassphrase"], [
    field("clientCertificate", "Client certificate", "pem"),
    field("clientPrivateKey", "Client private key", "pem", {
      secretPurpose: "privateKey",
    }),
    field("clientPrivateKeyPassphrase", "Private key passphrase", "secret", {
      secretPurpose: "privateKeyPassphrase",
    }),
  ]);
}

function authCustom() {
  return authMethod("customDriverOptions", "Custom driver options", "custom", ["password", "token", "privateKey", "privateKeyPassphrase"], [
    field("options", "Driver options", "map", { profileField: "options" }),
  ]);
}

function authMethod(id, label, kind, secretPurposes = [], fields = []) {
  return {
    id,
    label,
    kind,
    secretPurposes: unique(secretPurposes),
    fields: dedupeFields(fields),
  };
}

function tlsModel(engine, engineMeta) {
  const localOnly = ["duckdb"].includes(engine);
  return {
    supported: !localOnly,
    requiredByDefault: engineMeta.defaultPort === 443,
    modes: localOnly
      ? []
      : ["disable", "prefer", "require", "verifyCa", "verifyFull", "clientCertificate"],
    fields: localOnly
      ? []
      : [
          field("caCertificate", "CA certificate", "pem"),
          field("clientCertificate", "Client certificate", "pem"),
          field("clientPrivateKey", "Client private key", "pem", {
            secretPurpose: "privateKey",
          }),
        ],
  };
}

function transportModes(engine, engineMeta) {
  if (engine === "duckdb") {
    return ["localFile", "direct"];
  }
  const modes = ["direct", "sshTunnel", "socks5Proxy", "httpConnectProxy", "proxyChain"];
  if (engineMeta.defaultPort === 0) {
    modes.unshift("customEndpoint");
  }
  return modes;
}

function optionNamespaces(engine, engineMeta) {
  return unique([
    "profile.options",
    "driver",
    "tls",
    "network",
    engineMeta.wire,
    engine,
    ...cloudOptionNamespaces(engine),
  ]);
}

function cloudOptionNamespaces(engine) {
  if (["athena", "dynamodb", "s3Tables", "iceberg", "deltaLake", "hudi"].includes(engine)) {
    return ["aws", "catalog", "objectStorage"];
  }
  if (["bigquery", "bigtable", "cloudSpanner"].includes(engine)) {
    return ["googleCloud", "oauth"];
  }
  if (["databricks"].includes(engine)) {
    return ["databricks", "oauth", "azure"];
  }
  return [];
}

function field(id, label, type, options = {}) {
  return {
    id,
    label,
    type,
    ...options,
  };
}

function dedupeFields(fields) {
  return uniqueBy(fields, (field) => field.id);
}

function uniqueBy(values, keyFn) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const key = keyFn(value);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(value);
  }
  return result;
}

function secretPurposes(authMethods) {
  return unique(authMethods.flatMap((method) => method.secretPurposes ?? []));
}

function nameAliases(name) {
  return name
    .replace(/\s+Connector$/, "")
    .split(/\s*\/\s*|\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function kebabEngine(engine) {
  return engine
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();
}

function writeJson(path, value) {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(path, content) {
  writeFileSync(path, content);
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null))];
}

function cargoToml(packageName, crateName, realDriverLinked) {
  const dependencies = realDriverLinked
    ? `
[features]
default = []
bundled-duckdb = ["duckdb/bundled"]

[dependencies]
duckdb = { version = "1", default-features = false }
serde_json = "1"
`
    : "";
  const devDependencies = realDriverLinked
    ? ""
    : `
[dev-dependencies]
serde_json = "1"
`;
  return `[package]
name = "${packageName}"
version = "0.1.0"
edition = "2021"
license = "MIT OR 0BSD"
description = "Irodori Table native connector extension."
publish = false

[lib]
name = "${crateName}"
crate-type = ["cdylib", "rlib"]
${dependencies}
${devDependencies}
[profile.dev.package."*"]
debug = 0

[profile.release]
lto = "thin"
codegen-units = 1
strip = "symbols"
panic = "abort"
`;
}

function cargoConfig() {
  return `[build]
target-dir = "../target"

[term]
color = "auto"
`;
}

function rustLib(engine, label, realDriverLinked) {
  if (realDriverLinked) {
    return duckDbRustLib(engine, label);
  }
  return `//! Native connector ABI for ${label}.
//!
//! Connector behavior is declared in ../connector.config.json and
//! ../irodori.extension.json so packaging can customize metadata without
//! changing Rust code.

const ABI_VERSION: u32 = 1;
const ENGINE: &str = "${engine}";
const CONFIG_JSON: &str = include_str!("../connector.config.json");
const MANIFEST_JSON: &str = include_str!("../irodori.extension.json");
const HEALTH_RESPONSE_JSON: &str =
    r#"{"ok":true,"engine":"${engine}","abiVersion":1,"driverLinked":false}"#;
const DESCRIBE_RESPONSE_JSON: &str = concat!(
    r#"{"ok":true,"engine":"${engine}","abiVersion":1,"driverLinked":false,"manifest":"#,
    include_str!("../irodori.extension.json"),
    r#","config":"#,
    include_str!("../connector.config.json"),
    r#"}"#
);
const INVALID_REQUEST_RESPONSE_JSON: &str = r#"{"ok":false,"error":{"code":"connector.invalidRequest","message":"Connector request buffer must be empty or valid UTF-8 JSON."}}"#;
const NOT_LINKED_RESPONSE_JSON: &str = r#"{"ok":false,"error":{"code":"connector.driverNotLinked","message":"The native connector metadata is available, but the engine-specific driver entrypoint is not linked in this package yet."}}"#;

#[repr(C)]
#[derive(Clone, Copy)]
pub struct IrodoriConnectorBuffer {
    pub ptr: *const u8,
    pub len: usize,
}

fn static_buffer(value: &'static str) -> IrodoriConnectorBuffer {
    IrodoriConnectorBuffer {
        ptr: value.as_ptr(),
        len: value.len(),
    }
}

fn buffer_to_string(buffer: IrodoriConnectorBuffer) -> Result<String, ()> {
    if buffer.ptr.is_null() {
        return if buffer.len == 0 {
            Ok(String::new())
        } else {
            Err(())
        };
    }
    let bytes = unsafe { std::slice::from_raw_parts(buffer.ptr, buffer.len) };
    std::str::from_utf8(bytes)
        .map(str::to_owned)
        .map_err(|_| ())
}

#[no_mangle]
pub extern "C" fn irodori_extension_abi_version() -> u32 {
    ABI_VERSION
}

#[no_mangle]
pub extern "C" fn irodori_connector_engine_json() -> IrodoriConnectorBuffer {
    static_buffer(ENGINE)
}

#[no_mangle]
pub extern "C" fn irodori_extension_manifest_json() -> IrodoriConnectorBuffer {
    static_buffer(MANIFEST_JSON)
}

#[no_mangle]
pub extern "C" fn irodori_connector_config_json() -> IrodoriConnectorBuffer {
    static_buffer(CONFIG_JSON)
}

#[no_mangle]
pub extern "C" fn irodori_connector_call_json(
    request: IrodoriConnectorBuffer,
) -> IrodoriConnectorBuffer {
    let Ok(request) = buffer_to_string(request) else {
        return static_buffer(INVALID_REQUEST_RESPONSE_JSON);
    };
    if request.trim().is_empty() || request.contains(r#""health""#) || request.contains(r#""ping""#)
    {
        return static_buffer(HEALTH_RESPONSE_JSON);
    }
    if request.contains(r#""describe""#) || request.contains(r#""capabilities""#) {
        return static_buffer(DESCRIBE_RESPONSE_JSON);
    }
    if request.contains(r#""manifest""#) {
        return static_buffer(MANIFEST_JSON);
    }
    if request.contains(r#""config""#) {
        return static_buffer(CONFIG_JSON);
    }
    static_buffer(NOT_LINKED_RESPONSE_JSON)
}

#[no_mangle]
pub extern "C" fn irodori_connector_free_buffer(_buffer: IrodoriConnectorBuffer) {}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn buffer_from_str(value: &'static str) -> IrodoriConnectorBuffer {
        IrodoriConnectorBuffer {
            ptr: value.as_ptr(),
            len: value.len(),
        }
    }

    fn buffer_from_bytes(value: &'static [u8]) -> IrodoriConnectorBuffer {
        IrodoriConnectorBuffer {
            ptr: value.as_ptr(),
            len: value.len(),
        }
    }

    fn buffer_to_json(buffer: IrodoriConnectorBuffer) -> Value {
        let bytes = unsafe { std::slice::from_raw_parts(buffer.ptr, buffer.len) };
        serde_json::from_slice(bytes).unwrap()
    }

    #[test]
    fn manifest_and_config_describe_the_same_connector() {
        let manifest: Value = serde_json::from_str(MANIFEST_JSON).unwrap();
        let config: Value = serde_json::from_str(CONFIG_JSON).unwrap();
        let connector = &manifest["contributes"]["connectors"][0];

        assert_eq!(manifest["id"], config["extensionId"]);
        assert_eq!(connector["engine"], ENGINE);
        assert_eq!(connector["engine"], config["connector"]["engine"]);
        assert_eq!(connector["module"], config["connector"]["module"]);
        assert_eq!(connector["connection"], config["connection"]);
        assert!(config["connection"]["authMethods"]
            .as_array()
            .is_some_and(|methods| !methods.is_empty()));
        assert!(config["connection"]["secretPurposes"].as_array().is_some());
        assert!(manifest["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|permission| permission == "connectors"));
    }

    #[test]
    fn abi_exports_static_json() {
        assert_eq!(irodori_extension_abi_version(), ABI_VERSION);
        assert!(irodori_extension_manifest_json().len > 0);
        assert!(irodori_connector_config_json().len > 0);
        assert_eq!(irodori_connector_engine_json().len, ENGINE.len());
    }

    #[test]
    fn call_json_reports_health_and_describes_metadata() {
        let health = buffer_to_json(irodori_connector_call_json(buffer_from_str(
            r#"{"method":"health"}"#,
        )));
        assert_eq!(health["ok"], true);
        assert_eq!(health["engine"], ENGINE);
        assert_eq!(health["driverLinked"], false);

        let describe = buffer_to_json(irodori_connector_call_json(buffer_from_str(
            r#"{"method":"describe"}"#,
        )));
        assert_eq!(describe["ok"], true);
        assert_eq!(
            describe["manifest"]["id"],
            describe["config"]["extensionId"]
        );
        assert_eq!(describe["config"]["connector"]["engine"], ENGINE);
    }

    #[test]
    fn call_json_rejects_driver_operations_until_linked() {
        let response = buffer_to_json(irodori_connector_call_json(buffer_from_str(
            r#"{"method":"query","sql":"select 1"}"#,
        )));
        assert_eq!(response["ok"], false);
        assert_eq!(response["error"]["code"], "connector.driverNotLinked");
    }

    #[test]
    fn call_json_rejects_invalid_request_buffers() {
        let invalid_utf8 = buffer_to_json(irodori_connector_call_json(buffer_from_bytes(&[
            0xff, 0xfe,
        ])));
        assert_eq!(invalid_utf8["ok"], false);
        assert_eq!(invalid_utf8["error"]["code"], "connector.invalidRequest");

        let invalid_null = buffer_to_json(irodori_connector_call_json(IrodoriConnectorBuffer {
            ptr: std::ptr::null(),
            len: 1,
        }));
        assert_eq!(invalid_null["ok"], false);
        assert_eq!(invalid_null["error"]["code"], "connector.invalidRequest");
    }
}
`;
}

function duckDbRustLib(engine, label) {
  return `//! Native connector ABI for ${label}.
//!
//! This connector links a real DuckDB driver and implements connect/query/
//! metadata/close over the JSON connector ABI.

use std::collections::{BTreeMap, HashMap};
use std::sync::{Mutex, OnceLock};

use serde_json::{json, Value};

const ABI_VERSION: u32 = 1;
const ENGINE: &str = "${engine}";
const CONFIG_JSON: &str = include_str!("../connector.config.json");
const MANIFEST_JSON: &str = include_str!("../irodori.extension.json");

static CONNECTIONS: OnceLock<Mutex<HashMap<String, duckdb::Connection>>> = OnceLock::new();

#[repr(C)]
#[derive(Clone, Copy)]
pub struct IrodoriConnectorBuffer {
    pub ptr: *const u8,
    pub len: usize,
}

#[derive(Default)]
struct ObjectMeta {
    schema: String,
    name: String,
    kind: String,
    columns: Vec<Value>,
}

fn connections() -> &'static Mutex<HashMap<String, duckdb::Connection>> {
    CONNECTIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn owned_buffer(value: String) -> IrodoriConnectorBuffer {
    let mut bytes = value.into_bytes().into_boxed_slice();
    let buffer = IrodoriConnectorBuffer {
        ptr: bytes.as_mut_ptr(),
        len: bytes.len(),
    };
    std::mem::forget(bytes);
    buffer
}

fn json_buffer(value: Value) -> IrodoriConnectorBuffer {
    owned_buffer(value.to_string())
}

fn buffer_to_string(buffer: IrodoriConnectorBuffer) -> Result<String, ()> {
    if buffer.ptr.is_null() {
        return if buffer.len == 0 {
            Ok(String::new())
        } else {
            Err(())
        };
    }
    let bytes = unsafe { std::slice::from_raw_parts(buffer.ptr, buffer.len) };
    std::str::from_utf8(bytes).map(str::to_owned).map_err(|_| ())
}

fn ok(mut payload: serde_json::Map<String, Value>) -> IrodoriConnectorBuffer {
    payload.insert("ok".to_string(), Value::Bool(true));
    json_buffer(Value::Object(payload))
}

fn error(code: &str, message: impl Into<String>) -> IrodoriConnectorBuffer {
    json_buffer(json!({
        "ok": false,
        "error": {
            "code": code,
            "message": message.into()
        }
    }))
}

fn parse_request(buffer: IrodoriConnectorBuffer) -> Result<Option<Value>, IrodoriConnectorBuffer> {
    let request = buffer_to_string(buffer).map_err(|_| {
        error(
            "connector.invalidRequest",
            "Connector request buffer must be empty or valid UTF-8 JSON.",
        )
    })?;
    let trimmed = request.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    serde_json::from_str::<Value>(trimmed).map(Some).map_err(|err| {
        error(
            "connector.invalidJson",
            format!("Connector request must be valid JSON: {err}"),
        )
    })
}

fn request_method(request: Option<&Value>) -> Result<&str, IrodoriConnectorBuffer> {
    match request {
        None => Ok("health"),
        Some(value) => value
            .get("method")
            .and_then(Value::as_str)
            .filter(|method| !method.trim().is_empty())
            .ok_or_else(|| error("connector.invalidRequest", "Connector request needs a string method.")),
    }
}

fn string_field<'a>(value: &'a Value, field: &str) -> Option<&'a str> {
    value.get(field).and_then(Value::as_str).filter(|text| !text.trim().is_empty())
}

fn profile_field<'a>(request: &'a Value, field: &str) -> Option<&'a str> {
    string_field(request, field).or_else(|| {
        request
            .get("profile")
            .and_then(|profile| string_field(profile, field))
    })
}

fn connection_id(request: Option<&Value>) -> String {
    request
        .and_then(|value| {
            string_field(value, "connectionId")
                .or_else(|| string_field(value, "id"))
                .or_else(|| value.get("profile").and_then(|profile| string_field(profile, "id")))
        })
        .unwrap_or("default")
        .trim()
        .to_string()
}

fn max_rows(request: &Value) -> usize {
    request
        .get("maxRows")
        .or_else(|| request.get("limit"))
        .and_then(Value::as_u64)
        .unwrap_or(10_000)
        .clamp(1, 100_000) as usize
}

fn connect(request: &Value) -> IrodoriConnectorBuffer {
    let connection_id = connection_id(Some(request));
    let database = profile_field(request, "database").or_else(|| profile_field(request, "url"));
    let conn = match database.map(str::trim) {
        None | Some("") | Some(":memory:") => duckdb::Connection::open_in_memory(),
        Some(path) => duckdb::Connection::open(path),
    };
    let conn = match conn {
        Ok(conn) => conn,
        Err(err) => return error("connector.connectFailed", format!("connect failed: {err}")),
    };
    let server_version = duckdb_version(&conn).unwrap_or_else(|| "unknown".to_string());
    if should_seed_sample(request, &connection_id) {
        if let Err(err) = seed_sample(&conn) {
            return error("connector.seedFailed", err);
        }
    }
    let mut guard = match connections().lock() {
        Ok(guard) => guard,
        Err(_) => return error("connector.statePoisoned", "Connector connection state is poisoned."),
    };
    guard.insert(connection_id.clone(), conn);
    ok(serde_json::Map::from_iter([
        ("engine".to_string(), Value::String(ENGINE.to_string())),
        ("connectionId".to_string(), Value::String(connection_id)),
        ("serverVersion".to_string(), Value::String(server_version)),
        ("driverLinked".to_string(), Value::Bool(true)),
    ]))
}

fn query(request: &Value) -> IrodoriConnectorBuffer {
    let connection_id = connection_id(Some(request));
    let Some(sql) = string_field(request, "sql") else {
        return error("connector.invalidRequest", "query requires a string sql field.");
    };
    let mut guard = match connections().lock() {
        Ok(guard) => guard,
        Err(_) => return error("connector.statePoisoned", "Connector connection state is poisoned."),
    };
    let Some(conn) = guard.get_mut(&connection_id) else {
        return error(
            "connector.connectionNotFound",
            format!("no open connection: {connection_id}"),
        );
    };
    match run_query(conn, sql, max_rows(request)) {
        Ok((columns, rows, truncated)) => ok(serde_json::Map::from_iter([
            ("connectionId".to_string(), Value::String(connection_id)),
            ("columns".to_string(), Value::Array(columns.into_iter().map(Value::String).collect())),
            (
                "rows".to_string(),
                Value::Array(
                    rows.into_iter()
                        .map(|row| Value::Array(row.into_iter().collect()))
                        .collect(),
                ),
            ),
            ("truncated".to_string(), Value::Bool(truncated)),
        ])),
        Err(err) => error("connector.queryFailed", err),
    }
}

fn metadata(request: &Value) -> IrodoriConnectorBuffer {
    let connection_id = connection_id(Some(request));
    let mut guard = match connections().lock() {
        Ok(guard) => guard,
        Err(_) => return error("connector.statePoisoned", "Connector connection state is poisoned."),
    };
    let Some(conn) = guard.get_mut(&connection_id) else {
        return error(
            "connector.connectionNotFound",
            format!("no open connection: {connection_id}"),
        );
    };
    match load_metadata(conn) {
        Ok(metadata) => ok(serde_json::Map::from_iter([
            ("connectionId".to_string(), Value::String(connection_id)),
            ("metadata".to_string(), metadata),
        ])),
        Err(err) => error("connector.metadataFailed", err),
    }
}

fn close(request: &Value) -> IrodoriConnectorBuffer {
    let connection_id = connection_id(Some(request));
    let mut guard = match connections().lock() {
        Ok(guard) => guard,
        Err(_) => return error("connector.statePoisoned", "Connector connection state is poisoned."),
    };
    let existed = guard.remove(&connection_id).is_some();
    ok(serde_json::Map::from_iter([
        ("connectionId".to_string(), Value::String(connection_id)),
        ("closed".to_string(), Value::Bool(existed)),
    ]))
}

fn duckdb_version(conn: &duckdb::Connection) -> Option<String> {
    conn.query_row("select version()", [], |row| row.get::<_, String>(0)).ok()
}

fn should_seed_sample(request: &Value, connection_id: &str) -> bool {
    request
        .get("seedSample")
        .or_else(|| request.get("profile").and_then(|profile| profile.get("seedSample")))
        .and_then(Value::as_bool)
        .unwrap_or(matches!(connection_id, "duckdb-memory" | "motherduck-memory"))
}

fn seed_sample(conn: &duckdb::Connection) -> Result<(), String> {
    conn.execute_batch(
        "create table if not exists customers (id integer, name varchar);",
    )
    .map_err(|err| format!("duckdb sample schema failed: {err}"))?;
    let existing = conn
        .query_row("select count(*) from customers", [], |row| row.get::<_, i64>(0))
        .unwrap_or(0);
    if existing == 0 {
        conn.execute_batch("insert into customers values (1, 'Kawase Foods'), (2, 'Minato Labs');")
            .map_err(|err| format!("duckdb sample data failed: {err}"))?;
    }
    Ok(())
}

fn run_query(
    conn: &duckdb::Connection,
    sql: &str,
    cap: usize,
) -> Result<(Vec<String>, Vec<Vec<Value>>, bool), String> {
    let lead = sql.trim_start().to_ascii_lowercase();
    let is_query = [
        "select", "with", "show", "pragma", "explain", "describe", "values", "table", "call",
    ]
    .iter()
    .any(|keyword| lead.starts_with(keyword));
    if !is_query {
        conn.execute(sql, [])
            .map_err(|err| format!("query failed: {err}"))?;
        return Ok((Vec::new(), Vec::new(), false));
    }

    let mut stmt = conn
        .prepare(sql)
        .map_err(|err| format!("query failed: {err}"))?;
    let mut duck_rows = stmt.query([]).map_err(|err| format!("query failed: {err}"))?;
    let columns: Vec<String> = match duck_rows.as_ref() {
        Some(stmt) => stmt.column_names().iter().map(|column| column.to_string()).collect(),
        None => Vec::new(),
    };
    let column_count = columns.len();
    let mut rows = Vec::new();
    let mut truncated = false;
    while let Some(row) = duck_rows.next().map_err(|err| format!("query failed: {err}"))? {
        if rows.len() >= cap {
            truncated = true;
            break;
        }
        rows.push((0..column_count).map(|index| cell_to_json(row, index)).collect());
    }
    Ok((columns, rows, truncated))
}

fn load_metadata(conn: &duckdb::Connection) -> Result<Value, String> {
    let mut objects: BTreeMap<(String, String), ObjectMeta> = BTreeMap::new();
    let mut stmt = conn
        .prepare(
            "select table_schema, table_name, table_type \
             from information_schema.tables \
             where table_schema not in ('information_schema', 'pg_catalog') \
             order by table_schema, table_name",
        )
        .map_err(|err| format!("metadata objects failed: {err}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|err| format!("metadata objects failed: {err}"))?;
    for row in rows {
        let (schema, name, table_type) = row.map_err(|err| format!("metadata objects failed: {err}"))?;
        let kind = if table_type.eq_ignore_ascii_case("VIEW") { "view" } else { "table" };
        objects.insert(
            (schema.clone(), name.clone()),
            ObjectMeta {
                schema,
                name,
                kind: kind.to_string(),
                columns: Vec::new(),
            },
        );
    }

    let mut stmt = conn
        .prepare(
            "select table_schema, table_name, column_name, data_type, is_nullable, ordinal_position \
             from information_schema.columns \
             where table_schema not in ('information_schema', 'pg_catalog') \
             order by table_schema, table_name, ordinal_position",
        )
        .map_err(|err| format!("metadata columns failed: {err}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i32>(5)?,
            ))
        })
        .map_err(|err| format!("metadata columns failed: {err}"))?;
    for row in rows {
        let (schema, table, name, data_type, nullable, ordinal) =
            row.map_err(|err| format!("metadata columns failed: {err}"))?;
        if let Some(object) = objects.get_mut(&(schema, table)) {
            object.columns.push(json!({
                "name": name,
                "dataType": data_type,
                "nullable": nullable.eq_ignore_ascii_case("YES"),
                "ordinal": ordinal
            }));
        }
    }

    let mut schemas: BTreeMap<String, Vec<Value>> = BTreeMap::new();
    for object in objects.into_values() {
        schemas.entry(object.schema.clone()).or_default().push(json!({
            "schema": object.schema,
            "name": object.name,
            "kind": object.kind,
            "columns": object.columns
        }));
    }
    Ok(json!({
        "schemas": schemas
            .into_iter()
            .map(|(name, objects)| json!({ "name": name, "objects": objects }))
            .collect::<Vec<_>>()
    }))
}

fn cell_to_json(row: &duckdb::Row, index: usize) -> Value {
    use duckdb::types::Value as DuckValue;
    match row.get::<usize, DuckValue>(index) {
        Ok(DuckValue::Null) => Value::Null,
        Ok(DuckValue::Boolean(value)) => Value::Bool(value),
        Ok(DuckValue::TinyInt(value)) => json!(value),
        Ok(DuckValue::SmallInt(value)) => json!(value),
        Ok(DuckValue::Int(value)) => json!(value),
        Ok(DuckValue::BigInt(value)) => json!(value),
        Ok(DuckValue::UTinyInt(value)) => json!(value),
        Ok(DuckValue::USmallInt(value)) => json!(value),
        Ok(DuckValue::UInt(value)) => json!(value),
        Ok(DuckValue::UBigInt(value)) => json!(value),
        Ok(DuckValue::Float(value)) => json!(value as f64),
        Ok(DuckValue::Double(value)) => json!(value),
        Ok(DuckValue::Text(value)) => Value::String(value),
        Ok(DuckValue::Blob(value)) => Value::String(format!("\\\\x{}", hex_encode(&value))),
        Ok(other) => Value::String(format!("{other:?}")),
        Err(_) => Value::Null,
    }
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push_str(&format!("{byte:02x}"));
    }
    output
}

#[no_mangle]
pub extern "C" fn irodori_extension_abi_version() -> u32 {
    ABI_VERSION
}

#[no_mangle]
pub extern "C" fn irodori_connector_engine_json() -> IrodoriConnectorBuffer {
    owned_buffer(ENGINE.to_string())
}

#[no_mangle]
pub extern "C" fn irodori_extension_manifest_json() -> IrodoriConnectorBuffer {
    owned_buffer(MANIFEST_JSON.to_string())
}

#[no_mangle]
pub extern "C" fn irodori_connector_config_json() -> IrodoriConnectorBuffer {
    owned_buffer(CONFIG_JSON.to_string())
}

#[no_mangle]
pub extern "C" fn irodori_connector_call_json(
    request: IrodoriConnectorBuffer,
) -> IrodoriConnectorBuffer {
    let request = match parse_request(request) {
        Ok(request) => request,
        Err(response) => return response,
    };
    let method = match request_method(request.as_ref()) {
        Ok(method) => method,
        Err(response) => return response,
    };
    match method {
        "health" | "ping" => ok(serde_json::Map::from_iter([
            ("engine".to_string(), Value::String(ENGINE.to_string())),
            ("abiVersion".to_string(), json!(ABI_VERSION)),
            ("driverLinked".to_string(), Value::Bool(true)),
        ])),
        "describe" | "capabilities" => ok(serde_json::Map::from_iter([
            ("engine".to_string(), Value::String(ENGINE.to_string())),
            ("abiVersion".to_string(), json!(ABI_VERSION)),
            ("driverLinked".to_string(), Value::Bool(true)),
            ("manifest".to_string(), serde_json::from_str(MANIFEST_JSON).unwrap_or(Value::Null)),
            ("config".to_string(), serde_json::from_str(CONFIG_JSON).unwrap_or(Value::Null)),
        ])),
        "manifest" => owned_buffer(MANIFEST_JSON.to_string()),
        "config" => owned_buffer(CONFIG_JSON.to_string()),
        "connect" => connect(request.as_ref().expect("connect has request")),
        "query" => query(request.as_ref().expect("query has request")),
        "metadata" => metadata(request.as_ref().expect("metadata has request")),
        "close" => close(request.as_ref().expect("close has request")),
        other => error("connector.unknownMethod", format!("unknown connector method: {other}")),
    }
}

#[no_mangle]
pub extern "C" fn irodori_connector_free_buffer(buffer: IrodoriConnectorBuffer) {
    if buffer.ptr.is_null() {
        return;
    }
    unsafe {
        let slice = std::ptr::slice_from_raw_parts_mut(buffer.ptr as *mut u8, buffer.len);
        drop(Box::from_raw(slice));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn buffer_from_str(value: &'static str) -> IrodoriConnectorBuffer {
        IrodoriConnectorBuffer {
            ptr: value.as_ptr(),
            len: value.len(),
        }
    }

    fn buffer_from_bytes(value: &'static [u8]) -> IrodoriConnectorBuffer {
        IrodoriConnectorBuffer {
            ptr: value.as_ptr(),
            len: value.len(),
        }
    }

    fn buffer_to_json(buffer: IrodoriConnectorBuffer) -> Value {
        let bytes = unsafe { std::slice::from_raw_parts(buffer.ptr, buffer.len) };
        let value = serde_json::from_slice(bytes).unwrap();
        irodori_connector_free_buffer(buffer);
        value
    }

    fn call(request: &'static str) -> Value {
        buffer_to_json(irodori_connector_call_json(buffer_from_str(request)))
    }

    #[test]
    fn manifest_and_config_describe_the_same_connector() {
        let manifest: Value = serde_json::from_str(MANIFEST_JSON).unwrap();
        let config: Value = serde_json::from_str(CONFIG_JSON).unwrap();
        let connector = &manifest["contributes"]["connectors"][0];

        assert_eq!(manifest["id"], config["extensionId"]);
        assert_eq!(connector["engine"], ENGINE);
        assert_eq!(connector["engine"], config["connector"]["engine"]);
        assert_eq!(connector["module"], config["connector"]["module"]);
        assert_eq!(connector["connection"], config["connection"]);
        assert!(config["connection"]["authMethods"]
            .as_array()
            .is_some_and(|methods| !methods.is_empty()));
        assert!(config["connection"]["secretPurposes"]
            .as_array()
            .is_some_and(|purposes| !purposes.is_empty()));
        assert_eq!(config["runtime"]["driverLinked"], true);
        assert!(manifest["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|permission| permission == "connectors"));
    }

    #[test]
    fn call_json_reports_health_and_describes_metadata() {
        let health = call(r#"{"method":"health"}"#);
        assert_eq!(health["ok"], true);
        assert_eq!(health["engine"], ENGINE);
        assert_eq!(health["driverLinked"], true);

        let describe = call(r#"{"method":"describe"}"#);
        assert_eq!(describe["ok"], true);
        assert_eq!(describe["manifest"]["id"], describe["config"]["extensionId"]);
        assert_eq!(describe["config"]["connector"]["engine"], ENGINE);
    }

    #[test]
    fn connect_query_metadata_and_close_use_real_duckdb_driver() {
        let connected = call(r#"{"method":"connect","connectionId":"test","database":":memory:"}"#);
        assert_eq!(connected["ok"], true);
        assert_eq!(connected["driverLinked"], true);

        assert_eq!(
            call(r#"{"method":"query","connectionId":"test","sql":"create table numbers (n integer, label varchar)"}"#)["ok"],
            true
        );
        assert_eq!(
            call(r#"{"method":"query","connectionId":"test","sql":"insert into numbers values (1, 'one'), (2, 'two')"}"#)["ok"],
            true
        );
        let result = call(r#"{"method":"query","connectionId":"test","sql":"select n, label from numbers order by n","maxRows":10}"#);
        assert_eq!(result["ok"], true);
        assert_eq!(result["columns"], json!(["n", "label"]));
        assert_eq!(result["rows"], json!([[1, "one"], [2, "two"]]));

        let metadata = call(r#"{"method":"metadata","connectionId":"test"}"#);
        assert_eq!(metadata["ok"], true);
        let schemas = metadata["metadata"]["schemas"].as_array().unwrap();
        assert!(schemas.iter().any(|schema| schema["objects"]
            .as_array()
            .unwrap()
            .iter()
            .any(|object| object["name"] == "numbers")));

        assert_eq!(call(r#"{"method":"close","connectionId":"test"}"#)["closed"], true);
        let missing = call(r#"{"method":"query","connectionId":"test","sql":"select 1"}"#);
        assert_eq!(missing["ok"], false);
        assert_eq!(missing["error"]["code"], "connector.connectionNotFound");
    }

    #[test]
    fn query_reports_driver_errors() {
        let _ = call(r#"{"method":"connect","connectionId":"errors","database":":memory:"}"#);
        let response = call(r#"{"method":"query","connectionId":"errors","sql":"select * from missing_table"}"#);
        assert_eq!(response["ok"], false);
        assert_eq!(response["error"]["code"], "connector.queryFailed");
    }

    #[test]
    fn call_json_rejects_invalid_request_buffers() {
        let invalid_utf8 = buffer_to_json(irodori_connector_call_json(buffer_from_bytes(&[
            0xff, 0xfe,
        ])));
        assert_eq!(invalid_utf8["ok"], false);
        assert_eq!(invalid_utf8["error"]["code"], "connector.invalidRequest");

        let invalid_json = call("{");
        assert_eq!(invalid_json["ok"], false);
        assert_eq!(invalid_json["error"]["code"], "connector.invalidJson");

        let invalid_null = buffer_to_json(irodori_connector_call_json(IrodoriConnectorBuffer {
            ptr: std::ptr::null(),
            len: 1,
        }));
        assert_eq!(invalid_null["ok"], false);
        assert_eq!(invalid_null["error"]["code"], "connector.invalidRequest");
    }
}
`;
}

function readme(entry, engineMeta, visibility, realDriverLinked, connection) {
  const publicNote =
    visibility === "public"
      ? "This connector is listed in the public Irodori extension marketplace."
      : "This connector is internal and intentionally omitted from the public Irodori extension marketplace.";
  const adapter = engineMeta.adapter ?? engineMeta.routesThrough ?? null;
  const sourceNote = adapter
    ? `A desktop adapter source snapshot is staged in \`native/source/\` from \`${adapter}\`.`
    : "No desktop adapter source exists yet; this package starts from the ABI shim and connector metadata.";
  const driverNote = realDriverLinked
    ? "The Rust code links a DuckDB-compatible driver and handles `connect`, `query`, `metadata`, and `close` through the native JSON ABI."
    : "The Rust code exports the native ABI plus self-description calls. Engine-specific connect/query/metadata behavior should be linked behind `irodori_connector_call_json`.";
  const callRows = realDriverLinked
    ? `| \`connect\` | Opens an in-memory/local DuckDB-compatible connection. |
| \`query\` | Runs SQL and returns columns, rows, and truncation status. |
| \`metadata\` | Returns schema/table/column metadata. |
| \`close\` | Closes the named connector connection. |`
    : "";
  const driverOperationNote = realDriverLinked
    ? "Driver operations return structured connector errors for invalid requests, missing connections, and backend failures."
    : "Driver operations such as `connect`, `query`, and `metadata` intentionally return `connector.driverNotLinked` until the engine implementation is connected.";
  const localBuildNote = realDriverLinked
    ? `
DuckDB-linked builds share \`../target\` across sibling extension repositories. Normal \`make check\` does not enable \`bundled-duckdb\`; run \`make check-duckdb-bundled\` only when a self-contained DuckDB binary is required, because it compiles libduckdb C++ and can consume significant CPU.
`
    : `
Generated extension repositories share \`../target\` across sibling repositories so Rust dependencies are compiled once per checkout. Driver-linked DuckDB scaffolds are opt-in: run the scaffold with \`IRODORI_CONNECTOR_LINK_DUCKDB=1\` or \`IRODORI_CONNECTOR_LINKED_DRIVERS=duckdb,motherduck\` only when you need the local DuckDB driver.
`;
  const authRows = connection.authMethods
    .map(
      (method) =>
        `| \`${method.id}\` | ${method.label} | ${
          method.secretPurposes.length > 0 ? method.secretPurposes.map((purpose) => `\`${purpose}\``).join(", ") : "none"
        } |`,
    )
    .join("\n");
  const transportList = connection.transports.map((transport) => `\`${transport}\``).join(", ");
  const endpointList = connection.endpoint.modes.map((mode) => `\`${mode}\``).join(", ");
  return `# ${entry.name}

${entry.summary}

${publicNote}

## Connector

- Extension ID: \`${entry.id}\`
- Engine ID: \`${entry.engines[0]}\`
- Wire: \`${engineMeta.wire}\`
- Default port: \`${engineMeta.defaultPort}\`
- Native ABI: \`irodori.connector.native.v1\`
- Driver linked: \`${realDriverLinked}\`

${sourceNote}

Connector metadata lives in \`connector.config.json\` and \`irodori.extension.json\`.
${driverNote}

## Connection Metadata

- Endpoint modes: ${endpointList}
- Transport modes: ${transportList}
- TLS supported: \`${connection.tls.supported}\`
- Custom driver options: \`${connection.customDriverOptions}\`

| Auth method | Label | Secret purposes |
|---|---|---|
${authRows}

## ABI Calls

The scaffold handles these JSON requests today:

| Method | Response |
|---|---|
| \`health\` / \`ping\` | Connector health, engine id, ABI version, and driver link status. |
| \`describe\` / \`capabilities\` | Embedded manifest and connector config. |
| \`manifest\` | Raw \`irodori.extension.json\`. |
| \`config\` | Raw \`connector.config.json\`. |
${callRows}

${driverOperationNote}

## Development

${localBuildNote}

\`\`\`sh
make check
make build
\`\`\`

Release packages place platform-specific native artifacts under \`dist/native\`.
`;
}

function sourceReadme(entry, engineMeta, adapter, adapterSha256, migrationSources) {
  const sourceNote = adapter
    ? `The initial source snapshot was copied from \`${adapter}\` in the desktop app.`
    : "There is no existing desktop adapter source for this connector yet.";
  const shaNote = adapterSha256 ? `\nSource SHA-256: \`${adapterSha256}\`.\n` : "\n";
  const migrationRows = migrationSources
    .map(
      (source) =>
        `| \`${source.kind}\` | \`${source.path}\` | \`${source.destination}\` | \`${source.sha256}\` |`,
    )
    .join("\n");
  return `# Native Source

${sourceNote}
${shaNote}

This directory is a migration staging area for \`${entry.id}\`. The active native
ABI shim lives in \`src/lib.rs\`; engine-specific connect/query/metadata behavior
should move here as the connector runtime contract is wired into the desktop app.

## Migration Snapshots

| Kind | Source | Destination | SHA-256 |
|---|---|---|---|
${migrationRows}

Engine status from \`knowledge/engines.json\`: \`${engineMeta.status}\`.
`;
}

function makefile(realDriverLinked) {
  const lintCommand = realDriverLinked
    ? "$(CARGO) clippy --all-targets --no-default-features -- -D warnings"
    : "$(CARGO) clippy --all-targets -- -D warnings";
  const testCommand = realDriverLinked
    ? "$(CARGO) check --tests --no-default-features"
    : "$(CARGO) test";
  const duckDbCheckTarget = realDriverLinked
    ? `
check-duckdb-bundled: fmt
\t$(CARGO) clippy --all-targets --features bundled-duckdb -- -D warnings
\t$(CARGO) test --features bundled-duckdb
`
    : "";
  const phonyTargets = realDriverLinked
    ? "build check check-duckdb-bundled fmt lint test package clean"
    : "build check fmt lint test package clean";
  return `CARGO ?= cargo
CARGO_TARGET_DIR ?= ../target
CARGO_BUILD_JOBS ?= 2
export CARGO_TARGET_DIR
export CARGO_BUILD_JOBS

.PHONY: ${phonyTargets}

check: fmt lint test
${duckDbCheckTarget}

fmt:
\t$(CARGO) fmt --check

lint:
\t${lintCommand}

build:
\t$(CARGO) build --release

test:
\t${testCommand}

package: build
\tmkdir -p dist/native
\tcp $(CARGO_TARGET_DIR)/release/libirodori_extension_* dist/native/ 2>/dev/null || true
\tcp $(CARGO_TARGET_DIR)/release/irodori_extension_*.dll dist/native/ 2>/dev/null || true
\tcp $(CARGO_TARGET_DIR)/release/libirodori_extension_*.dylib dist/native/ 2>/dev/null || true

clean:
\t$(CARGO) clean
`;
}

function gitignore() {
  return `/target
/.irodori-dev
dist/native/*
!dist/native/.gitkeep
`;
}

function ciWorkflow(realDriverLinked) {
  const clippyCommand = realDriverLinked
    ? "cargo clippy --all-targets --features bundled-duckdb -- -D warnings"
    : "cargo clippy --all-targets -- -D warnings";
  const testCommand = realDriverLinked
    ? "cargo test --features bundled-duckdb"
    : "cargo test";
  return `name: CI

on:
  push:
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    env:
      CARGO_BUILD_JOBS: "2"
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: rustfmt, clippy
      - uses: Swatinem/rust-cache@v2
      - run: cargo fmt --check
      - run: ${clippyCommand}
      - run: ${testCommand}
`;
}

function licenseMit() {
  return `MIT License

Copyright (c) Irodori contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;
}

function licenseZeroBsd() {
  return `BSD Zero Clause License

Copyright (c) Irodori contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
`;
}
