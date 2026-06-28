import { AlertTriangle } from "lucide-react";
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
  error,
  sqlPreview,
  onPreviewChange,
  onClose,
  onPutSqlInEditor,
  formatCell,
  formatCount,
}: {
  preview: ImportPreview | null;
  error: string | null;
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
          <span>
            {preview
              ? `${preview.fileName} \u00b7 ${preview.format.toUpperCase()}`
              : "File"}
          </span>
          <button className="text-button" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        {error ? (
          <div className="dialog-body">
            <div className="result-error" role="alert">
              <AlertTriangle size={16} />
              <span>{error}</span>
            </div>
          </div>
        ) : null}
        {preview ? (
          <>
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
                  {formatCount(preview.rows.length)} / {formatCount(preview.totalRows)} rows
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
          </>
        ) : null}
    </DialogShell>
  );
}
