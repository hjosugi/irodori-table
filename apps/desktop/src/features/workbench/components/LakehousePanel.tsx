import { useMemo } from "react";
import { Cloud, Copy, Database, FileText, Play, Wrench, X } from "lucide-react";
import type { DatabaseMetadata, DbEngine } from "@/generated/irodori-api";

type LakehousePanelProps = {
  editorEngine: DbEngine;
  activeConnectionName: string;
  activeConnectionOpen: boolean;
  activeMetadata: DatabaseMetadata | undefined;
  onInsertSql: (sql: string) => void;
  onLoadSql: (sql: string) => void;
  onClose: () => void;
};

type LakehouseAction = {
  id: string;
  title: string;
  detail: string;
  sql: string;
};

const duckdbIcebergSql = `INSTALL httpfs;
INSTALL iceberg;

LOAD httpfs;
LOAD iceberg;

CREATE SECRET IF NOT EXISTS irodori_s3 (
  TYPE s3,
  PROVIDER credential_chain
);

SELECT *
FROM iceberg_scan('s3://bucket/path/to/table/metadata/00000.metadata.json')
LIMIT 100;`;

const restCatalogSql = `INSTALL iceberg;
LOAD iceberg;

CREATE SECRET IF NOT EXISTS irodori_iceberg (
  TYPE iceberg,
  CLIENT_ID 'client-id',
  CLIENT_SECRET 'client-secret',
  ENDPOINT 'https://catalog.example.com/api/catalog',
  AWS_REGION 'us-east-1'
);

ATTACH 'catalog_name' AS lakehouse (TYPE iceberg);

SHOW ALL TABLES;

SELECT *
FROM lakehouse.namespace.table_name
LIMIT 100;`;

const motherDuckSql = `INSTALL motherduck;
LOAD motherduck;

ATTACH 'md:' AS md;

SHOW ALL TABLES;

SELECT *
FROM md.database_name.schema_name.table_name
LIMIT 100;`;

const athenaSql = `-- Athena profile fields:
-- Region: us-east-1
-- Catalog/database: AwsDataCatalog/default
-- Workgroup: primary
-- Output: s3://bucket/query-results/

SELECT *
FROM "database_name"."table_name"
LIMIT 100;`;

const maintenanceSql = `-- Run after selecting an Iceberg table and verifying retention policy.
-- DuckDB executes reads locally; catalog-backed maintenance may require Athena,
-- Spark, Trino, or a REST catalog maintenance service.

SELECT *
FROM lakehouse.namespace.table_name
LIMIT 100;

-- Common maintenance commands by engine:
-- OPTIMIZE table_name;
-- VACUUM table_name;
-- ALTER TABLE table_name EXECUTE expire_snapshots(retention_threshold => '7d');`;

function lakehouseActions(engine: DbEngine): LakehouseAction[] {
  const actions: LakehouseAction[] = [
    {
      id: "duckdb-iceberg",
      title: "DuckDB Iceberg",
      detail: "S3/R2/GCS object storage through httpfs and iceberg_scan.",
      sql: duckdbIcebergSql,
    },
    {
      id: "iceberg-rest",
      title: "REST Catalog",
      detail: "Attach a REST-compatible Iceberg catalog and query by table name.",
      sql: restCatalogSql,
    },
    {
      id: "motherduck",
      title: "MotherDuck",
      detail: "Attach MotherDuck from a DuckDB session and query cloud tables.",
      sql: motherDuckSql,
    },
    {
      id: "athena",
      title: "Athena",
      detail: "Use Glue/Athena naming for Iceberg tables and workgroups.",
      sql: athenaSql,
    },
    {
      id: "maintenance",
      title: "Maintenance",
      detail: "Keep optimization/retention workflows visible beside SQL.",
      sql: maintenanceSql,
    },
  ];

  if (engine === "motherduck") {
    return [actions[2], actions[0], actions[1], actions[4], actions[3]];
  }
  if (engine === "athena") {
    return [actions[3], actions[1], actions[4], actions[0], actions[2]];
  }
  if (engine === "iceberg" || engine === "s3Tables") {
    return [actions[0], actions[1], actions[4], actions[3], actions[2]];
  }
  return actions;
}

function isLakehouseEngine(engine: DbEngine) {
  return [
    "athena",
    "duckdb",
    "motherduck",
    "iceberg",
    "s3Tables",
    "deltaLake",
    "hudi",
  ].includes(engine);
}

export function LakehousePanel({
  editorEngine,
  activeConnectionName,
  activeConnectionOpen,
  activeMetadata,
  onInsertSql,
  onLoadSql,
  onClose,
}: LakehousePanelProps) {
  const actions = useMemo(() => lakehouseActions(editorEngine), [editorEngine]);
  const tableCount =
    activeMetadata?.schemas.reduce(
      (count, schema) =>
        count +
        schema.objects.filter((object) => object.kind === "table" || object.kind === "view")
          .length,
      0,
    ) ?? 0;
  const lakehouseEngine = isLakehouseEngine(editorEngine);

  return (
    <section className="lakehouse-panel" aria-label="Lakehouse">
      <div className="lakehouse-header">
        <div>
          <strong>Lakehouse</strong>
          <span>
            {activeConnectionName} · {editorEngine}
          </span>
        </div>
        <button type="button" title="Close Lakehouse" aria-label="Close Lakehouse" onClick={onClose}>
          <X size={14} />
        </button>
      </div>

      <div className="lakehouse-status">
        <div>
          <Database size={15} />
          <span>{activeConnectionOpen ? "connected" : "not connected"}</span>
        </div>
        <div>
          <FileText size={15} />
          <span>{tableCount ? `${tableCount} objects` : "no catalog loaded"}</span>
        </div>
      </div>

      {!lakehouseEngine ? (
        <div className="lakehouse-callout">
          <Cloud size={16} />
          <span>Switch to DuckDB, MotherDuck, Athena, or Iceberg for lakehouse workflows.</span>
        </div>
      ) : null}

      <div className="lakehouse-action-list">
        {actions.map((action) => (
          <article className="lakehouse-action" key={action.id}>
            <div>
              <strong>{action.title}</strong>
              <span>{action.detail}</span>
            </div>
            <div className="lakehouse-action-buttons">
              <button
                type="button"
                title={`Load ${action.title} SQL`}
                onClick={() => onLoadSql(action.sql)}
              >
                <Play size={14} />
                <span>Load</span>
              </button>
              <button
                type="button"
                title={`Insert ${action.title} SQL`}
                onClick={() => onInsertSql(`\n${action.sql}\n`)}
              >
                <Wrench size={14} />
                <span>Insert</span>
              </button>
              <button
                type="button"
                title={`Copy ${action.title} SQL`}
                aria-label={`Copy ${action.title} SQL`}
                onClick={() => void navigator.clipboard?.writeText(action.sql)}
              >
                <Copy size={14} />
              </button>
            </div>
          </article>
        ))}
      </div>

      {activeMetadata?.schemas.length ? (
        <div className="lakehouse-catalog">
          <strong>Catalog</strong>
          {activeMetadata.schemas.slice(0, 6).map((schema) => (
            <div className="lakehouse-catalog-row" key={schema.name}>
              <span>{schema.name}</span>
              <small>{schema.objects.length}</small>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
