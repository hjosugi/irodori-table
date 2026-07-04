import { migrationBuildPlan } from "@/generated/irodori-api";
import type {
  DbEngine,
  MigrationPlanExportFormat,
  MigrationPlanInput,
  MigrationPlanOutput,
} from "@/generated/irodori-api";

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

export type MigrationExportFormat = MigrationPlanExportFormat;
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

export type MigrationPlan = MigrationPlanOutput;
export type MigrationTask = MigrationPlanOutput["tasks"][number];
export type MigrationHashAlgorithm = "md5";

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
      return plan.sourceSql || "-- Migration plan is not ready yet.";
    case "target":
      return plan.targetSql || "-- Migration plan is not ready yet.";
    case "diff":
      return plan.diffSql || "-- Migration plan is not ready yet.";
    case "runbook":
      return plan.runbook || "Migration plan is not ready yet.";
    default:
      return [
        `# ${plan.title}`,
        "",
        "## Validation Gates",
        ...(plan.tasks.length > 0
          ? plan.tasks.map((task) => `- ${task.title}: ${task.detail}`)
          : ["- Migration plan is not ready yet."]),
        "",
        "## Engine Notes",
        ...(plan.pairNotes.length > 0
          ? plan.pairNotes.map((note) => `- ${note}`)
          : ["- No engine notes generated yet."]),
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

export function migrationPlanInputFromDraft(
  draft: MigrationDraft,
): MigrationPlanInput {
  return {
    sourceEngine: draft.sourceEngine,
    targetEngine: draft.targetEngine,
    sourceVersion: draft.sourceVersion,
    targetVersion: draft.targetVersion,
    sourceTable: draft.sourceTable,
    targetTable: draft.targetTable,
    keyColumnsText: draft.keyColumnsText,
    compareColumnsText: draft.compareColumnsText,
    partitionColumn: draft.partitionColumn,
    partitionPredicate: draft.partitionPredicate,
    exportFormat: draft.exportFormat,
    batchSize: clampInteger(draft.batchSize, 1_000, 100_000_000),
    diffLimit: clampInteger(draft.diffLimit, 10, 100_000),
    nullToken: draft.nullToken || defaultMigrationDraft.nullToken,
    delimiter: draft.delimiter || defaultMigrationDraft.delimiter,
    normalizeWhitespace: draft.normalizeWhitespace,
    normalizeCase: draft.normalizeCase,
  };
}

export async function buildMigrationPlan(
  draft: MigrationDraft,
): Promise<MigrationPlan> {
  return migrationBuildPlan(migrationPlanInputFromDraft(draft));
}

export function createMigrationPlanPlaceholder(
  draft: MigrationDraft,
  warning?: string,
): MigrationPlan {
  const sourceLabel = migrationEngineLabel(draft.sourceEngine);
  const targetLabel = migrationEngineLabel(draft.targetEngine);
  const keys = parseColumnList(draft.keyColumnsText);
  const compareColumns = parseColumnList(draft.compareColumnsText);
  const hashColumns = compareColumns.length > 0 ? compareColumns : keys;
  const title =
    `${sourceLabel} ${draft.sourceVersion || ""} -> ${targetLabel} ${
      draft.targetVersion || ""
    }`
      .replace(/\s+/g, " ")
      .trim();

  return {
    title,
    sourceLabel,
    targetLabel,
    hashAlgorithm: "md5" satisfies MigrationHashAlgorithm,
    hashAlgorithmLabel: "MD5",
    keys,
    compareColumns,
    hashColumns,
    warnings: warning ? [warning] : [],
    tasks: [
      {
        title: warning ? "Planner unavailable" : "Build plan",
        detail: warning ?? "Waiting for the native migration planner.",
        level: warning ? "risk" : "manual",
      },
    ],
    pairNotes: [],
    sourceSql: "",
    targetSql: "",
    diffSql: "",
    runbook: "",
  };
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
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(value);
  }
  return result;
}
