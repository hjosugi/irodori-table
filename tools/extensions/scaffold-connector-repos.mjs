#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "../..");
const defaultExtensionsRoot = resolve(root, "../../irodori-extensions");
const extensionsRoot =
  process.env.IRODORI_EXTENSIONS_ROOT ?? defaultExtensionsRoot;
const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printHelp();
  process.exit(0);
}

const index = JSON.parse(
  readFileSync(resolve(root, "registry/catalog/index.json"), "utf8"),
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
const supportedLinkedDriverEngines = new Set(["duckdb", "motherduck"]);
const unsupportedLinkedDriverEngines = [...linkedDriverEngines].filter(
  (engine) => !supportedLinkedDriverEngines.has(engine),
);
if (unsupportedLinkedDriverEngines.length > 0) {
  throw new Error(
    `IRODORI_CONNECTOR_LINKED_DRIVERS includes unsupported generated drivers: ${unsupportedLinkedDriverEngines.join(
      ", ",
    )}. Supported generated drivers are duckdb and motherduck.`,
  );
}
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
    path: "../irodori-kit/irodori-connection/src/lib.rs",
  },
  {
    kind: "portable-connection-contract",
    path: "../irodori-kit/irodori-connection/src/portable.rs",
  },
  {
    kind: "secure-store-contract",
    path: "../irodori-kit/irodori-secure-store/src/lib.rs",
  },
  {
    kind: "transport-contract",
    path: "../irodori-kit/irodori-core/src/lib.rs",
  },
  {
    kind: "transport-runtime",
    path: "../irodori-kit/irodori-proxy/src/lib.rs",
  },
  {
    kind: "transport-runtime",
    path: "../irodori-kit/irodori-proxy/src/plan.rs",
  },
  {
    kind: "transport-runtime",
    path: "../irodori-kit/irodori-proxy/src/resolved.rs",
  },
];

const excludedExtensionIds = new Set();
const entries = index.extensions.filter((entry) => !excludedExtensionIds.has(entry.id));
const summary = {
  skipped: 0,
  written: 0,
};

for (const entry of entries) {
  summary[writeConnectorRepo(entry)] += 1;
}

const writeVerb = options.dryRun ? "would write" : "wrote";
const skipPhrase =
  summary.skipped > 0 ? `, skipped ${summary.skipped} implemented repos` : "";
console.log(
  `connector-scaffold: ${writeVerb} ${summary.written} repos${skipPhrase} in ${extensionsRoot}`,
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
  const implementedMarkers = implementedRepoMarkers(repoDir);
  if (implementedMarkers.length > 0 && !options.force) {
    const skipVerb = options.dryRun ? "would skip" : "skipped";
    console.log(
      `connector-scaffold: ${skipVerb} implemented repo ${repoName} (${implementedMarkers.join(
        ", ",
      )})`,
    );
    return "skipped";
  }
  if (implementedMarkers.length > 0 && options.force) {
    const forceVerb = options.dryRun ? "would rewrite" : "rewriting";
    console.log(
      `connector-scaffold: ${forceVerb} implemented repo ${repoName} because --force is set (${implementedMarkers.join(
        ", ",
      )})`,
    );
  } else if (options.dryRun) {
    console.log(`connector-scaffold: would write ${repoName}`);
  }
  const crateName = repoName.replaceAll("-", "_");
  const connectorId = `${engine}.connector`;
  const moduleId = `${engine}.driver`;
  const label = connectorLabel(entry.name, engineMeta.label);
  const features = connectorFeatures(entry, engineMeta);
  const dialectDefinition = connectorSqlDialectDefinition(entry, engineMeta);
  const dialectContribution = dialectDefinition
    ? {
        id: dialectDefinition.id,
        name: dialectDefinition.name,
        path: `dialects/${kebabEngine(engine)}.json`,
        fileExtensions: [".sql", ".sfsql"],
      }
    : null;
  const realDriverLinked =
    isDuckDbBackedConnector(engine) && (linkDuckDbDrivers || linkedDriverEngines.has(engine));
  const visibility = entry.visibility ?? "public";
  const permissions = unique([
    ...(entry.permissions ?? []),
    "connectors",
    "native",
    ...(dialectContribution ? ["sqlDialects"] : []),
  ]);
  const nativeModule = {
    id: moduleId,
    path: "dist/native",
    platforms,
  };
  const connection = connectionModel(entry, engineMeta);
  const experience = connectorExperience(entry, engineMeta);
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
    ...(dialectContribution ? { dialect: dialectContribution.id } : {}),
    features,
    connection,
    ...(experience ? { experience } : {}),
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
      ...(dialectContribution ? { sqlDialects: [dialectContribution] } : {}),
      connectors: [connectorContribution],
    },
    capabilities: {
      nativeModules: [nativeModule],
    },
    dev: {
      watch: unique([
        "src",
        "connector.config.json",
        "irodori.extension.json",
        ...(dialectContribution ? ["dialects"] : []),
      ]),
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
    ...(dialectDefinition ? { dialect: dialectDefinition } : {}),
    ...(experience ? { experience } : {}),
  };

  ensureDir(resolve(repoDir, "src"));
  ensureDir(resolve(repoDir, "dist/native"));
  ensureDir(resolve(repoDir, "native/source"));
  ensureDir(resolve(repoDir, ".cargo"));
  ensureDir(resolve(repoDir, ".github/workflows"));
  if (dialectContribution) {
    ensureDir(resolve(repoDir, "dialects"));
  }

  writeJson(resolve(repoDir, "irodori.extension.json"), manifest);
  writeJson(resolve(repoDir, "connector.config.json"), config);
  if (dialectContribution) {
    writeJson(resolve(repoDir, dialectContribution.path), dialectDefinition);
  }
  writeText(resolve(repoDir, "Cargo.toml"), cargoToml(repoName, crateName, realDriverLinked));
  writeText(resolve(repoDir, ".cargo/config.toml"), cargoConfig());
  writeRustSources(repoDir, engine, label, realDriverLinked);
  writeText(
    resolve(repoDir, "README.md"),
    readme(entry, engineMeta, visibility, realDriverLinked, connection, experience, dialectDefinition),
  );
  writeText(
    resolve(repoDir, "native/source/README.md"),
    sourceReadme(entry, engineMeta, config.source.adapter, config.source.adapterSha256, migrationSources),
  );
  copyAdapterSource(repoDir, adapterSource);
  copyMigrationSources(repoDir, migrationSources);
  writeText(resolve(repoDir, "LICENSE-MIT"), licenseMit());
  writeText(resolve(repoDir, "LICENSE-0BSD"), licenseZeroBsd());
  writeText(resolve(repoDir, "Makefile"), makefile(repoName, crateName, realDriverLinked));
  writeText(resolve(repoDir, ".gitignore"), gitignore());
  writeText(resolve(repoDir, ".github/workflows/ci.yml"), ciWorkflow(realDriverLinked));
  writeText(resolve(repoDir, "dist/native/.gitkeep"), "");
  formatRustSources(repoDir);
  return "written";
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
  copyFile(
    adapterSource.sourcePath,
    resolve(repoDir, "native/source", adapterSource.adapter.split("/").at(-1)),
  );
}

function copyMigrationSources(repoDir, snapshots) {
  for (const snapshot of snapshots) {
    const sourcePath = resolve(root, snapshot.path);
    const destination = resolve(repoDir, snapshot.destination);
    ensureDir(dirname(destination));
    copyFile(sourcePath, destination);
  }
}

function implementedRepoMarkers(repoDir) {
  return [
    ["connector.source.json", resolve(repoDir, "connector.source.json")],
    ["src/driver.rs", resolve(repoDir, "src/driver.rs")],
  ]
    .filter(([, path]) => existsSync(path))
    .map(([label]) => label);
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
  const engine = entry.engines[0];
  const features = ["metadata"];
  if (isSqlLikeConnector(entry, engineMeta)) {
    features.push("sql");
  }
  if (["verified", "wired", "extension"].includes(engineMeta.status)) {
    features.push("streaming");
  }
  if (
    ["relational", "analytical", "warehouse", "distributed-sql"].some((family) =>
      String(engineMeta.family ?? "").includes(family),
    )
  ) {
    features.push("explain");
  }
  const domains = new Set(connectorExperienceDomains(entry, engineMeta));
  if (domains.has("graph")) {
    features.push("graph", "graphVisualization", "pathFinding", "graphAlgorithms", "queryTemplates", "visualization");
  }
  if (domains.has("vector")) {
    features.push("vectorSearch", "embeddingSearch", "hybridSearch", "queryTemplates", "visualization");
  }
  if (domains.has("search")) {
    features.push("fullTextSearch", "facetedSearch", "hybridSearch", "queryTemplates");
  }
  if (domains.has("timeSeries")) {
    features.push("timeSeries", "timeBuckets", "latestValue", "queryTemplates", "visualization");
    if (engine === "questdb") {
      features.push("asOfJoin");
    }
  }
  if (domains.has("warehouse")) {
    features.push(
      "warehouse",
      "queryHistory",
      "queryProfile",
      "workloadMonitoring",
      "dataLoading",
      "dataEngineering",
      "semanticLayer",
      "aiSql",
      "sqlFormatting",
      "queryTemplates",
      "visualization",
    );
  }
  return unique(features);
}

function connectorExperienceDomains(entry, engineMeta) {
  const categories = new Set(entry.categories ?? []);
  const engine = entry.engines[0];
  const family = String(engineMeta.family ?? "");
  const domains = [];
  if (categories.has("graph") || ["neo4j", "memgraph", "arangodb"].includes(engine)) {
    domains.push("graph");
  }
  if (categories.has("search") || ["elasticsearch", "openSearch"].includes(engine)) {
    domains.push("search", "vector");
  }
  if (categories.has("vector") || ["qdrant", "milvus", "pinecone"].includes(engine)) {
    domains.push("vector");
  }
  if (
    categories.has("time-series") ||
    ["influxdb", "questdb", "iotdb", "clickhouse"].includes(engine) ||
    family.includes("time")
  ) {
    domains.push("timeSeries");
  }
  if (engine === "snowflake") {
    domains.push("warehouse");
  }
  return unique(domains);
}

function connectorExperience(entry, engineMeta) {
  const engine = entry.engines[0];
  const domains = connectorExperienceDomains(entry, engineMeta);
  if (domains.length === 0) {
    return null;
  }
  const parts = domains
    .map((domain) => {
      if (domain === "graph") {
        return graphExperience(engine);
      }
      if (domain === "vector") {
        return vectorExperience(engine);
      }
      if (domain === "search") {
        return searchExperience(engine);
      }
      if (domain === "timeSeries") {
        return timeSeriesExperience(engine);
      }
      if (domain === "warehouse") {
        return warehouseExperience(engine);
      }
      return null;
    })
    .filter(Boolean);
  return {
    schemaVersion: 1,
    domains,
    inspiredBy: unique(parts.flatMap((part) => part.inspiredBy ?? [])),
    resultViews: unique(parts.flatMap((part) => part.resultViews ?? [])),
    objectTypes: unique(parts.flatMap((part) => part.objectTypes ?? [])),
    workflows: uniqueBy(parts.flatMap((part) => part.workflows ?? []), (workflow) => workflow.id),
    queryTemplates: uniqueBy(parts.flatMap((part) => part.queryTemplates ?? []), (template) => template.id),
    inspectorHints: uniqueBy(parts.flatMap((part) => part.inspectorHints ?? []), (hint) => hint.id),
  };
}

function connectorSqlDialectDefinition(entry, engineMeta) {
  const engine = entry.engines[0];
  if (engine !== "snowflake") {
    return null;
  }
  return {
    id: "snowflake.sql",
    name: "Snowflake SQL",
    aliases: ["snowflake", "snowsql", "sfsql", engineMeta.label],
    keywords: [
      sqlKeyword("select", "keyword"),
      sqlKeyword("qualify", "keyword"),
      sqlKeyword("sample", "keyword"),
      sqlKeyword("tablesample", "keyword"),
      sqlKeyword("pivot", "keyword"),
      sqlKeyword("unpivot", "keyword"),
      sqlKeyword("match_recognize", "keyword"),
      sqlKeyword("merge", "keyword"),
      sqlKeyword("copy", "keyword"),
      sqlKeyword("stage", "keyword"),
      sqlKeyword("warehouse", "keyword"),
      sqlKeyword("task", "keyword"),
      sqlKeyword("stream", "keyword"),
      sqlKeyword("dynamic", "keyword"),
      sqlKeyword("semantic", "keyword"),
      sqlKeyword("time", "keyword"),
      sqlKeyword("travel", "keyword"),
      sqlKeyword("changes", "keyword"),
      sqlKeyword("flatten", "function"),
      sqlKeyword("try_cast", "function"),
      sqlKeyword("result_scan", "function"),
      sqlKeyword("get_query_operator_stats", "function"),
      sqlKeyword("query_history", "function"),
      sqlKeyword("warehouse_load_history", "function"),
      sqlKeyword("warehouse_metering_history", "function"),
      sqlKeyword("snowflake.cortex.complete", "function"),
      sqlKeyword("snowflake.cortex.summarize", "function"),
      sqlKeyword("snowflake.cortex.sentiment", "function"),
      sqlKeyword("system$task_dependents_enable", "procedure"),
    ],
    snippets: [
      sqlSnippet(
        "sf context",
        "SELECT CURRENT_ACCOUNT() AS account, CURRENT_REGION() AS region, CURRENT_USER() AS user, CURRENT_ROLE() AS role, CURRENT_WAREHOUSE() AS warehouse, CURRENT_DATABASE() AS database, CURRENT_SCHEMA() AS schema;",
        "Show Snowflake session context.",
      ),
      sqlSnippet(
        "sf query history",
        "SELECT query_id, user_name, warehouse_name, execution_status, total_elapsed_time, bytes_scanned, rows_produced, query_text\nFROM TABLE(INFORMATION_SCHEMA.QUERY_HISTORY(END_TIME_RANGE_START => DATEADD('hour', -1, CURRENT_TIMESTAMP()), RESULT_LIMIT => 100))\nORDER BY start_time DESC;",
        "Recent query history from INFORMATION_SCHEMA.",
      ),
      sqlSnippet(
        "sf query profile",
        "SELECT *\nFROM TABLE(GET_QUERY_OPERATOR_STATS('<query_id>'))\nORDER BY step_id, operator_id;",
        "Operator-level query profile for one query id.",
      ),
      sqlSnippet(
        "sf copy validate",
        "COPY INTO <table_name>\nFROM @<stage_name>\nFILE_FORMAT = (FORMAT_NAME = '<file_format>')\nVALIDATION_MODE = RETURN_ERRORS;",
        "Validate staged files before loading.",
      ),
      sqlSnippet(
        "sf cortex complete",
        "SELECT SNOWFLAKE.CORTEX.COMPLETE('claude-3-5-sonnet', '<prompt>') AS response;",
        "Run a Cortex AISQL completion.",
      ),
    ],
    formatter: {
      keywordCase: "upper",
      identifierQuote: "\"",
      provider: "sql-dialect-fmt",
      command: "sql_format_snowflake",
      lineWidth: 100,
      indentWidth: 4,
    },
  };
}

function sqlKeyword(word, category) {
  return { word, category };
}

function sqlSnippet(label, insertText, detail) {
  return { label, insertText, detail };
}

function graphExperience(engine) {
  if (engine === "arangodb") {
    return {
      inspiredBy: ["ArangoDB Web Interface Graph Viewer", "AQL graph traversals", "AQL shortest path"],
      resultViews: ["graph", "path", "table", "json"],
      objectTypes: ["graphs", "vertexCollections", "edgeCollections", "indexes", "analyzers"],
      workflows: [
        workflow("graph-neighborhood", "Explore neighborhood", "Start from one vertex and return the surrounding path objects.", "graph", ["graph-aql-neighborhood"]),
        workflow("graph-shortest-path", "Shortest path", "Trace the shortest route between two vertices in a named graph.", "path", ["graph-aql-shortest-path"]),
        workflow("graph-collection-sample", "Collection sample", "Inspect vertex or edge documents before building a traversal.", "table", ["graph-aql-sample"]),
      ],
      queryTemplates: [
        queryTemplate(
          "graph-aql-neighborhood",
          "Neighborhood traversal",
          "aql",
          "Return paths around a starting vertex.",
          `FOR v, e, p IN 1..2 ANY @startVertex GRAPH @graphName
  LIMIT @limit
  RETURN p`,
          [
            parameter("graphName", "Graph name", "string"),
            parameter("startVertex", "Start vertex id", "string"),
            parameter("limit", "Limit", "number", 25),
          ],
          "graph",
        ),
        queryTemplate(
          "graph-aql-shortest-path",
          "Shortest path",
          "aql",
          "Find the shortest path between source and target vertices.",
          `FOR v, e, p IN OUTBOUND SHORTEST_PATH @source TO @target GRAPH @graphName
  RETURN p`,
          [
            parameter("graphName", "Graph name", "string"),
            parameter("source", "Source vertex id", "string"),
            parameter("target", "Target vertex id", "string"),
          ],
          "path",
        ),
        queryTemplate(
          "graph-aql-sample",
          "Collection sample",
          "aql",
          "Preview graph collection documents.",
          `FOR doc IN @@collection
  LIMIT @limit
  RETURN doc`,
          [
            parameter("collection", "Collection", "string"),
            parameter("limit", "Limit", "number", 25),
          ],
          "table",
        ),
      ],
      inspectorHints: [
        inspectorHint("graph-name", "Graph selector", "Expose named graphs alongside vertex and edge collections."),
        inspectorHint("edge-direction", "Direction toggle", "Let users switch OUTBOUND, INBOUND, and ANY traversal direction."),
      ],
    };
  }
  return {
    inspiredBy: engine === "memgraph"
      ? ["Memgraph Lab", "MAGE graph algorithms", "Cypher shortest path"]
      : ["Neo4j Browser", "Neo4j Bloom", "Neo4j Graph Data Science", "Cypher shortest path"],
    resultViews: ["graph", "path", "table"],
    objectTypes: ["nodeLabels", "relationshipTypes", "properties", "indexes", "constraints"],
    workflows: [
      workflow("graph-schema-overview", "Schema overview", "Summarize labels and relationship types before exploration.", "table", ["graph-cypher-label-counts"]),
      workflow("graph-neighborhood", "Explore neighborhood", "Return connected nodes and relationships around a node.", "graph", ["graph-cypher-neighborhood"]),
      workflow("graph-shortest-path", "Shortest path", "Find a bounded shortest path between source and target nodes.", "path", ["graph-cypher-shortest-path"]),
      workflow("graph-algorithm-starter", "Algorithm starter", "Open centrality and community-detection starter queries.", "table", ["graph-cypher-degree-centrality"]),
    ],
    queryTemplates: [
      queryTemplate(
        "graph-cypher-label-counts",
        "Label counts",
        "cypher",
        "Count nodes by label for a quick schema read.",
        "MATCH (n)\nRETURN labels(n) AS labels, count(*) AS count\nORDER BY count DESC",
        [],
        "table",
      ),
      queryTemplate(
        "graph-cypher-neighborhood",
        "Neighborhood graph",
        "cypher",
        "Render a small relationship neighborhood.",
        "MATCH (n)-[r]->(m)\nRETURN n, r, m\nLIMIT $limit",
        [parameter("limit", "Limit", "number", 100)],
        "graph",
      ),
      queryTemplate(
        "graph-cypher-shortest-path",
        "Shortest path",
        "cypher",
        "Find a bounded shortest path between two nodes.",
        "MATCH p = shortestPath((source {id: $sourceId})-[*..6]-(target {id: $targetId}))\nRETURN p",
        [
          parameter("sourceId", "Source id", "string"),
          parameter("targetId", "Target id", "string"),
        ],
        "path",
      ),
      queryTemplate(
        "graph-cypher-degree-centrality",
        "Degree centrality starter",
        "cypher",
        "Find highly connected nodes without requiring a projected algorithm graph.",
        "MATCH (n)--()\nRETURN n, count(*) AS degree\nORDER BY degree DESC\nLIMIT $limit",
        [parameter("limit", "Limit", "number", 25)],
        "table",
      ),
    ],
    inspectorHints: [
      inspectorHint("graph-node-labels", "Label browser", "Show labels, relationship types, and sample properties together."),
      inspectorHint("graph-expand-depth", "Depth control", "Offer one, two, and three hop expansion presets."),
    ],
  };
}

function vectorExperience(engine) {
  const common = {
    resultViews: ["vectorNeighbors", "table", "json"],
    objectTypes: ["collections", "indexes", "vectors", "payloadFields", "partitions", "namespaces"],
    workflows: [
      workflow("vector-similarity-search", "Similarity search", "Search nearest neighbors from a pasted vector or embedding variable.", "vectorNeighbors", ["vector-similarity"]),
      workflow("vector-filtered-search", "Filtered ANN search", "Combine vector similarity with metadata or scalar filters.", "vectorNeighbors", ["vector-filtered"]),
      workflow("vector-health", "Collection or index health", "Inspect vector count, dimensionality, metric, shard, and index status.", "table", ["vector-health"]),
    ],
    inspectorHints: [
      inspectorHint("vector-dimension", "Dimension badge", "Surface vector dimension and distance metric beside each collection or index."),
      inspectorHint("vector-payload", "Payload fields", "Show filterable metadata fields before composing a filtered search."),
    ],
  };
  if (engine === "qdrant") {
    return {
      ...common,
      inspiredBy: ["Qdrant Collections", "Qdrant filtering", "Qdrant payload indexes"],
      queryTemplates: [
        queryTemplate(
          "vector-similarity",
          "Qdrant similarity search",
          "json",
          "Search nearest points with payloads but without returning raw vectors.",
          `{
  "vector": "$vector",
  "limit": 10,
  "with_payload": true,
  "with_vector": false
}`,
          [parameter("vector", "Query vector", "json")],
          "vectorNeighbors",
        ),
        queryTemplate(
          "vector-filtered",
          "Qdrant filtered search",
          "json",
          "Filter payload fields while searching nearest neighbors.",
          `{
  "vector": "$vector",
  "filter": {
    "must": [
      { "key": "$field", "match": { "value": "$value" } }
    ]
  },
  "limit": 10,
  "with_payload": true,
  "with_vector": false
}`,
          [
            parameter("vector", "Query vector", "json"),
            parameter("field", "Payload field", "string"),
            parameter("value", "Payload value", "string"),
          ],
          "vectorNeighbors",
        ),
        queryTemplate("vector-health", "Qdrant collection info", "text", "Inspect collection status and vector config.", "GET /collections/$collection", [parameter("collection", "Collection", "string")], "json"),
      ],
    };
  }
  if (engine === "milvus") {
    return {
      ...common,
      inspiredBy: ["Milvus collections", "Milvus indexes", "Milvus scalar filtering"],
      queryTemplates: [
        queryTemplate(
          "vector-similarity",
          "Milvus vector search",
          "python",
          "Search a collection with a COSINE ANN parameter block.",
          `collection.search(
    data=[$vector],
    anns_field="embedding",
    param={"metric_type": "COSINE", "params": {"ef": 64}},
    limit=10,
    output_fields=["*"]
)`,
          [parameter("vector", "Query vector", "json")],
          "vectorNeighbors",
        ),
        queryTemplate(
          "vector-filtered",
          "Milvus filtered search",
          "python",
          "Add a scalar filter expression to vector search.",
          `collection.search(
    data=[$vector],
    anns_field="embedding",
    param={"metric_type": "COSINE", "params": {"ef": 64}},
    limit=10,
    expr='$field == "$value"',
    output_fields=["*"]
)`,
          [
            parameter("vector", "Query vector", "json"),
            parameter("field", "Scalar field", "string"),
            parameter("value", "Scalar value", "string"),
          ],
          "vectorNeighbors",
        ),
        queryTemplate("vector-health", "Milvus collection stats", "text", "Inspect collection schema, indexes, and load state.", "describe_collection($collection)", [parameter("collection", "Collection", "string")], "table"),
      ],
    };
  }
  if (engine === "pinecone") {
    return {
      ...common,
      inspiredBy: ["Pinecone indexes", "Pinecone namespaces", "Pinecone metadata filters"],
      queryTemplates: [
        queryTemplate(
          "vector-similarity",
          "Pinecone query",
          "json",
          "Search topK nearest records in a namespace.",
          `{
  "namespace": "$namespace",
  "vector": $vector,
  "topK": 10,
  "includeMetadata": true
}`,
          [
            parameter("namespace", "Namespace", "string", "default"),
            parameter("vector", "Query vector", "json"),
          ],
          "vectorNeighbors",
        ),
        queryTemplate(
          "vector-filtered",
          "Pinecone filtered query",
          "json",
          "Search vectors with a metadata filter.",
          `{
  "namespace": "$namespace",
  "vector": $vector,
  "topK": 10,
  "includeMetadata": true,
  "filter": {
    "$field": { "$eq": "$value" }
  }
}`,
          [
            parameter("namespace", "Namespace", "string", "default"),
            parameter("vector", "Query vector", "json"),
            parameter("field", "Metadata field", "string"),
            parameter("value", "Metadata value", "string"),
          ],
          "vectorNeighbors",
        ),
        queryTemplate("vector-health", "Pinecone index stats", "text", "Inspect namespaces, dimensions, and vector counts.", "describe_index_stats(namespace=$namespace)", [parameter("namespace", "Namespace", "string", "default")], "table"),
      ],
    };
  }
  return {
    ...common,
    inspiredBy: engine === "openSearch" ? ["OpenSearch k-NN search", "OpenSearch hybrid search", "OpenSearch aggregations"] : ["Elasticsearch kNN search", "Elasticsearch hybrid search", "Elasticsearch aggregations"],
    queryTemplates: [
      queryTemplate(
        "vector-similarity",
        "kNN vector search",
        "json",
        "Search nearest vectors using a dense-vector field.",
        `{
  "knn": {
    "field": "embedding",
    "query_vector": $vector,
    "k": 10,
    "num_candidates": 100
  }
}`,
        [parameter("vector", "Query vector", "json")],
        "vectorNeighbors",
      ),
      queryTemplate(
        "vector-filtered",
        "Filtered kNN search",
        "json",
        "Combine kNN search with a metadata filter.",
        `{
  "knn": {
    "field": "embedding",
    "query_vector": $vector,
    "k": 10,
    "num_candidates": 100,
    "filter": { "term": { "$field": "$value" } }
  }
}`,
        [
          parameter("vector", "Query vector", "json"),
          parameter("field", "Filter field", "string"),
          parameter("value", "Filter value", "string"),
        ],
        "vectorNeighbors",
      ),
      queryTemplate("vector-health", "Index mapping", "text", "Inspect vector mapping and index settings.", "GET /$index/_mapping", [parameter("index", "Index", "string")], "json"),
    ],
  };
}

function searchExperience(engine) {
  return {
    inspiredBy: engine === "openSearch" ? ["OpenSearch Dashboards Discover", "OpenSearch aggregations", "OpenSearch hybrid search"] : ["Kibana Discover", "Elasticsearch aggregations", "Elasticsearch hybrid search"],
    resultViews: ["searchHits", "facets", "json", "table"],
    objectTypes: ["indexes", "mappings", "aliases", "templates", "analyzers"],
    workflows: [
      workflow("search-discover", "Discover documents", "Search documents with query text, field filters, and highlights.", "searchHits", ["search-query-string"]),
      workflow("search-facets", "Facet breakdown", "Build terms and date facets for a filtered result set.", "facets", ["search-facets"]),
      workflow("search-hybrid", "Hybrid search", "Blend text relevance with vector nearest-neighbor search.", "searchHits", ["search-hybrid"]),
    ],
    queryTemplates: [
      queryTemplate(
        "search-query-string",
        "Query string search",
        "json",
        "Search all mapped fields and highlight matched text.",
        `{
  "query": {
    "query_string": {
      "query": "$query"
    }
  },
  "highlight": {
    "fields": { "*": {} }
  },
  "size": 25
}`,
        [parameter("query", "Search query", "string")],
        "searchHits",
      ),
      queryTemplate(
        "search-facets",
        "Terms facet",
        "json",
        "Return a terms aggregation for a field.",
        `{
  "size": 0,
  "aggs": {
    "by_field": {
      "terms": { "field": "$field", "size": 20 }
    }
  }
}`,
        [parameter("field", "Facet field", "string")],
        "facets",
      ),
      queryTemplate(
        "search-hybrid",
        "Hybrid text and vector search",
        "json",
        "Keep a starter shape for combining text relevance with vector search.",
        `{
  "query": {
    "bool": {
      "must": [
        { "match": { "$textField": "$query" } }
      ]
    }
  },
  "knn": {
    "field": "embedding",
    "query_vector": $vector,
    "k": 10,
    "num_candidates": 100
  }
}`,
        [
          parameter("textField", "Text field", "string"),
          parameter("query", "Search query", "string"),
          parameter("vector", "Query vector", "json"),
        ],
        "searchHits",
      ),
    ],
    inspectorHints: [
      inspectorHint("search-mapping", "Mapping inspector", "Show analyzer, type, and fielddata/doc_values availability per field."),
      inspectorHint("search-facetable", "Facet suggestions", "Suggest keyword, numeric, boolean, and date fields for facets."),
    ],
  };
}

function timeSeriesExperience(engine) {
  if (engine === "influxdb") {
    return {
      inspiredBy: ["InfluxDB Data Explorer", "Flux aggregateWindow", "InfluxDB tasks"],
      resultViews: ["timeChart", "table", "heatmap"],
      objectTypes: ["buckets", "measurements", "fields", "tags", "retentionPolicies", "tasks"],
      workflows: [
        workflow("time-range-query", "Time range query", "Start every query from a clear time range.", "timeChart", ["time-influx-aggregate-window"]),
        workflow("time-downsample", "Downsample window", "Aggregate points into a chart-friendly window.", "timeChart", ["time-influx-aggregate-window"]),
        workflow("time-latest", "Latest values", "Read latest values per series key.", "table", ["time-influx-latest"]),
      ],
      queryTemplates: [
        queryTemplate(
          "time-influx-aggregate-window",
          "Aggregate window",
          "flux",
          "Downsample a measurement over the last hour.",
          `from(bucket: "$bucket")
  |> range(start: -1h)
  |> filter(fn: (r) => r._measurement == "$measurement")
  |> aggregateWindow(every: 1m, fn: mean, createEmpty: false)
  |> yield(name: "mean")`,
          [
            parameter("bucket", "Bucket", "string"),
            parameter("measurement", "Measurement", "string"),
          ],
          "timeChart",
        ),
        queryTemplate(
          "time-influx-latest",
          "Latest values",
          "flux",
          "Return latest values for a measurement.",
          `from(bucket: "$bucket")
  |> range(start: -24h)
  |> filter(fn: (r) => r._measurement == "$measurement")
  |> last()`,
          [
            parameter("bucket", "Bucket", "string"),
            parameter("measurement", "Measurement", "string"),
          ],
          "table",
        ),
      ],
      inspectorHints: [
        inspectorHint("time-field-tag", "Field and tag picker", "Group fields and tags so chart builders can choose dimensions quickly."),
        inspectorHint("time-range", "Pinned time range", "Carry a reusable time range across Flux templates."),
      ],
    };
  }
  if (engine === "questdb") {
    return {
      inspiredBy: ["QuestDB Web Console", "SAMPLE BY", "LATEST ON", "ASOF JOIN"],
      resultViews: ["timeChart", "table", "heatmap"],
      objectTypes: ["tables", "designatedTimestamps", "symbols", "partitions", "walTables"],
      workflows: [
        workflow("time-sample-by", "Sample by window", "Aggregate timestamped rows into fixed windows.", "timeChart", ["time-questdb-sample-by"]),
        workflow("time-latest", "Latest per key", "Read the newest row per symbol or device.", "table", ["time-questdb-latest"]),
        workflow("time-asof-join", "As-of join", "Join event streams by nearest preceding timestamp.", "table", ["time-questdb-asof-join"]),
      ],
      queryTemplates: [
        queryTemplate(
          "time-questdb-sample-by",
          "SAMPLE BY aggregate",
          "sql",
          "Downsample recent readings into one-minute buckets.",
          `SELECT timestamp, avg(value)
FROM readings
WHERE timestamp >= dateadd('h', -1, now())
SAMPLE BY 1m ALIGN TO CALENDAR;`,
          [],
          "timeChart",
        ),
        queryTemplate(
          "time-questdb-latest",
          "LATEST ON per key",
          "sql",
          "Return the latest row for each sensor.",
          "SELECT *\nFROM readings\nLATEST ON timestamp PARTITION BY sensor_id;",
          [],
          "table",
        ),
        queryTemplate(
          "time-questdb-asof-join",
          "ASOF JOIN",
          "sql",
          "Join two time-aligned event streams.",
          `SELECT *
FROM trades t ASOF JOIN quotes q ON (symbol)
WHERE t.timestamp >= dateadd('d', -1, now());`,
          [],
          "table",
        ),
      ],
      inspectorHints: [
        inspectorHint("time-designated", "Designated timestamp", "Highlight the designated timestamp column and partitioning choice."),
        inspectorHint("time-symbol", "Symbol columns", "Show symbol columns as preferred group and partition keys."),
      ],
    };
  }
  if (engine === "iotdb") {
    return {
      inspiredBy: ["Apache IoTDB time-series hierarchy", "GROUP BY time", "ALIGN BY DEVICE", "FILL"],
      resultViews: ["timeChart", "table", "heatmap"],
      objectTypes: ["storageGroups", "devices", "measurements", "templates", "ttl"],
      workflows: [
        workflow("time-device-query", "Device aligned query", "Compare measurements across devices.", "timeChart", ["time-iotdb-group-by-device"]),
        workflow("time-gap-fill", "Gap fill", "Fill sparse telemetry windows for charting.", "timeChart", ["time-iotdb-fill"]),
        workflow("time-latest", "Latest telemetry", "Inspect the newest values in a device subtree.", "table", ["time-iotdb-latest"]),
      ],
      queryTemplates: [
        queryTemplate(
          "time-iotdb-group-by-device",
          "GROUP BY time aligned by device",
          "sql",
          "Aggregate measurements per device over the last hour.",
          `SELECT avg(temperature)
FROM root.factory.**
WHERE time >= now() - 1h
GROUP BY ([now() - 1h, now()), 1m)
ALIGN BY DEVICE;`,
          [],
          "timeChart",
        ),
        queryTemplate(
          "time-iotdb-fill",
          "Fill missing windows",
          "sql",
          "Fill sparse time windows for a device path.",
          `SELECT last_value(temperature)
FROM root.factory.line1.device1
WHERE time >= now() - 1h
FILL(previous);`,
          [],
          "timeChart",
        ),
        queryTemplate(
          "time-iotdb-latest",
          "Latest values",
          "sql",
          "Read recent measurements from a hierarchy.",
          "SELECT last_value(*)\nFROM root.factory.**;",
          [],
          "table",
        ),
      ],
      inspectorHints: [
        inspectorHint("time-device-tree", "Device tree", "Keep storage group, device, and measurement hierarchy navigable."),
        inspectorHint("time-align-device", "Align by device", "Offer ALIGN BY DEVICE as a visible query option."),
      ],
    };
  }
  return {
    inspiredBy: ["ClickHouse SQL console", "time bucketing", "latest-point analytics"],
    resultViews: ["timeChart", "table", "heatmap"],
    objectTypes: ["tables", "columns", "partitions", "projections", "materializedViews"],
    workflows: [
      workflow("time-bucket", "Bucketed aggregate", "Group high-volume events into chart windows.", "timeChart", ["time-clickhouse-bucket"]),
      workflow("time-latest", "Latest event per key", "Use argMax-style aggregates for latest values.", "table", ["time-clickhouse-latest"]),
    ],
    queryTemplates: [
      queryTemplate(
        "time-clickhouse-bucket",
        "Bucketed aggregate",
        "sql",
        "Aggregate events into one-minute windows.",
        `SELECT
  toStartOfInterval(timestamp, INTERVAL 1 minute) AS bucket,
  count() AS events
FROM events
WHERE timestamp >= now() - INTERVAL 1 HOUR
GROUP BY bucket
ORDER BY bucket;`,
        [],
        "timeChart",
      ),
      queryTemplate(
        "time-clickhouse-latest",
        "Latest per key",
        "sql",
        "Return latest values per series key.",
        `SELECT
  series_id,
  argMax(value, timestamp) AS latest_value,
  max(timestamp) AS latest_timestamp
FROM readings
GROUP BY series_id;`,
        [],
        "table",
      ),
    ],
    inspectorHints: [
      inspectorHint("time-partition", "Partition key", "Show partition expressions and TTL settings near each table."),
      inspectorHint("time-projection", "Projection hint", "Surface projections and materialized views useful for time buckets."),
    ],
  };
}

function warehouseExperience(engine) {
  if (engine !== "snowflake") {
    return null;
  }
  return {
    inspiredBy: [
      "Snowsight Worksheets",
      "Snowsight Query History",
      "Snowsight Query Profile",
      "Snowflake SQL API",
      "Snowflake Tasks",
      "Snowflake Streams",
      "Snowflake Dynamic Tables",
      "Snowflake Semantic Views",
      "Snowflake Cortex AISQL",
      "sql-dialect-fmt",
    ],
    resultViews: [
      "worksheet",
      "queryHistory",
      "queryProfile",
      "warehouseMonitor",
      "costChart",
      "copyReport",
      "taskGraph",
      "lineage",
      "semanticModel",
      "notebook",
      "aiAssistant",
      "table",
    ],
    objectTypes: [
      "accounts",
      "databases",
      "schemas",
      "tables",
      "views",
      "semanticViews",
      "stages",
      "fileFormats",
      "warehouses",
      "roles",
      "users",
      "shares",
      "tasks",
      "streams",
      "dynamicTables",
      "notebooks",
      "queryHistory",
      "queryProfile",
      "cortexFunctions",
    ],
    workflows: [
      workflow("snowflake-worksheet-context", "Worksheet context", "Show account, role, warehouse, database, schema, and formatter-backed worksheet context.", "worksheet", ["snowflake-context"]),
      workflow("snowflake-query-history", "Query history triage", "Find slow, failed, expensive, or high-scan queries without leaving the connector.", "queryHistory", ["snowflake-query-history", "snowflake-expensive-queries", "snowflake-result-scan"]),
      workflow("snowflake-query-profile", "Query profile drilldown", "Open operator stats for a query id and compare hotspots.", "queryProfile", ["snowflake-query-profile"]),
      workflow("snowflake-warehouse-monitor", "Warehouse monitor", "Inspect warehouse load and credit consumption together.", "warehouseMonitor", ["snowflake-warehouse-load", "snowflake-warehouse-metering"]),
      workflow("snowflake-data-loading", "Stage and COPY control", "Validate staged files, load them, and review load failures.", "copyReport", ["snowflake-copy-validate", "snowflake-copy-into", "snowflake-load-history"]),
      workflow("snowflake-data-engineering", "Streams, tasks, and dynamic tables", "Create incremental pipelines with streams, tasks, and dynamic tables.", "taskGraph", ["snowflake-stream-changes", "snowflake-create-task", "snowflake-dynamic-table"]),
      workflow("snowflake-semantic-layer", "Semantic model starter", "Start a semantic view and inspect metrics-friendly model shape.", "semanticModel", ["snowflake-semantic-view"]),
      workflow("snowflake-cortex-ai", "Cortex AISQL assistant", "Use Cortex functions from SQL templates for summarization and generation.", "aiAssistant", ["snowflake-cortex-complete", "snowflake-cortex-summarize"]),
      workflow("snowflake-governance", "Role and grants audit", "Inspect active role, grants, and object access before running privileged operations.", "table", ["snowflake-role-grants"]),
    ],
    queryTemplates: [
      queryTemplate(
        "snowflake-context",
        "Current Snowflake context",
        "sql",
        "Show the account, user, role, warehouse, database, and schema used by this worksheet.",
        `SELECT
  CURRENT_ACCOUNT() AS account,
  CURRENT_REGION() AS region,
  CURRENT_USER() AS user_name,
  CURRENT_ROLE() AS role_name,
  CURRENT_WAREHOUSE() AS warehouse_name,
  CURRENT_DATABASE() AS database_name,
  CURRENT_SCHEMA() AS schema_name;`,
        [],
        "worksheet",
      ),
      queryTemplate(
        "snowflake-query-history",
        "Recent query history",
        "sql",
        "List recent query history from INFORMATION_SCHEMA with runtime and scan indicators.",
        `SELECT
  query_id,
  user_name,
  warehouse_name,
  execution_status,
  total_elapsed_time,
  bytes_scanned,
  rows_produced,
  query_text
FROM TABLE(
  INFORMATION_SCHEMA.QUERY_HISTORY(
    END_TIME_RANGE_START => DATEADD('hour', -$hours, CURRENT_TIMESTAMP()),
    RESULT_LIMIT => $limit
  )
)
ORDER BY start_time DESC;`,
        [parameter("hours", "Hours back", "number", 1), parameter("limit", "Limit", "number", 100)],
        "queryHistory",
      ),
      queryTemplate(
        "snowflake-expensive-queries",
        "Expensive queries",
        "sql",
        "Find high-scan or long-running queries from ACCOUNT_USAGE.",
        `SELECT
  query_id,
  user_name,
  warehouse_name,
  total_elapsed_time / 1000 AS elapsed_seconds,
  bytes_scanned,
  rows_produced,
  credits_used_cloud_services,
  query_text
FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY
WHERE start_time >= DATEADD('hour', -$hours, CURRENT_TIMESTAMP())
ORDER BY bytes_scanned DESC, total_elapsed_time DESC
LIMIT $limit;`,
        [parameter("hours", "Hours back", "number", 24), parameter("limit", "Limit", "number", 50)],
        "costChart",
      ),
      queryTemplate(
        "snowflake-result-scan",
        "Result scan",
        "sql",
        "Re-open a prior query result by query id.",
        "SELECT *\nFROM TABLE(RESULT_SCAN('$queryId'))\nLIMIT $limit;",
        [parameter("queryId", "Query ID", "string"), parameter("limit", "Limit", "number", 100)],
        "table",
      ),
      queryTemplate(
        "snowflake-query-profile",
        "Query operator stats",
        "sql",
        "Inspect operator-level query profile data for a query id.",
        `SELECT *
FROM TABLE(GET_QUERY_OPERATOR_STATS('$queryId'))
ORDER BY step_id, operator_id;`,
        [parameter("queryId", "Query ID", "string")],
        "queryProfile",
      ),
      queryTemplate(
        "snowflake-warehouse-load",
        "Warehouse load history",
        "sql",
        "Review queued and running load for one warehouse.",
        `SELECT *
FROM TABLE(
  INFORMATION_SCHEMA.WAREHOUSE_LOAD_HISTORY(
    DATE_RANGE_START => DATEADD('hour', -$hours, CURRENT_TIMESTAMP()),
    WAREHOUSE_NAME => '$warehouse'
  )
)
ORDER BY start_time DESC;`,
        [parameter("hours", "Hours back", "number", 6), parameter("warehouse", "Warehouse", "string")],
        "warehouseMonitor",
      ),
      queryTemplate(
        "snowflake-warehouse-metering",
        "Warehouse metering history",
        "sql",
        "Review credits used by a warehouse.",
        `SELECT
  start_time,
  end_time,
  warehouse_name,
  credits_used,
  credits_used_compute,
  credits_used_cloud_services
FROM TABLE(
  INFORMATION_SCHEMA.WAREHOUSE_METERING_HISTORY(
    DATE_RANGE_START => DATEADD('day', -$days, CURRENT_TIMESTAMP()),
    WAREHOUSE_NAME => '$warehouse'
  )
)
ORDER BY start_time DESC;`,
        [parameter("days", "Days back", "number", 7), parameter("warehouse", "Warehouse", "string")],
        "costChart",
      ),
      queryTemplate(
        "snowflake-copy-validate",
        "Validate staged files",
        "sql",
        "Validate staged files before loading them into a table.",
        `COPY INTO $table
FROM @$stage
FILE_FORMAT = (FORMAT_NAME = '$fileFormat')
VALIDATION_MODE = RETURN_ERRORS;`,
        [
          parameter("table", "Target table", "string"),
          parameter("stage", "Stage", "string"),
          parameter("fileFormat", "File format", "string"),
        ],
        "copyReport",
      ),
      queryTemplate(
        "snowflake-copy-into",
        "COPY INTO table",
        "sql",
        "Load staged files into a target table.",
        `COPY INTO $table
FROM @$stage
FILE_FORMAT = (FORMAT_NAME = '$fileFormat')
MATCH_BY_COLUMN_NAME = CASE_INSENSITIVE
ON_ERROR = CONTINUE;`,
        [
          parameter("table", "Target table", "string"),
          parameter("stage", "Stage", "string"),
          parameter("fileFormat", "File format", "string"),
        ],
        "copyReport",
      ),
      queryTemplate(
        "snowflake-load-history",
        "Load history",
        "sql",
        "Inspect load status for a target table.",
        `SELECT *
FROM TABLE(
  INFORMATION_SCHEMA.LOAD_HISTORY(
    TABLE_NAME => '$table',
    START_TIME => DATEADD('day', -$days, CURRENT_TIMESTAMP())
  )
)
ORDER BY last_load_time DESC;`,
        [parameter("table", "Table", "string"), parameter("days", "Days back", "number", 7)],
        "copyReport",
      ),
      queryTemplate(
        "snowflake-stream-changes",
        "Read stream changes",
        "sql",
        "Preview change data captured by a stream.",
        `SELECT *
FROM $streamName
WHERE METADATA$ACTION IS NOT NULL
LIMIT $limit;`,
        [parameter("streamName", "Stream name", "string"), parameter("limit", "Limit", "number", 100)],
        "lineage",
      ),
      queryTemplate(
        "snowflake-create-task",
        "Create scheduled task",
        "sql",
        "Create a scheduled task starter using the active warehouse.",
        `CREATE OR REPLACE TASK $taskName
  WAREHOUSE = $warehouse
  SCHEDULE = 'USING CRON 0 * * * * UTC'
AS
  $statement;`,
        [
          parameter("taskName", "Task name", "string"),
          parameter("warehouse", "Warehouse", "string"),
          parameter("statement", "Task SQL", "string", "SELECT 1"),
        ],
        "taskGraph",
      ),
      queryTemplate(
        "snowflake-dynamic-table",
        "Create dynamic table",
        "sql",
        "Create a dynamic table with a target lag and warehouse.",
        `CREATE OR REPLACE DYNAMIC TABLE $dynamicTable
  TARGET_LAG = '$targetLag'
  WAREHOUSE = $warehouse
AS
SELECT *
FROM $sourceTable;`,
        [
          parameter("dynamicTable", "Dynamic table", "string"),
          parameter("targetLag", "Target lag", "string", "5 minutes"),
          parameter("warehouse", "Warehouse", "string"),
          parameter("sourceTable", "Source table", "string"),
        ],
        "lineage",
      ),
      queryTemplate(
        "snowflake-semantic-view",
        "Semantic view starter",
        "sql",
        "Start a semantic view definition for metric-friendly analytics.",
        `CREATE OR REPLACE SEMANTIC VIEW $semanticView
  TABLES (
    $factTable PRIMARY KEY ($primaryKey)
  )
  FACTS (
    $factTable.$metricColumn AS metric_value
  )
  METRICS (
    metric_count AS COUNT(*)
  );`,
        [
          parameter("semanticView", "Semantic view", "string"),
          parameter("factTable", "Fact table", "string"),
          parameter("primaryKey", "Primary key", "string"),
          parameter("metricColumn", "Metric column", "string"),
        ],
        "semanticModel",
      ),
      queryTemplate(
        "snowflake-cortex-complete",
        "Cortex complete",
        "sql",
        "Generate text with a Cortex model.",
        "SELECT SNOWFLAKE.CORTEX.COMPLETE('$model', '$prompt') AS response;",
        [parameter("model", "Model", "string", "claude-3-5-sonnet"), parameter("prompt", "Prompt", "string")],
        "aiAssistant",
      ),
      queryTemplate(
        "snowflake-cortex-summarize",
        "Cortex summarize",
        "sql",
        "Summarize a column or text expression with Cortex.",
        "SELECT SNOWFLAKE.CORTEX.SUMMARIZE($expression) AS summary\nFROM $table\nLIMIT $limit;",
        [
          parameter("expression", "Expression", "string"),
          parameter("table", "Table", "string"),
          parameter("limit", "Limit", "number", 25),
        ],
        "aiAssistant",
      ),
      queryTemplate(
        "snowflake-role-grants",
        "Role grants",
        "sql",
        "Inspect grants for a role before changing objects.",
        "SHOW GRANTS TO ROLE $role;",
        [parameter("role", "Role", "string")],
        "table",
      ),
    ],
    inspectorHints: [
      inspectorHint("snowflake-session-context", "Session context", "Pin role, warehouse, database, and schema above the worksheet."),
      inspectorHint("snowflake-format-provider", "Snowflake formatter", "Use sql-dialect-fmt for lossless Snowflake formatting before falling back to generic SQL formatting."),
      inspectorHint("snowflake-query-profile", "Profile deep link", "Attach query ids to results so operator stats can open beside the grid."),
      inspectorHint("snowflake-warehouse-cost", "Warehouse cost panel", "Pair load history with metering history and current warehouse size."),
      inspectorHint("snowflake-pipeline-objects", "Pipeline objects", "Group streams, tasks, and dynamic tables as a pipeline graph."),
      inspectorHint("snowflake-cortex", "Cortex actions", "Expose AI SQL templates only when the active account has Cortex access."),
    ],
  };
}

function queryTemplate(id, label, language, description, insertText, parameters = [], resultView = "table") {
  return {
    id,
    label,
    language,
    description,
    insertText,
    parameters,
    resultView,
  };
}

function workflow(id, label, description, resultView, templateIds = []) {
  return {
    id,
    label,
    description,
    resultView,
    templateIds,
  };
}

function parameter(id, label, type, defaultValue = undefined) {
  return {
    id,
    label,
    type,
    ...(defaultValue !== undefined ? { default: defaultValue } : {}),
  };
}

function inspectorHint(id, label, description) {
  return {
    id,
    label,
    description,
  };
}

function isSqlLikeConnector(entry, engineMeta) {
  const categories = new Set(entry.categories ?? []);
  if (
    ["document", "search", "vector", "key-value", "graph"].some((category) =>
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

function ensureDir(path) {
  if (options.dryRun) {
    return;
  }
  mkdirSync(path, { recursive: true });
}

function copyFile(source, destination) {
  if (options.dryRun) {
    return;
  }
  copyFileSync(source, destination);
}

function writeText(path, content) {
  if (options.dryRun) {
    return;
  }
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
    : `
[dependencies]
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

function writeRustSources(repoDir, engine, label, realDriverLinked) {
  writeText(resolve(repoDir, "src/lib.rs"), rustLib(engine, label, realDriverLinked));
  writeText(resolve(repoDir, "src/abi.rs"), abiRust());
  if (realDriverLinked) {
    writeText(resolve(repoDir, "src/driver.rs"), duckDbDriverRust());
    removeIfExists(resolve(repoDir, "src/stub.rs"));
  } else {
    writeText(resolve(repoDir, "src/stub.rs"), stubRust());
    removeIfExists(resolve(repoDir, "src/driver.rs"));
  }
}

function removeIfExists(path) {
  if (options.dryRun) {
    return;
  }
  rmSync(path, { force: true });
}

function formatRustSources(repoDir) {
  if (options.dryRun || process.env.IRODORI_SKIP_RUSTFMT === "1") {
    return;
  }
  const result = spawnSync("cargo", ["fmt", "--manifest-path", resolve(repoDir, "Cargo.toml")], {
    cwd: repoDir,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `cargo fmt failed in ${repoDir}\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  }
}

function parseArgs(args) {
  const parsed = {
    dryRun: false,
    force: false,
    help: false,
  };

  for (const arg of args) {
    if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg === "--force") {
      parsed.force = true;
    } else if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function printHelp() {
  console.log(`Usage: node tools/extensions/scaffold-connector-repos.mjs [options]

Bootstraps connector extension repositories from registry/catalog/index.json.

Options:
  --dry-run  Report which repositories would be written or skipped.
  --force    Rewrite implemented repositories that have connector.source.json or src/driver.rs.
  -h, --help Show this help text.
`);
}

function rustLib(engine, label, realDriverLinked) {
  const dispatcherModule = realDriverLinked ? "driver" : "stub";
  const driverOperationTest = realDriverLinked
    ? ""
    : `
    #[test]
    fn call_json_rejects_driver_operations_until_linked() {
        let response = call(r#"{"method":"query","sql":"select 1"}"#);
        assert_eq!(response["ok"], false);
        assert_eq!(response["error"]["code"], "connector.driverNotLinked");
    }
`;

  return `//! Native connector ABI for ${label}.
//!
//! Generated extension entrypoints stay small: \`abi\` owns buffer/JSON ABI
//! mechanics, and \`${dispatcherModule}\` owns connector behavior.

mod abi;
mod ${dispatcherModule};

pub use abi::IrodoriConnectorBuffer;

pub const ABI_VERSION: u32 = 1;
pub const ENGINE: &str = "${engine}";
pub const DRIVER_LINKED: bool = ${realDriverLinked};
pub const CONFIG_JSON: &str = include_str!("../connector.config.json");
pub const MANIFEST_JSON: &str = include_str!("../irodori.extension.json");

#[no_mangle]
pub extern "C" fn irodori_extension_abi_version() -> u32 {
    ABI_VERSION
}

#[no_mangle]
pub extern "C" fn irodori_connector_engine_json() -> IrodoriConnectorBuffer {
    abi::owned_buffer(ENGINE.to_string())
}

#[no_mangle]
pub extern "C" fn irodori_extension_manifest_json() -> IrodoriConnectorBuffer {
    abi::owned_buffer(MANIFEST_JSON.to_string())
}

#[no_mangle]
pub extern "C" fn irodori_connector_config_json() -> IrodoriConnectorBuffer {
    abi::owned_buffer(CONFIG_JSON.to_string())
}

#[no_mangle]
pub extern "C" fn irodori_connector_call_json(
    request: IrodoriConnectorBuffer,
) -> IrodoriConnectorBuffer {
    ${dispatcherModule}::call_json(request)
}

#[no_mangle]
pub extern "C" fn irodori_connector_free_buffer(buffer: IrodoriConnectorBuffer) {
    abi::free_owned_buffer(buffer);
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

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

    fn buffer_to_string(buffer: IrodoriConnectorBuffer) -> String {
        let bytes = unsafe { std::slice::from_raw_parts(buffer.ptr, buffer.len) };
        let value = std::str::from_utf8(bytes).unwrap().to_string();
        irodori_connector_free_buffer(buffer);
        value
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
        assert_eq!(config["runtime"]["driverLinked"], json!(${realDriverLinked}));
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
    fn abi_exports_owned_json() {
        assert_eq!(irodori_extension_abi_version(), ABI_VERSION);
        assert_eq!(buffer_to_string(irodori_connector_engine_json()), ENGINE);
        assert_eq!(buffer_to_string(irodori_extension_manifest_json()), MANIFEST_JSON);
        assert_eq!(buffer_to_string(irodori_connector_config_json()), CONFIG_JSON);
    }

    #[test]
    fn call_json_reports_health_and_describes_metadata() {
        let health = call(r#"{"method":"health"}"#);
        assert_eq!(health["ok"], true);
        assert_eq!(health["engine"], ENGINE);
        assert_eq!(health["driverLinked"], json!(${realDriverLinked}));

        let describe = call(r#"{"method":"describe"}"#);
        assert_eq!(describe["ok"], true);
        assert_eq!(describe["driverLinked"], json!(${realDriverLinked}));
        assert_eq!(describe["manifest"]["id"], describe["config"]["extensionId"]);
        assert_eq!(describe["config"]["connector"]["engine"], ENGINE);
    }
${driverOperationTest}
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

function abiRust() {
  return `#![allow(dead_code)]

use serde_json::{json, Value};

#[repr(C)]
#[derive(Clone, Copy)]
pub struct IrodoriConnectorBuffer {
    pub ptr: *const u8,
    pub len: usize,
}

pub fn owned_buffer(value: String) -> IrodoriConnectorBuffer {
    let mut bytes = value.into_bytes().into_boxed_slice();
    let buffer = IrodoriConnectorBuffer {
        ptr: bytes.as_mut_ptr(),
        len: bytes.len(),
    };
    std::mem::forget(bytes);
    buffer
}

pub fn json_buffer(value: Value) -> IrodoriConnectorBuffer {
    owned_buffer(value.to_string())
}

pub fn free_owned_buffer(buffer: IrodoriConnectorBuffer) {
    if buffer.ptr.is_null() {
        return;
    }
    unsafe {
        let slice = std::ptr::slice_from_raw_parts_mut(buffer.ptr as *mut u8, buffer.len);
        drop(Box::from_raw(slice));
    }
}

pub fn buffer_to_string(buffer: IrodoriConnectorBuffer) -> Result<String, ()> {
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

pub fn ok(mut payload: serde_json::Map<String, Value>) -> IrodoriConnectorBuffer {
    payload.insert("ok".to_string(), Value::Bool(true));
    json_buffer(Value::Object(payload))
}

pub fn error(code: &str, message: impl Into<String>) -> IrodoriConnectorBuffer {
    json_buffer(json!({
        "ok": false,
        "error": {
            "code": code,
            "message": message.into()
        }
    }))
}

pub fn parse_request(buffer: IrodoriConnectorBuffer) -> Result<Option<Value>, IrodoriConnectorBuffer> {
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

pub fn request_method(request: Option<&Value>) -> Result<&str, IrodoriConnectorBuffer> {
    match request {
        None => Ok("health"),
        Some(value) => value
            .get("method")
            .and_then(Value::as_str)
            .filter(|method| !method.trim().is_empty())
            .ok_or_else(|| error("connector.invalidRequest", "Connector request needs a string method.")),
    }
}

pub fn string_field<'a>(value: &'a Value, field: &str) -> Option<&'a str> {
    value
        .get(field)
        .and_then(Value::as_str)
        .filter(|text| !text.trim().is_empty())
}

pub fn profile_field<'a>(request: &'a Value, field: &str) -> Option<&'a str> {
    string_field(request, field).or_else(|| {
        request
            .get("profile")
            .and_then(|profile| string_field(profile, field))
    })
}

pub fn connection_id(request: Option<&Value>) -> String {
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

pub fn max_rows(request: &Value) -> usize {
    request
        .get("maxRows")
        .or_else(|| request.get("limit"))
        .and_then(Value::as_u64)
        .unwrap_or(10_000)
        .clamp(1, 100_000) as usize
}
`;
}

function stubRust() {
  return `use serde_json::{json, Value};

use crate::abi::{self, IrodoriConnectorBuffer};
use crate::{ABI_VERSION, CONFIG_JSON, ENGINE, MANIFEST_JSON};

const NOT_LINKED_MESSAGE: &str = "The native connector metadata is available, but the engine-specific driver entrypoint is not linked in this package yet.";

pub fn call_json(request: IrodoriConnectorBuffer) -> IrodoriConnectorBuffer {
    let request = match abi::parse_request(request) {
        Ok(request) => request,
        Err(response) => return response,
    };
    let method = match abi::request_method(request.as_ref()) {
        Ok(method) => method,
        Err(response) => return response,
    };

    match method {
        "health" | "ping" => abi::ok(serde_json::Map::from_iter([
            ("engine".to_string(), Value::String(ENGINE.to_string())),
            ("abiVersion".to_string(), json!(ABI_VERSION)),
            ("driverLinked".to_string(), Value::Bool(false)),
        ])),
        "describe" | "capabilities" => abi::ok(serde_json::Map::from_iter([
            ("engine".to_string(), Value::String(ENGINE.to_string())),
            ("abiVersion".to_string(), json!(ABI_VERSION)),
            ("driverLinked".to_string(), Value::Bool(false)),
            (
                "manifest".to_string(),
                serde_json::from_str(MANIFEST_JSON).unwrap_or(Value::Null),
            ),
            (
                "config".to_string(),
                serde_json::from_str(CONFIG_JSON).unwrap_or(Value::Null),
            ),
        ])),
        "manifest" => abi::owned_buffer(MANIFEST_JSON.to_string()),
        "config" => abi::owned_buffer(CONFIG_JSON.to_string()),
        _ => abi::error("connector.driverNotLinked", NOT_LINKED_MESSAGE),
    }
}
`;
}

function duckDbDriverRust() {
  return `use std::collections::{BTreeMap, HashMap};
use std::sync::{Mutex, OnceLock};

use serde_json::{json, Value};

use crate::abi::{self, IrodoriConnectorBuffer};
use crate::{ABI_VERSION, CONFIG_JSON, ENGINE, MANIFEST_JSON};

static CONNECTIONS: OnceLock<Mutex<HashMap<String, duckdb::Connection>>> = OnceLock::new();

#[derive(Default)]
struct ObjectMeta {
    schema: String,
    name: String,
    kind: String,
    columns: Vec<Value>,
}

type QueryRows = Vec<Vec<Value>>;
type QueryOutput = (Vec<String>, QueryRows, bool);

fn connections() -> &'static Mutex<HashMap<String, duckdb::Connection>> {
    CONNECTIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn call_json(request: IrodoriConnectorBuffer) -> IrodoriConnectorBuffer {
    let request = match abi::parse_request(request) {
        Ok(request) => request,
        Err(response) => return response,
    };
    let method = match abi::request_method(request.as_ref()) {
        Ok(method) => method,
        Err(response) => return response,
    };

    match method {
        "health" | "ping" => abi::ok(serde_json::Map::from_iter([
            ("engine".to_string(), Value::String(ENGINE.to_string())),
            ("abiVersion".to_string(), json!(ABI_VERSION)),
            ("driverLinked".to_string(), Value::Bool(true)),
        ])),
        "describe" | "capabilities" => abi::ok(serde_json::Map::from_iter([
            ("engine".to_string(), Value::String(ENGINE.to_string())),
            ("abiVersion".to_string(), json!(ABI_VERSION)),
            ("driverLinked".to_string(), Value::Bool(true)),
            (
                "manifest".to_string(),
                serde_json::from_str(MANIFEST_JSON).unwrap_or(Value::Null),
            ),
            (
                "config".to_string(),
                serde_json::from_str(CONFIG_JSON).unwrap_or(Value::Null),
            ),
        ])),
        "manifest" => abi::owned_buffer(MANIFEST_JSON.to_string()),
        "config" => abi::owned_buffer(CONFIG_JSON.to_string()),
        "connect" => connect(request.as_ref().expect("connect has request")),
        "query" => query(request.as_ref().expect("query has request")),
        "metadata" => metadata(request.as_ref().expect("metadata has request")),
        "close" => close(request.as_ref().expect("close has request")),
        other => abi::error(
            "connector.unknownMethod",
            format!("unknown connector method: {other}"),
        ),
    }
}

fn connect(request: &Value) -> IrodoriConnectorBuffer {
    let connection_id = abi::connection_id(Some(request));
    let database = abi::profile_field(request, "database").or_else(|| abi::profile_field(request, "url"));
    let conn = match database.map(str::trim) {
        None | Some("") | Some(":memory:") => duckdb::Connection::open_in_memory(),
        Some(path) => duckdb::Connection::open(path),
    };
    let conn = match conn {
        Ok(conn) => conn,
        Err(err) => return abi::error("connector.connectFailed", format!("connect failed: {err}")),
    };
    let server_version = duckdb_version(&conn).unwrap_or_else(|| "unknown".to_string());
    if should_seed_sample(request, &connection_id) {
        if let Err(err) = seed_sample(&conn) {
            return abi::error("connector.seedFailed", err);
        }
    }
    let mut guard = match connections().lock() {
        Ok(guard) => guard,
        Err(_) => {
            return abi::error(
                "connector.statePoisoned",
                "Connector connection state is poisoned.",
            )
        }
    };
    guard.insert(connection_id.clone(), conn);
    abi::ok(serde_json::Map::from_iter([
        ("engine".to_string(), Value::String(ENGINE.to_string())),
        ("connectionId".to_string(), Value::String(connection_id)),
        ("serverVersion".to_string(), Value::String(server_version)),
        ("driverLinked".to_string(), Value::Bool(true)),
    ]))
}

fn query(request: &Value) -> IrodoriConnectorBuffer {
    let connection_id = abi::connection_id(Some(request));
    let Some(sql) = abi::string_field(request, "sql") else {
        return abi::error(
            "connector.invalidRequest",
            "query requires a string sql field.",
        );
    };
    let mut guard = match connections().lock() {
        Ok(guard) => guard,
        Err(_) => {
            return abi::error(
                "connector.statePoisoned",
                "Connector connection state is poisoned.",
            )
        }
    };
    let Some(conn) = guard.get_mut(&connection_id) else {
        return abi::error(
            "connector.connectionNotFound",
            format!("no open connection: {connection_id}"),
        );
    };
    match run_query(conn, sql, abi::max_rows(request)) {
        Ok((columns, rows, truncated)) => abi::ok(serde_json::Map::from_iter([
            ("connectionId".to_string(), Value::String(connection_id)),
            (
                "columns".to_string(),
                Value::Array(columns.into_iter().map(Value::String).collect()),
            ),
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
        Err(err) => abi::error("connector.queryFailed", err),
    }
}

fn metadata(request: &Value) -> IrodoriConnectorBuffer {
    let connection_id = abi::connection_id(Some(request));
    let mut guard = match connections().lock() {
        Ok(guard) => guard,
        Err(_) => {
            return abi::error(
                "connector.statePoisoned",
                "Connector connection state is poisoned.",
            )
        }
    };
    let Some(conn) = guard.get_mut(&connection_id) else {
        return abi::error(
            "connector.connectionNotFound",
            format!("no open connection: {connection_id}"),
        );
    };
    match load_metadata(conn) {
        Ok(metadata) => abi::ok(serde_json::Map::from_iter([
            ("connectionId".to_string(), Value::String(connection_id)),
            ("metadata".to_string(), metadata),
        ])),
        Err(err) => abi::error("connector.metadataFailed", err),
    }
}

fn close(request: &Value) -> IrodoriConnectorBuffer {
    let connection_id = abi::connection_id(Some(request));
    let mut guard = match connections().lock() {
        Ok(guard) => guard,
        Err(_) => {
            return abi::error(
                "connector.statePoisoned",
                "Connector connection state is poisoned.",
            )
        }
    };
    let existed = guard.remove(&connection_id).is_some();
    abi::ok(serde_json::Map::from_iter([
        ("connectionId".to_string(), Value::String(connection_id)),
        ("closed".to_string(), Value::Bool(existed)),
    ]))
}

fn duckdb_version(conn: &duckdb::Connection) -> Option<String> {
    conn.query_row("select version()", [], |row| row.get::<_, String>(0))
        .ok()
}

fn should_seed_sample(request: &Value, connection_id: &str) -> bool {
    request
        .get("seedSample")
        .or_else(|| request.get("profile").and_then(|profile| profile.get("seedSample")))
        .and_then(Value::as_bool)
        .unwrap_or(matches!(connection_id, "duckdb-memory" | "motherduck-memory"))
}

fn seed_sample(conn: &duckdb::Connection) -> Result<(), String> {
    conn.execute_batch("create table if not exists customers (id integer, name varchar);")
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
) -> Result<QueryOutput, String> {
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
        Some(stmt) => stmt
            .column_names()
            .iter()
            .map(|column| column.to_string())
            .collect(),
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
            "select table_schema, table_name, table_type \\
             from information_schema.tables \\
             where table_schema not in ('information_schema', 'pg_catalog') \\
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
        let (schema, name, table_type) =
            row.map_err(|err| format!("metadata objects failed: {err}"))?;
        let kind = if table_type.eq_ignore_ascii_case("VIEW") {
            "view"
        } else {
            "table"
        };
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
            "select table_schema, table_name, column_name, data_type, is_nullable, ordinal_position \\
             from information_schema.columns \\
             where table_schema not in ('information_schema', 'pg_catalog') \\
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

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    use crate::{
        irodori_connector_call_json, irodori_connector_free_buffer, IrodoriConnectorBuffer,
    };

    fn buffer_from_str(value: &'static str) -> IrodoriConnectorBuffer {
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
}
`;
}

function readme(entry, engineMeta, visibility, realDriverLinked, connection, experience, dialectDefinition) {
  const publicNote =
    visibility === "public"
      ? "This connector is listed in the public Irodori extension marketplace."
      : "This connector is internal and intentionally omitted from the public Irodori extension marketplace.";
  const adapter = engineMeta.adapter ?? engineMeta.routesThrough ?? null;
  const sourceNote = adapter
    ? `A desktop adapter source snapshot is staged in \`native/source/\` from \`${adapter}\`.`
    : "No desktop adapter source exists yet; this package starts from the refactored ABI shim and connector metadata.";
  const driverNote = realDriverLinked
    ? "The Rust code keeps native ABI exports in `src/lib.rs`, shared buffer/JSON helpers in `src/abi.rs`, and DuckDB-compatible connect/query/metadata behavior in `src/driver.rs`."
    : "The Rust code keeps native ABI exports in `src/lib.rs`, shared buffer/JSON helpers in `src/abi.rs`, and metadata-only behavior in `src/stub.rs` until the engine driver is linked.";
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
DuckDB-linked builds share \`../target\` across sibling extension repositories. Normal \`make check\` and CI set \`DUCKDB_DOWNLOAD_LIB=1\` so libduckdb comes from the prebuilt upstream archive instead of a local C++ build. Run \`make check-duckdb-bundled\` only when a fully self-contained DuckDB build is required, because it compiles libduckdb C++ and can consume significant CPU.
`
    : `
Generated extension repositories share \`../target\` across sibling repositories so Rust dependencies are compiled once per checkout. DuckDB and MotherDuck are driver-linked by default; set \`IRODORI_CONNECTOR_LINK_DUCKDB=0\` only when you need metadata-only DuckDB-compatible scaffolds.
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

${dialectReadme(dialectDefinition)}${experienceReadme(experience)}## ABI Calls

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

function dialectReadme(dialectDefinition) {
  if (!dialectDefinition) {
    return "";
  }
  const aliases = dialectDefinition.aliases.map((alias) => `\`${alias}\``).join(", ");
  const formatter = dialectDefinition.formatter ?? {};
  return `## SQL Dialect

- Dialect ID: \`${dialectDefinition.id}\`
- Aliases: ${aliases}
- Formatter provider: \`${formatter.provider ?? "default"}\`
- Formatter command: \`${formatter.command ?? "default"}\`
- Keyword case: \`${formatter.keywordCase ?? "preserve"}\`
- Identifier quote: \`${formatter.identifierQuote ?? ""}\`
- Line width: \`${formatter.lineWidth ?? "default"}\`
- Indent width: \`${formatter.indentWidth ?? "default"}\`

`;
}

function experienceReadme(experience) {
  if (!experience) {
    return "";
  }
  const domains = experience.domains.map((domain) => `\`${domain}\``).join(", ");
  const resultViews = experience.resultViews.map((view) => `\`${view}\``).join(", ");
  const inspiredBy = experience.inspiredBy.map((item) => `\`${item}\``).join(", ");
  const workflows = experience.workflows
    .map(
      (workflowItem) =>
        `| ${escapeMarkdownTable(workflowItem.label)} | ${escapeMarkdownTable(workflowItem.resultView)} | ${escapeMarkdownTable(workflowItem.templateIds.join(", "))} |`,
    )
    .join("\n");
  const templates = experience.queryTemplates
    .map(
      (template) =>
        `| \`${template.id}\` | ${escapeMarkdownTable(template.label)} | \`${template.language}\` | \`${template.resultView}\` |`,
    )
    .join("\n");
  return `## Experience Metadata

- Domains: ${domains}
- Result views: ${resultViews}
- Inspired by: ${inspiredBy}

| Workflow | Result view | Templates |
|---|---|---|
${workflows}

| Template | Label | Language | Result view |
|---|---|---|---|
${templates}

`;
}

function escapeMarkdownTable(value) {
  return String(value).replace(/\|/g, "\\|");
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
entrypoints live in \`src/lib.rs\`, shared ABI helpers live in \`src/abi.rs\`, and
engine behavior lives in \`src/stub.rs\` or \`src/driver.rs\`. Engine-specific
connect/query/metadata code should move from these snapshots into that behavior
module as the connector runtime contract is wired into the desktop app.

## Migration Snapshots

| Kind | Source | Destination | SHA-256 |
|---|---|---|---|
${migrationRows}

Engine status from \`knowledge/engines.json\`: \`${engineMeta.status}\`.
`;
}

function makefile(repoName, crateName, realDriverLinked) {
  const lintCommand = realDriverLinked
    ? "DUCKDB_DOWNLOAD_LIB=1 $(CARGO) clippy --all-targets --no-default-features -- -D warnings"
    : "$(CARGO) clippy --all-targets -- -D warnings";
  const buildCommand = realDriverLinked
    ? "DUCKDB_DOWNLOAD_LIB=1 $(CARGO) build --release --no-default-features"
    : "$(CARGO) build --release";
  const testCommand = realDriverLinked
    ? "DUCKDB_DOWNLOAD_LIB=1 $(CARGO) test --no-default-features"
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
EXTENSION_PACKAGE := ${repoName}.tar.gz
LIB_NAME := ${crateName}
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
\t${buildCommand}

test:
\t${testCommand}

package: build
\tmkdir -p dist/native
\trm -f dist/native/libirodori_extension_*.so dist/native/irodori_extension_*.dll dist/native/libirodori_extension_*.dylib
\tcp $(CARGO_TARGET_DIR)/release/lib$(LIB_NAME).so dist/native/ 2>/dev/null || true
\tcp $(CARGO_TARGET_DIR)/release/$(LIB_NAME).dll dist/native/ 2>/dev/null || true
\tcp $(CARGO_TARGET_DIR)/release/lib$(LIB_NAME).dylib dist/native/ 2>/dev/null || true
\ttar -czf dist/$(EXTENSION_PACKAGE) README.md LICENSE-MIT LICENSE-0BSD connector.config.json connector.source.json irodori.extension.json dist/native

clean:
\t$(CARGO) clean
`;
}

function gitignore() {
  return `/target
/.irodori-dev
dist/*.tar.gz
dist/native/*
!dist/native/.gitkeep
`;
}

function ciWorkflow(realDriverLinked) {
  const clippyCommand = realDriverLinked
    ? "DUCKDB_DOWNLOAD_LIB=1 cargo clippy --all-targets --no-default-features -- -D warnings"
    : "cargo clippy --all-targets -- -D warnings";
  const testCommand = realDriverLinked
    ? "DUCKDB_DOWNLOAD_LIB=1 cargo test --no-default-features"
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
