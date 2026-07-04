import {
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
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
      detail:
        "Attach a REST-compatible Iceberg catalog and query by table name.",
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

export function isLakehouseEngine(engine: DbEngine) {
  return [
    "databricks",
    "athena",
    "duckdb",
    "motherduck",
    "hive",
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
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    action: LakehouseAction;
  } | null>(null);
  const tableCount =
    activeMetadata?.schemas.reduce(
      (count, schema) =>
        count +
        schema.objects.filter(
          (object) => object.kind === "table" || object.kind === "view",
        ).length,
      0,
    ) ?? 0;
  const lakehouseEngine = isLakehouseEngine(editorEngine);
  const contextAction = contextMenu?.action;

  useEffect(() => {
    if (!contextMenu) {
      return undefined;
    }
    const close = () => setContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [contextMenu]);

  useEffect(() => {
    setContextMenu(null);
  }, [editorEngine]);

  const openContextMenu = (
    event: ReactMouseEvent,
    action: LakehouseAction = actions[0],
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      ...clampLakehouseMenuPosition(event.clientX, event.clientY),
      action,
    });
  };

  const loadSql = (sql: string) => {
    onLoadSql(sql);
    setContextMenu(null);
  };

  const insertSql = (sql: string) => {
    onInsertSql(`\n${sql}\n`);
    setContextMenu(null);
  };

  const copySql = (sql: string) => {
    void navigator.clipboard?.writeText(sql);
    setContextMenu(null);
  };

  return (
    <section
      className="lakehouse-panel"
      aria-label="Lakehouse"
      onContextMenu={(event) => openContextMenu(event)}
    >
      <div className="lakehouse-header">
        <div>
          <strong>Lakehouse</strong>
          <span>
            {activeConnectionName} · {editorEngine}
          </span>
        </div>
        <button
          type="button"
          title="Close Lakehouse"
          aria-label="Close Lakehouse"
          onClick={onClose}
        >
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
          <span>
            {tableCount ? `${tableCount} objects` : "no catalog loaded"}
          </span>
        </div>
      </div>

      {!lakehouseEngine ? (
        <div className="lakehouse-callout">
          <Cloud size={16} />
          <span>
            Switch to DuckDB, MotherDuck, Athena, or Iceberg for lakehouse
            workflows.
          </span>
        </div>
      ) : null}

      <div className="lakehouse-action-list">
        {actions.map((action) => (
          <article
            className="lakehouse-action"
            key={action.id}
            onContextMenu={(event) => openContextMenu(event, action)}
          >
            <div>
              <strong>{action.title}</strong>
              <span>{action.detail}</span>
            </div>
            <div className="lakehouse-action-buttons">
              <button
                type="button"
                title={`Load ${action.title} SQL`}
                onClick={() => loadSql(action.sql)}
              >
                <Play size={14} />
                <span>Load</span>
              </button>
              <button
                type="button"
                title={`Insert ${action.title} SQL`}
                onClick={() => insertSql(action.sql)}
              >
                <Wrench size={14} />
                <span>Insert</span>
              </button>
              <button
                type="button"
                title={`Copy ${action.title} SQL`}
                aria-label={`Copy ${action.title} SQL`}
                onClick={() => copySql(action.sql)}
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

      {contextAction ? (
        <div
          className="app-menu-popover lakehouse-context-menu"
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => loadSql(contextAction.sql)}
          >
            <span>Load {contextAction.title} SQL</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => insertSql(contextAction.sql)}
          >
            <span>Insert {contextAction.title} SQL</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => copySql(contextAction.sql)}
          >
            <span>Copy {contextAction.title} SQL</span>
          </button>
          <span className="menu-separator" aria-hidden="true" />
          <button type="button" role="menuitem" onClick={onClose}>
            <span>Close Lakehouse</span>
          </button>
        </div>
      ) : null}
    </section>
  );
}

function clampLakehouseMenuPosition(x: number, y: number) {
  if (typeof window === "undefined") {
    return { x, y };
  }
  const menuWidth = 238;
  const menuHeight = 136;
  return {
    x: Math.max(8, Math.min(x, window.innerWidth - menuWidth - 8)),
    y: Math.max(8, Math.min(y, window.innerHeight - menuHeight - 8)),
  };
}
