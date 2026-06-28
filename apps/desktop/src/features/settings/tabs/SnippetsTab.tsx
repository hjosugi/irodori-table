import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileUp, ListPlus } from "lucide-react";
import {
  cloneDefaultSqlSnippets,
  isSqlSnippetScope,
  mergeImportedSqlSnippets,
  sqlSnippetsFromText,
  type SqlSnippetDefinition,
  type SqlSnippetScope,
} from "../../../sql/completion";
import { clampNumber, type TranslateFn, type ValueUpdater } from "./shared";

const snippetScopeOptions: SqlSnippetScope[] = [
  "statement",
  "clause",
  "expression",
];

function copyDefaultSqlSnippets() {
  return cloneDefaultSqlSnippets();
}

function uniqueSnippetLabel(snippets: readonly SqlSnippetDefinition[]) {
  const used = new Set(snippets.map((snippet) => snippet.label));
  if (!used.has("custom")) return "custom";
  let index = 2;
  while (used.has(`custom${index}`)) index += 1;
  return `custom${index}`;
}

export interface SnippetsTabProps {
  t: TranslateFn;
  sqlSnippets: SqlSnippetDefinition[];
  setSqlSnippets: (value: ValueUpdater<SqlSnippetDefinition[]>) => void;
}

export function SnippetsTab({ t, sqlSnippets, setSqlSnippets }: SnippetsTabProps) {
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const [importDraft, setImportDraft] = useState("");
  const [importSourceName, setImportSourceName] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);

  function updateSnippet(
    index: number,
    patch: Partial<SqlSnippetDefinition>,
  ) {
    setSqlSnippets((current) =>
      current.map((snippet, snippetIndex) =>
        snippetIndex === index ? { ...snippet, ...patch } : snippet,
      ),
    );
  }

  function addSnippet() {
    setSqlSnippets((current) => [
      ...current,
      {
        label: uniqueSnippetLabel(current),
        detail: "custom snippet",
        template: "${1:statement}${0}",
        scope: "statement",
        rank: 500,
      },
    ]);
  }

  function removeSnippet(index: number) {
    setSqlSnippets((current) =>
      current.filter((_, snippetIndex) => snippetIndex !== index),
    );
  }

  async function applySnippetImport(mode: "merge" | "replace") {
    try {
      const result = await sqlSnippetsFromText(importDraft, importSourceName);
      setSqlSnippets((current) =>
        mode === "replace"
          ? result.snippets.map((snippet) => ({ ...snippet }))
          : mergeImportedSqlSnippets(current, result.snippets),
      );
      setImportError(null);
      setImportNotice(
        t("settings.snippets.importSuccess", {
          count: String(result.snippets.length),
          format: result.format.toUpperCase(),
        }),
      );
    } catch (error) {
      setImportNotice(null);
      setImportError(error instanceof Error ? error.message : String(error));
    }
  }

  async function loadSnippetImportFile(file: File) {
    try {
      const text = await file.text();
      setImportDraft(text);
      setImportSourceName(file.name);
      setImportError(null);
      setImportNotice(
        t("settings.snippets.fileLoaded", {
          name: file.name,
        }),
      );
    } catch (error) {
      setImportNotice(null);
      setImportError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="settings-snippets">
      <div className="settings-json-toolbar">
        <span>
          <strong>{t("settings.snippets.title")}</strong>
          <small>
            {t("settings.snippets.description", {
              first: "${1:table}",
              final: "${0}",
            })}
          </small>
        </span>
        <button
          className="text-button"
          type="button"
          onClick={() => setSqlSnippets(copyDefaultSqlSnippets())}
        >
          {t("settings.snippets.resetDefaults")}
        </button>
        <button
          className="primary-button"
          type="button"
          onClick={addSnippet}
        >
          {t("settings.snippets.add")}
        </button>
      </div>
      <div className="snippet-import-panel">
        <div className="snippet-import-header">
          <span>
            <strong>{t("settings.snippets.importTitle")}</strong>
            <small>{t("settings.snippets.importDescription")}</small>
          </span>
          <input
            ref={importFileRef}
            type="file"
            accept=".json,.yaml,.yml,application/json,text/yaml,text/x-yaml"
            hidden
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) {
                void loadSnippetImportFile(file);
              }
            }}
          />
          <button
            className="text-button"
            type="button"
            onClick={() => importFileRef.current?.click()}
          >
            <FileUp size={14} />
            {t("settings.snippets.importFile")}
          </button>
        </div>
        <textarea
          value={importDraft}
          spellCheck={false}
          placeholder={t("settings.snippets.importPlaceholder")}
          onChange={(event) => {
            setImportDraft(event.currentTarget.value);
            setImportSourceName("");
            setImportError(null);
            setImportNotice(null);
          }}
        />
        <div className="snippet-import-actions">
          <button
            className="primary-button"
            type="button"
            disabled={importDraft.trim().length === 0}
            onClick={() => void applySnippetImport("merge")}
          >
            <ListPlus size={14} />
            {t("settings.snippets.importMerge")}
          </button>
          <button
            className="text-button"
            type="button"
            disabled={importDraft.trim().length === 0}
            onClick={() => void applySnippetImport("replace")}
          >
            {t("settings.snippets.importReplace")}
          </button>
        </div>
        {importError ? (
          <div className="inline-error settings-json-error">
            <AlertTriangle size={13} />
            <span>{importError}</span>
          </div>
        ) : importNotice ? (
          <div className="inline-success snippet-import-notice">
            <CheckCircle2 size={13} />
            <span>{importNotice}</span>
          </div>
        ) : null}
      </div>
      {sqlSnippets.length > 0 ? (
        <div className="snippet-editor-list">
          {sqlSnippets.map((snippet, index) => (
            <div
              className="snippet-editor-item"
              key={`${snippet.label}-${index}`}
            >
              <div className="snippet-editor-grid">
                <label>
                  <span>{t("settings.snippets.trigger")}</span>
                  <input
                    value={snippet.label}
                    spellCheck={false}
                    onChange={(event) =>
                      updateSnippet(index, {
                        label: event.currentTarget.value,
                      })
                    }
                  />
                </label>
                <label>
                  <span>{t("settings.snippets.scope")}</span>
                  <select
                    value={snippet.scope}
                    onChange={(event) => {
                      const next = event.currentTarget.value;
                      if (isSqlSnippetScope(next)) {
                        updateSnippet(index, { scope: next });
                      }
                    }}
                  >
                    {snippetScopeOptions.map((scope) => (
                      <option key={scope} value={scope}>
                        {scope}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>{t("settings.snippets.rank")}</span>
                  <input
                    type="number"
                    min={0}
                    max={999}
                    step={5}
                    value={snippet.rank ?? 500}
                    onChange={(event) =>
                      updateSnippet(index, {
                        rank: clampNumber(
                          Number(event.currentTarget.value),
                          0,
                          999,
                        ),
                      })
                    }
                  />
                </label>
                <label className="snippet-detail-field">
                  <span>{t("settings.snippets.detail")}</span>
                  <input
                    value={snippet.detail}
                    onChange={(event) =>
                      updateSnippet(index, {
                        detail: event.currentTarget.value,
                      })
                    }
                  />
                </label>
              </div>
              <label className="snippet-template-field">
                <span>{t("settings.snippets.template")}</span>
                <textarea
                  value={snippet.template}
                  spellCheck={false}
                  onChange={(event) =>
                    updateSnippet(index, {
                      template: event.currentTarget.value,
                    })
                  }
                />
              </label>
              <div className="snippet-editor-actions">
                <button
                  className="text-button"
                  type="button"
                  onClick={() => removeSnippet(index)}
                >
                  {t("settings.snippets.remove")}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-browser">
          {t("settings.snippets.empty")}
        </div>
      )}
    </div>
  );
}
