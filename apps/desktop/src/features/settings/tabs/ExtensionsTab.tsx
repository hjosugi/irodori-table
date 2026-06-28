import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, Search } from "lucide-react";
import {
  bundledPluginStoreCatalog,
  defaultPluginStoreCatalogUrl,
  fetchPluginStoreCatalog,
  type PluginStoreCatalog,
  type PluginStoreExtension,
} from "@/features/extensions/plugin-store";
import { openExternalUrl, type TranslateFn } from "./shared";

function ExtensionSection({
  title,
  count,
  empty,
  extensions,
}: {
  title: string;
  count: number;
  empty: string;
  extensions: readonly PluginStoreExtension[];
}) {
  return (
    <section className="extension-section">
      <div className="extension-section-header">
        <span>{title}</span>
        <small>{count}</small>
      </div>
      {extensions.length === 0 ? (
        <div className="extension-empty">{empty}</div>
      ) : (
        <div className="extension-list">
          {extensions.map((extension) => (
            <article className="extension-item" key={extension.id}>
              <div className="extension-icon" aria-hidden="true">
                {extension.name.slice(0, 1)}
              </div>
              <div className="extension-main">
                <div className="extension-title-row">
                  <strong>{extension.name}</strong>
                  <span>{extension.version}</span>
                </div>
                <p>{extension.summary}</p>
                <div className="extension-meta">
                  <span>{extension.publisher}</span>
                  <span>{extension.runtime}</span>
                  <span>{extension.engines.join(", ")}</span>
                </div>
              </div>
              <div className="extension-actions">
                {extension.install ? (
                  <button
                    type="button"
                    className="icon-button"
                    title="Open release"
                    aria-label={`Open ${extension.name} release`}
                    onClick={() =>
                      openExternalUrl(
                        extension.install?.url ?? extension.repository,
                      )
                    }
                  >
                    <Download size={15} />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="text-button"
                  onClick={() => openExternalUrl(extension.repository)}
                >
                  GitHub
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export interface ExtensionsTabProps {
  t: TranslateFn;
  active: boolean;
}

export function ExtensionsTab({ t, active }: ExtensionsTabProps) {
  const [pluginStore, setPluginStore] = useState<PluginStoreCatalog>(
    bundledPluginStoreCatalog,
  );
  const [pluginStoreLoading, setPluginStoreLoading] = useState(false);
  const [pluginStoreError, setPluginStoreError] = useState<string | null>(null);
  const [pluginSearch, setPluginSearch] = useState("");
  const filteredPluginStoreExtensions = useMemo(() => {
    const term = pluginSearch.trim().toLowerCase();
    if (!term) {
      return pluginStore.extensions;
    }
    return pluginStore.extensions.filter((extension) =>
      [
        extension.name,
        extension.id,
        extension.publisher,
        extension.summary,
        extension.engines.join(" "),
        extension.categories.join(" "),
      ]
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [pluginSearch, pluginStore.extensions]);
  const recommendedPluginStoreExtensions = useMemo(
    () =>
      pluginStore.extensions.filter((extension) =>
        ["duckdb", "snowflake", "bigquery", "cloudSpanner", "dynamodb"].some(
          (engine) => extension.engines.includes(engine),
        ),
      ),
    [pluginStore.extensions],
  );

  useEffect(() => {
    if (!active) {
      return;
    }
    let cancelled = false;
    setPluginStoreLoading(true);
    setPluginStoreError(null);
    fetchPluginStoreCatalog(defaultPluginStoreCatalogUrl)
      .then((catalog) => {
        if (!cancelled) {
          setPluginStore(catalog);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setPluginStore(bundledPluginStoreCatalog);
          setPluginStoreError(
            error instanceof Error ? error.message : String(error),
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPluginStoreLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

  return (
    <div className="settings-extensions">
      <div className="extension-search">
        <Search size={15} />
        <input
          type="search"
          value={pluginSearch}
          placeholder={t("settings.extensions.search")}
          aria-label={t("settings.extensions.search")}
          onChange={(event) => setPluginSearch(event.currentTarget.value)}
        />
      </div>
      <div className="extension-store-note">
        <span>
          {pluginStoreLoading
            ? t("settings.extensions.loading")
            : t("settings.extensions.source", {
                source: pluginStore.source,
              })}
        </span>
        <button
          type="button"
          className="text-button"
          onClick={() => openExternalUrl(defaultPluginStoreCatalogUrl)}
        >
          {t("settings.extensions.openStore")}
        </button>
      </div>
      {pluginStoreError ? (
        <div className="inline-error settings-json-error">
          <AlertTriangle size={15} />
          <span>{pluginStoreError}</span>
        </div>
      ) : null}
      <ExtensionSection
        title={t("settings.extensions.installed")}
        count={0}
        empty={t("settings.extensions.noInstalled")}
        extensions={[]}
      />
      <ExtensionSection
        title={t("settings.extensions.marketplace")}
        count={filteredPluginStoreExtensions.length}
        empty={t("settings.extensions.noMatches")}
        extensions={filteredPluginStoreExtensions}
      />
      <ExtensionSection
        title={t("settings.extensions.recommended")}
        count={recommendedPluginStoreExtensions.length}
        empty={t("settings.extensions.noRecommended")}
        extensions={recommendedPluginStoreExtensions}
      />
    </div>
  );
}
