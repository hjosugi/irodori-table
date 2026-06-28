import { useEffect, useRef } from "react";
import { FileSearch, Pencil, Search, X } from "lucide-react";
import type { SqlMetadataToolWindowRequest } from "./SqlEditor";
import {
  sqlMetadataTargetTitle,
  type SqlMetadataTarget,
} from "../../sql/metadata-inspection";
import { renderSqlMetadataTooltip } from "./sql-metadata-tooltip";
import type { EditorSelection } from "./query-editor-pane-types";

type MetadataUsage = {
  from: number;
  to: number;
  line: number;
  column: number;
  preview: string;
};

export function MetadataToolWindow({
  request,
  query,
  onClose,
  onEdit,
  onRevealUsage,
}: {
  request: SqlMetadataToolWindowRequest;
  query: string;
  onClose: () => void;
  onEdit: () => void;
  onRevealUsage: (selection: EditorSelection) => void;
}) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const title = sqlMetadataTargetTitle(request.target);
  const usages =
    request.mode === "usages" ? findMetadataUsages(query, request.target) : [];

  useEffect(() => {
    const content = contentRef.current;
    if (!content || request.mode !== "definition") {
      return;
    }
    content.replaceChildren(
      renderSqlMetadataTooltip(request.target, {
        className: "sql-metadata-tooltip-tool-window",
      }),
    );
    return () => content.replaceChildren();
  }, [request]);

  return (
    <section className="metadata-tool-window" aria-label="Find tool window">
      <div className="metadata-tool-window-header">
        <div className="metadata-tool-window-title">
          {request.mode === "usages" ? (
            <Search size={15} />
          ) : (
            <FileSearch size={15} />
          )}
          <span>{request.mode === "usages" ? "Usages" : "Definition"}</span>
          <strong>{title}</strong>
        </div>
        <div className="metadata-tool-window-actions">
          <button
            className="icon-button"
            type="button"
            title="Edit Source"
            aria-label="Edit Source"
            onClick={onEdit}
          >
            <Pencil size={14} />
          </button>
          <button
            className="icon-button"
            type="button"
            title="Close"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>
      </div>
      {request.mode === "definition" ? (
        <div ref={contentRef} className="metadata-tool-window-body" />
      ) : (
        <div className="metadata-tool-window-body metadata-usages-list">
          {usages.length === 0 ? (
            <div className="metadata-tool-window-empty">
              No usages in the current SQL buffer
            </div>
          ) : (
            usages.map((usage) => (
              <button
                key={`${usage.from}:${usage.to}`}
                className="metadata-usage-row"
                type="button"
                onClick={() =>
                  onRevealUsage({ from: usage.from, to: usage.to })
                }
              >
                <span>
                  {usage.line}:{usage.column}
                </span>
                <code>{usage.preview}</code>
              </button>
            ))
          )}
        </div>
      )}
    </section>
  );
}

function findMetadataUsages(
  query: string,
  target: SqlMetadataTarget,
): MetadataUsage[] {
  const ranges = new Map<string, MetadataUsage>();
  for (const needle of metadataUsageNeedles(target)) {
    for (const usage of findIdentifierOccurrences(query, needle)) {
      ranges.set(`${usage.from}:${usage.to}`, usage);
    }
  }
  return Array.from(ranges.values()).sort(
    (left, right) => left.from - right.from,
  );
}

function metadataUsageNeedles(target: SqlMetadataTarget): string[] {
  const object = target.object;
  const values =
    target.kind === "column"
      ? [
          `${object.schema}.${object.name}.${target.column.name}`,
          `${object.name}.${target.column.name}`,
          target.column.name,
        ]
      : [`${object.schema}.${object.name}`, object.name];
  return [...new Set(values.map((value) => value.toLowerCase()))].sort(
    (left, right) => right.length - left.length,
  );
}

function findIdentifierOccurrences(
  query: string,
  needle: string,
): MetadataUsage[] {
  const lowerQuery = query.toLowerCase();
  const usages: MetadataUsage[] = [];
  let index = lowerQuery.indexOf(needle);
  while (index >= 0) {
    const to = index + needle.length;
    if (
      isIdentifierBoundary(query[index - 1]) &&
      isIdentifierBoundary(query[to])
    ) {
      const { line, column } = lineColumnAt(query, index);
      usages.push({
        from: index,
        to,
        line,
        column,
        preview: linePreviewAt(query, index),
      });
    }
    index = lowerQuery.indexOf(needle, index + Math.max(needle.length, 1));
  }
  return usages;
}

function lineColumnAt(query: string, index: number) {
  let line = 1;
  let lineStart = 0;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (query[cursor] === "\n") {
      line += 1;
      lineStart = cursor + 1;
    }
  }
  return { line, column: index - lineStart + 1 };
}

function linePreviewAt(query: string, index: number): string {
  const lineStart = query.lastIndexOf("\n", index - 1) + 1;
  const lineEnd = query.indexOf("\n", index);
  return query
    .slice(lineStart, lineEnd < 0 ? query.length : lineEnd)
    .trim()
    .slice(0, 180);
}

function isIdentifierBoundary(char: string | undefined): boolean {
  return !char || !/[A-Za-z0-9_$]/.test(char);
}
