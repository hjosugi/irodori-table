import { useMemo, useState } from "react";
import { ArrowRight, Copy, Search, X } from "lucide-react";

import {
  dbRunQuery,
  type DatabaseMetadata,
  type DbEngine,
  type DbObjectMetadata,
  type ForeignKey,
} from "@/generated/irodori-api";
import {
  buildJsonTree,
  buildForeignKeyLookup,
  findTableByName,
  foreignKeyColumns,
  formatRowAsJson,
  formatDetailValue,
  rowToJsonObject,
  type JsonTreeNode,
} from "../row-detail";

const MAX_FK_DEPTH = 6;

type DetailMode = "fields" | "json" | "tree";

const DETAIL_MODES: Array<{ id: DetailMode; label: string }> = [
  { id: "fields", label: "Fields" },
  { id: "json", label: "JSON" },
  { id: "tree", label: "Tree" },
];

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
  const [mode, setMode] = useState<DetailMode>("fields");
  const [query, setQuery] = useState("");
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const rowJson = useMemo(
    () => formatRowAsJson(props.columns, props.values),
    [props.columns, props.values],
  );
  const rowObject = useMemo(
    () => rowToJsonObject(props.columns, props.values),
    [props.columns, props.values],
  );

  async function copyJson() {
    try {
      await navigator.clipboard.writeText(rowJson);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  }

  return (
    <aside className="row-detail" aria-label="Row detail">
      <div className="row-detail-header">
        <div className="row-detail-title">
          <span>JSON Row Viewer</span>
          <span>{props.columns.length} fields</span>
        </div>
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
      <div className="row-detail-controls">
        <div className="row-detail-tabs" role="tablist" aria-label="Row detail view">
          {DETAIL_MODES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={mode === item.id}
              className={mode === item.id ? "is-active" : undefined}
              onClick={() => setMode(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`row-detail-copy${copyStatus !== "idle" ? " is-status" : ""}`}
          onClick={copyJson}
          title="Copy row JSON"
        >
          <Copy size={12} aria-hidden="true" />
          <span>
            {copyStatus === "copied" ? "Copied" : copyStatus === "failed" ? "Failed" : "Copy"}
          </span>
        </button>
        <label className="row-detail-search">
          <Search size={12} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setCopyStatus("idle");
            }}
            placeholder="Search row"
          />
        </label>
      </div>
      <div className="row-detail-body">
        {mode === "fields" ? (
          <RowDetailFields
            columns={props.columns}
            values={props.values}
            table={props.table}
            metadata={props.metadata}
            engine={props.engine}
            connectionId={props.connectionId}
            depth={0}
            filter={query}
          />
        ) : mode === "json" ? (
          <RowJsonDocument text={rowJson} filter={query} />
        ) : (
          <JsonTreeView value={rowObject} filter={query} />
        )}
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
  filter: string;
};

type ReferencedRow = {
  columns: string[];
  values: unknown[];
  table: DbObjectMetadata | null;
};

function RowDetailFields(props: RowDetailFieldsProps) {
  const { columns, values, table, metadata, engine, connectionId, depth, filter } = props;

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
  const normalizedFilter = filter.trim().toLowerCase();

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

  const rows = columns
    .map((column, index) => {
      const detail = formatDetailValue(values[index]);
      const dataType = typeByColumn.get(column.toLowerCase());
      return { column, index, detail, dataType };
    })
    .filter(({ column, detail, dataType }) =>
      matchesDetailFilter(normalizedFilter, column, dataType, detail.text),
    );

  if (rows.length === 0) {
    return <div className="detail-empty">No matching fields</div>;
  }

  return (
    <dl className="detail-list">
      {rows.map(({ column, index, detail, dataType }) => {
        const binding = fkColumns.get(index);
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
                        filter={filter}
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

function matchesDetailFilter(
  normalizedFilter: string,
  column: string,
  dataType: string | undefined,
  value: string,
): boolean {
  if (normalizedFilter.length === 0) {
    return true;
  }
  return `${column} ${dataType ?? ""} ${value}`.toLowerCase().includes(normalizedFilter);
}

function RowJsonDocument({ text, filter }: { text: string; filter: string }) {
  const normalizedFilter = filter.trim().toLowerCase();
  const matches = normalizedFilter.length === 0 || text.toLowerCase().includes(normalizedFilter);
  return (
    <div className="row-json-view">
      {normalizedFilter.length > 0 ? (
        <div className={`detail-filter-status${matches ? "" : " is-empty"}`}>
          {matches ? "JSON document matches" : "No JSON text match"}
        </div>
      ) : null}
      <pre className={`detail-json detail-json-full${matches ? "" : " is-dimmed"}`}>{text}</pre>
    </div>
  );
}

function JsonTreeView({ value, filter }: { value: unknown; filter: string }) {
  const tree = useMemo(() => buildJsonTree(value), [value]);
  const normalizedFilter = filter.trim().toLowerCase();
  const matches = nodeMatchesFilter(tree, normalizedFilter);
  if (!matches) {
    return <div className="detail-empty">No matching JSON paths</div>;
  }
  return (
    <div className="json-tree">
      <JsonTreeNodeView node={tree} filter={normalizedFilter} root />
    </div>
  );
}

function JsonTreeNodeView({
  node,
  filter,
  root = false,
}: {
  node: JsonTreeNode;
  filter: string;
  root?: boolean;
}) {
  const visibleChildren = node.children.filter((child) => nodeMatchesFilter(child, filter));
  const label = root ? "$" : node.key;

  if (node.children.length > 0) {
    return (
      <details className="json-tree-node" open>
        <summary className="json-tree-summary">
          <span className="json-tree-key">{label}</span>
          <span className="json-tree-type">{node.type}</span>
          <span className="json-tree-preview">{node.preview}</span>
        </summary>
        <div className="json-tree-children">
          {visibleChildren.map((child) => (
            <JsonTreeNodeView key={child.path} node={child} filter={filter} />
          ))}
        </div>
      </details>
    );
  }

  return (
    <div className="json-tree-leaf">
      <span className="json-tree-key">{label}</span>
      <span className="json-tree-type">{node.type}</span>
      <span className="json-tree-preview">{node.preview}</span>
    </div>
  );
}

function nodeMatchesFilter(node: JsonTreeNode, normalizedFilter: string): boolean {
  if (normalizedFilter.length === 0) {
    return true;
  }
  const selfMatches = `${node.key} ${node.path} ${node.type} ${node.preview}`
    .toLowerCase()
    .includes(normalizedFilter);
  return selfMatches || node.children.some((child) => nodeMatchesFilter(child, normalizedFilter));
}
