import type { DbEngine } from "../generated/irodori-api";

export type SqlSnippetScope = "statement" | "expression" | "clause";

export interface SqlSnippetDefinition {
  label: string;
  detail: string;
  template: string;
  scope: SqlSnippetScope;
  rank?: number;
  engines?: readonly DbEngine[];
}

const SNIPPET_LABEL_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;

export const DEFAULT_SNIPPET_RANK = 500;

export const sqlSnippetEngines = [
  "postgres",
  "mysql",
  "sqlite",
  "oracle",
  "sqlserver",
  "duckdb",
  "motherduck",
  "cockroachdb",
  "yugabytedb",
  "redshift",
  "timescaledb",
  "mariadb",
  "tidb",
  "neon",
  "h2",
  "clickhouse",
  "snowflake",
  "bigquery",
  "athena",
  "cloudSpanner",
  "trinoPresto",
  "firebird",
  "databricks",
  "questdb",
  "hive",
  "iceberg",
  "s3Tables",
  "deltaLake",
  "hudi",
] as const satisfies readonly DbEngine[];

const sqlSnippetEngineSet = new Set<string>(sqlSnippetEngines);

const postgresFamily = [
  "postgres",
  "cockroachdb",
  "yugabytedb",
  "timescaledb",
  "neon",
] as const satisfies readonly DbEngine[];

const mysqlFamily = [
  "mysql",
  "mariadb",
  "tidb",
] as const satisfies readonly DbEngine[];

const duckFamily = [
  "duckdb",
  "motherduck",
] as const satisfies readonly DbEngine[];

const postgresConflictEngines = [
  ...postgresFamily,
  "sqlite",
  ...duckFamily,
] as const satisfies readonly DbEngine[];

const limitEngines = [
  ...postgresFamily,
  ...mysqlFamily,
  ...duckFamily,
  "sqlite",
  "redshift",
  "h2",
  "clickhouse",
  "snowflake",
  "bigquery",
  "athena",
  "cloudSpanner",
  "trinoPresto",
  "databricks",
  "questdb",
  "hive",
  "iceberg",
  "s3Tables",
  "deltaLake",
  "hudi",
] as const satisfies readonly DbEngine[];

const fetchFirstEngines = [
  "oracle",
  "firebird",
] as const satisfies readonly DbEngine[];

const topEngines = ["sqlserver"] as const satisfies readonly DbEngine[];

const explicitTransactionEngines = [
  ...postgresFamily,
  ...mysqlFamily,
  ...duckFamily,
  "sqlite",
  "redshift",
  "h2",
  "snowflake",
  "firebird",
] as const satisfies readonly DbEngine[];

const noExplicitTransactionDmlEngines = [
  "bigquery",
  "athena",
  "cloudSpanner",
  "trinoPresto",
  "databricks",
  "questdb",
  "hive",
  "iceberg",
  "s3Tables",
  "deltaLake",
  "hudi",
] as const satisfies readonly DbEngine[];

const dmlEngines = [
  ...explicitTransactionEngines,
  ...noExplicitTransactionDmlEngines,
  ...fetchFirstEngines,
  ...topEngines,
] as const satisfies readonly DbEngine[];

const returningEngines = [
  ...postgresFamily,
  "sqlite",
  ...duckFamily,
] as const satisfies readonly DbEngine[];

const mergeEngines = [
  "oracle",
  "sqlserver",
  ...duckFamily,
  "redshift",
  "snowflake",
  "bigquery",
  "databricks",
  "hive",
  "iceberg",
  "s3Tables",
  "deltaLake",
  "hudi",
] as const satisfies readonly DbEngine[];

const indexEngines = [
  ...postgresFamily,
  ...mysqlFamily,
  ...duckFamily,
  "sqlite",
  "oracle",
  "sqlserver",
  "redshift",
  "h2",
  "firebird",
] as const satisfies readonly DbEngine[];

const lockForUpdateEngines = [
  ...postgresFamily,
  ...mysqlFamily,
  "oracle",
] as const satisfies readonly DbEngine[];

const lakehouseEngines = [
  "duckdb",
  "motherduck",
  "athena",
  "databricks",
  "hive",
  "iceberg",
  "s3Tables",
  "deltaLake",
  "hudi",
] as const satisfies readonly DbEngine[];

type SqlSnippetDraft = Omit<SqlSnippetDefinition, "engines">;

function snippet(
  engines: readonly DbEngine[],
  definition: SqlSnippetDraft,
): SqlSnippetDefinition {
  return { ...definition, engines: [...engines] };
}

export const defaultSqlSnippets: readonly SqlSnippetDefinition[] = [
  snippet(sqlSnippetEngines, {
    label: "sel",
    detail: "select statement",
    template: "select ${1:*}\nfrom ${2:table}\nwhere ${3:condition};\n${0}",
    rank: 540,
    scope: "statement",
  }),
  snippet(limitEngines, {
    label: "selw",
    detail: "select with where/order/limit",
    template:
      "select ${1:*}\nfrom ${2:table}\nwhere ${3:condition}\norder by ${4:column}\nlimit ${5:100};\n${0}",
    rank: 535,
    scope: "statement",
  }),
  snippet(fetchFirstEngines, {
    label: "selw",
    detail: "select with where/order/fetch first",
    template:
      "select ${1:*}\nfrom ${2:table}\nwhere ${3:condition}\norder by ${4:column}\nfetch first ${5:100} rows only;\n${0}",
    rank: 535,
    scope: "statement",
  }),
  snippet(topEngines, {
    label: "selw",
    detail: "select with top/where/order",
    template:
      "select top (${5:100}) ${1:*}\nfrom ${2:table}\nwhere ${3:condition}\norder by ${4:column};\n${0}",
    rank: 535,
    scope: "statement",
  }),
  snippet(sqlSnippetEngines, {
    label: "cte",
    detail: "with common table expression",
    template:
      "with ${1:cte_name} as (\n  select ${2:*}\n  from ${3:table}\n)\nselect ${4:*}\nfrom ${1:cte_name};\n${0}",
    rank: 530,
    scope: "statement",
  }),
  snippet(dmlEngines, {
    label: "ins",
    detail: "insert statement",
    template:
      "insert into ${1:table} (${2:columns})\nvalues (${3:values});\n${0}",
    rank: 525,
    scope: "statement",
  }),
  snippet(dmlEngines, {
    label: "insel",
    detail: "insert from select",
    template:
      "insert into ${1:target_table} (${2:columns})\nselect ${2:columns}\nfrom ${3:source_table}\nwhere ${4:condition};\n${0}",
    rank: 523,
    scope: "statement",
  }),
  snippet(postgresConflictEngines, {
    label: "upsert",
    detail: "insert on conflict update",
    template:
      "insert into ${1:table} (${2:columns})\nvalues (${3:values})\non conflict (${4:key_column}) do update\nset ${5:column} = excluded.${5:column};\n${0}",
    rank: 520,
    scope: "statement",
  }),
  snippet(mysqlFamily, {
    label: "upsert",
    detail: "insert on duplicate key update",
    template:
      "insert into ${1:table} (${2:columns})\nvalues (${3:values})\non duplicate key update\n  ${4:column} = values(${4:column});\n${0}",
    rank: 520,
    scope: "statement",
  }),
  snippet(mergeEngines, {
    label: "upsert",
    detail: "merge upsert operation",
    template:
      "merge into ${1:target_table} as target\nusing ${2:source_table} as source\non ${3:target.id = source.id}\nwhen matched then update set\n  ${4:column} = source.${4:column}\nwhen not matched then insert (${5:columns})\nvalues (${6:source_columns});\n${0}",
    rank: 520,
    scope: "statement",
  }),
  snippet(dmlEngines, {
    label: "upd",
    detail: "update statement",
    template:
      "update ${1:table}\nset ${2:column} = ${3:value}\nwhere ${4:condition};\n${0}",
    rank: 525,
    scope: "statement",
  }),
  snippet(limitEngines, {
    label: "updop",
    detail: "update operation: preview/update/verify",
    template:
      "-- preview target rows\nselect *\nfrom ${1:table}\nwhere ${2:condition}\nlimit ${3:100};\n\nbegin;\n\nupdate ${1:table}\nset ${4:column} = ${5:value}\nwhere ${2:condition};\n\n-- verify after update before commit\nselect *\nfrom ${1:table}\nwhere ${2:condition}\nlimit ${3:100};\n\n-- commit;\nrollback;\n${0}",
    rank: 524,
    scope: "statement",
  }),
  snippet(fetchFirstEngines, {
    label: "updop",
    detail: "update operation: preview/update/verify",
    template:
      "-- preview target rows\nselect *\nfrom ${1:table}\nwhere ${2:condition}\nfetch first ${3:100} rows only;\n\nupdate ${1:table}\nset ${4:column} = ${5:value}\nwhere ${2:condition};\n\n-- verify after update before commit\nselect *\nfrom ${1:table}\nwhere ${2:condition}\nfetch first ${3:100} rows only;\n\n-- commit;\nrollback;\n${0}",
    rank: 524,
    scope: "statement",
  }),
  snippet(topEngines, {
    label: "updop",
    detail: "update operation: preview/update/verify",
    template:
      "-- preview target rows\nselect top (${3:100}) *\nfrom ${1:table}\nwhere ${2:condition};\n\nbegin transaction;\n\nupdate ${1:table}\nset ${4:column} = ${5:value}\nwhere ${2:condition};\n\n-- verify after update before commit\nselect top (${3:100}) *\nfrom ${1:table}\nwhere ${2:condition};\n\n-- commit transaction;\nrollback transaction;\n${0}",
    rank: 524,
    scope: "statement",
  }),
  snippet(noExplicitTransactionDmlEngines, {
    label: "updop",
    detail: "update operation: preview/update/verify",
    template:
      "-- preview target rows\nselect *\nfrom ${1:table}\nwhere ${2:condition}\nlimit ${3:100};\n\nupdate ${1:table}\nset ${4:column} = ${5:value}\nwhere ${2:condition};\n\n-- verify after update\nselect *\nfrom ${1:table}\nwhere ${2:condition}\nlimit ${3:100};\n${0}",
    rank: 524,
    scope: "statement",
  }),
  snippet(dmlEngines, {
    label: "touch",
    detail: "update audit timestamp",
    template:
      "update ${1:table}\nset ${2:updated_at} = current_timestamp\nwhere ${3:condition};\n${0}",
    rank: 510,
    scope: "statement",
  }),
  snippet(["bigquery"], {
    label: "touch",
    detail: "update audit timestamp",
    template:
      "update ${1:table}\nset ${2:updated_at} = current_timestamp()\nwhere ${3:condition};\n${0}",
    rank: 510,
    scope: "statement",
  }),
  snippet(dmlEngines, {
    label: "del",
    detail: "delete statement",
    template: "delete from ${1:table}\nwhere ${2:condition};\n${0}",
    rank: 525,
    scope: "statement",
  }),
  snippet(limitEngines, {
    label: "delop",
    detail: "delete operation: select/delete/select",
    template:
      "-- preview rows to delete\nselect count(*) as target_count\nfrom ${1:table}\nwhere ${2:condition};\n\nselect *\nfrom ${1:table}\nwhere ${2:condition}\nlimit ${3:100};\n\nbegin;\n\ndelete from ${1:table}\nwhere ${2:condition};\n\n-- verify no unexpected rows remain before commit\nselect count(*) as remaining_count\nfrom ${1:table}\nwhere ${2:condition};\n\n-- commit;\nrollback;\n${0}",
    rank: 524,
    scope: "statement",
  }),
  snippet(fetchFirstEngines, {
    label: "delop",
    detail: "delete operation: select/delete/select",
    template:
      "-- preview rows to delete\nselect count(*) as target_count\nfrom ${1:table}\nwhere ${2:condition};\n\nselect *\nfrom ${1:table}\nwhere ${2:condition}\nfetch first ${3:100} rows only;\n\ndelete from ${1:table}\nwhere ${2:condition};\n\n-- verify no unexpected rows remain before commit\nselect count(*) as remaining_count\nfrom ${1:table}\nwhere ${2:condition};\n\n-- commit;\nrollback;\n${0}",
    rank: 524,
    scope: "statement",
  }),
  snippet(topEngines, {
    label: "delop",
    detail: "delete operation: select/delete/select",
    template:
      "-- preview rows to delete\nselect count(*) as target_count\nfrom ${1:table}\nwhere ${2:condition};\n\nselect top (${3:100}) *\nfrom ${1:table}\nwhere ${2:condition};\n\nbegin transaction;\n\ndelete from ${1:table}\nwhere ${2:condition};\n\n-- verify no unexpected rows remain before commit\nselect count(*) as remaining_count\nfrom ${1:table}\nwhere ${2:condition};\n\n-- commit transaction;\nrollback transaction;\n${0}",
    rank: 524,
    scope: "statement",
  }),
  snippet(noExplicitTransactionDmlEngines, {
    label: "delop",
    detail: "delete operation: select/delete/select",
    template:
      "-- preview rows to delete\nselect count(*) as target_count\nfrom ${1:table}\nwhere ${2:condition};\n\nselect *\nfrom ${1:table}\nwhere ${2:condition}\nlimit ${3:100};\n\ndelete from ${1:table}\nwhere ${2:condition};\n\n-- verify no unexpected rows remain\nselect count(*) as remaining_count\nfrom ${1:table}\nwhere ${2:condition};\n${0}",
    rank: 524,
    scope: "statement",
  }),
  snippet(returningEngines, {
    label: "delret",
    detail: "delete returning rows",
    template:
      "delete from ${1:table}\nwhere ${2:condition}\nreturning ${3:*};\n${0}",
    rank: 512,
    scope: "statement",
  }),
  snippet(dmlEngines, {
    label: "softdel",
    detail: "soft delete operation",
    template:
      "update ${1:table}\nset ${2:deleted_at} = current_timestamp\nwhere ${3:condition};\n${0}",
    rank: 512,
    scope: "statement",
  }),
  snippet(["bigquery"], {
    label: "softdel",
    detail: "soft delete operation",
    template:
      "update ${1:table}\nset ${2:deleted_at} = current_timestamp()\nwhere ${3:condition};\n${0}",
    rank: 512,
    scope: "statement",
  }),
  snippet(explicitTransactionEngines, {
    label: "begin",
    detail: "safe transaction block",
    template: "begin;\n\n${1:statement}\n\n-- commit;\nrollback;\n${0}",
    rank: 524,
    scope: "statement",
  }),
  snippet(topEngines, {
    label: "begin",
    detail: "safe transaction block",
    template:
      "begin transaction;\n\n${1:statement}\n\n-- commit transaction;\nrollback transaction;\n${0}",
    rank: 524,
    scope: "statement",
  }),
  snippet(["oracle"], {
    label: "begin",
    detail: "PL/SQL block",
    template: "begin\n  ${1:null;}\nend;\n/\n${0}",
    rank: 524,
    scope: "statement",
  }),
  snippet([...explicitTransactionEngines, ...fetchFirstEngines], {
    label: "commit",
    detail: "commit transaction",
    template: "commit;\n${0}",
    rank: 500,
    scope: "statement",
  }),
  snippet(topEngines, {
    label: "commit",
    detail: "commit transaction",
    template: "commit transaction;\n${0}",
    rank: 500,
    scope: "statement",
  }),
  snippet([...explicitTransactionEngines, ...fetchFirstEngines], {
    label: "rollback",
    detail: "rollback transaction",
    template: "rollback;\n${0}",
    rank: 500,
    scope: "statement",
  }),
  snippet(topEngines, {
    label: "rollback",
    detail: "rollback transaction",
    template: "rollback transaction;\n${0}",
    rank: 500,
    scope: "statement",
  }),
  snippet(explicitTransactionEngines, {
    label: "sp",
    detail: "savepoint with rollback",
    template:
      "savepoint ${1:sp_name};\n\n${2:statement}\n\n-- rollback to savepoint ${1:sp_name};\n-- release savepoint ${1:sp_name};\n${0}",
    rank: 495,
    scope: "statement",
  }),
  snippet(["oracle"], {
    label: "sp",
    detail: "savepoint with rollback",
    template:
      "savepoint ${1:sp_name};\n\n${2:statement}\n\n-- rollback to ${1:sp_name};\n${0}",
    rank: 495,
    scope: "statement",
  }),
  snippet(topEngines, {
    label: "sp",
    detail: "savepoint with rollback",
    template:
      "save transaction ${1:sp_name};\n\n${2:statement}\n\n-- rollback transaction ${1:sp_name};\n${0}",
    rank: 495,
    scope: "statement",
  }),
  snippet(sqlSnippetEngines, {
    label: "join",
    detail: "join clause",
    template: "join ${1:table} on ${2:condition}${0}",
    rank: 520,
    scope: "clause",
  }),
  snippet(sqlSnippetEngines, {
    label: "case",
    detail: "case expression",
    template:
      "case\n  when ${1:condition} then ${2:value}\n  else ${3:fallback}\nend${0}",
    rank: 515,
    scope: "expression",
  }),
  snippet(sqlSnippetEngines, {
    label: "ct",
    detail: "create table",
    template:
      "create table ${1:table} (\n  ${2:id} ${3:integer} primary key,\n  ${4:created_at} ${5:timestamp}\n);\n${0}",
    rank: 510,
    scope: "statement",
  }),
  snippet(sqlSnippetEngines, {
    label: "ctas",
    detail: "create table as select",
    template:
      "create table ${1:new_table} as\nselect ${2:*}\nfrom ${3:source_table}\nwhere ${4:condition};\n${0}",
    rank: 508,
    scope: "statement",
  }),
  snippet(limitEngines, {
    label: "tempt",
    detail: "create temp staging table",
    template:
      "create temporary table ${1:staging_table} as\nselect ${2:*}\nfrom ${3:source_table}\nwhere ${4:condition};\n${0}",
    rank: 506,
    scope: "statement",
  }),
  snippet(["oracle"], {
    label: "tempt",
    detail: "create temp staging table",
    template:
      "create global temporary table ${1:staging_table}\non commit preserve rows as\nselect ${2:*}\nfrom ${3:source_table}\nwhere ${4:condition};\n${0}",
    rank: 506,
    scope: "statement",
  }),
  snippet(topEngines, {
    label: "tempt",
    detail: "create temp staging table",
    template:
      "select ${2:*}\ninto #${1:staging_table}\nfrom ${3:source_table}\nwhere ${4:condition};\n${0}",
    rank: 506,
    scope: "statement",
  }),
  snippet(indexEngines, {
    label: "idx",
    detail: "create index",
    template:
      "create index ${1:index_name}\non ${2:table} (${3:column});\n${0}",
    rank: 505,
    scope: "statement",
  }),
  snippet(sqlSnippetEngines, {
    label: "cnt",
    detail: "count rows with filter",
    template:
      "select count(*) as row_count\nfrom ${1:table}\nwhere ${2:condition};\n${0}",
    rank: 518,
    scope: "statement",
  }),
  snippet(limitEngines, {
    label: "sample",
    detail: "sample rows for inspection",
    template:
      "select *\nfrom ${1:table}\nwhere ${2:condition}\norder by ${3:column}\nlimit ${4:100};\n${0}",
    rank: 516,
    scope: "statement",
  }),
  snippet(fetchFirstEngines, {
    label: "sample",
    detail: "sample rows for inspection",
    template:
      "select *\nfrom ${1:table}\nwhere ${2:condition}\norder by ${3:column}\nfetch first ${4:100} rows only;\n${0}",
    rank: 516,
    scope: "statement",
  }),
  snippet(topEngines, {
    label: "sample",
    detail: "sample rows for inspection",
    template:
      "select top (${4:100}) *\nfrom ${1:table}\nwhere ${2:condition}\norder by ${3:column};\n${0}",
    rank: 516,
    scope: "statement",
  }),
  snippet(sqlSnippetEngines, {
    label: "exists",
    detail: "exists check",
    template:
      "select exists (\n  select 1\n  from ${1:table}\n  where ${2:condition}\n) as exists_flag;\n${0}",
    rank: 508,
    scope: "statement",
  }),
  snippet(limitEngines, {
    label: "dupes",
    detail: "find duplicate keys",
    template:
      "select ${1:key_column}, count(*) as duplicate_count\nfrom ${2:table}\ngroup by ${1:key_column}\nhaving count(*) > 1\norder by duplicate_count desc\nlimit ${3:100};\n${0}",
    rank: 506,
    scope: "statement",
  }),
  snippet(fetchFirstEngines, {
    label: "dupes",
    detail: "find duplicate keys",
    template:
      "select ${1:key_column}, count(*) as duplicate_count\nfrom ${2:table}\ngroup by ${1:key_column}\nhaving count(*) > 1\norder by duplicate_count desc\nfetch first ${3:100} rows only;\n${0}",
    rank: 506,
    scope: "statement",
  }),
  snippet(topEngines, {
    label: "dupes",
    detail: "find duplicate keys",
    template:
      "select top (${3:100}) ${1:key_column}, count(*) as duplicate_count\nfrom ${2:table}\ngroup by ${1:key_column}\nhaving count(*) > 1\norder by duplicate_count desc;\n${0}",
    rank: 506,
    scope: "statement",
  }),
  snippet(sqlSnippetEngines, {
    label: "nulls",
    detail: "profile null counts",
    template:
      "select\n  count(*) as row_count,\n  sum(case when ${1:column} is null then 1 else 0 end) as null_count\nfrom ${2:table};\n${0}",
    rank: 504,
    scope: "statement",
  }),
  snippet(postgresFamily, {
    label: "checksum",
    detail: "ordered row count and md5 fingerprint",
    template:
      "select\n  count(*) as row_count,\n  md5(string_agg(md5(concat_ws('|', ${1:columns})), '' order by ${2:key_column})) as data_hash\nfrom ${3:table}\nwhere ${4:condition};\n${0}",
    rank: 502,
    scope: "statement",
  }),
  snippet(mysqlFamily, {
    label: "checksum",
    detail: "ordered row count and md5 fingerprint",
    template:
      "select\n  count(*) as row_count,\n  md5(group_concat(md5(concat_ws('|', ${1:columns})) order by ${2:key_column} separator '')) as data_hash\nfrom ${3:table}\nwhere ${4:condition};\n${0}",
    rank: 502,
    scope: "statement",
  }),
  snippet(["sqlite"], {
    label: "checksum",
    detail: "ordered row count and md5-ready fingerprint input",
    template:
      "select\n  count(*) as row_count,\n  group_concat(${1:columns}, '|') as fingerprint_input\nfrom (\n  select ${1:columns}\n  from ${2:table}\n  where ${3:condition}\n  order by ${4:key_column}\n);\n${0}",
    rank: 502,
    scope: "statement",
  }),
  snippet(duckFamily, {
    label: "checksum",
    detail: "ordered row count and md5 fingerprint",
    template:
      "select\n  count(*) as row_count,\n  md5(string_agg(md5(concat_ws('|', ${1:columns})), '' order by ${2:key_column})) as data_hash\nfrom ${3:table}\nwhere ${4:condition};\n${0}",
    rank: 502,
    scope: "statement",
  }),
  snippet(["oracle"], {
    label: "checksum",
    detail: "ordered row count and sha256 fingerprint",
    template:
      "select\n  count(*) as row_count,\n  standard_hash(listagg(standard_hash(${1:column_expression}, 'SHA256'), '') within group (order by ${2:key_column}), 'SHA256') as data_hash\nfrom ${3:table}\nwhere ${4:condition};\n${0}",
    rank: 502,
    scope: "statement",
  }),
  snippet(topEngines, {
    label: "checksum",
    detail: "fast row count and checksum aggregate",
    template:
      "select\n  count(*) as row_count,\n  checksum_agg(binary_checksum(${1:columns})) as data_hash\nfrom ${2:table}\nwhere ${3:condition};\n${0}",
    rank: 502,
    scope: "statement",
  }),
  snippet(["snowflake"], {
    label: "checksum",
    detail: "ordered row count and sha2 fingerprint",
    template:
      "select\n  count(*) as row_count,\n  sha2(listagg(sha2(concat_ws('|', ${1:columns}), 256), '') within group (order by ${2:key_column}), 256) as data_hash\nfrom ${3:table}\nwhere ${4:condition};\n${0}",
    rank: 502,
    scope: "statement",
  }),
  snippet(["bigquery"], {
    label: "checksum",
    detail: "ordered row count and md5 fingerprint",
    template:
      "select\n  count(*) as row_count,\n  to_hex(md5(string_agg(to_hex(md5(to_json_string(struct(${1:columns})))), '' order by ${2:key_column}))) as data_hash\nfrom `${3:project.dataset.table}`\nwhere ${4:condition};\n${0}",
    rank: 502,
    scope: "statement",
  }),
  snippet(["hive", "databricks", "deltaLake", "hudi"], {
    label: "checksum",
    detail: "row count and distributed md5 fingerprint",
    template:
      "select\n  count(*) as row_count,\n  md5(concat_ws('', sort_array(collect_list(md5(concat_ws('|', ${1:columns})))))) as data_hash\nfrom ${2:table}\nwhere ${3:condition};\n${0}",
    rank: 502,
    scope: "statement",
  }),
  snippet(["athena", "trinoPresto", "iceberg", "s3Tables"], {
    label: "checksum",
    detail: "ordered row count and md5 fingerprint",
    template:
      "select\n  count(*) as row_count,\n  to_hex(md5(cast(array_join(array_agg(to_hex(md5(cast(json_format(cast(row(${1:columns}) as json)) as varbinary))) order by ${2:key_column}), '') as varbinary))) as data_hash\nfrom ${3:table}\nwhere ${4:condition};\n${0}",
    rank: 502,
    scope: "statement",
  }),
  snippet(["clickhouse"], {
    label: "checksum",
    detail: "row count and md5 fingerprint",
    template:
      "select\n  count() as row_count,\n  hex(MD5(arrayStringConcat(arraySort(groupArray(hex(MD5(concat(${1:columns}))))), ''))) as data_hash\nfrom ${2:table}\nwhere ${3:condition};\n${0}",
    rank: 502,
    scope: "statement",
  }),
  snippet(["redshift"], {
    label: "checksum",
    detail: "ordered row count and md5 fingerprint",
    template:
      "select\n  count(*) as row_count,\n  md5(listagg(md5(${1:column_expression}), '') within group (order by ${2:key_column})) as data_hash\nfrom ${3:table}\nwhere ${4:condition};\n${0}",
    rank: 502,
    scope: "statement",
  }),
  snippet(postgresFamily, {
    label: "explain",
    detail: "explain analyze query plan",
    template:
      "explain (analyze, buffers, verbose)\n${1:select * from table where condition};\n${0}",
    rank: 500,
    scope: "statement",
  }),
  snippet(mysqlFamily, {
    label: "explain",
    detail: "explain json query plan",
    template:
      "explain format=json\n${1:select * from table where condition};\n${0}",
    rank: 500,
    scope: "statement",
  }),
  snippet(["oracle"], {
    label: "explain",
    detail: "explain plan",
    template:
      "explain plan for\n${1:select * from table where condition};\n\nselect * from table(dbms_xplan.display);\n${0}",
    rank: 500,
    scope: "statement",
  }),
  snippet(topEngines, {
    label: "explain",
    detail: "show estimated execution plan",
    template:
      "set showplan_text on;\n${1:select * from table where condition};\nset showplan_text off;\n${0}",
    rank: 500,
    scope: "statement",
  }),
  snippet([...duckFamily, "snowflake", "bigquery", "athena", "trinoPresto", "hive", "databricks", "clickhouse", "redshift", "h2", "firebird", "iceberg", "s3Tables", "deltaLake", "hudi"], {
    label: "explain",
    detail: "explain query plan",
    template: "explain\n${1:select * from table where condition};\n${0}",
    rank: 500,
    scope: "statement",
  }),
  snippet(lockForUpdateEngines, {
    label: "lock",
    detail: "select rows for update",
    template:
      "select *\nfrom ${1:table}\nwhere ${2:condition}\nfor update;\n${0}",
    rank: 498,
    scope: "statement",
  }),
  snippet(topEngines, {
    label: "lock",
    detail: "select rows with update lock",
    template:
      "select *\nfrom ${1:table} with (updlock, rowlock)\nwhere ${2:condition};\n${0}",
    rank: 498,
    scope: "statement",
  }),
  snippet(mergeEngines, {
    label: "merge",
    detail: "merge/upsert operation",
    template:
      "merge into ${1:target_table} as target\nusing ${2:source_table} as source\non ${3:target.id = source.id}\nwhen matched then update set\n  ${4:column} = source.${4:column}\nwhen not matched then insert (${5:columns})\nvalues (${6:source_columns});\n${0}",
    rank: 496,
    scope: "statement",
  }),
  snippet(sqlSnippetEngines, {
    label: "win",
    detail: "window expression",
    template:
      "${1:sum}(${2:amount}) over (partition by ${3:group_column} order by ${4:sort_column})${0}",
    rank: 500,
    scope: "expression",
  }),
  snippet(explicitTransactionEngines, {
    label: "tx",
    detail: "transaction block",
    template: "begin;\n\n${1:statement}\n\n-- commit;\nrollback;\n${0}",
    rank: 495,
    scope: "statement",
  }),
  snippet(topEngines, {
    label: "tx",
    detail: "transaction block",
    template:
      "begin transaction;\n\n${1:statement}\n\n-- commit transaction;\nrollback transaction;\n${0}",
    rank: 495,
    scope: "statement",
  }),
  snippet(lakehouseEngines, {
    label: "readparquet",
    detail: "query parquet files",
    template:
      "select ${1:*}\nfrom read_parquet('${2:s3://bucket/path/*.parquet}')\nlimit ${3:100};\n${0}",
    rank: 490,
    scope: "statement",
  }),
  snippet(duckFamily, {
    label: "readcsv",
    detail: "query csv files",
    template:
      "select ${1:*}\nfrom read_csv('${2:path/to/file.csv}', header = true)\nlimit ${3:100};\n${0}",
    rank: 490,
    scope: "statement",
  }),
  snippet(["duckdb", "motherduck", "iceberg", "s3Tables"], {
    label: "attachiceberg",
    detail: "attach Iceberg REST catalog with DuckDB",
    template:
      "install httpfs;\nload httpfs;\ninstall iceberg;\nload iceberg;\n\ncreate secret ${1:s3_secret} (\n  type s3,\n  key_id '${2:AWS_ACCESS_KEY_ID}',\n  secret '${3:AWS_SECRET_ACCESS_KEY}',\n  region '${4:us-east-1}'\n);\n\nattach '${5:warehouse}' as ${6:iceberg_db} (\n  type iceberg,\n  endpoint_url '${7:https://catalog.example.com}'\n);\n${0}",
    rank: 488,
    scope: "statement",
  }),
  snippet(["iceberg", "s3Tables", "athena", "databricks"], {
    label: "snapshots",
    detail: "inspect Iceberg table snapshots",
    template:
      "select *\nfrom ${1:catalog.schema.table}$snapshots\norder by committed_at desc\nlimit ${2:20};\n${0}",
    rank: 486,
    scope: "statement",
  }),
];

export function cloneDefaultSqlSnippets(): SqlSnippetDefinition[] {
  return defaultSqlSnippets.map(cloneSnippet);
}

export function mergeDefaultSqlSnippets(
  snippets: readonly SqlSnippetDefinition[],
): SqlSnippetDefinition[] {
  const seen = new Set(snippets.map(snippetIdentityKey));
  return [
    ...snippets.map(cloneSnippet),
    ...defaultSqlSnippets
      .filter((snippetDefinition) => !seen.has(snippetIdentityKey(snippetDefinition)))
      .map(cloneSnippet),
  ];
}

export function snippetsForEngine(
  snippets: readonly SqlSnippetDefinition[],
  engine: DbEngine,
): SqlSnippetDefinition[] {
  const matching = snippets.filter((snippetDefinition) =>
    snippetMatchesEngine(snippetDefinition, engine),
  );
  const labelsWithEngineSpecificSnippet = new Set(
    matching
      .filter((snippetDefinition) => (snippetDefinition.engines?.length ?? 0) > 0)
      .map((snippetDefinition) => snippetDefinition.label),
  );
  return matching
    .filter(
      (snippetDefinition) =>
        (snippetDefinition.engines?.length ?? 0) > 0 ||
        !labelsWithEngineSpecificSnippet.has(snippetDefinition.label),
    )
    .map(cloneSnippet);
}

export function isSqlSnippetScope(value: unknown): value is SqlSnippetScope {
  return value === "statement" || value === "expression" || value === "clause";
}

export function isSqlSnippetEngine(value: unknown): value is DbEngine {
  return typeof value === "string" && sqlSnippetEngineSet.has(value);
}

export function sqlSnippetsFromJson(value: unknown): SqlSnippetDefinition[] {
  if (!Array.isArray(value)) {
    throw new Error("editor.snippets must be an array");
  }
  return value.map((entry, index) => sqlSnippetFromJson(entry, index));
}

function sqlSnippetFromJson(
  value: unknown,
  index: number,
): SqlSnippetDefinition {
  if (!isRecord(value)) {
    throw new Error(`editor.snippets[${index}] must be an object`);
  }
  const label = stringField(value, "label", index).trim();
  if (!SNIPPET_LABEL_PATTERN.test(label)) {
    throw new Error(
      `editor.snippets[${index}].label must start with a letter and contain only letters, numbers, "_" or "-"`,
    );
  }
  const detail = stringField(value, "detail", index).trim();
  const template = stringField(value, "template", index);
  const scope = value.scope;
  if (!isSqlSnippetScope(scope)) {
    throw new Error(
      `editor.snippets[${index}].scope must be "statement", "clause", or "expression"`,
    );
  }
  const rank = value.rank;
  if (
    rank !== undefined &&
    (typeof rank !== "number" || !Number.isFinite(rank))
  ) {
    throw new Error(`editor.snippets[${index}].rank must be a number`);
  }
  const engines = sqlSnippetEnginesFromJson(value.engines, index);
  return {
    label,
    detail,
    template,
    scope,
    ...(typeof rank === "number" && Number.isFinite(rank) ? { rank } : {}),
    ...(engines.length > 0 ? { engines } : {}),
  };
}

function sqlSnippetEnginesFromJson(value: unknown, index: number): DbEngine[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`editor.snippets[${index}].engines must be an array`);
  }
  return normalizeSnippetEngines(value, `editor.snippets[${index}].engines`);
}

function normalizeSnippetEngines(
  engines: readonly unknown[],
  fieldName: string,
): DbEngine[] {
  const normalized: DbEngine[] = [];
  const seen = new Set<DbEngine>();
  for (const engine of engines) {
    if (!isSqlSnippetEngine(engine)) {
      throw new Error(`${fieldName} contains an unsupported database engine`);
    }
    if (seen.has(engine)) continue;
    seen.add(engine);
    normalized.push(engine);
  }
  return normalized;
}

function stringField(
  value: Record<string, unknown>,
  field: "label" | "detail" | "template",
  index: number,
): string {
  const fieldValue = value[field];
  if (typeof fieldValue !== "string" || fieldValue.length === 0) {
    throw new Error(`editor.snippets[${index}].${field} must be a string`);
  }
  return fieldValue;
}

function snippetMatchesEngine(
  snippetDefinition: SqlSnippetDefinition,
  engine: DbEngine,
) {
  return (
    !snippetDefinition.engines ||
    snippetDefinition.engines.length === 0 ||
    snippetDefinition.engines.includes(engine)
  );
}

function cloneSnippet(
  snippetDefinition: SqlSnippetDefinition,
): SqlSnippetDefinition {
  return {
    ...snippetDefinition,
    ...(snippetDefinition.engines
      ? { engines: [...snippetDefinition.engines] }
      : {}),
  };
}

function snippetIdentityKey(snippetDefinition: SqlSnippetDefinition): string {
  const engines =
    snippetDefinition.engines && snippetDefinition.engines.length > 0
      ? [...snippetDefinition.engines].sort().join(",")
      : "*";
  return `${snippetDefinition.label}:${engines}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
