import type { Dispatch, RefObject, SetStateAction } from "react";
import { DialogShell } from "@/components/DialogShell";
import { usePreferencesStore } from "@/features/preferences";
import { createTranslator } from "@/i18n";
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
  const locale = usePreferencesStore((state) => state.locale);
  const { t } = createTranslator(locale);
  return (
    <DialogShell className="diagram" label={t("erd.title")} onClose={onClose}>
      <div className="diagram-header">
        <strong>{t("erd.title")}</strong>
        <span>
          {activeConnectionName}
          {model
            ? ` \u00b7 ${t("erd.summary", {
                tables: model.tables.length,
                total: model.totalTables,
                edges: model.edges.length,
              })}`
            : ""}
        </span>
        <button
          className="text-button"
          type="button"
          title={t("erd.fitTitle")}
          onClick={onFit}
          disabled={!layout}
        >
          <Maximize2 size={13} />
          <span>{t("erd.fit")}</span>
        </button>
        <button
          className="mini-button"
          type="button"
          title={t("erd.zoomOut")}
          aria-label={t("erd.zoomOut")}
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
          title={t("erd.zoomIn")}
          aria-label={t("erd.zoomIn")}
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
          aria-label={t("erd.copySvg")}
          title={t("erd.copySvg")}
          onClick={onCopySvg}
          disabled={!layout}
        >
          <Copy size={13} />
          <span>SVG</span>
        </button>
        <button
          className="text-button"
          type="button"
          aria-label={t("erd.copyPng")}
          title={t("erd.copyPng")}
          onClick={onCopyPng}
          disabled={!layout}
        >
          <Copy size={13} />
          <span>PNG</span>
        </button>
        <button
          className="text-button"
          type="button"
          aria-label={t("erd.downloadSvg")}
          title={t("erd.downloadSvg")}
          onClick={onDownloadSvg}
          disabled={!layout}
        >
          <Download size={13} />
          <span>SVG</span>
        </button>
        <button
          className="text-button"
          type="button"
          aria-label={t("erd.downloadPng")}
          title={t("erd.downloadPng")}
          onClick={onDownloadPng}
          disabled={!layout}
        >
          <ImageDown size={13} />
          <span>PNG</span>
        </button>
        <button
          className="text-button"
          type="button"
          title={t("erd.designerTitle")}
          onClick={onEditInDesigner}
          disabled={!metadataLoaded}
        >
          <PencilRuler size={13} />
          <span>{t("erd.designer")}</span>
        </button>
        <button
          className="text-button"
          type="button"
          title={t("erd.createDbTitle")}
          onClick={onCreateDatabaseSql}
          disabled={!metadataLoaded}
        >
          <Database size={13} />
          <span>{t("erd.createDb")}</span>
        </button>
        <button
          className="text-button"
          type="button"
          onClick={onDownloadSpecMarkdown}
          disabled={!metadataLoaded}
        >
          {t("erd.specMarkdown")}
        </button>
        <button
          className="text-button"
          type="button"
          onClick={onDownloadSpecJson}
          disabled={!metadataLoaded}
        >
          {t("erd.specJson")}
        </button>
        <button className="text-button" type="button" onClick={onLoadSpecDdl}>
          {t("erd.specToDdl")}
        </button>
        <button
          className="text-button"
          type="button"
          onClick={onCopyMermaid}
          disabled={!metadataLoaded}
        >
          {t("erd.copyMermaid")}
        </button>
        <button className="text-button" type="button" onClick={onClose}>
          {t("common.close")}
        </button>
      </div>
      <div className="diagram-controls">
        <label className="diagram-search">
          <Search size={14} />
          <input
            value={search}
            placeholder={t("erd.filterPlaceholder")}
            onChange={(event) => onSearchChange(event.currentTarget.value)}
          />
        </label>
        <div className="diagram-schema-actions">
          <button
            className="mini-button"
            type="button"
            onClick={() => onSchemaNamesChange(availableSchemas)}
          >
            {t("erd.allSchemas")}
          </button>
          <button
            className="mini-button"
            type="button"
            onClick={() => onSchemaNamesChange([])}
          >
            {t("erd.noSchemas")}
          </button>
        </div>
        <div
          className="diagram-schema-list"
          role="group"
          aria-label={t("erd.schemas")}
        >
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
        {!error && !metadataLoaded ? (
          <div className="grid-state loading">{t("erd.loadingMetadata")}</div>
        ) : null}
        {!error && metadataLoaded && (!layout || layout.tables.length === 0) ? (
          <div className="grid-state">{t("erd.noTablesMatch")}</div>
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
