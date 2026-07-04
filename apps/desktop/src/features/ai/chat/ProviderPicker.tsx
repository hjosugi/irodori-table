import { useCallback, useEffect, useState } from "react";
import {
  aiEngineStatus,
  aiGetProvider,
  aiSetProvider,
  type AiEngineStatus,
  type AiProviderConfig,
  type AiProviderKind,
} from "@/generated/irodori-api";
import { aiDeleteLocalModel, aiUnloadLocal } from "./chat-bridge";
import { useConfirm } from "@/components/ConfirmDialog";
import { errorMessage } from "@/core/errors";
import { usePreferencesStore } from "@/features/preferences";
import { createTranslator } from "@/i18n";
import {
  hasCloudProviderConsent,
  isCloudProvider,
  cloudProviderPrivacyUrl,
  providerHostLabel,
  rememberCloudProviderConsent,
} from "../provider-disclosure";

const PROVIDER_LABELS: Record<AiProviderKind, string> = {
  local: "Local (embedded model)",
  ollama: "Ollama (local server)",
  openaiCompat: "OpenAI-compatible API",
  command: "CLI (Claude Code / Codex / any)",
};

/**
 * One-click provider presets. The provider is shared with SQL generation, so
 * changing it here changes it everywhere. OpenAI / Gemini / DeepSeek all speak
 * the OpenAI-compatible protocol, so they share the `openaiCompat` kind and only
 * differ by endpoint + model.
 */
type ProviderPreset = {
  id: string;
  label: string;
  config: Omit<AiProviderConfig, "apiKey">;
  /** Whether this preset needs an API key field. */
  needsKey?: boolean;
};

const EMPTY: AiProviderConfig = {
  kind: "local",
  model: "",
  program: "",
  args: [],
};

const PRESETS: ProviderPreset[] = [
  {
    id: "local",
    label: "Local (embedded)",
    config: { ...EMPTY, kind: "local" },
  },
  {
    id: "ollama",
    label: "Ollama",
    config: {
      ...EMPTY,
      kind: "ollama",
      model: "qwen2.5-coder",
      endpoint: "http://localhost:11434",
    },
  },
  {
    id: "openai",
    label: "OpenAI (ChatGPT)",
    needsKey: true,
    config: {
      ...EMPTY,
      kind: "openaiCompat",
      model: "gpt-4o-mini",
      endpoint: "https://api.openai.com",
    },
  },
  {
    id: "gemini",
    label: "Google Gemini",
    needsKey: true,
    config: {
      ...EMPTY,
      kind: "openaiCompat",
      model: "gemini-2.0-flash",
      endpoint: "https://generativelanguage.googleapis.com/v1beta/openai",
    },
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    needsKey: true,
    config: {
      ...EMPTY,
      kind: "openaiCompat",
      model: "deepseek-chat",
      endpoint: "https://api.deepseek.com",
    },
  },
  {
    id: "claude",
    label: "Claude Code (CLI)",
    config: { ...EMPTY, kind: "command", program: "claude", args: ["-p"] },
  },
  {
    id: "codex",
    label: "Codex (CLI)",
    config: { ...EMPTY, kind: "command", program: "codex", args: ["exec"] },
  },
  {
    id: "copilot",
    label: "Copilot (CLI)",
    config: { ...EMPTY, kind: "command", program: "copilot", args: ["-p"] },
  },
];

function matchPreset(config: AiProviderConfig): string {
  const found = PRESETS.find(
    (p) =>
      p.config.kind === config.kind &&
      (p.config.model ?? "") === (config.model ?? "") &&
      (p.config.endpoint ?? "") === (config.endpoint ?? "") &&
      (p.config.program ?? "") === (config.program ?? ""),
  );
  return found?.id ?? "custom";
}

export type ProviderPickerProps = {
  notify?: (kind: "success" | "error", title: string, detail?: string) => void;
};

/**
 * Compact provider selector for the chat panel. Reads/writes the same global
 * provider as SQL generation (`ai_get_provider` / `ai_set_provider`).
 */
export function ProviderPicker({ notify }: ProviderPickerProps) {
  const [config, setConfig] = useState<AiProviderConfig>(EMPTY);
  const [apiKey, setApiKey] = useState("");
  const [presetId, setPresetId] = useState("local");
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<AiEngineStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [cloudProviderConsent, setCloudProviderConsent] = useState(
    hasCloudProviderConsent,
  );
  const { confirm, confirmElement } = useConfirm();
  const locale = usePreferencesStore((state) => state.locale);
  const { t } = createTranslator(locale);

  const refreshStatus = useCallback(() => {
    void aiEngineStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    void aiGetProvider()
      .then((current) => {
        const merged = { ...EMPTY, ...current };
        setConfig(merged);
        setPresetId(matchPreset(merged));
      })
      .catch(() => {});
    refreshStatus();
  }, [refreshStatus]);

  const unloadLocal = useCallback(async () => {
    setBusy(true);
    try {
      await aiUnloadLocal();
      notify?.(
        "success",
        t("notice.ai.localModelUnloaded"),
        t("notice.ai.localModelUnloadedDetail"),
      );
    } catch (err) {
      notify?.("error", t("notice.ai.unloadFailed"), errorMessage(err));
    } finally {
      setBusy(false);
      refreshStatus();
    }
  }, [notify, refreshStatus, t]);

  const deleteLocal = useCallback(async () => {
    if (
      !(await confirm({
        title: t("ai.provider.confirmDeleteLocal.title"),
        message: t("ai.provider.confirmDeleteLocal.message"),
        confirmLabel: t("common.delete"),
        tone: "danger",
      }))
    ) {
      return;
    }
    setBusy(true);
    try {
      await aiDeleteLocalModel();
      notify?.(
        "success",
        t("notice.ai.localModelDeleted"),
        t("notice.ai.localModelDeletedDetail"),
      );
    } catch (err) {
      notify?.("error", t("notice.ai.deleteFailed"), errorMessage(err));
    } finally {
      setBusy(false);
      refreshStatus();
    }
  }, [confirm, notify, refreshStatus, t]);

  const applyPreset = useCallback((id: string) => {
    setPresetId(id);
    const preset = PRESETS.find((p) => p.id === id);
    if (preset) {
      setConfig({ ...EMPTY, ...preset.config });
      setApiKey("");
    }
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const payload: AiProviderConfig = {
        ...config,
        apiKey: apiKey.trim() ? apiKey.trim() : undefined,
      };
      await aiSetProvider(payload);
      setApiKey("");
      notify?.(
        "success",
        t("notice.ai.providerUpdated"),
        PROVIDER_LABELS[config.kind],
      );
    } catch (err) {
      const message = errorMessage(err);
      setError(message);
      notify?.("error", t("notice.ai.providerUpdateFailed"), message);
    } finally {
      setSaving(false);
    }
  }, [config, apiKey, notify, t]);

  const needsKey = config.kind === "openaiCompat";
  const isHttp = config.kind === "ollama" || config.kind === "openaiCompat";
  const isCommand = config.kind === "command";
  const cloudProviderSelected = isCloudProvider(config);
  const cloudProviderHost = providerHostLabel(
    config,
    t("ai.provider.cloudDisclosure.hostUnknown"),
  );
  const cloudConsentRequired = cloudProviderSelected && !cloudProviderConsent;

  const acceptCloudProviderDisclosure = useCallback(() => {
    rememberCloudProviderConsent();
    setCloudProviderConsent(true);
  }, []);

  return (
    <div className="aichat-provider">
      <div className="aichat-provider-row">
        <label className="aichat-provider-select">
          <span>{t("ai.provider.model")}</span>
          <select
            value={presetId}
            onChange={(e) => applyPreset(e.target.value)}
          >
            {PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
            {presetId === "custom" ? (
              <option value="custom">Custom…</option>
            ) : null}
          </select>
        </label>
        <button
          type="button"
          className="aichat-provider-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          title={t("ai.provider.settings")}
        >
          {expanded ? "▾" : "⚙"}
        </button>
      </div>

      {/* API key shown inline so auth is obvious for ChatGPT / Gemini / DeepSeek. */}
      {needsKey ? (
        <label className="aichat-field">
          <span>{t("ai.provider.apiKey")}</span>
          <input
            type="password"
            value={apiKey}
            placeholder="sk-… (kept in memory only)"
            onChange={(e) => setApiKey(e.target.value)}
          />
        </label>
      ) : null}
      {isCommand ? (
        <p className="aichat-provider-hint">
          {t("ai.provider.commandHintBefore")}
          <code>claude</code> / <code>codex</code>
          {t("ai.provider.commandHintAfter")}
        </p>
      ) : null}
      {cloudProviderSelected ? (
        <p className="aichat-provider-hint">
          {t("ai.provider.cloudHint", { host: cloudProviderHost })}
        </p>
      ) : null}
      {cloudConsentRequired ? (
        <div className="aichat-provider-disclosure" role="status">
          <strong>{t("ai.provider.cloudDisclosure.title")}</strong>
          <p>
            {t("ai.provider.cloudDisclosure.body", {
              host: cloudProviderHost,
            })}{" "}
            <a href={cloudProviderPrivacyUrl} target="_blank" rel="noreferrer">
              {t("ai.provider.cloudDisclosure.privacyLink")}
            </a>
          </p>
          <button type="button" onClick={acceptCloudProviderDisclosure}>
            {t("ai.provider.cloudDisclosure.accept")}
          </button>
        </div>
      ) : null}

      {config.kind === "local" && status ? (
        <div className="aichat-local">
          <span className="aichat-local-status">
            {!status.compiled
              ? t("ai.provider.local.notCompiled")
              : status.loaded
                ? t("ai.provider.local.loaded")
                : status.modelPresent
                  ? t("ai.provider.local.installed")
                  : t("ai.provider.local.notInstalled")}
          </span>
          <div className="aichat-local-actions">
            <button
              type="button"
              onClick={() => void unloadLocal()}
              disabled={busy || !status.loaded}
              title={t("ai.provider.unloadLocal")}
            >
              {t("common.stop")}
            </button>
            <button
              type="button"
              className="aichat-local-danger"
              onClick={() => void deleteLocal()}
              disabled={busy || !status.modelPresent}
              title={t("ai.provider.deleteLocal")}
            >
              {t("common.delete")}
            </button>
          </div>
        </div>
      ) : null}

      {expanded ? (
        <div className="aichat-provider-body">
          <label className="aichat-field">
            <span>{t("ai.provider.kind")}</span>
            <select
              value={config.kind}
              onChange={(e) => {
                setConfig((c) => ({
                  ...c,
                  kind: e.target.value as AiProviderKind,
                }));
                setPresetId("custom");
              }}
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

          {isHttp ? (
            <>
              <label className="aichat-field">
                <span>{t("ai.provider.model")}</span>
                <input
                  value={config.model}
                  placeholder={
                    config.kind === "ollama" ? "qwen2.5-coder" : "gpt-4o-mini"
                  }
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, model: e.target.value }))
                  }
                />
              </label>
              <label className="aichat-field">
                <span>{t("ai.provider.endpoint")}</span>
                <input
                  value={config.endpoint ?? ""}
                  placeholder="https://api.openai.com"
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      endpoint: e.target.value || undefined,
                    }))
                  }
                />
              </label>
            </>
          ) : null}

          {isCommand ? (
            <>
              <label className="aichat-field">
                <span>{t("ai.provider.program")}</span>
                <input
                  value={config.program}
                  placeholder="claude"
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, program: e.target.value }))
                  }
                />
              </label>
              <label className="aichat-field">
                <span>{t("ai.provider.args")}</span>
                <input
                  value={config.args.join(" ")}
                  placeholder="-p  (or use {prompt})"
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      args: e.target.value.split(/\s+/).filter(Boolean),
                    }))
                  }
                />
              </label>
            </>
          ) : null}

          {error ? <p className="aichat-provider-error">{error}</p> : null}
        </div>
      ) : null}

      <button
        type="button"
        className="aichat-provider-save"
        onClick={() => void save()}
        disabled={saving || cloudConsentRequired}
        title={
          cloudConsentRequired
            ? t("ai.provider.cloudDisclosure.required")
            : undefined
        }
      >
        {saving ? t("common.saving") : t("ai.provider.useThisModel")}
      </button>
      {confirmElement}
    </div>
  );
}
