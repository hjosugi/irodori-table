import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileUp,
  ListPlus,
  Plus,
  Replace,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  cloneDefaultSqlSnippets,
  collectSqlSnippetTags,
  formatSnippetTagInput,
  isSqlSnippetScope,
  mergeImportedSqlSnippets,
  parseSnippetTagInput,
  snippetMatchesFilter,
  sqlSnippetsFromText,
  type SqlSnippetDefinition,
  type SqlSnippetScope,
} from "../../../sql/completion";
import { clampNumber, type TranslateFn, type ValueUpdater } from "./shared";
import { errorMessage } from "@/core";

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

export function SnippetsTab({
  t,
  sqlSnippets,
  setSqlSnippets,
}: SnippetsTabProps) {
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const [importDraft, setImportDraft] = useState("");
  const [importSourceName, setImportSourceName] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeTags, setActiveTags] = useState<string[]>([]);
  // Cards start collapsed. The shipped defaults alone are 92 snippets, and
  // rendering 92 open editors is what made a snippet impossible to find.
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(
    () => new Set<number>(),
  );
  const [tagDrafts, setTagDrafts] = useState<Record<number, string>>({});

  const availableTags = useMemo(
    () => collectSqlSnippetTags(sqlSnippets),
    [sqlSnippets],
  );
  // Filter while keeping each snippet's real index, because edits and removals
  // address the unfiltered list.
  const visibleSnippets = useMemo(
    () =>
      sqlSnippets
        .map((snippet, index) => ({ snippet, index }))
        .filter(({ snippet }) =>
          snippetMatchesFilter(snippet, search, activeTags),
        ),
    [sqlSnippets, search, activeTags],
  );
  const filtered = search.trim().length > 0 || activeTags.length > 0;

  function updateSnippet(index: number, patch: Partial<SqlSnippetDefinition>) {
    setSqlSnippets((current) =>
      current.map((snippet, snippetIndex) =>
        snippetIndex === index ? { ...snippet, ...patch } : snippet,
      ),
    );
  }

  // The tag field normalizes (lowercase, dedupe, drop blanks), so hold the raw
  // text while the field has focus. Without this, typing the comma in
  // "ddl, dml" would parse to a single tag and eat the separator as you type.
  function editSnippetTags(index: number, value: string) {
    setTagDrafts((current) => ({ ...current, [index]: value }));
    setSqlSnippets((current) =>
      current.map((snippet, snippetIndex) => {
        if (snippetIndex !== index) return snippet;
        const tags = parseSnippetTagInput(value);
        const { tags: _replaced, ...rest } = snippet;
        return tags.length > 0 ? { ...rest, tags } : rest;
      }),
    );
  }

  function commitSnippetTags(index: number) {
    setTagDrafts((current) => {
      const next = { ...current };
      delete next[index];
      return next;
    });
  }

  function toggleExpanded(index: number) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }

  function toggleTagFilter(tag: string) {
    setActiveTags((current) =>
      current.includes(tag)
        ? current.filter((value) => value !== tag)
        : [...current, tag],
    );
  }

  function clearFilters() {
    setSearch("");
    setActiveTags([]);
  }

  function collapseAll() {
    setExpanded(new Set<number>());
    setTagDrafts({});
  }

  function addSnippet() {
    // Clear the filter first: otherwise the new snippet falls outside the
    // active search and the button looks like it did nothing.
    clearFilters();
    setSqlSnippets((current) => {
      // A snippet you just created is the one you want to edit, so open it.
      setExpanded(new Set([current.length]));
      return [
        ...current,
        {
          label: uniqueSnippetLabel(current),
          detail: "custom snippet",
          template: "${1:statement}${0}",
          scope: "statement",
          rank: 500,
        },
      ];
    });
  }

  function removeSnippet(index: number) {
    setSqlSnippets((current) =>
      current.filter((_, snippetIndex) => snippetIndex !== index),
    );
    // Indices shift left past the removed row, so move the expanded set with
    // them instead of leaving unrelated cards open.
    setExpanded((current) => {
      const next = new Set<number>();
      current.forEach((value) => {
        if (value < index) next.add(value);
        else if (value > index) next.add(value - 1);
      });
      return next;
    });
    setTagDrafts({});
  }

  async function applySnippetImport(mode: "merge" | "replace") {
    try {
      const result = await sqlSnippetsFromText(importDraft, importSourceName);
      setSqlSnippets((current) =>
        mode === "replace"
          ? result.snippets.map((snippet) => ({ ...snippet }))
          : mergeImportedSqlSnippets(current, result.snippets),
      );
      collapseAll();
      setImportError(null);
      setImportNotice(
        t("settings.snippets.importSuccess", {
          count: String(result.snippets.length),
          format: result.format.toUpperCase(),
        }),
      );
    } catch (error) {
      setImportNotice(null);
      setImportError(errorMessage(error));
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
      setImportError(errorMessage(error));
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
          onClick={() => {
            setSqlSnippets(copyDefaultSqlSnippets());
            collapseAll();
            clearFilters();
          }}
        >
          <RotateCcw size={14} />
          <span>{t("settings.snippets.resetDefaults")}</span>
        </button>
        <button className="primary-button" type="button" onClick={addSnippet}>
          <Plus size={14} />
          <span>{t("settings.snippets.add")}</span>
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
            <span>{t("settings.snippets.importFile")}</span>
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
            <span>{t("settings.snippets.importMerge")}</span>
          </button>
          <button
            className="text-button"
            type="button"
            disabled={importDraft.trim().length === 0}
            onClick={() => void applySnippetImport("replace")}
          >
            <Replace size={14} />
            <span>{t("settings.snippets.importReplace")}</span>
          </button>
        </div>
        {importError ? (
          <div className="inline-error settings-json-error" role="alert">
            <AlertTriangle size={13} />
            <span>{importError}</span>
          </div>
        ) : importNotice ? (
          <div className="inline-success snippet-import-notice" role="status">
            <CheckCircle2 size={13} />
            <span>{importNotice}</span>
          </div>
        ) : null}
      </div>
      {sqlSnippets.length > 0 ? (
        <div className="snippet-filter-bar">
          <div className="snippet-search">
            <Search size={14} />
            <input
              type="search"
              value={search}
              spellCheck={false}
              placeholder={t("settings.snippets.searchPlaceholder")}
              aria-label={t("settings.snippets.search")}
              onChange={(event) => setSearch(event.currentTarget.value)}
            />
            {search ? (
              <button
                className="snippet-search-clear"
                type="button"
                title={t("settings.snippets.clearSearch")}
                aria-label={t("settings.snippets.clearSearch")}
                onClick={() => setSearch("")}
              >
                <X size={13} />
              </button>
            ) : null}
          </div>
          {availableTags.length > 0 ? (
            <div
              className="snippet-tag-filter"
              role="group"
              aria-label={t("settings.snippets.filterByTag")}
            >
              {availableTags.map((tag) => (
                <button
                  key={tag}
                  className={`snippet-tag${activeTags.includes(tag) ? " active" : ""}`}
                  type="button"
                  aria-pressed={activeTags.includes(tag)}
                  onClick={() => toggleTagFilter(tag)}
                >
                  {tag}
                </button>
              ))}
            </div>
          ) : null}
          <div className="snippet-filter-status">
            <small>
              {t("settings.snippets.matchCount", {
                visible: String(visibleSnippets.length),
                total: String(sqlSnippets.length),
              })}
            </small>
            {filtered ? (
              <button
                className="text-button"
                type="button"
                onClick={clearFilters}
              >
                {t("settings.snippets.clearFilters")}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {sqlSnippets.length === 0 ? (
        <div className="empty-browser">{t("settings.snippets.empty")}</div>
      ) : visibleSnippets.length === 0 ? (
        <div className="empty-browser">{t("settings.snippets.noMatches")}</div>
      ) : (
        <div className="snippet-editor-list">
          {visibleSnippets.map(({ snippet, index }) => {
            const open = expanded.has(index);
            return (
              <div
                className={`snippet-editor-item${open ? " expanded" : ""}`}
                key={`${snippet.label}-${index}`}
              >
                <button
                  className="snippet-editor-summary"
                  type="button"
                  aria-expanded={open}
                  onClick={() => toggleExpanded(index)}
                >
                  {open ? (
                    <ChevronDown size={14} />
                  ) : (
                    <ChevronRight size={14} />
                  )}
                  <code className="snippet-summary-label">{snippet.label}</code>
                  <small className={`command-scope ${snippet.scope}`}>
                    {snippet.scope}
                  </small>
                  <span className="snippet-summary-detail">
                    {snippet.detail}
                  </span>
                  {(snippet.tags ?? []).map((tag) => (
                    <small className="snippet-tag" key={tag}>
                      {tag}
                    </small>
                  ))}
                </button>
                {open ? (
                  <div className="snippet-editor-body">
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
                    <label className="snippet-tags-field">
                      <span>{t("settings.snippets.tags")}</span>
                      <input
                        value={
                          tagDrafts[index] ??
                          formatSnippetTagInput(snippet.tags)
                        }
                        spellCheck={false}
                        placeholder={t("settings.snippets.tagsPlaceholder")}
                        onChange={(event) =>
                          editSnippetTags(index, event.currentTarget.value)
                        }
                        onBlur={() => commitSnippetTags(index)}
                      />
                      <small className="snippet-field-hint">
                        {t("settings.snippets.tagsHint")}
                      </small>
                    </label>
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
                        className="text-button danger"
                        type="button"
                        onClick={() => removeSnippet(index)}
                      >
                        <Trash2 size={13} />
                        <span>{t("settings.snippets.remove")}</span>
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
