import type { DbEngine } from "@/generated/irodori-api";

export type MigrationEngine = Extract<
  DbEngine,
  | "postgres"
  | "mysql"
  | "mariadb"
  | "oracle"
  | "snowflake"
  | "hive"
  | "duckdb"
  | "iceberg"
  | "s3Tables"
  | "redshift"
  | "databricks"
  | "trinoPresto"
>;

export type MigrationExportFormat = "parquet" | "csv";
export type MigrationOutputKind =
  | "overview"
  | "source"
  | "target"
  | "diff"
  | "runbook";

export type MigrationDraft = {
  sourceEngine: MigrationEngine;
  targetEngine: MigrationEngine;
  sourceVersion: string;
  targetVersion: string;
  sourceTable: string;
  targetTable: string;
  keyColumnsText: string;
  compareColumnsText: string;
  partitionColumn: string;
  partitionPredicate: string;
  exportFormat: MigrationExportFormat;
  batchSize: number;
  diffLimit: number;
  nullToken: string;
  delimiter: string;
  normalizeWhitespace: boolean;
  normalizeCase: boolean;
};

export type MigrationTask = {
  title: string;
  detail: string;
  level: "ready" | "manual" | "risk";
};

export type MigrationPlan = {
  title: string;
  sourceLabel: string;
  targetLabel: string;
  keys: string[];
  compareColumns: string[];
  hashColumns: string[];
  warnings: string[];
  tasks: MigrationTask[];
  pairNotes: string[];
  sourceSql: string;
  targetSql: string;
  diffSql: string;
  runbook: string;
};

export const migrationEngineOptions: Array<{
  value: MigrationEngine;
  label: string;
}> = [
  { value: "hive", label: "Apache Hive" },
  { value: "snowflake", label: "Snowflake" },
  { value: "duckdb", label: "DuckDB / DuckDB-Wasm" },
  { value: "iceberg", label: "Apache Iceberg REST" },
  { value: "s3Tables", label: "AWS S3 Tables" },
  { value: "postgres", label: "PostgreSQL" },
  { value: "oracle", label: "Oracle" },
  { value: "mysql", label: "MySQL" },
  { value: "mariadb", label: "MariaDB" },
  { value: "redshift", label: "Redshift" },
  { value: "databricks", label: "Databricks / Spark SQL" },
  { value: "trinoPresto", label: "Trino / Presto" },
];

export const migrationOutputTabs: Array<{
  value: MigrationOutputKind;
  label: string;
}> = [
  { value: "overview", label: "Plan" },
  { value: "source", label: "Source SQL" },
  { value: "target", label: "Target SQL" },
  { value: "diff", label: "Diff SQL" },
  { value: "runbook", label: "Runbook" },
];

export const defaultMigrationDraft: MigrationDraft = {
  sourceEngine: "hive",
  targetEngine: "snowflake",
  sourceVersion: "Hive 2/3",
  targetVersion: "Snowflake",
  sourceTable: "legacy.orders",
  targetTable: "analytics.orders",
  keyColumnsText: "order_id\nline_id",
  compareColumnsText: [
    "order_id",
    "line_id",
    "customer_id",
    "status",
    "amount",
    "updated_at",
  ].join("\n"),
  partitionColumn: "sales_dt",
  partitionPredicate: "sales_dt >= '2026-01-01'",
  exportFormat: "parquet",
  batchSize: 5_000_000,
  diffLimit: 1_000,
  nullToken: "__IRODORI_NULL__",
  delimiter: "|#|",
  normalizeWhitespace: true,
  normalizeCase: false,
};

const migrationEngineLabels: Record<MigrationEngine, string> =
  migrationEngineOptions.reduce(
    (labels, option) => ({ ...labels, [option.value]: option.label }),
    {} as Record<MigrationEngine, string>,
  );

export function migrationEngineLabel(engine: MigrationEngine) {
  return migrationEngineLabels[engine] ?? engine;
}

export function migrationOutputText(
  plan: MigrationPlan,
  kind: MigrationOutputKind,
) {
  switch (kind) {
    case "source":
      return plan.sourceSql;
    case "target":
      return plan.targetSql;
    case "diff":
      return plan.diffSql;
    case "runbook":
      return plan.runbook;
    default:
      return [
        `# ${plan.title}`,
        "",
        "## Validation Gates",
        ...plan.tasks.map((task) => `- ${task.title}: ${task.detail}`),
        "",
        "## Engine Notes",
        ...plan.pairNotes.map((note) => `- ${note}`),
        "",
        "## Warnings",
        ...(plan.warnings.length > 0
          ? plan.warnings.map((warning) => `- ${warning}`)
          : ["- No blocking warning generated."]),
      ].join("\n");
  }
}

export function parseColumnList(value: string) {
  return uniqueCaseInsensitive(
    value
      .split(/[\n,]+/)
      .map((part) => part.trim())
      .filter(Boolean),
  );
}

export function buildMigrationPlan(draft: MigrationDraft): MigrationPlan {
  const sourceLabel = migrationEngineLabel(draft.sourceEngine);
  const targetLabel = migrationEngineLabel(draft.targetEngine);
  const keys = parseColumnList(draft.keyColumnsText);
  const compareColumns = parseColumnList(draft.compareColumnsText);
  const hashColumns = compareColumns.length > 0 ? compareColumns : keys;
  const normalizedDraft = {
    ...draft,
    batchSize: clampInteger(draft.batchSize, 1_000, 100_000_000),
    diffLimit: clampInteger(draft.diffLimit, 10, 100_000),
    nullToken: draft.nullToken || defaultMigrationDraft.nullToken,
    delimiter: draft.delimiter || defaultMigrationDraft.delimiter,
  };
  const sourceHashSql = buildRowHashSelectSql(
    normalizedDraft.sourceEngine,
    normalizedDraft.sourceTable,
    keys,
    hashColumns,
    normalizedDraft.partitionPredicate,
    normalizedDraft,
  );
  const targetHashSql = buildRowHashSelectSql(
    normalizedDraft.targetEngine,
    normalizedDraft.targetTable,
    keys,
    hashColumns,
    normalizedDraft.partitionPredicate,
    normalizedDraft,
  );
  const sourceSql = [
    sourceExtractionSql(normalizedDraft, keys, hashColumns, sourceHashSql),
    statement(
      buildFingerprintSql(normalizedDraft.sourceEngine, sourceHashSql, keys),
    ),
  ]
    .filter(Boolean)
    .join("\n\n");
  const targetSql = [
    targetLoadSql(normalizedDraft),
    statement(
      buildManifestTableSql(
        normalizedDraft.targetEngine,
        keys,
        normalizedDraft.partitionColumn,
      ),
    ),
    statement(
      buildFingerprintSql(normalizedDraft.targetEngine, targetHashSql, keys),
    ),
  ]
    .filter(Boolean)
    .join("\n\n");
  const diffSql = statement(buildDiffSql(normalizedDraft.targetEngine, keys, normalizedDraft));
  const warnings = buildWarnings(normalizedDraft, keys, compareColumns);
  const pairNotes = buildPairNotes(normalizedDraft);
  const tasks = buildTasks(normalizedDraft, keys, hashColumns);
  const title = `${sourceLabel} ${normalizedDraft.sourceVersion || ""} -> ${targetLabel} ${
    normalizedDraft.targetVersion || ""
  }`
    .replace(/\s+/g, " ")
    .trim();

  return {
    title,
    sourceLabel,
    targetLabel,
    keys,
    compareColumns,
    hashColumns,
    warnings,
    tasks,
    pairNotes,
    sourceSql,
    targetSql,
    diffSql,
    runbook: buildRunbook(title, normalizedDraft, keys, hashColumns, warnings, pairNotes),
  };
}

function sourceExtractionSql(
  draft: MigrationDraft,
  keys: readonly string[],
  hashColumns: readonly string[],
  sourceHashSql: string,
) {
  if (draft.sourceEngine === "hive") {
    return statement(buildHiveExportSql(draft, keys, hashColumns));
  }
  if (isDuckDbLakehouseEngine(draft.sourceEngine)) {
    return statement(
      [buildDuckDbIcebergBootstrapSql(draft.sourceEngine), sourceHashSql]
        .filter(Boolean)
        .join("\n\n"),
    );
  }
  return statement(sourceHashSql);
}

function targetLoadSql(draft: MigrationDraft) {
  if (draft.targetEngine === "snowflake") {
    return buildSnowflakeLoadSql(draft);
  }
  if (isDuckDbLakehouseEngine(draft.targetEngine)) {
    return buildDuckDbIcebergLoadSql(draft);
  }
  return [
    "-- Load the exported files with the target engine's bulk loader.",
    "-- Keep the irodori_row_hash column in a staging or manifest table until validation passes.",
  ].join("\n");
}

function buildDuckDbIcebergBootstrapSql(engine: MigrationEngine) {
  const label = migrationEngineLabel(engine);
  return [
    `-- ${label} via DuckDB: local/browser compute with Iceberg REST Catalog access.`,
    "-- DuckDB-Wasm runs this shape inside a browser tab; desktop DuckDB runs the same SQL locally.",
    "INSTALL httpfs;",
    "LOAD httpfs;",
    "INSTALL iceberg;",
    "LOAD iceberg;",
    "",
    "CREATE OR REPLACE SECRET irodori_s3_secret (",
    "  TYPE S3,",
    "  KEY_ID '${AWS_ACCESS_KEY_ID}',",
    "  SECRET '${AWS_SECRET_ACCESS_KEY}',",
    "  REGION '${AWS_REGION}'",
    ");",
    "",
    "ATTACH '${ICEBERG_WAREHOUSE}' AS irodori_iceberg (",
    "  TYPE ICEBERG,",
    "  ENDPOINT_URL '${ICEBERG_REST_ENDPOINT}'",
    ");",
    "",
    "-- For AWS S3 Tables, use the S3 Tables bucket ARN as ICEBERG_WAREHOUSE.",
    "-- Browser caution: never put real credentials into a shareable URL.",
  ].join("\n");
}

function buildDuckDbIcebergLoadSql(draft: MigrationDraft) {
  const scan =
    draft.exportFormat === "parquet"
      ? "read_parquet('${EXPORT_PATH}/*.parquet')"
      : "read_csv_auto('${EXPORT_PATH}/*.csv')";
  return [
    buildDuckDbIcebergBootstrapSql(draft.targetEngine),
    "",
    "-- First-load pattern. For incremental loads, INSERT/MERGE after DDL and partition mapping are validated.",
    `CREATE OR REPLACE TABLE ${tableRef(draft.targetEngine, draft.targetTable)} AS`,
    `SELECT * FROM ${scan};`,
    "",
    "-- Keep source/target hash manifests available until row count, key count, fingerprint, and row-level diff pass.",
  ].join("\n");
}

function buildHiveExportSql(
  draft: MigrationDraft,
  keys: readonly string[],
  hashColumns: readonly string[],
) {
  const dataColumns = uniqueCaseInsensitive([...keys, ...hashColumns]);
  const selectColumns = dataColumns.map((column) => `  ${columnRef("hive", column)}`);
  const hash = buildRowHashExpression("hive", hashColumns, draft);
  const where = whereClause(draft.partitionPredicate);
  const storedAs =
    draft.exportFormat === "parquet"
      ? "STORED AS PARQUET"
      : "ROW FORMAT DELIMITED FIELDS TERMINATED BY ',' STORED AS TEXTFILE";

  return [
    "-- Hive extraction: partitioned files plus deterministic row hashes.",
    "SET hive.execution.engine=tez;",
    "SET hive.vectorized.execution.enabled=true;",
    "SET hive.exec.compress.output=true;",
    "",
    "INSERT OVERWRITE DIRECTORY '${EXPORT_PATH}'",
    storedAs,
    "SELECT",
    [...selectColumns, `  ${hash} AS irodori_row_hash`].join(",\n"),
    `FROM ${tableRef("hive", draft.sourceTable)}`,
    where,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function buildSnowflakeLoadSql(draft: MigrationDraft) {
  const formatName = "irodori_migration_file_format";
  const stageName = "irodori_migration_stage";
  const fileFormat =
    draft.exportFormat === "parquet"
      ? `CREATE OR REPLACE FILE FORMAT ${formatName} TYPE = PARQUET USE_VECTORIZED_SCANNER = TRUE;`
      : [
          `CREATE OR REPLACE FILE FORMAT ${formatName}`,
          "  TYPE = CSV",
          "  FIELD_DELIMITER = ','",
          "  SKIP_HEADER = 1",
          "  FIELD_OPTIONALLY_ENCLOSED_BY = '\"'",
          "  NULL_IF = ('', 'NULL');",
        ].join("\n");

  return [
    "-- Snowflake load: point the stage at the exported Hive files.",
    fileFormat,
    `CREATE OR REPLACE STAGE ${stageName} FILE_FORMAT = ${formatName};`,
    "",
    `COPY INTO ${tableRef("snowflake", draft.targetTable)}`,
    `FROM @${stageName}`,
    "MATCH_BY_COLUMN_NAME = CASE_INSENSITIVE",
    `FILE_FORMAT = (FORMAT_NAME = ${formatName});`,
  ].join("\n");
}

function buildRowHashSelectSql(
  engine: MigrationEngine,
  table: string,
  keys: readonly string[],
  hashColumns: readonly string[],
  predicate: string,
  draft: MigrationDraft,
) {
  const dataColumns = uniqueCaseInsensitive([...keys, ...hashColumns]);
  const selectColumns = dataColumns.map((column) => `  ${columnRef(engine, column)}`);
  const hash = buildRowHashExpression(engine, hashColumns, draft);
  const where = whereClause(predicate);

  return [
    "-- Row hash manifest query.",
    "SELECT",
    [...selectColumns, `  ${hash} AS irodori_row_hash`].join(",\n"),
    `FROM ${tableRef(engine, table)}`,
    where,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function buildFingerprintSql(
  engine: MigrationEngine,
  rowHashSql: string,
  keys: readonly string[],
) {
  const keyValues = keys.map((key) =>
    normalizedColumnValue(engine, key, {
      nullToken: "__IRODORI_NULL__",
      delimiter: "|#|",
      normalizeWhitespace: false,
      normalizeCase: false,
    }),
  );
  const keyCount =
    keys.length > 0
      ? `COUNT(DISTINCT ${buildConcatExpression(engine, keyValues)}) AS key_count,`
      : "0 AS key_count,";

  return [
    "-- Fast validation fingerprint. Use this before running row-level diff.",
    "WITH row_hashes AS (",
    indent(rowHashSql),
    ")",
    "SELECT",
    "  COUNT(*) AS row_count,",
    `  ${keyCount}`,
    "  MIN(irodori_row_hash) AS min_row_hash,",
    "  MAX(irodori_row_hash) AS max_row_hash",
    "FROM row_hashes",
  ].join("\n");
}

function buildManifestTableSql(
  engine: MigrationEngine,
  keys: readonly string[],
  partitionColumn: string,
) {
  const textType = stringType(engine);
  const columns = [
    ...keys.map((key) => `  ${identifierRef(engine, key)} ${textType}`),
    `  irodori_row_hash ${textType}`,
    partitionColumn.trim() ? `  irodori_partition ${textType}` : null,
  ].filter(Boolean);

  return [
    "-- Manifest tables hold source and target row hashes for fast diff.",
    `CREATE OR REPLACE TEMP TABLE ${tableRef(engine, "irodori_source_manifest")} (`,
    columns.join(",\n"),
    ");",
    "",
    `CREATE OR REPLACE TEMP TABLE ${tableRef(engine, "irodori_target_manifest")} (`,
    columns.join(",\n"),
    ")",
  ].join("\n");
}

function buildDiffSql(
  engine: MigrationEngine,
  keys: readonly string[],
  draft: MigrationDraft,
) {
  if (keys.length === 0) {
    return [
      "-- Row-level diff needs a stable business key.",
      "-- Add key columns, regenerate this plan, then load both manifest tables.",
    ].join("\n");
  }

  const keyProjection = keys
    .map((key) => {
      const ref = identifierRef(engine, key);
      return `  COALESCE(s.${ref}, t.${ref}) AS ${ref}`;
    })
    .join(",\n");
  const join = keys
    .map((key) => {
      const ref = identifierRef(engine, key);
      return `s.${ref} = t.${ref}`;
    })
    .join("\n  AND ");
  const orderBy = keys
    .map((_, index) => String(index + 1))
    .join(", ");

  return [
    "-- High-signal diff: missing rows first, changed rows with both hashes.",
    "WITH source_rows AS (",
    `  SELECT * FROM ${tableRef(engine, "irodori_source_manifest")}`,
    "),",
    "target_rows AS (",
    `  SELECT * FROM ${tableRef(engine, "irodori_target_manifest")}`,
    ")",
    "SELECT",
    keyProjection + ",",
    "  CASE",
    "    WHEN s.irodori_row_hash IS NULL THEN 'target_only'",
    "    WHEN t.irodori_row_hash IS NULL THEN 'source_only'",
    "    ELSE 'changed'",
    "  END AS diff_kind,",
    "  s.irodori_row_hash AS source_hash,",
    "  t.irodori_row_hash AS target_hash",
    "FROM source_rows s",
    "FULL OUTER JOIN target_rows t",
    `  ON ${join}`,
    "WHERE s.irodori_row_hash IS NULL",
    "   OR t.irodori_row_hash IS NULL",
    "   OR s.irodori_row_hash <> t.irodori_row_hash",
    `ORDER BY ${orderBy}`,
    limitClause(engine, draft.diffLimit),
  ]
    .filter(Boolean)
    .join("\n");
}

function buildRowHashExpression(
  engine: MigrationEngine,
  columns: readonly string[],
  draft: Pick<
    MigrationDraft,
    "nullToken" | "delimiter" | "normalizeWhitespace" | "normalizeCase"
  >,
) {
  const hashColumns = columns.length > 0 ? columns : ["*"];
  if (hashColumns.includes("*")) {
    return "'configure_compare_columns_before_hashing'";
  }
  const values = hashColumns.map((column) =>
    normalizedColumnValue(engine, column, draft),
  );
  const concatenated = buildConcatExpression(engine, values, draft.delimiter);

  switch (engine) {
    case "oracle":
      return `LOWER(RAWTOHEX(STANDARD_HASH(${concatenated}, 'SHA256')))`;
    case "mysql":
    case "mariadb":
      return `LOWER(SHA2(${concatenated}, 256))`;
    default:
      return `LOWER(MD5(${concatenated}))`;
  }
}

function isDuckDbLakehouseEngine(engine: MigrationEngine) {
  return engine === "iceberg" || engine === "s3Tables";
}

function normalizedColumnValue(
  engine: MigrationEngine,
  column: string,
  draft: Pick<
    MigrationDraft,
    "nullToken" | "delimiter" | "normalizeWhitespace" | "normalizeCase"
  >,
) {
  const ref = columnRef(engine, column);
  let value: string;
  switch (engine) {
    case "postgres":
    case "redshift":
      value = `CAST(${ref} AS TEXT)`;
      break;
    case "oracle":
      value = `TO_CHAR(${ref})`;
      break;
    case "snowflake":
      value = `TO_VARCHAR(${ref})`;
      break;
    case "mysql":
    case "mariadb":
      value = `CAST(${ref} AS CHAR)`;
      break;
    case "duckdb":
    case "iceberg":
    case "s3Tables":
      value = `CAST(${ref} AS VARCHAR)`;
      break;
    case "hive":
    case "databricks":
    case "trinoPresto":
      value = `CAST(${ref} AS STRING)`;
      break;
    default:
      value = `CAST(${ref} AS STRING)`;
  }
  if (draft.normalizeWhitespace) {
    value = regexpReplaceWhitespace(engine, value);
  }
  if (draft.normalizeCase) {
    value = `LOWER(${value})`;
  }
  return `COALESCE(${value}, ${sqlString(draft.nullToken)})`;
}

function regexpReplaceWhitespace(engine: MigrationEngine, value: string) {
  if (engine === "postgres" || engine === "redshift") {
    return `REGEXP_REPLACE(${value}, '\\s+', ' ', 'g')`;
  }
  return `REGEXP_REPLACE(${value}, '\\s+', ' ')`;
}

function buildConcatExpression(
  engine: MigrationEngine,
  values: readonly string[],
  delimiter = "|#|",
) {
  if (values.length === 0) {
    return "''";
  }
  if (engine === "oracle") {
    return values.join(` || ${sqlString(delimiter)} || `);
  }
  return `CONCAT_WS(${sqlString(delimiter)}, ${values.join(", ")})`;
}

function buildWarnings(
  draft: MigrationDraft,
  keys: readonly string[],
  compareColumns: readonly string[],
) {
  const warnings: string[] = [];
  if (!draft.sourceTable.trim() || !draft.targetTable.trim()) {
    warnings.push("Source and target table names are required before execution.");
  }
  if (keys.length === 0) {
    warnings.push("A stable business key is required for row-level diff.");
  }
  if (compareColumns.length === 0) {
    warnings.push("Compare columns are empty, so only key columns will be hashed.");
  }
  if (draft.sourceEngine === "hive" && draft.exportFormat !== "parquet") {
    warnings.push("Hive CSV extraction is slower and riskier than Parquet for Snowflake loads.");
  }
  if (draft.sourceEngine === "oracle" || draft.targetEngine === "oracle") {
    warnings.push("Oracle empty string, NLS date format, NUMBER precision, and timezone semantics need explicit mapping.");
  }
  if (draft.sourceEngine === "mysql" || draft.targetEngine === "mysql") {
    warnings.push("MySQL zero dates, unsigned numerics, charset, and collation can change comparison hashes.");
  }
  if (draft.targetEngine === "snowflake") {
    warnings.push("Snowflake quoted identifiers are case-sensitive. Keep generated identifiers aligned with table DDL.");
  }
  if (
    isDuckDbLakehouseEngine(draft.sourceEngine) ||
    isDuckDbLakehouseEngine(draft.targetEngine)
  ) {
    warnings.push("Browser DuckDB/Iceberg flows must keep credentials out of shareable URLs and exported runbooks.");
    warnings.push("Iceberg REST Catalog and object-store endpoints must be reachable from the browser/runtime, including CORS where applicable.");
  }
  return warnings;
}

function buildPairNotes(draft: MigrationDraft) {
  const pair = `${draft.sourceEngine}->${draft.targetEngine}`;
  const notes = [
    "Use an inventory scan before moving data: schema, row counts, partitions, primary keys, nullability, and incompatible types.",
    "Use recipe-style transforms for DDL and SQL rewrites, then gate every batch with count, hash, and sampled row checks.",
  ];

  if (pair === "hive->snowflake") {
    notes.unshift(
      "Hive -> Snowflake: export partitioned Parquet, stage files, COPY into Snowflake, then compare source and target hash manifests inside Snowflake.",
      "Avoid row-by-row JDBC extraction from Hive for large tables; push projection, partition predicates, and hashing down to Hive.",
    );
  }
  if (draft.sourceEngine === "oracle" && draft.targetEngine === "postgres") {
    notes.unshift(
      "Oracle -> PostgreSQL: map NUMBER precision, DATE/TIMESTAMP timezone behavior, empty string NULL behavior, sequences, and LOB columns before data compare.",
    );
  }
  if (draft.sourceEngine === "mysql" && draft.targetEngine === "oracle") {
    notes.unshift(
      "MySQL -> Oracle: map AUTO_INCREMENT, unsigned integers, zero dates, text/blob limits, and case/collation before hash validation.",
    );
  }
  if (
    isDuckDbLakehouseEngine(draft.sourceEngine) ||
    isDuckDbLakehouseEngine(draft.targetEngine)
  ) {
    notes.unshift(
      "DuckDB/Iceberg: use DuckDB as the client-is-the-server compute layer, attaching the Iceberg REST Catalog directly and keeping validation local.",
      "For S3 Tables, treat the bucket ARN as the Iceberg warehouse and keep catalog credentials in a secure connection profile, not in URL fragments.",
    );
  }
  if (draft.targetEngine === "snowflake") {
    notes.push(
      "For very large tables, compare by partition or hash bucket first, then run row-level diff only for failed buckets.",
    );
  }
  return notes;
}

function buildTasks(
  draft: MigrationDraft,
  keys: readonly string[],
  hashColumns: readonly string[],
): MigrationTask[] {
  return [
    {
      title: "Inventory",
      detail: `${draft.sourceTable || "source table"} -> ${draft.targetTable || "target table"} with ${keys.length} key column(s).`,
      level: keys.length > 0 ? "ready" : "risk",
    },
    {
      title: "Extract",
      detail:
        draft.sourceEngine === "hive"
          ? `${draft.exportFormat.toUpperCase()} export with pushed-down row hash and partition predicate.`
          : isDuckDbLakehouseEngine(draft.sourceEngine)
            ? "Attach the Iceberg REST Catalog in DuckDB and materialize a source hash manifest locally."
            : "Run the source row hash query and persist the result as a manifest.",
      level: "manual",
    },
    {
      title: "Validate",
      detail: `${hashColumns.length} compare column(s), row count, key count, and min/max hash fingerprint before row diff.`,
      level: hashColumns.length > 0 ? "ready" : "risk",
    },
    {
      title: "Diff",
      detail: `Load both manifests into ${migrationEngineLabel(draft.targetEngine)} and inspect the first ${draft.diffLimit.toLocaleString()} mismatches.`,
      level: keys.length > 0 ? "ready" : "risk",
    },
  ];
}

function buildRunbook(
  title: string,
  draft: MigrationDraft,
  keys: readonly string[],
  hashColumns: readonly string[],
  warnings: readonly string[],
  notes: readonly string[],
) {
  return [
    `# ${title}`,
    "",
    "## 1. Inventory",
    `- Source: ${migrationEngineLabel(draft.sourceEngine)} ${draft.sourceVersion || ""} / ${draft.sourceTable || "(missing)"}`,
    `- Target: ${migrationEngineLabel(draft.targetEngine)} ${draft.targetVersion || ""} / ${draft.targetTable || "(missing)"}`,
    `- Keys: ${keys.length > 0 ? keys.join(", ") : "(missing)"}`,
    `- Hash columns: ${hashColumns.length > 0 ? hashColumns.join(", ") : "(missing)"}`,
    "",
    "## 2. Recipe Plan",
    "- Build source schema inventory, type mapping, and SQL rewrite recipes before data movement.",
    "- Treat DDL conversion and application modernization like recipe-based automation: scan, propose, apply, verify.",
    "- Keep a migration scorecard: unsupported types, lossy casts, timezone handling, and manual cutover items.",
    "",
    "## 3. Extract And Load",
    `- Batch size target: ${draft.batchSize.toLocaleString()} rows per partition or bucket.`,
    `- Partition predicate: ${draft.partitionPredicate || "(none)"}`,
    "- Persist a source hash manifest before loading target data.",
    "- Load data first, then create the target hash manifest from the loaded table.",
    "",
    "## 4. Compare Gates",
    "- Gate 1: row count and key count match.",
    "- Gate 2: min/max hash fingerprint matches for each partition or hash bucket.",
    "- Gate 3: row-level FULL OUTER JOIN diff returns zero rows.",
    "- Gate 4: sampled value-level checks for failed hashes and high-risk data types.",
    "",
    "## 5. Notes",
    ...notes.map((note) => `- ${note}`),
    "",
    "## 6. Warnings",
    ...(warnings.length > 0
      ? warnings.map((warning) => `- ${warning}`)
      : ["- No blocking warning generated."]),
  ].join("\n");
}

function tableRef(engine: MigrationEngine, name: string) {
  const trimmed = name.trim();
  if (!trimmed) {
    return "(missing_table)";
  }
  return trimmed
    .split(".")
    .map((part) => identifierRef(engine, part))
    .join(".");
}

function columnRef(engine: MigrationEngine, name: string) {
  return name
    .split(".")
    .map((part) => identifierRef(engine, part))
    .join(".");
}

function identifierRef(engine: MigrationEngine, value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return '""';
  }
  if (
    trimmed.startsWith('"') ||
    trimmed.startsWith("`") ||
    trimmed.includes("(") ||
    trimmed.includes(")")
  ) {
    return trimmed;
  }
  if (/^[A-Za-z_][A-Za-z0-9_$]*$/.test(trimmed)) {
    return trimmed;
  }
  const quote = engine === "mysql" || engine === "mariadb" || engine === "hive" ? "`" : '"';
  return `${quote}${trimmed.split(quote).join(quote + quote)}${quote}`;
}

function whereClause(predicate: string) {
  const trimmed = predicate.trim();
  return trimmed ? `WHERE ${trimmed}` : "";
}

function limitClause(engine: MigrationEngine, value: number) {
  const limit = clampInteger(value, 10, 100_000);
  if (engine === "oracle") {
    return `FETCH FIRST ${limit} ROWS ONLY`;
  }
  return `LIMIT ${limit}`;
}

function stringType(engine: MigrationEngine) {
  switch (engine) {
    case "oracle":
      return "VARCHAR2(4000)";
    case "mysql":
    case "mariadb":
      return "VARCHAR(4000)";
    case "duckdb":
    case "iceberg":
    case "s3Tables":
      return "VARCHAR";
    case "snowflake":
      return "STRING";
    default:
      return "TEXT";
  }
}

function statement(sql: string) {
  const trimmed = sql.trim();
  if (!trimmed || trimmed.endsWith(";")) {
    return trimmed;
  }
  return `${trimmed};`;
}

function sqlString(value: string) {
  return `'${value.split("'").join("''")}'`;
}

function indent(value: string) {
  return value
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

function clampInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

function uniqueCaseInsensitive(values: readonly string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(value);
  }
  return result;
}
