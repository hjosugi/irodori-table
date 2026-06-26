import { AlertTriangle, Columns3 } from "lucide-react";
import { QueryHistorySidebar } from "@/features/query-history";
import type { WorkspaceConnection } from "@/features/connections";
import type { CompletionHint } from "../types";

type InspectorProps = {
  activeConnectionId: string;
  connectionById: ReadonlyMap<string, WorkspaceConnection>;
  activeMetadataLoading: boolean;
  activeMetadataError: string | undefined;
  completionHints: CompletionHint[];
  onInsertCompletionHint: (hint: CompletionHint) => void;
  onLoadHistorySql: (sql: string) => void;
};

export function Inspector({
  activeConnectionId,
  connectionById,
  activeMetadataLoading,
  activeMetadataError,
  completionHints,
  onInsertCompletionHint,
  onLoadHistorySql,
}: InspectorProps) {
  return (
    <aside className="inspector">
      <section>
        <div className="section-heading">
          <span>Completion</span>
          <Columns3 size={14} />
        </div>
        <div className="completion-list">
          {activeMetadataLoading ? (
            <div className="empty-browser loading">Loading metadata</div>
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
      <QueryHistorySidebar
        activeConnectionId={activeConnectionId}
        connectionById={connectionById}
        onLoad={(item) => onLoadHistorySql(item.sql)}
      />
    </aside>
  );
}
