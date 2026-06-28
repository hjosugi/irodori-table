import {
  cloneDefaultSqlSnippets,
  isSqlSnippetScope,
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
