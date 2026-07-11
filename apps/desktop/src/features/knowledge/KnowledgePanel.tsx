import { useMemo, useState } from "react";
import { BookOpen, ExternalLink, RefreshCw, X } from "lucide-react";
import type { DbEngine } from "@/generated/irodori-api";
import { usePreferencesStore } from "@/features/preferences";
import { createTranslator } from "@/i18n";
import {
  bundledKnowledgePack,
  fetchKnowledgePack,
  knowledgeForEngine,
  searchKnowledgeFacts,
  type KnowledgeFactMatch,
  type KnowledgePack,
} from "./knowledge-pack";

type KnowledgeScope = "connection" | "all";

type KnowledgePanelProps = {
  editorEngine: DbEngine;
  activeConnectionName: string;
  onClose: () => void;
  initialPack?: KnowledgePack;
};

const matchLimit = 200;

export function KnowledgePanel({
  editorEngine,
  activeConnectionName,
  onClose,
  initialPack = bundledKnowledgePack,
}: KnowledgePanelProps) {
  const locale = usePreferencesStore((state) => state.locale);
  const { t } = createTranslator(locale);
  const [pack, setPack] = useState<KnowledgePack>(initialPack);
  const [scope, setScope] = useState<KnowledgeScope>("connection");
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const engineProducts = useMemo(
    () => knowledgeForEngine(pack, editorEngine),
    [pack, editorEngine],
  );
  const scopedPack = useMemo<KnowledgePack>(
    () =>
      scope === "connection" && engineProducts.length > 0
        ? { ...pack, products: engineProducts }
        : pack,
    [pack, scope, engineProducts],
  );
  const matches = useMemo<KnowledgeFactMatch[]>(() => {
    if (query.trim()) {
      return searchKnowledgeFacts(scopedPack, query, matchLimit);
    }
    return scopedPack.products.flatMap((product) =>
      product.facts.map((fact) => ({
        product: product.product,
        engineId: product.engineId,
        fact,
      })),
    );
  }, [scopedPack, query]);

  const refresh = () => {
    setRefreshing(true);
    setRefreshError(null);
    fetchKnowledgePack()
      .then((next) => setPack(next))
      .catch((error: unknown) => {
        setRefreshError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setRefreshing(false));
  };

  return (
    <section className="knowledge-panel" aria-label={t("knowledge.title")}>
      <div className="knowledge-header">
        <div>
          <strong>{t("knowledge.title")}</strong>
          <span>
            {activeConnectionName} · {editorEngine}
          </span>
        </div>
        <button
          type="button"
          title={t("knowledge.refresh")}
          aria-label={t("knowledge.refresh")}
          disabled={refreshing}
          onClick={refresh}
        >
          <RefreshCw size={14} className={refreshing ? "spin" : undefined} />
        </button>
        <button
          type="button"
          title={t("knowledge.close")}
          aria-label={t("knowledge.close")}
          onClick={onClose}
        >
          <X size={14} />
        </button>
      </div>

      <div className="knowledge-toolbar">
        <input
          type="search"
          value={query}
          placeholder={t("knowledge.filter")}
          aria-label={t("knowledge.filter")}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div
          className="knowledge-scope"
          role="radiogroup"
          aria-label={t("knowledge.scope")}
        >
          <button
            type="button"
            role="radio"
            aria-checked={scope === "connection"}
            className={scope === "connection" ? "active" : undefined}
            onClick={() => setScope("connection")}
          >
            {t("knowledge.scope.connection")}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={scope === "all"}
            className={scope === "all" ? "active" : undefined}
            onClick={() => setScope("all")}
          >
            {t("knowledge.scope.all")}
          </button>
        </div>
      </div>

      {refreshError ? (
        <div className="knowledge-callout error" role="alert">
          {t("knowledge.refreshError", { message: refreshError })}
        </div>
      ) : null}

      {scope === "connection" && engineProducts.length === 0 ? (
        <div className="knowledge-callout">
          <BookOpen size={16} />
          <span>{t("knowledge.emptyEngine", { engine: editorEngine })}</span>
        </div>
      ) : null}

      <div className="knowledge-status">
        <span>{t("knowledge.factCount", { count: `${matches.length}` })}</span>
        {pack.updatedAt ? (
          <span>{t("knowledge.updatedAt", { date: pack.updatedAt })}</span>
        ) : null}
      </div>

      <div className="knowledge-fact-list">
        {query.trim() && matches.length === 0 ? (
          <div className="knowledge-callout">
            <span>{t("knowledge.noMatches", { query: query.trim() })}</span>
          </div>
        ) : null}
        {matches.map((match, index) => (
          <article
            className="knowledge-fact"
            key={`${match.product}-${match.fact.area}-${index}`}
          >
            <div className="knowledge-fact-meta">
              <span
                className={`knowledge-badge priority-${match.fact.priority}`}
              >
                {match.fact.priority}
              </span>
              <span className="knowledge-tag">{match.fact.area}</span>
              {scope === "all" || query.trim() ? (
                <span className="knowledge-tag product">{match.product}</span>
              ) : null}
              {match.fact.version ? (
                <span className="knowledge-tag">{match.fact.version}</span>
              ) : null}
            </div>
            <strong>{match.fact.title}</strong>
            <span>{match.fact.summary}</span>
            {match.fact.url ? (
              <a
                href={match.fact.url}
                target="_blank"
                rel="noreferrer"
                title={t("knowledge.source")}
                aria-label={t("knowledge.source")}
              >
                <ExternalLink size={12} />
                <span>{match.fact.sourceId ?? match.fact.url}</span>
              </a>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
