import { useMemo, useState } from "react";
import { ArrowRight, X } from "lucide-react";

import {
  dbRunQuery,
  type DatabaseMetadata,
  type DbEngine,
  type DbObjectMetadata,
  type ForeignKey,
} from "./generated/irodori-api";
import {
  buildForeignKeyLookup,
  findTableByName,
  foreignKeyColumns,
  formatDetailValue,
} from "./row-detail";

const MAX_FK_DEPTH = 6;

type RowDetailSidebarProps = {
  columns: string[];
  values: unknown[];
  /** Metadata for the table the row came from (null when the source is ambiguous). */
  table: DbObjectMetadata | null;
  metadata: DatabaseMetadata | undefined;
  engine: DbEngine;
  connectionId: string;
  onClose: () => void;
};

/** A right-side drawer showing one result row's columns, JSON values, and FK links. */
export function RowDetailSidebar(props: RowDetailSidebarProps) {
  return (
    <aside className="row-detail" aria-label="Row detail">
      <div className="row-detail-header">
        <span>Row detail</span>
        <button
          type="button"
          className="row-detail-close"
          onClick={props.onClose}
          aria-label="Close row detail"
          title="Close"
        >
          <X size={14} />
        </button>
      </div>
      <div className="row-detail-body">
        <RowDetailFields
          columns={props.columns}
          values={props.values}
          table={props.table}
          metadata={props.metadata}
          engine={props.engine}
          connectionId={props.connectionId}
          depth={0}
        />
      </div>
    </aside>
  );
}

type RowDetailFieldsProps = {
  columns: string[];
  values: unknown[];
  table: DbObjectMetadata | null;
  metadata: DatabaseMetadata | undefined;
  engine: DbEngine;
  connectionId: string;
  depth: number;
};

type ReferencedRow = {
  columns: string[];
  values: unknown[];
  table: DbObjectMetadata | null;
};

function RowDetailFields(props: RowDetailFieldsProps) {
  const { columns, values, table, metadata, engine, connectionId, depth } = props;

  const fkColumns = useMemo(() => foreignKeyColumns(table, columns), [table, columns]);
  const typeByColumn = useMemo(() => {
    const map = new Map<string, string>();
    for (const column of table?.columns ?? []) {
      map.set(column.name.toLowerCase(), column.dataType);
    }
    return map;
  }, [table]);

  const [openColumn, setOpenColumn] = useState<number | null>(null);
  const [referenced, setReferenced] = useState<ReferencedRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function navigate(columnIndex: number, fk: ForeignKey, columnIndexes: number[]) {
    if (openColumn === columnIndex) {
      setOpenColumn(null);
      setReferenced(null);
      setError(null);
      return;
    }
    const keyValues = columnIndexes.map((index) => values[index]);
    if (keyValues.some((value) => value === null || value === undefined)) {
      return;
    }
    setOpenColumn(columnIndex);
    setReferenced(null);
    setError(null);
    setLoading(true);
    try {
      const lookup = buildForeignKeyLookup(fk, keyValues, engine);
      const result = await dbRunQuery(
        connectionId,
        lookup.sql,
        1,
        undefined,
        undefined,
        lookup.params,
      );
      if (result.rows.length === 0) {
        setError("No matching row in " + fk.referencesTable + ".");
        return;
      }
      setReferenced({
        columns: result.columns,
        values: result.rows[0],
        table: findTableByName(metadata, fk.referencesSchema, fk.referencesTable),
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }

  return (
    <dl className="detail-list">
      {columns.map((column, index) => {
        const detail = formatDetailValue(values[index]);
        const binding = fkColumns.get(index);
        const dataType = typeByColumn.get(column.toLowerCase());
        const navigable = binding !== undefined && depth < MAX_FK_DEPTH;
        const open = navigable && openColumn === index;
        return (
          <div className="detail-row" key={`${column}-${index}`}>
            <dt className="detail-key">
              <span className="detail-col">{column}</span>
              {dataType ? <span className="detail-type">{dataType}</span> : null}
            </dt>
            <dd className="detail-value">
              {navigable ? (
                <button
                  type="button"
                  className={`fk-link${open ? " is-open" : ""}`}
                  onClick={() => navigate(index, binding.fk, binding.columnIndexes)}
                  title={`References ${binding.fk.referencesTable}`}
                >
                  <ArrowRight size={12} aria-hidden="true" />
                  <span>{detail.text}</span>
                </button>
              ) : detail.json ? (
                <pre className="detail-json">{detail.text}</pre>
              ) : (
                <span className={values[index] === null ? "detail-null" : undefined}>
                  {detail.text}
                </span>
              )}
              {open ? (
                <div className="detail-ref">
                  {loading ? (
                    <span className="detail-ref-status">
                      Loading {binding.fk.referencesTable}…
                    </span>
                  ) : null}
                  {error ? <span className="detail-ref-error">{error}</span> : null}
                  {referenced ? (
                    <>
                      <div className="detail-ref-head">→ {binding.fk.referencesTable}</div>
                      <RowDetailFields
                        columns={referenced.columns}
                        values={referenced.values}
                        table={referenced.table}
                        metadata={metadata}
                        engine={engine}
                        connectionId={connectionId}
                        depth={depth + 1}
                      />
                    </>
                  ) : null}
                </div>
              ) : null}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
