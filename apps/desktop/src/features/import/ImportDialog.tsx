import type { Dispatch, SetStateAction } from "react";
import { DialogShell } from "@/components/DialogShell";
import type { ImportTextFormat, ParsedImport } from "./importers";

export type ImportPreview = ParsedImport & {
  fileName: string;
  format: ImportTextFormat;
  tableName: string;
};

export function ImportDialog({
  preview,
  sqlPreview,
  onPreviewChange,
  onClose,
  onPutSqlInEditor,
  formatCell,
  formatCount,
}: {
  /** Always present: the dialog is only mounted while a preview exists. */
  preview: ImportPreview;
  sqlPreview: string;
  onPreviewChange: Dispatch<SetStateAction<ImportPreview | null>>;
  onClose: () => void;
  onPutSqlInEditor: () => void;
  formatCell: (value: unknown) => string;
  formatCount: (value: bigint | number) => string;
}) {
  return (
    <DialogShell
      className="data-dialog import-dialog"
      label="Import preview"
      onClose={onClose}
    >
      <div className="dialog-header">
        <strong>Import</strong>
        <span>{`${preview.fileName} \u00b7 ${preview.format.toUpperCase()}`}</span>
        <button className="text-button" type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="dialog-body">
        <div className="dialog-form-row">
          <label>
            <span>Table</span>
            <input
              value={preview.tableName}
              onChange={(event) =>
                onPreviewChange((current) =>
                  current
                    ? {
                        ...current,
                        tableName: event.currentTarget.value,
                      }
                    : current,
                )
              }
            />
          </label>
          <span className="dialog-stat">
            {formatCount(preview.rows.length)} /{" "}
            {formatCount(preview.totalRows)} rows
            {preview.truncated ? " capped" : ""}
          </span>
        </div>
        <div className="preview-table-wrap">
          <table className="preview-table">
            <thead>
              <tr>
                {preview.columns.map((column, index) => (
                  <th key={`${column}-${index}`}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.rows.slice(0, 8).map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {preview.columns.map((_, columnIndex) => (
                    <td key={columnIndex}>{formatCell(row[columnIndex])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <pre className="sql-preview">{sqlPreview}</pre>
      </div>
      <div className="dialog-footer">
        <button
          className="text-button"
          type="button"
          onClick={() => void navigator.clipboard?.writeText(sqlPreview)}
        >
          Copy SQL
        </button>
        <button
          className="primary-action"
          type="button"
          onClick={onPutSqlInEditor}
        >
          Put SQL in editor
        </button>
      </div>
    </DialogShell>
  );
}
