import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Download,
  ExternalLink,
  Power,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import {
  compareExtensionVersions,
  bundledPluginStoreCatalog,
  defaultPluginStoreCatalogUrl,
  fetchPluginStoreCatalog,
  resolvePluginStoreInstallAsset,
  type PluginStoreCatalog,
  type PluginStoreExtension,
} from "@/features/extensions/plugin-store";
import {
  extInstall,
  extList,
  extSetEnabled,
  extTarget,
  extUninstall,
  type InstalledExtension,
} from "@/generated/irodori-api";
import { openExternalUrl, type TranslateFn } from "./shared";
import { errorMessage } from "@/core";

function MarketplaceSection({
  title,
  empty,
  extensions,
  installedById,
  nativeTarget,
  operationId,
  showUnavailable,
  t,
  onInstall,
  onToggleUnavailable,
}: {
  title: string;
  empty: string;
  extensions: readonly PluginStoreExtension[];
  installedById: ReadonlyMap<string, InstalledExtension>;
  nativeTarget: string | null;
  operationId: string | null;
  showUnavailable: boolean;
  t: TranslateFn;
  onInstall: (extension: PluginStoreExtension) => void;
  onToggleUnavailable: () => void;
}) {
  // An entry with no release asset for this platform only dead-ends in a
  // disabled Install button, so it is hidden by default (#131). Installed
  // entries always stay visible: their state ("Installed") is still useful.
  // Without a runtime target (browser preview, e2e harness) nothing is
  // resolvable, so treat "no target" as "no filtering" instead of rendering
  // an empty marketplace.
  const isUnavailable = (extension: PluginStoreExtension) =>
    nativeTarget !== null &&
    !installedById.has(extension.id) &&
    !resolvePluginStoreInstallAsset(extension, nativeTarget);
  const hiddenCount = extensions.filter(isUnavailable).length;
  const visibleExtensions = showUnavailable
    ? extensions
    : extensions.filter((extension) => !isUnavailable(extension));

  return (
    <section className="extension-section">
      <div className="extension-section-header">
        <span>{title}</span>
        <span className="extension-section-tools">
          {hiddenCount > 0 ? (
            <button
              type="button"
              className="text-button extension-hidden-toggle"
              onClick={onToggleUnavailable}
            >
              {showUnavailable
                ? t("settings.extensions.hideUnavailable")
                : t("settings.extensions.hiddenForPlatform", {
                    count: hiddenCount,
                  })}
            </button>
          ) : null}
          <small>{visibleExtensions.length}</small>
        </span>
      </div>
      {visibleExtensions.length === 0 ? (
        <div className="extension-empty">{empty}</div>
      ) : (
        <div className="extension-list">
          {visibleExtensions.map((extension) => {
            const installed = installedById.get(extension.id);
            const asset = nativeTarget
              ? resolvePluginStoreInstallAsset(extension, nativeTarget)
              : undefined;
            const updateAvailable = Boolean(
              installed &&
              compareExtensionVersions(extension.version, installed.version) >
                0,
            );
            const current = Boolean(installed && !updateAvailable);
            const busy = operationId === extension.id;
            const actionLabel = busy
              ? t("settings.extensions.working")
              : updateAvailable
                ? t("settings.extensions.update")
                : current
                  ? t("settings.extensions.installedAction")
                  : asset
                    ? t("settings.extensions.install")
                    : t("settings.extensions.unsupported");

            return (
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
                    {installed ? (
                      <span>
                        {t("settings.extensions.currentVersion", {
                          version: installed.version,
                        })}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="extension-actions">
                  <button
                    type="button"
                    className="icon-button"
                    title={t("settings.extensions.openRelease")}
                    aria-label={t("settings.extensions.openReleaseFor", {
                      name: extension.name,
                    })}
                    onClick={() =>
                      openExternalUrl(
                        extension.install?.url ?? extension.repository,
                      )
                    }
                  >
                    <ExternalLink size={15} />
                  </button>
                  <button
                    type="button"
                    className="text-button primary"
                    disabled={busy || current || !asset}
                    onClick={() => onInstall(extension)}
                  >
                    <Download size={14} />
                    {actionLabel}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function InstalledSection({
  installed,
  catalogById,
  nativeTarget,
  operationId,
  t,
  onInstall,
  onToggle,
  onUninstall,
}: {
  installed: readonly InstalledExtension[];
  catalogById: ReadonlyMap<string, PluginStoreExtension>;
  nativeTarget: string | null;
  operationId: string | null;
  t: TranslateFn;
  onInstall: (extension: PluginStoreExtension) => void;
  onToggle: (extension: InstalledExtension) => void;
  onUninstall: (extension: InstalledExtension) => void;
}) {
  return (
    <section className="extension-section">
      <div className="extension-section-header">
        <span>{t("settings.extensions.installed")}</span>
        <small>{installed.length}</small>
      </div>
      {installed.length === 0 ? (
        <div className="extension-empty">
          {t("settings.extensions.noInstalled")}
        </div>
      ) : (
        <div className="extension-list">
          {installed.map((extension) => {
            const catalog = catalogById.get(extension.id);
            const canUpdate = Boolean(
              catalog &&
              nativeTarget &&
              resolvePluginStoreInstallAsset(catalog, nativeTarget) &&
              compareExtensionVersions(catalog.version, extension.version) > 0,
            );
            const busy = operationId === extension.id;
            return (
              <article className="extension-item" key={extension.id}>
                <div className="extension-icon" aria-hidden="true">
                  {extension.name.slice(0, 1)}
                </div>
                <div className="extension-main">
                  <div className="extension-title-row">
                    <strong>{extension.name}</strong>
                    <span>{extension.version}</span>
                  </div>
                  <p>
                    {extension.engine} · ABI {extension.abiVersion}
                  </p>
                  <div className="extension-meta">
                    <span>
                      {extension.enabled
                        ? t("settings.extensions.enabled")
                        : t("settings.extensions.disabled")}
                    </span>
                    <span>
                      {t("settings.extensions.verifiedDigest", {
                        digest: extension.sha256.slice(0, 12),
                      })}
                    </span>
                  </div>
                </div>
                <div className="extension-actions">
                  {canUpdate && catalog ? (
                    <button
                      type="button"
                      className="text-button primary"
                      disabled={busy}
                      onClick={() => onInstall(catalog)}
                    >
                      <Download size={14} />
                      {t("settings.extensions.update")}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => onToggle(extension)}
                  >
                    <Power size={14} />
                    {extension.enabled
                      ? t("settings.extensions.disable")
                      : t("settings.extensions.enable")}
                  </button>
                  <button
                    type="button"
                    className="text-button danger"
                    disabled={busy}
                    onClick={() => onUninstall(extension)}
                  >
                    <Trash2 size={14} />
                    {t("settings.extensions.uninstall")}
                  </button>
                </div>
              </article>
            );
          })}
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
  const { confirm, confirmElement } = useConfirm();
  const [pluginStore, setPluginStore] = useState<PluginStoreCatalog>(
    bundledPluginStoreCatalog,
  );
  const [installedExtensions, setInstalledExtensions] = useState<
    InstalledExtension[]
  >([]);
  const [nativeTarget, setNativeTarget] = useState<string | null>(null);
  const [pluginStoreLoading, setPluginStoreLoading] = useState(false);
  const [pluginStoreError, setPluginStoreError] = useState<string | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [pluginSearch, setPluginSearch] = useState("");
  const [showUnavailable, setShowUnavailable] = useState(false);

  const catalogById = useMemo(
    () =>
      new Map(
        pluginStore.extensions.map((extension) => [extension.id, extension]),
      ),
    [pluginStore.extensions],
  );
  const installedById = useMemo(
    () =>
      new Map(
        installedExtensions.map((extension) => [extension.id, extension]),
      ),
    [installedExtensions],
  );
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
        extension.topics.join(" "),
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

  const refresh = useCallback(async () => {
    setPluginStoreLoading(true);
    setPluginStoreError(null);
    setRuntimeError(null);
    const [catalogResult, runtimeResult] = await Promise.allSettled([
      fetchPluginStoreCatalog(defaultPluginStoreCatalogUrl),
      Promise.all([extTarget(), extList()]),
    ]);
    if (catalogResult.status === "fulfilled") {
      setPluginStore(catalogResult.value);
    } else {
      setPluginStore(bundledPluginStoreCatalog);
      setPluginStoreError(errorMessage(catalogResult.reason));
    }
    if (runtimeResult.status === "fulfilled") {
      setNativeTarget(runtimeResult.value[0]);
      setInstalledExtensions(runtimeResult.value[1]);
    } else {
      setNativeTarget(null);
      setInstalledExtensions([]);
      setRuntimeError(errorMessage(runtimeResult.reason));
    }
    setPluginStoreLoading(false);
  }, []);

  useEffect(() => {
    if (active) {
      void refresh();
    }
  }, [active, refresh]);

  const installOrUpdate = useCallback(
    async (extension: PluginStoreExtension) => {
      const install = extension.install;
      const asset = nativeTarget
        ? resolvePluginStoreInstallAsset(extension, nativeTarget)
        : undefined;
      if (!install || !asset || !nativeTarget) {
        setRuntimeError(t("settings.extensions.targetUnavailable"));
        return;
      }
      const existing = installedById.get(extension.id);
      const confirmed = await confirm({
        title: existing
          ? t("settings.extensions.confirmUpdateTitle", {
              name: extension.name,
            })
          : t("settings.extensions.confirmInstallTitle", {
              name: extension.name,
            }),
        message: t("settings.extensions.confirmInstallMessage", {
          version: extension.version,
          permissions: extension.permissions.join(", "),
        }),
        confirmLabel: existing
          ? t("settings.extensions.update")
          : t("settings.extensions.install"),
      });
      if (!confirmed) {
        return;
      }
      setOperationId(extension.id);
      setRuntimeError(null);
      try {
        await extInstall({
          id: extension.id,
          version: extension.version,
          repository: extension.repository,
          assetName: asset.name,
          tag: install.tag,
          sha256: asset.sha256,
          permissions: extension.permissions,
        });
        setInstalledExtensions(await extList());
      } catch (error) {
        setRuntimeError(errorMessage(error));
      } finally {
        setOperationId(null);
      }
    },
    [confirm, installedById, nativeTarget, t],
  );

  const toggleExtension = useCallback(async (extension: InstalledExtension) => {
    setOperationId(extension.id);
    setRuntimeError(null);
    try {
      await extSetEnabled(extension.id, !extension.enabled);
      setInstalledExtensions(await extList());
    } catch (error) {
      setRuntimeError(errorMessage(error));
    } finally {
      setOperationId(null);
    }
  }, []);

  const uninstallExtension = useCallback(
    async (extension: InstalledExtension) => {
      const confirmed = await confirm({
        title: t("settings.extensions.confirmUninstallTitle", {
          name: extension.name,
        }),
        message: t("settings.extensions.confirmUninstallMessage"),
        confirmLabel: t("settings.extensions.uninstall"),
        tone: "danger",
      });
      if (!confirmed) {
        return;
      }
      setOperationId(extension.id);
      setRuntimeError(null);
      try {
        await extUninstall(extension.id);
        setInstalledExtensions(await extList());
      } catch (error) {
        setRuntimeError(errorMessage(error));
      } finally {
        setOperationId(null);
      }
    },
    [confirm, t],
  );

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
        <button
          type="button"
          className="icon-button"
          title={t("settings.extensions.refresh")}
          aria-label={t("settings.extensions.refresh")}
          disabled={pluginStoreLoading}
          onClick={() => void refresh()}
        >
          <RefreshCw size={15} />
        </button>
      </div>
      <div className="extension-store-note">
        <span>
          {pluginStoreLoading
            ? t("settings.extensions.loading")
            : t("settings.extensions.source", {
                source: pluginStore.source,
              })}
        </span>
        {nativeTarget ? (
          <small>
            {t("settings.extensions.target", { target: nativeTarget })}
          </small>
        ) : null}
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
      {runtimeError ? (
        <div className="inline-error settings-json-error">
          <AlertTriangle size={15} />
          <span>{runtimeError}</span>
        </div>
      ) : null}
      <div className="extension-runtime-notice">
        <AlertTriangle size={15} />
        <span>{t("settings.extensions.runtimeNotice")}</span>
      </div>
      <InstalledSection
        installed={installedExtensions}
        catalogById={catalogById}
        nativeTarget={nativeTarget}
        operationId={operationId}
        t={t}
        onInstall={(extension) => void installOrUpdate(extension)}
        onToggle={(extension) => void toggleExtension(extension)}
        onUninstall={(extension) => void uninstallExtension(extension)}
      />
      <MarketplaceSection
        title={t("settings.extensions.marketplace")}
        empty={t("settings.extensions.noMatches")}
        extensions={filteredPluginStoreExtensions}
        installedById={installedById}
        nativeTarget={nativeTarget}
        operationId={operationId}
        showUnavailable={showUnavailable}
        t={t}
        onInstall={(extension) => void installOrUpdate(extension)}
        onToggleUnavailable={() => setShowUnavailable((value) => !value)}
      />
      <MarketplaceSection
        title={t("settings.extensions.recommended")}
        empty={t("settings.extensions.noRecommended")}
        extensions={recommendedPluginStoreExtensions}
        installedById={installedById}
        nativeTarget={nativeTarget}
        operationId={operationId}
        showUnavailable={showUnavailable}
        t={t}
        onInstall={(extension) => void installOrUpdate(extension)}
        onToggleUnavailable={() => setShowUnavailable((value) => !value)}
      />
      {confirmElement}
    </div>
  );
}
