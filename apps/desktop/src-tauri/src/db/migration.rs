use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::engine::DbEngine;
use super::{DbError, DbResult};
use irodori_error::{IrodoriError, Result as IrodoriResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum MigrationPlanExportFormat {
    Parquet,
    Csv,
    Tsv,
}

impl From<MigrationPlanExportFormat> for irodori_migration::MigrationExportFormat {
    fn from(format: MigrationPlanExportFormat) -> Self {
        match format {
            MigrationPlanExportFormat::Parquet => Self::Parquet,
            MigrationPlanExportFormat::Csv => Self::Csv,
            MigrationPlanExportFormat::Tsv => Self::Tsv,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct MigrationPlanInput {
    pub source_engine: DbEngine,
    pub target_engine: DbEngine,
    pub source_version: String,
    pub target_version: String,
    pub source_table: String,
    pub target_table: String,
    pub key_columns_text: String,
    pub compare_columns_text: String,
    pub partition_column: String,
    pub partition_predicate: String,
    pub export_format: MigrationPlanExportFormat,
    pub batch_size: u32,
    pub diff_limit: u32,
    pub null_token: String,
    pub delimiter: String,
    pub normalize_whitespace: bool,
    pub normalize_case: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum MigrationPlanTaskLevel {
    Ready,
    Manual,
    Risk,
}

impl From<irodori_migration::MigrationTaskLevel> for MigrationPlanTaskLevel {
    fn from(level: irodori_migration::MigrationTaskLevel) -> Self {
        match level {
            irodori_migration::MigrationTaskLevel::Ready => Self::Ready,
            irodori_migration::MigrationTaskLevel::Manual => Self::Manual,
            irodori_migration::MigrationTaskLevel::Risk => Self::Risk,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct MigrationPlanTask {
    pub title: String,
    pub detail: String,
    pub level: MigrationPlanTaskLevel,
}

impl From<irodori_migration::MigrationTask> for MigrationPlanTask {
    fn from(task: irodori_migration::MigrationTask) -> Self {
        Self {
            title: task.title,
            detail: task.detail,
            level: task.level.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct MigrationPlanOutput {
    pub title: String,
    pub source_label: String,
    pub target_label: String,
    pub hash_algorithm: String,
    pub hash_algorithm_label: String,
    pub keys: Vec<String>,
    pub compare_columns: Vec<String>,
    pub hash_columns: Vec<String>,
    pub warnings: Vec<String>,
    pub tasks: Vec<MigrationPlanTask>,
    pub pair_notes: Vec<String>,
    pub source_sql: String,
    pub target_sql: String,
    pub diff_sql: String,
    pub runbook: String,
}

impl From<irodori_migration::MigrationPlan> for MigrationPlanOutput {
    fn from(plan: irodori_migration::MigrationPlan) -> Self {
        Self {
            title: plan.title,
            source_label: plan.source_label,
            target_label: plan.target_label,
            hash_algorithm: "md5".to_string(),
            hash_algorithm_label: "MD5".to_string(),
            keys: plan.keys,
            compare_columns: plan.compare_columns,
            hash_columns: plan.hash_columns,
            warnings: plan.warnings,
            tasks: plan.tasks.into_iter().map(Into::into).collect(),
            pair_notes: plan.pair_notes,
            source_sql: plan.source_sql,
            target_sql: plan.target_sql,
            diff_sql: plan.diff_sql,
            runbook: plan.runbook,
        }
    }
}

#[tauri::command]
pub fn migration_build_plan(input: MigrationPlanInput) -> IrodoriResult<MigrationPlanOutput> {
    let spec = migration_spec_from_input(input).map_err(IrodoriError::from)?;
    irodori_migration::try_build_migration_plan(&spec)
        .map(Into::into)
        .map_err(|error| IrodoriError::from(DbError::validation(error.to_string())))
}

fn migration_spec_from_input(
    input: MigrationPlanInput,
) -> DbResult<irodori_migration::MigrationSpec> {
    let defaults = irodori_migration::MigrationSpec::default();

    Ok(irodori_migration::MigrationSpec {
        source_engine: migration_engine(input.source_engine)?,
        target_engine: migration_engine(input.target_engine)?,
        source_version: input.source_version,
        target_version: input.target_version,
        source_table: input.source_table,
        target_table: input.target_table,
        key_columns: irodori_migration::parse_column_list(&input.key_columns_text),
        compare_columns: irodori_migration::parse_column_list(&input.compare_columns_text),
        partition_column: input.partition_column,
        partition_predicate: input.partition_predicate,
        export_format: input.export_format.into(),
        batch_size: u64::from(input.batch_size),
        diff_limit: input.diff_limit as usize,
        hash_bucket_prefix_len: defaults.hash_bucket_prefix_len,
        null_token: input.null_token,
        delimiter: input.delimiter,
        normalize_whitespace: input.normalize_whitespace,
        normalize_case: input.normalize_case,
    })
}

fn migration_engine(engine: DbEngine) -> DbResult<irodori_migration::MigrationEngine> {
    match engine {
        DbEngine::Postgres => Ok(irodori_migration::MigrationEngine::Postgres),
        DbEngine::Mysql => Ok(irodori_migration::MigrationEngine::MySql),
        DbEngine::MariaDb => Ok(irodori_migration::MigrationEngine::MariaDb),
        DbEngine::Oracle => Ok(irodori_migration::MigrationEngine::Oracle),
        DbEngine::Snowflake => Ok(irodori_migration::MigrationEngine::Snowflake),
        DbEngine::Hive => Ok(irodori_migration::MigrationEngine::Hive),
        DbEngine::DuckDb => Ok(irodori_migration::MigrationEngine::DuckDb),
        DbEngine::Iceberg => Ok(irodori_migration::MigrationEngine::Iceberg),
        DbEngine::S3Tables => Ok(irodori_migration::MigrationEngine::S3Tables),
        DbEngine::Redshift => Ok(irodori_migration::MigrationEngine::Redshift),
        DbEngine::Databricks => Ok(irodori_migration::MigrationEngine::Databricks),
        DbEngine::TrinoPresto => Ok(irodori_migration::MigrationEngine::TrinoPresto),
        other => Err(DbError::unsupported(format!(
            "{other:?} is not supported by Migration Studio"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> MigrationPlanInput {
        MigrationPlanInput {
            source_engine: DbEngine::Postgres,
            target_engine: DbEngine::Mysql,
            source_version: "PostgreSQL 16".to_string(),
            target_version: "MySQL 8".to_string(),
            source_table: "public.orders".to_string(),
            target_table: "analytics.orders".to_string(),
            key_columns_text: "id".to_string(),
            compare_columns_text: "id\namount\nupdated_at".to_string(),
            partition_column: String::new(),
            partition_predicate: String::new(),
            export_format: MigrationPlanExportFormat::Parquet,
            batch_size: 5_000_000,
            diff_limit: 1_000,
            null_token: "__IRODORI_NULL__".to_string(),
            delimiter: "|#|".to_string(),
            normalize_whitespace: true,
            normalize_case: false,
        }
    }

    #[test]
    fn command_uses_native_md5_plan() {
        let plan = migration_build_plan(input()).expect("build migration plan");

        assert_eq!(plan.hash_algorithm, "md5");
        assert_eq!(plan.hash_algorithm_label, "MD5");
        assert!(plan.source_sql.contains("MD5"));
        assert!(plan.target_sql.contains("MD5"));
        assert!(!plan.source_sql.contains("blake3"));
        assert!(!plan.target_sql.contains("blake3"));
    }

    #[test]
    fn command_returns_typed_planner_error() {
        let mut input = input();
        input.key_columns_text.clear();

        let error = migration_build_plan(input).expect_err("missing key should fail closed");

        assert_eq!(error.kind, irodori_error::IrodoriErrorKind::Validation);
        assert!(error.message.contains("stable key column"));
    }
}
