import { AlertTriangle, Columns3, X } from "lucide-react";
import { QueryHistorySidebar } from "@/features/query-history";
import type { WorkspaceConnection } from "@/lib/workspace-connection";
import type { DbEngine } from "@/generated/irodori-api";
import { isVectorEngine, vectorHelperTemplates } from "../vector-helpers";
import type { CompletionHint } from "../types";
import type { WorkbenchSide } from "../types";

type InspectorProps = {
  activeConnectionId: string;
  editorEngine: DbEngine;
  connectionById: ReadonlyMap<string, WorkspaceConnection>;
  activeMetadataLoading: boolean;
  activeMetadataError: string | undefined;
  completionHints: CompletionHint[];
  onInsertCompletionHint: (hint: CompletionHint) => void;
  onInsertSql: (sql: string) => void;
  onLoadHistorySql: (sql: string) => void;
  onCloseCompletion?: () => void;
  onCloseHistory?: () => void;
  side?: WorkbenchSide;
  showCompletion?: boolean;
  showHistory?: boolean;
};

export function InspectorContent({
  activeConnectionId,
  editorEngine,
  connectionById,
  activeMetadataLoading,
  activeMetadataError,
  completionHints,
  onInsertCompletionHint,
  onInsertSql,
  onLoadHistorySql,
  onCloseCompletion,
  onCloseHistory,
  showCompletion = true,
  showHistory = true,
}: InspectorProps) {
  const vectorTemplates = vectorHelperTemplates(editorEngine);
  return (
    <>
      {showCompletion && isVectorEngine(editorEngine) ? (
        <section>
          <div className="section-heading">
            <span>Vector Tools</span>
            <div className="section-heading-actions">
              <Columns3 size={14} />
              {onCloseCompletion ? (
                <button
                  type="button"
                  aria-label="Close completion"
                  title="Close completion"
                  onClick={onCloseCompletion}
                >
                  <X size={12} />
                </button>
              ) : null}
            </div>
          </div>
          <div className="completion-list">
            {vectorTemplates.map((template) => (
              <button
                className="completion-item"
                key={template.id}
                onClick={() => onInsertSql(template.insertText)}
              >
                <strong>{template.label}</strong>
                <small>{template.detail}</small>
              </button>
            ))}
          </div>
        </section>
      ) : null}
      {showCompletion ? (
        <section>
          <div className="section-heading">
            <span>Completion</span>
            <div className="section-heading-actions">
              <Columns3 size={14} />
              {onCloseCompletion ? (
                <button
                  type="button"
                  aria-label="Close completion"
                  title="Close completion"
                  onClick={onCloseCompletion}
                >
                  <X size={12} />
                </button>
              ) : null}
            </div>
          </div>
          <div className="completion-list">
            {activeMetadataLoading ? (
              <div
                className="metadata-skeleton compact"
                role="status"
                aria-label="Loading metadata"
              >
                {Array.from({ length: 5 }, (_, index) => (
                  <span key={index} />
                ))}
              </div>
            ) : activeMetadataError ? (
              <div className="empty-browser">
                <AlertTriangle size={14} />
                <span>{activeMetadataError}</span>
              </div>
            ) : completionHints.length > 0 ? (
              completionHints.map((item) => (
                <button
                  className="completion-item"
                  key={`${item.detail}:${item.label}`}
                  onClick={() => onInsertCompletionHint(item)}
                >
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </button>
              ))
            ) : (
              <div className="empty-browser">
                Connect to load completion metadata
              </div>
            )}
          </div>
        </section>
      ) : null}
      {showHistory ? (
        <QueryHistorySidebar
          activeConnectionId={activeConnectionId}
          connectionById={connectionById}
          onLoad={(item) => onLoadHistorySql(item.sql)}
          onClose={onCloseHistory}
        />
      ) : null}
    </>
  );
}

export function Inspector({ side = "right", ...props }: InspectorProps) {
  return (
    <aside className={`inspector inspector-${side}`}>
      <InspectorContent {...props} />
    </aside>
  );
}
