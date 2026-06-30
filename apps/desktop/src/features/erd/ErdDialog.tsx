import type { Dispatch, RefObject, SetStateAction } from "react";
import { DialogShell } from "@/components/DialogShell";
import {
  AlertTriangle,
  Copy,
  Database,
  Download,
  ImageDown,
  Maximize2,
  PencilRuler,
  Search,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { ErdLayout, ErdModel } from "./erd";
import { ErdSvg } from "./erd-svg";

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function ErdDialog({
  activeConnectionName,
  model,
  layout,
  svgRef,
  canvasRef,
  svgStyle,
  zoom,
  search,
  schemaNames,
  availableSchemas,
  error,
  metadataLoaded,
  onClose,
  onFit,
  onZoomChange,
  onSearchChange,
  onSchemaNamesChange,
  onCopySvg,
  onCopyPng,
  onDownloadSvg,
  onDownloadPng,
  onDownloadSpecMarkdown,
  onDownloadSpecJson,
  onLoadSpecDdl,
  onCreateDatabaseSql,
  onEditInDesigner,
  onSelectTable,
  onCopyMermaid,
}: {
  activeConnectionName: string;
  model: ErdModel | null;
  layout: ErdLayout | null;
  svgRef: RefObject<SVGSVGElement | null>;
  canvasRef: RefObject<HTMLDivElement | null>;
  svgStyle: string;
  zoom: number;
  search: string;
  schemaNames: string[];
  availableSchemas: string[];
  error: string | null;
  metadataLoaded: boolean;
  onClose: () => void;
  onFit: () => void;
  onZoomChange: Dispatch<SetStateAction<number>>;
  onSearchChange: (value: string) => void;
  onSchemaNamesChange: Dispatch<SetStateAction<string[]>>;
  onCopySvg: () => void;
  onCopyPng: () => void;
  onDownloadSvg: () => void;
  onDownloadPng: () => void;
  onDownloadSpecMarkdown: () => void;
  onDownloadSpecJson: () => void;
  onLoadSpecDdl: () => void;
  onCreateDatabaseSql: () => void;
  onEditInDesigner: () => void;
  onSelectTable: (tableId: string) => void;
  onCopyMermaid: () => void;
}) {
  return (
    <DialogShell className="diagram" label="ER diagram" onClose={onClose}>
      <div className="diagram-header">
        <strong>ER Diagram</strong>
        <span>
          {activeConnectionName}
          {model
            ? ` \u00b7 ${model.tables.length}/${model.totalTables} tables \u00b7 ${model.edges.length} edges`
            : ""}
        </span>
        <button
          className="text-button"
          type="button"
          title="Fit diagram"
          onClick={onFit}
          disabled={!layout}
        >
          <Maximize2 size={13} />
          <span>Fit</span>
        </button>
        <button
          className="mini-button"
          type="button"
          title="Zoom out"
          aria-label="Zoom out"
          disabled={!layout}
          onClick={() =>
            onZoomChange((current) => clampNumber(current - 0.1, 0.25, 2))
          }
        >
          <ZoomOut size={13} />
        </button>
        <span className="diagram-zoom">{Math.round(zoom * 100)}%</span>
        <button
          className="mini-button"
          type="button"
          title="Zoom in"
          aria-label="Zoom in"
          disabled={!layout}
          onClick={() =>
            onZoomChange((current) => clampNumber(current + 0.1, 0.25, 2))
          }
        >
          <ZoomIn size={13} />
        </button>
        <button
          className="text-button"
          type="button"
          aria-label="Copy ERD SVG"
          title="Copy ERD SVG"
          onClick={onCopySvg}
          disabled={!layout}
        >
          <Copy size={13} />
          <span>SVG</span>
        </button>
        <button
          className="text-button"
          type="button"
          aria-label="Copy ERD PNG"
          title="Copy ERD PNG"
          onClick={onCopyPng}
          disabled={!layout}
        >
          <Copy size={13} />
          <span>PNG</span>
        </button>
        <button
          className="text-button"
          type="button"
          aria-label="Download ERD SVG"
          title="Download ERD SVG"
          onClick={onDownloadSvg}
          disabled={!layout}
        >
          <Download size={13} />
          <span>SVG</span>
        </button>
        <button
          className="text-button"
          type="button"
          aria-label="Download ERD PNG"
          title="Download ERD PNG"
          onClick={onDownloadPng}
          disabled={!layout}
        >
          <ImageDown size={13} />
          <span>PNG</span>
        </button>
        <button
          className="text-button"
          type="button"
          title="Open the current diagram in the interactive designer"
          onClick={onEditInDesigner}
          disabled={!metadataLoaded}
        >
          <PencilRuler size={13} />
          <span>Designer</span>
        </button>
        <button
          className="text-button"
          type="button"
          title="Generate a runnable CREATE script for the current diagram"
          onClick={onCreateDatabaseSql}
          disabled={!metadataLoaded}
        >
          <Database size={13} />
          <span>Create DB</span>
        </button>
        <button
          className="text-button"
          type="button"
          onClick={onDownloadSpecMarkdown}
          disabled={!metadataLoaded}
        >
          Spec MD
        </button>
        <button
          className="text-button"
          type="button"
          onClick={onDownloadSpecJson}
          disabled={!metadataLoaded}
        >
          Spec JSON
        </button>
        <button className="text-button" type="button" onClick={onLoadSpecDdl}>
          Spec to DDL
        </button>
        <button
          className="text-button"
          type="button"
          onClick={onCopyMermaid}
          disabled={!metadataLoaded}
        >
          Copy Mermaid
        </button>
        <button className="text-button" type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="diagram-controls">
        <label className="diagram-search">
          <Search size={14} />
          <input
            value={search}
            placeholder="Filter schemas, tables, columns"
            onChange={(event) => onSearchChange(event.currentTarget.value)}
          />
        </label>
        <div className="diagram-schema-actions">
          <button
            className="mini-button"
            type="button"
            onClick={() => onSchemaNamesChange(availableSchemas)}
          >
            All
          </button>
          <button
            className="mini-button"
            type="button"
            onClick={() => onSchemaNamesChange([])}
          >
            None
          </button>
        </div>
        <div className="diagram-schema-list" role="group" aria-label="Schemas">
          {availableSchemas.map((schema) => {
            const active = schemaNames.includes(schema);
            return (
              <button
                key={schema}
                className={active ? "schema-chip active" : "schema-chip"}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  onSchemaNamesChange((current) =>
                    current.includes(schema)
                      ? current.filter((item) => item !== schema)
                      : [...current, schema],
                  )
                }
              >
                {schema}
              </button>
            );
          })}
        </div>
      </div>
      <div className="diagram-canvas" ref={canvasRef}>
        {error ? (
          <div className="result-error" role="alert">
            <AlertTriangle size={16} />
            <span>{error}</span>
          </div>
        ) : null}
        {!error && (!layout || layout.tables.length === 0) ? (
          <div className="grid-state">
            No tables match the current diagram filters
          </div>
        ) : null}
        {!error && layout && layout.tables.length > 0 ? (
          <div
            className="diagram-stage"
            style={{
              width: layout.width * zoom,
              height: layout.height * zoom,
            }}
          >
            <div
              className="diagram-scale"
              style={{
                transform: `scale(${zoom})`,
                width: layout.width,
                height: layout.height,
              }}
            >
              <ErdSvg
                layout={layout}
                svgRef={svgRef}
                svgStyle={svgStyle}
                onSelectTable={onSelectTable}
              />
            </div>
          </div>
        ) : null}
      </div>
    </DialogShell>
  );
}
