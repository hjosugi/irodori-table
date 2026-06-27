import { useCallback, useEffect, useRef, useState } from "react";
import {
  aiDownloadModel,
  aiEngineStatus,
  aiGenerateSql,
  type AiEngineStatus,
  type DbEngine,
} from "@/generated/irodori-api";
import { errorMessage, isIrodoriError } from "@/core/errors";
import "./ai-generate-dialog.css";

type ActionNoticeKind = "success" | "error" | "info";

export type AiGenerateDialogProps = {
  open: boolean;
  onClose: () => void;
  connectionId: string;
  engine: DbEngine;
  /** Insert the generated SQL into the active editor. */
  onInsert: (sql: string) => void;
  /** Surface a toast notification. */
  notify: (kind: ActionNoticeKind, title: string, detail?: string) => void;
};

/**
 * Natural-language → SQL prompt. Calls the local, grammar-constrained generator
 * (`ai_generate_sql`) and inserts the result into the editor — it never runs the
 * SQL. When the engine isn't built or the model isn't downloaded, it explains how
 * to enable it (and can kick off the background download).
 */
export function AiGenerateDialog({
  open,
  onClose,
  connectionId,
  engine,
  onInsert,
  notify,
}: AiGenerateDialogProps) {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<AiEngineStatus | null>(null);
  const [downloading, setDownloading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    void aiEngineStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
    // Focus the prompt when the dialog opens.
    const id = window.setTimeout(() => textareaRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  const submit = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setError(null);
    try {
      const result = await aiGenerateSql(connectionId, trimmed, engine);
      onInsert(result.sql);
      notify(
        "success",
        "SQL generated",
        `${result.model} · ${result.tokensOut} tokens${result.repaired ? " · repaired" : ""}`,
      );
      setPrompt("");
      onClose();
    } catch (err) {
      // A missing model is recoverable: surface the download affordance.
      if (isIrodoriError(err) && err.kind === "notFound") {
        void aiEngineStatus()
          .then(setStatus)
          .catch(() => {});
      }
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [prompt, loading, connectionId, engine, onInsert, notify, onClose]);

  const startDownload = useCallback(async () => {
    setDownloading(true);
    setError(null);
    try {
      await aiDownloadModel();
      notify(
        "info",
        "Model download started",
        "Watch progress in the jobs dashboard.",
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setDownloading(false);
    }
  }, [notify]);

  if (!open) return null;

  const needsDownload = status ? status.compiled && !status.modelPresent : false;
  const notCompiled = status ? !status.compiled : false;

  return (
    <div
      className="ai-generate-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Generate SQL with AI"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="ai-generate-panel">
        <header className="ai-generate-header">
          <span className="ai-generate-title">Generate SQL</span>
          <button
            type="button"
            className="ai-generate-close"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <textarea
          ref={textareaRef}
          className="ai-generate-input"
          placeholder="Describe the query in plain language — e.g. “top 10 customers by revenue last month”"
          value={prompt}
          rows={3}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void submit();
            } else if (event.key === "Escape") {
              onClose();
            }
          }}
        />

        {notCompiled && (
          <p className="ai-generate-note">
            Local generation isn’t in this build. Rebuild the desktop app with{" "}
            <code>--features llama</code> to enable it.
          </p>
        )}
        {needsDownload && (
          <p className="ai-generate-note">
            The local model isn’t downloaded yet.{" "}
            <button
              type="button"
              className="ai-generate-link"
              onClick={() => void startDownload()}
              disabled={downloading}
            >
              {downloading ? "Starting…" : "Download model"}
            </button>
          </p>
        )}
        {error && <p className="ai-generate-error">{error}</p>}

        <footer className="ai-generate-footer">
          <span className="ai-generate-hint">⌘/Ctrl+Enter to generate · inserts into the editor, never runs</span>
          <div className="ai-generate-actions">
            <button type="button" className="ai-generate-button" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="ai-generate-button ai-generate-button--primary"
              onClick={() => void submit()}
              disabled={loading || !prompt.trim()}
            >
              {loading ? "Generating…" : "Generate"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
