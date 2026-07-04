import { useCallback, useEffect, useRef, useState } from "react";
import {
  aiEngineStatus,
  aiGenerateSql,
  aiGetProvider,
  aiSetProvider,
  type AiEngineStatus,
  type AiProviderConfig,
  type AiProviderKind,
  type DbEngine,
} from "@/generated/irodori-api";
import { errorMessage, isIrodoriError } from "@/core/errors";
import { DialogShell } from "@/components/DialogShell";
import { usePreferencesStore } from "@/features/preferences";
import { createTranslator } from "@/i18n";
import {
  hasCloudProviderConsent,
  isCloudProvider,
  cloudProviderPrivacyUrl,
  providerHostLabel,
  rememberCloudProviderConsent,
} from "./provider-disclosure";
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

const PROVIDER_LABELS: Record<AiProviderKind, string> = {
  local: "Local (embedded model)",
  ollama: "Ollama (local server)",
  openaiCompat: "OpenAI-compatible API",
  command: "CLI (Claude Code / Codex / any)",
};

const EMPTY_PROVIDER: AiProviderConfig = {
  kind: "local",
  model: "",
  program: "",
  args: [],
};

/**
 * Natural-language → SQL prompt with a pluggable backend. Calls the
 * grammar-constrained generator (`ai_generate_sql`) and inserts the result into
 * the editor — it never runs the SQL. The provider section connects a stronger or
 * external model (Ollama, any OpenAI-compatible API, or a CLI agent); every
 * provider goes through the same schema-validation gate, so output is always
 * checked against the real schema.
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
  const [provider, setProvider] = useState<AiProviderConfig>(EMPTY_PROVIDER);
  const [showProvider, setShowProvider] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [savingProvider, setSavingProvider] = useState(false);
  const [cloudProviderConsent, setCloudProviderConsent] = useState(
    hasCloudProviderConsent,
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const locale = usePreferencesStore((state) => state.locale);
  const { t } = createTranslator(locale);

  useEffect(() => {
    if (!open) return;
    setError(null);
    void aiEngineStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
    void aiGetProvider()
      .then((config) => setProvider({ ...EMPTY_PROVIDER, ...config }))
      .catch(() => {});
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
        t("notice.ai.sqlGenerated"),
        result.repaired
          ? t("notice.ai.sqlGeneratedRepairedDetail", {
              model: result.model,
              tokens: result.tokensOut,
            })
          : t("notice.ai.sqlGeneratedDetail", {
              model: result.model,
              tokens: result.tokensOut,
            }),
      );
      setPrompt("");
      onClose();
    } catch (err) {
      if (isIrodoriError(err) && err.kind === "notFound") {
        void aiEngineStatus()
          .then(setStatus)
          .catch(() => {});
      }
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [prompt, loading, connectionId, engine, onInsert, notify, onClose, t]);

  const saveProvider = useCallback(async () => {
    if (isCloudProvider(provider) && !cloudProviderConsent) {
      setError(t("ai.provider.cloudDisclosure.required"));
      return;
    }
    setSavingProvider(true);
    setError(null);
    try {
      const config: AiProviderConfig = {
        ...provider,
        // API key is sent transiently; never echoed back by the backend.
        apiKey: apiKey.trim() ? apiKey.trim() : undefined,
      };
      await aiSetProvider(config);
      setApiKey("");
      notify(
        "success",
        t("notice.ai.providerSaved"),
        PROVIDER_LABELS[provider.kind],
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSavingProvider(false);
    }
  }, [provider, cloudProviderConsent, apiKey, notify, t]);

  if (!open) return null;

  const modelMissing =
    provider.kind === "local" && status
      ? status.compiled && !status.modelPresent
      : false;
  const notCompiled =
    provider.kind === "local" && status ? !status.compiled : false;
  const cloudProviderSelected = isCloudProvider(provider);
  const cloudProviderHost = providerHostLabel(
    provider,
    t("ai.provider.cloudDisclosure.hostUnknown"),
  );
  const cloudConsentRequired = cloudProviderSelected && !cloudProviderConsent;

  const acceptCloudProviderDisclosure = () => {
    rememberCloudProviderConsent();
    setCloudProviderConsent(true);
    setError(null);
  };

  return (
    <DialogShell
      className="ai-generate-panel"
      overlayClassName="ai-generate-overlay"
      label="Generate SQL with AI"
      onClose={onClose}
    >
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
          }
        }}
      />

      {notCompiled && (
        <p className="ai-generate-note">
          The embedded model isn’t in this build — rebuild with{" "}
          <code>--features llama</code>, or pick another provider below (Ollama
          / API / CLI work without it).
        </p>
      )}
      {modelMissing && (
        <p className="ai-generate-note">
          The local model is not present. Use a preinstalled model or pick
          another provider below.
        </p>
      )}
      {error && <p className="ai-generate-error">{error}</p>}

      <div className="ai-generate-provider">
        <button
          type="button"
          className="ai-generate-link"
          onClick={() => setShowProvider((v) => !v)}
        >
          {showProvider ? "▾" : "▸"} Model provider:{" "}
          {PROVIDER_LABELS[provider.kind]}
        </button>
        {showProvider && (
          <div className="ai-generate-provider-body">
            <label className="ai-generate-field">
              <span>Provider</span>
              <select
                value={provider.kind}
                onChange={(e) =>
                  setProvider((p) => ({
                    ...p,
                    kind: e.target.value as AiProviderKind,
                  }))
                }
              >
                {(Object.keys(PROVIDER_LABELS) as AiProviderKind[]).map(
                  (kind) => (
                    <option key={kind} value={kind}>
                      {PROVIDER_LABELS[kind]}
                    </option>
                  ),
                )}
              </select>
            </label>

            {(provider.kind === "ollama" ||
              provider.kind === "openaiCompat") && (
              <label className="ai-generate-field">
                <span>Model</span>
                <input
                  value={provider.model}
                  placeholder={
                    provider.kind === "ollama" ? "qwen2.5-coder" : "gpt-4o-mini"
                  }
                  onChange={(e) =>
                    setProvider((p) => ({ ...p, model: e.target.value }))
                  }
                />
              </label>
            )}
            {(provider.kind === "ollama" ||
              provider.kind === "openaiCompat") && (
              <label className="ai-generate-field">
                <span>Endpoint</span>
                <input
                  value={provider.endpoint ?? ""}
                  placeholder={
                    provider.kind === "ollama"
                      ? "http://localhost:11434"
                      : "https://api.openai.com"
                  }
                  onChange={(e) =>
                    setProvider((p) => ({
                      ...p,
                      endpoint: e.target.value || undefined,
                    }))
                  }
                />
              </label>
            )}
            {provider.kind === "openaiCompat" && (
              <label className="ai-generate-field">
                <span>API key</span>
                <input
                  type="password"
                  value={apiKey}
                  placeholder="sk-… (kept in memory only)"
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </label>
            )}
            {cloudProviderSelected ? (
              <p className="ai-generate-provider-hint">
                {t("ai.provider.cloudHint", { host: cloudProviderHost })}
              </p>
            ) : null}
            {cloudConsentRequired ? (
              <div className="ai-generate-provider-disclosure" role="status">
                <strong>{t("ai.provider.cloudDisclosure.title")}</strong>
                <p>
                  {t("ai.provider.cloudDisclosure.body", {
                    host: cloudProviderHost,
                  })}{" "}
                  <a
                    href={cloudProviderPrivacyUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("ai.provider.cloudDisclosure.privacyLink")}
                  </a>
                </p>
                <button type="button" onClick={acceptCloudProviderDisclosure}>
                  {t("ai.provider.cloudDisclosure.accept")}
                </button>
              </div>
            ) : null}
            {provider.kind === "command" && (
              <label className="ai-generate-field">
                <span>Program</span>
                <input
                  value={provider.program}
                  placeholder="claude"
                  onChange={(e) =>
                    setProvider((p) => ({ ...p, program: e.target.value }))
                  }
                />
              </label>
            )}
            {provider.kind === "command" && (
              <label className="ai-generate-field">
                <span>Args</span>
                <input
                  value={provider.args.join(" ")}
                  placeholder="-p   (use {prompt} as a placeholder, else prompt is piped to stdin)"
                  onChange={(e) =>
                    setProvider((p) => ({
                      ...p,
                      args: e.target.value.split(/\s+/).filter(Boolean),
                    }))
                  }
                />
              </label>
            )}

            <div className="ai-generate-actions">
              <button
                type="button"
                className="ai-generate-button"
                onClick={() => void saveProvider()}
                disabled={savingProvider || cloudConsentRequired}
                title={
                  cloudConsentRequired
                    ? t("ai.provider.cloudDisclosure.required")
                    : undefined
                }
              >
                {savingProvider ? "Saving…" : "Save provider"}
              </button>
            </div>
          </div>
        )}
      </div>

      <footer className="ai-generate-footer">
        <span className="ai-generate-hint">
          ⌘/Ctrl+Enter to generate · inserts into the editor, never runs
        </span>
        <div className="ai-generate-actions">
          <button
            type="button"
            className="ai-generate-button"
            onClick={onClose}
          >
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
    </DialogShell>
  );
}
