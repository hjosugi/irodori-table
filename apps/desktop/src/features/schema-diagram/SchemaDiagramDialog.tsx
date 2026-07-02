import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Database,
  Download,
  KeyRound,
  Link2,
  Maximize2,
  Plus,
  Trash2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { DialogShell } from "@/components/DialogShell";
import { downloadBlob } from "@/features/erd";
import {
  canvasPointFromPointer,
  diagramCanvasSize,
  diagramTableHeight,
  diagramToCreateSql,
  DIAGRAM_TABLE_WIDTH,
  parseDiagramDocument,
  serializeDiagramDocument,
  type DiagramDocument,
  type DiagramForeignKey,
  type DiagramTable,
} from "./schema-diagram";
import { useSchemaDiagramStore } from "./schema-diagram-store";

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 1.6;

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

type DiagramEdge = {
  id: string;
  path: string;
};

function computeEdges(document: DiagramDocument): DiagramEdge[] {
  const byId = new Map(document.tables.map((table) => [table.id, table]));
  const edges: DiagramEdge[] = [];
  for (const table of document.tables) {
    for (const foreignKey of table.foreignKeys) {
      const target = byId.get(foreignKey.referencesTableId);
      if (!target) {
        continue;
      }
      const toRight = target.x >= table.x;
      const sx = toRight ? table.x + DIAGRAM_TABLE_WIDTH : table.x;
      const tx = toRight ? target.x : target.x + DIAGRAM_TABLE_WIDTH;
      const sy = table.y + diagramTableHeight(table) / 2;
      const ty = target.y + diagramTableHeight(target) / 2;
      const curve = Math.max(40, Math.abs(tx - sx) * 0.4) * (toRight ? 1 : -1);
      edges.push({
        id: foreignKey.id,
        path: `M ${sx} ${sy} C ${sx + curve} ${sy}, ${tx - curve} ${ty}, ${tx} ${ty}`,
      });
    }
  }
  return edges;
}

export function SchemaDiagramDialog({
  onClose,
  onPutSqlInEditor,
  onCopySql,
  onSeedFromDb,
  canSeedFromDb,
}: {
  onClose: () => void;
  onPutSqlInEditor: (sql: string) => void;
  onCopySql: (sql: string) => void;
  onSeedFromDb?: () => void;
  canSeedFromDb: boolean;
}) {
  const document = useSchemaDiagramStore((state) => state.document);
  const selectedTableId = useSchemaDiagramStore(
    (state) => state.selectedTableId,
  );
  const selectTable = useSchemaDiagramStore((state) => state.selectTable);
  const moveTable = useSchemaDiagramStore((state) => state.moveTable);
  const addTable = useSchemaDiagramStore((state) => state.addTable);
  const setDocument = useSchemaDiagramStore((state) => state.setDocument);

  const [zoom, setZoom] = useState(1);
  const [importError, setImportError] = useState<string | null>(null);
  const scaleRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{
    tableId: string;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  const size = diagramCanvasSize(document);
  const edges = computeEdges(document);
  const sql = diagramToCreateSql(document);

  function pointToCanvas(clientX: number, clientY: number) {
    const origin = scaleRef.current?.getBoundingClientRect();
    return canvasPointFromPointer(
      clientX,
      clientY,
      { left: origin?.left ?? 0, top: origin?.top ?? 0 },
      zoom,
    );
  }

  function handleHeaderPointerDown(
    event: ReactPointerEvent<HTMLDivElement>,
    table: DiagramTable,
  ) {
    if (event.button !== 0) {
      return;
    }
    const point = pointToCanvas(event.clientX, event.clientY);
    dragRef.current = {
      tableId: table.id,
      offsetX: point.x - table.x,
      offsetY: point.y - table.y,
    };
    selectTable(table.id);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handleHeaderPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    const point = pointToCanvas(event.clientX, event.clientY);
    moveTable(drag.tableId, point.x - drag.offsetX, point.y - drag.offsetY);
  }

  function handleHeaderPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      dragRef.current = null;
    }
  }

  function fitToViewport() {
    const stage = scaleRef.current?.parentElement?.parentElement;
    if (!stage) {
      setZoom(1);
      return;
    }
    const ratio = Math.min(
      (stage.clientWidth - 48) / size.width,
      (stage.clientHeight - 48) / size.height,
    );
    setZoom(clampZoom(Number.isFinite(ratio) && ratio > 0 ? ratio : 1));
  }

  function exportJson() {
    void downloadBlob(
      new Blob([serializeDiagramDocument(document)], {
        type: "application/json;charset=utf-8",
      }),
      "irodori-schema-diagram.json",
    );
  }

  async function importJson(file: File) {
    try {
      setDocument(parseDiagramDocument(await file.text()));
      setImportError(null);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    }
  }

  const tableCount = document.tables.length;
  const columnCount = document.tables.reduce(
    (sum, table) => sum + table.columns.length,
    0,
  );

  return (
    <DialogShell
      className="diagram diagram-designer"
      label="Schema diagram designer"
      onClose={onClose}
    >
      <div className="diagram-header">
        <strong>Schema Designer</strong>
        <span>
          {tableCount} tables · {columnCount} columns
        </span>
        <button
          className="text-button"
          type="button"
          title="Add a new table"
          onClick={addTable}
        >
          <Plus size={13} />
          <span>Table</span>
        </button>
        <button
          className="text-button"
          type="button"
          title="Replace the canvas with the connected database schema"
          onClick={onSeedFromDb}
          disabled={!canSeedFromDb}
        >
          <Database size={13} />
          <span>From DB</span>
        </button>
        <button
          className="mini-button"
          type="button"
          title="Zoom out"
          aria-label="Zoom out"
          onClick={() => setZoom((current) => clampZoom(current - 0.1))}
        >
          <ZoomOut size={13} />
        </button>
        <span className="diagram-zoom">{Math.round(zoom * 100)}%</span>
        <button
          className="mini-button"
          type="button"
          title="Zoom in"
          aria-label="Zoom in"
          onClick={() => setZoom((current) => clampZoom(current + 0.1))}
        >
          <ZoomIn size={13} />
        </button>
        <button
          className="text-button"
          type="button"
          title="Fit to viewport"
          onClick={fitToViewport}
        >
          <Maximize2 size={13} />
          <span>Fit</span>
        </button>
        <button
          className="text-button"
          type="button"
          title="Export diagram as JSON"
          onClick={exportJson}
        >
          <Download size={13} />
          <span>Export</span>
        </button>
        <button
          className="text-button"
          type="button"
          title="Import diagram JSON"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload size={13} />
          <span>Import</span>
        </button>
        <button
          className="text-button"
          type="button"
          onClick={() => onCopySql(sql)}
        >
          Copy SQL
        </button>
        <button
          className="primary-action"
          type="button"
          title="Generate the runnable CREATE script in the editor"
          onClick={() => onPutSqlInEditor(sql)}
        >
          Create DB SQL
        </button>
        <button className="text-button" type="button" onClick={onClose}>
          Close
        </button>
      </div>

      {importError ? (
        <div className="diagram-designer-error" role="alert">
          {importError}
        </div>
      ) : null}

      <div className="diagram-canvas">
        <div
          className="diagram-stage"
          style={{ width: size.width * zoom, height: size.height * zoom }}
        >
          <div
            ref={scaleRef}
            className="diagram-scale diagram-designer-scale"
            style={{
              transform: `scale(${zoom})`,
              width: size.width,
              height: size.height,
            }}
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) {
                selectTable(null);
              }
            }}
          >
            <svg
              className="diagram-designer-edges"
              width={size.width}
              height={size.height}
              viewBox={`0 0 ${size.width} ${size.height}`}
              aria-hidden="true"
            >
              <defs>
                <marker
                  id="diagram-designer-arrow"
                  markerHeight="7"
                  markerWidth="9"
                  orient="auto"
                  refX="7"
                  refY="3.5"
                  viewBox="0 0 9 7"
                >
                  <path d="M 0 0 L 7 3.5 L 0 7 z" fill="currentColor" />
                </marker>
              </defs>
              {edges.map((edge) => (
                <path
                  key={edge.id}
                  d={edge.path}
                  markerEnd="url(#diagram-designer-arrow)"
                />
              ))}
            </svg>
            {document.tables.map((table) => (
              <DiagramTableCard
                key={table.id}
                table={table}
                tables={document.tables}
                selected={table.id === selectedTableId}
                onHeaderPointerDown={handleHeaderPointerDown}
                onHeaderPointerMove={handleHeaderPointerMove}
                onHeaderPointerUp={handleHeaderPointerUp}
              />
            ))}
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) {
            void importJson(file);
          }
          event.currentTarget.value = "";
        }}
      />
    </DialogShell>
  );
}

function DiagramTableCard({
  table,
  tables,
  selected,
  onHeaderPointerDown,
  onHeaderPointerMove,
  onHeaderPointerUp,
}: {
  table: DiagramTable;
  tables: DiagramTable[];
  selected: boolean;
  onHeaderPointerDown: (
    event: ReactPointerEvent<HTMLDivElement>,
    table: DiagramTable,
  ) => void;
  onHeaderPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onHeaderPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const updateTable = useSchemaDiagramStore((state) => state.updateTable);
  const removeTable = useSchemaDiagramStore((state) => state.removeTable);
  const addColumn = useSchemaDiagramStore((state) => state.addColumn);
  const updateColumn = useSchemaDiagramStore((state) => state.updateColumn);
  const removeColumn = useSchemaDiagramStore((state) => state.removeColumn);
  const addForeignKey = useSchemaDiagramStore((state) => state.addForeignKey);
  const removeForeignKey = useSchemaDiagramStore(
    (state) => state.removeForeignKey,
  );

  return (
    <div
      className={`diagram-designer-table${selected ? " is-selected" : ""}`}
      style={{ left: table.x, top: table.y, width: DIAGRAM_TABLE_WIDTH }}
    >
      <div
        className="diagram-designer-table-header"
        onPointerDown={(event) => onHeaderPointerDown(event, table)}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
      >
        <input
          aria-label="Table name"
          className="diagram-designer-table-name"
          value={table.name}
          onChange={(event) =>
            updateTable(table.id, { name: event.currentTarget.value })
          }
        />
        <button
          className="mini-button"
          type="button"
          aria-label={`Remove ${table.name}`}
          title="Remove table"
          onClick={() => removeTable(table.id)}
        >
          <Trash2 size={12} />
        </button>
      </div>

      <div className="diagram-designer-columns">
        {table.columns.map((column) => (
          <div className="diagram-designer-column" key={column.id}>
            <button
              className={`diagram-designer-key${column.primaryKey ? " is-on" : ""}`}
              type="button"
              aria-label="Toggle primary key"
              aria-pressed={column.primaryKey}
              title="Primary key"
              onClick={() =>
                updateColumn(table.id, column.id, {
                  primaryKey: !column.primaryKey,
                })
              }
            >
              <KeyRound size={11} />
            </button>
            <input
              aria-label="Column name"
              className="diagram-designer-column-name"
              value={column.name}
              placeholder="column"
              onChange={(event) =>
                updateColumn(table.id, column.id, {
                  name: event.currentTarget.value,
                })
              }
            />
            <input
              aria-label="Column type"
              className="diagram-designer-column-type"
              value={column.dataType}
              placeholder="TYPE"
              onChange={(event) =>
                updateColumn(table.id, column.id, {
                  dataType: event.currentTarget.value,
                })
              }
            />
            <label className="diagram-designer-flag" title="NOT NULL">
              <input
                type="checkbox"
                checked={!column.nullable}
                aria-label="Not null"
                onChange={(event) =>
                  updateColumn(table.id, column.id, {
                    nullable: !event.currentTarget.checked,
                  })
                }
              />
              <span>NN</span>
            </label>
            <button
              className="mini-button"
              type="button"
              aria-label={`Remove column ${column.name}`}
              title="Remove column"
              onClick={() => removeColumn(table.id, column.id)}
            >
              <X size={11} />
            </button>
          </div>
        ))}
      </div>

      {table.foreignKeys.length > 0 ? (
        <div className="diagram-designer-relations">
          {table.foreignKeys.map((foreignKey) => (
            <DiagramForeignKeyRow
              key={foreignKey.id}
              table={table}
              tables={tables}
              foreignKey={foreignKey}
              onRemove={() => removeForeignKey(table.id, foreignKey.id)}
            />
          ))}
        </div>
      ) : null}

      <div className="diagram-designer-table-actions">
        <button
          className="text-button"
          type="button"
          onClick={() => addColumn(table.id)}
        >
          + Column
        </button>
        <button
          className="text-button"
          type="button"
          disabled={tables.length < 2}
          title={
            tables.length < 2
              ? "Add another table to create a relationship"
              : "Add a foreign key relationship"
          }
          onClick={() => addForeignKey(table.id)}
        >
          <Link2 size={12} />
          <span>FK</span>
        </button>
      </div>
    </div>
  );
}

function DiagramForeignKeyRow({
  table,
  tables,
  foreignKey,
  onRemove,
}: {
  table: DiagramTable;
  tables: DiagramTable[];
  foreignKey: DiagramForeignKey;
  onRemove: () => void;
}) {
  const updateForeignKey = useSchemaDiagramStore(
    (state) => state.updateForeignKey,
  );
  const target = tables.find(
    (item) => item.id === foreignKey.referencesTableId,
  );

  return (
    <div className="diagram-designer-relation">
      <Link2 size={11} />
      <select
        aria-label="Local column"
        value={foreignKey.columns[0] ?? ""}
        onChange={(event) =>
          updateForeignKey(table.id, foreignKey.id, {
            columns: [event.currentTarget.value],
          })
        }
      >
        <option value="">column</option>
        {table.columns.map((column) => (
          <option key={column.id} value={column.name}>
            {column.name || "(unnamed)"}
          </option>
        ))}
      </select>
      <span className="diagram-designer-relation-arrow">→</span>
      <select
        aria-label="Referenced table"
        value={foreignKey.referencesTableId}
        onChange={(event) =>
          updateForeignKey(table.id, foreignKey.id, {
            referencesTableId: event.currentTarget.value,
            referencesColumns: [],
          })
        }
      >
        {tables
          .filter((item) => item.id !== table.id)
          .map((item) => (
            <option key={item.id} value={item.id}>
              {item.name || "(unnamed)"}
            </option>
          ))}
      </select>
      <select
        aria-label="Referenced column"
        value={foreignKey.referencesColumns[0] ?? ""}
        onChange={(event) =>
          updateForeignKey(table.id, foreignKey.id, {
            referencesColumns: [event.currentTarget.value],
          })
        }
      >
        <option value="">column</option>
        {(target?.columns ?? []).map((column) => (
          <option key={column.id} value={column.name}>
            {column.name || "(unnamed)"}
          </option>
        ))}
      </select>
      <button
        className="mini-button"
        type="button"
        aria-label="Remove relationship"
        title="Remove relationship"
        onClick={onRemove}
      >
        <X size={11} />
      </button>
    </div>
  );
}
