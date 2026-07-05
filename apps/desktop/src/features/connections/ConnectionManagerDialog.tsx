import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEventHandler,
} from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Database,
  LockKeyhole,
  MoreHorizontal,
  Plus,
  Power,
  Search,
  ShieldCheck,
  Upload,
} from "lucide-react";
import {
  dbEngineBuildSupport,
  type DbEngine,
  type EngineBuildSupport,
} from "@/generated/irodori-api";
import { DialogShell } from "@/components/DialogShell";
import { ErrorDetails } from "@/components/ErrorDetails";
import { useConfirm } from "@/components/ConfirmDialog";
import { usePreferencesStore } from "@/features/preferences";
import { createTranslator, type TranslationKey, type Translator } from "@/i18n";
import {
  connectionCustomColorOptions,
  connectionColorOptions,
  engineConnectionSettings,
  engineLabel,
  engineOptions,
  normalizeConnectionColor,
  supportsSocketTransport,
  type ConnectionDraft,
} from "./connection-profiles";
import {
  connectionTransferFormatOptions,
  type ConnectionTransferFormat,
} from "./connection-transfer";

type ConnectionProfileGroup = {
  id: string;
  labelKey: TranslationKey;
  profiles: ConnectionDraft[];
};

type ConnectionColorPickerProps = {
  color: string;
  normalizedColor: string;
  t: Translator["t"];
  onChange: (color: string) => void;
  onNormalize: () => void;
};

const environmentOrder = ["prod", "stg", "dev", "local", "other"] as const;
const environmentLabelKeys: Record<
  (typeof environmentOrder)[number],
  TranslationKey
> = {
  prod: "connection.group.prod",
  stg: "connection.group.stg",
  dev: "connection.group.dev",
  local: "connection.group.local",
  other: "connection.group.other",
};
const connectorStatusDocUrl =
  "https://hjosugi.github.io/irodori-docs/data-source-support-status.html";

function connectionSearchText(profile: ConnectionDraft) {
  return [profile.id, profile.name, profile.host, profile.database, profile.url]
    .join(" ")
    .toLowerCase();
}

function connectionEnvironment(profile: ConnectionDraft) {
  const text = connectionSearchText(profile);
  if (/\b(prod|prd|production)\b/.test(text)) {
    return "prod";
  }
  if (/\b(stg|stage|staging)\b/.test(text)) {
    return "stg";
  }
  if (/\b(dev|develop|development|test|qa)\b/.test(text)) {
    return "dev";
  }
  if (/\b(local|localhost|127\.0\.0\.1|memory)\b/.test(text)) {
    return "local";
  }
  return "other";
}

function groupConnectionProfiles(profiles: ConnectionDraft[]) {
  const byEnvironment = new Map<string, ConnectionDraft[]>();
  for (const profile of profiles) {
    const key = connectionEnvironment(profile);
    byEnvironment.set(key, [...(byEnvironment.get(key) ?? []), profile]);
  }
  return environmentOrder
    .filter((key) => byEnvironment.has(key))
    .map((key) => ({
      id: key,
      labelKey: environmentLabelKeys[key],
      profiles: byEnvironment.get(key) ?? [],
    }));
}

function connectionColorForeground(color: string) {
  const normalized = normalizeConnectionColor(color);
  const red = Number.parseInt(normalized.slice(1, 3), 16);
  const green = Number.parseInt(normalized.slice(3, 5), 16);
  const blue = Number.parseInt(normalized.slice(5, 7), 16);
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  return luminance > 0.58 ? "#1c1c1c" : "#ffffff";
}

function isMysqlSocketEngine(engine: DbEngine) {
  return engine === "mysql" || engine === "mariadb" || engine === "tidb";
}

function socketPathLabelKey(engine: DbEngine): TranslationKey {
  return isMysqlSocketEngine(engine)
    ? "connection.socketFile"
    : "connection.socketDirectory";
}

function socketPathPlaceholder(engine: DbEngine) {
  return isMysqlSocketEngine(engine)
    ? "/var/run/mysqld/mysqld.sock"
    : "/var/run/postgresql";
}

function buildSupportByEngine(items: EngineBuildSupport[]) {
  return new Map(items.map((item) => [item.engine, item]));
}

function isFeatureMissing(support: EngineBuildSupport | undefined) {
  return Boolean(
    support?.requiredFeature && support.includedInCurrentBuild === false,
  );
}

function featureMissingMessage(
  engine: DbEngine,
  support: EngineBuildSupport | undefined,
  t: Translator["t"],
) {
  if (!isFeatureMissing(support)) {
    return null;
  }
  return [
    t("connection.build.notAvailable", { engine: engineLabel(engine) }),
    t("connection.build.useStandardRelease"),
    t("connection.build.availability", { url: connectorStatusDocUrl }),
  ].join(" ");
}

function ConnectionColorPicker({
  color,
  normalizedColor,
  t,
  onChange,
  onNormalize,
}: ConnectionColorPickerProps) {
  return (
    <div className="connection-color-options">
      <div className="connection-color-bar">
        <div
          className="connection-color-grid"
          role="group"
          aria-label={t("connection.color.label")}
        >
          {connectionColorOptions.map((option) => (
            <ConnectionColorSwatch
              key={option}
              color={option}
              selected={normalizedColor === option}
              className="connection-color-swatch"
              t={t}
              onSelect={onChange}
            />
          ))}
          <label
            className="connection-color-custom"
            title={t("connection.color.pickCustom")}
          >
            <span
              className="connection-color-custom-chip"
              style={{
                background: normalizedColor,
                color: connectionColorForeground(normalizedColor),
              }}
              aria-hidden="true"
            >
              <Plus size={12} strokeWidth={2.5} />
            </span>
            <input
              type="color"
              value={normalizedColor}
              onChange={(event) => onChange(event.currentTarget.value)}
              aria-label={t("connection.color.useCustom")}
            />
          </label>
        </div>
        <input
          className="connection-color-hex"
          value={color}
          spellCheck={false}
          aria-label={t("connection.color.hex")}
          onBlur={onNormalize}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      </div>
      <details className="connection-color-more">
        <summary>
          <ChevronRight size={13} />
          <span>{t("connection.color.more")}</span>
        </summary>
        <div
          className="connection-color-palette"
          role="group"
          aria-label={t("connection.color.extendedPalette")}
        >
          {connectionCustomColorOptions.map((option) => (
            <ConnectionColorSwatch
              key={option}
              color={option}
              selected={normalizedColor === option}
              className="connection-color-chip"
              t={t}
              onSelect={onChange}
            />
          ))}
        </div>
      </details>
    </div>
  );
}

function ConnectionColorSwatch({
  color,
  selected,
  className,
  t,
  onSelect,
}: {
  color: string;
  selected: boolean;
  className: string;
  t: Translator["t"];
  onSelect: (color: string) => void;
}) {
  return (
    <button
      type="button"
      className={selected ? `${className} active` : className}
      style={{
        background: color,
        color: connectionColorForeground(color),
      }}
      aria-label={t("connection.color.use", { color })}
      aria-pressed={selected}
      onClick={() => onSelect(color)}
    >
      {selected ? <Check size={12} strokeWidth={3} /> : null}
    </button>
  );
}

export function ConnectionManagerDialog({
  profiles,
  connectedIds,
  selectedProfileId,
  draft,
  search,
  error,
  activeConnectionOpen,
  testing,
  connecting,
  onClose,
  onSearchChange,
  onAddProfile,
  onImportProfiles,
  onExportProfiles,
  onSelectProfile,
  onUpdateDraft,
  onDeleteProfile,
  onDisconnect,
  onSave,
  onTest,
  onConnect,
}: {
  profiles: ConnectionDraft[];
  connectedIds: Set<string>;
  selectedProfileId: string;
  draft: ConnectionDraft;
  search: string;
  error: unknown | null;
  activeConnectionOpen: boolean;
  testing: boolean;
  connecting: boolean;
  onClose: () => void;
  onSearchChange: (value: string) => void;
  onAddProfile: () => void;
  onImportProfiles: (file: File) => void;
  onExportProfiles: (format: ConnectionTransferFormat) => void;
  onSelectProfile: (profile: ConnectionDraft) => void;
  onUpdateDraft: (patch: Partial<ConnectionDraft>) => void;
  onDeleteProfile: () => void;
  onDisconnect: () => void;
  onSave: () => void;
  onTest: () => void;
  onConnect: FormEventHandler<HTMLFormElement>;
}) {
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const transferMenuRef = useRef<HTMLDivElement | null>(null);
  const engineSettings = engineConnectionSettings(draft.engine);
  const locale = usePreferencesStore((state) => state.locale);
  const { t } = createTranslator(locale);
  const { confirm, confirmElement } = useConfirm();
  const [transferMenuOpen, setTransferMenuOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(),
  );
  const [engineBuildSupport, setEngineBuildSupport] = useState(
    () => new Map<DbEngine, EngineBuildSupport>(),
  );
  const groupedProfiles = useMemo(
    () => groupConnectionProfiles(profiles),
    [profiles],
  );
  const normalizedDraftColor = normalizeConnectionColor(draft.color);
  const socketSupported = supportsSocketTransport(draft.engine);
  const selectedEngineSupport = engineBuildSupport.get(draft.engine);
  const selectedEngineMessage = featureMissingMessage(
    draft.engine,
    selectedEngineSupport,
    t,
  );
  const selectedEngineMissing = Boolean(selectedEngineMessage);
  const transportMode =
    socketSupported && draft.connectionTransport === "socket"
      ? "socket"
      : "tcp";

  useEffect(() => {
    let active = true;
    void dbEngineBuildSupport()
      .then((items) => {
        if (active) {
          setEngineBuildSupport(buildSupportByEngine(items));
        }
      })
      .catch(() => {
        if (active) {
          setEngineBuildSupport(new Map());
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!transferMenuOpen) {
      return;
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      setTransferMenuOpen(false);
    };
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && transferMenuRef.current?.contains(target)) {
        return;
      }
      setTransferMenuOpen(false);
    };
    const closeOnBlur = () => setTransferMenuOpen(false);
    window.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("blur", closeOnBlur);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("blur", closeOnBlur);
    };
  }, [transferMenuOpen]);

  function toggleGroup(groupId: string) {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }

  function renderProfile(profile: ConnectionDraft) {
    const connected = connectedIds.has(profile.id);
    return (
      <button
        key={profile.id}
        className={
          profile.id === selectedProfileId
            ? "connection-profile active"
            : "connection-profile"
        }
        type="button"
        onClick={() => onSelectProfile(profile)}
      >
        <span
          className="connection-color-dot"
          style={{ background: profile.color }}
          aria-hidden="true"
        />
        <span>
          <strong>{profile.name}</strong>
          <small>
            {engineLabel(profile.engine)}
            {profile.database ? " · " + profile.database : ""}
            {profile.readOnly ? " · " + t("connection.readOnlyBadge") : ""}
          </small>
        </span>
        <i className={connected ? "connected" : ""} />
      </button>
    );
  }

  function renderGroup(group: ConnectionProfileGroup) {
    const collapsed = collapsedGroups.has(group.id);
    const connectedCount = group.profiles.filter((profile) =>
      connectedIds.has(profile.id),
    ).length;
    return (
      <section className="connection-profile-group" key={group.id}>
        <button
          className="connection-profile-group-header"
          type="button"
          aria-expanded={!collapsed}
          onClick={() => toggleGroup(group.id)}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          <span>
            <strong>{t(group.labelKey)}</strong>
            <small>
              {connectedCount > 0
                ? t("connection.group.connectedCount", {
                    connected: connectedCount,
                    total: group.profiles.length,
                  })
                : t("connection.group.totalCount", {
                    total: group.profiles.length,
                  })}
            </small>
          </span>
        </button>
        {collapsed ? null : (
          <div className="connection-profile-group-items">
            {group.profiles.map(renderProfile)}
          </div>
        )}
      </section>
    );
  }

  const handleConnect: FormEventHandler<HTMLFormElement> = (event) => {
    if (selectedEngineMissing) {
      event.preventDefault();
      return;
    }
    onConnect(event);
  };

  return (
    <DialogShell
      className="connection-dialog"
      overlayClassName="palette-overlay connection-overlay"
      label={t("connection.title")}
      onClose={onClose}
      autoFocus={false}
    >
      <aside className="connection-picker">
        <div className="connection-picker-header">
          <button
            className="icon-button"
            type="button"
            title={t("connection.newConnection")}
            aria-label={t("connection.newConnection")}
            onClick={onAddProfile}
          >
            <Plus size={16} />
          </button>
          <div className="connection-action-menu-wrap" ref={transferMenuRef}>
            <button
              className={
                transferMenuOpen ? "icon-button active" : "icon-button"
              }
              type="button"
              title={t("connection.importExport")}
              aria-label={t("connection.importExport")}
              aria-expanded={transferMenuOpen}
              onClick={() => setTransferMenuOpen((open) => !open)}
            >
              <MoreHorizontal size={16} />
            </button>
            {transferMenuOpen ? (
              <div className="connection-action-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setTransferMenuOpen(false);
                    importInputRef.current?.click();
                  }}
                >
                  <span>{t("connection.importConnections")}</span>
                  <Upload size={13} />
                </button>
                <span className="connection-action-menu-separator" />
                {connectionTransferFormatOptions.map((format) => (
                  <button
                    key={format.value}
                    type="button"
                    role="menuitem"
                    disabled={profiles.length === 0}
                    onClick={() => {
                      setTransferMenuOpen(false);
                      onExportProfiles(format.value);
                    }}
                  >
                    <span>
                      {t("connection.exportFormat", { format: format.label })}
                    </span>
                    <small>{t("connection.noPasswords")}</small>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <label className="connection-search">
            <Search size={15} />
            <input
              autoFocus
              value={search}
              placeholder={t("connection.searchPlaceholder")}
              onChange={(event) => onSearchChange(event.currentTarget.value)}
            />
          </label>
          <input
            ref={importInputRef}
            className="hidden-file-input"
            type="file"
            accept=".json,.xml,.csv,.ini,.txt,.conf,.tableplusconnection"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) {
                onImportProfiles(file);
              }
            }}
          />
        </div>
        <div className="connection-profile-list">
          {groupedProfiles.map(renderGroup)}
        </div>
        <div className="connection-picker-empty">
          {profiles.length === 0 ? t("connection.noMatches") : null}
        </div>
      </aside>
      <form className="connection-form" onSubmit={handleConnect}>
        <div className="dialog-header">
          <strong>
            {draft.name.trim() || t("connection.newConnectionName")}
          </strong>
          <span>{engineLabel(draft.engine)}</span>
          <button className="text-button" type="button" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
        <div className="dialog-body connection-form-body">
          <label className="full-row">
            <span>{t("connection.name")}</span>
            <input
              value={draft.name}
              placeholder={t("connection.namePlaceholder")}
              onChange={(event) =>
                onUpdateDraft({ name: event.currentTarget.value })
              }
            />
          </label>
          <div className="connection-color-row full-row">
            <span>{t("connection.colorTag")}</span>
            <ConnectionColorPicker
              color={draft.color}
              normalizedColor={normalizedDraftColor}
              t={t}
              onChange={(color) => onUpdateDraft({ color })}
              onNormalize={() =>
                onUpdateDraft({
                  color: normalizeConnectionColor(draft.color),
                })
              }
            />
          </div>
          <div className="connection-form-grid">
            <label>
              <span>{t("connection.engine")}</span>
              <select
                value={draft.engine}
                onChange={(event) =>
                  onUpdateDraft({
                    engine: event.currentTarget.value as DbEngine,
                  })
                }
              >
                {engineOptions.map((engine) => {
                  const missing = isFeatureMissing(
                    engineBuildSupport.get(engine.value),
                  );
                  return (
                    <option
                      key={engine.value}
                      value={engine.value}
                      disabled={missing}
                    >
                      {engine.label}
                      {missing ? ` ${t("connection.notInBuild")}` : ""}
                    </option>
                  );
                })}
              </select>
            </label>
            {selectedEngineMessage ? (
              <p className="inline-error connection-build-error full-row">
                <AlertTriangle size={13} />
                <span>{selectedEngineMessage}</span>
              </p>
            ) : null}
            <label>
              <span>{t("connection.profileId")}</span>
              <input
                value={draft.id}
                onChange={(event) =>
                  onUpdateDraft({ id: event.currentTarget.value })
                }
              />
            </label>
            <div
              className="mode-toggle form-toggle"
              aria-label={t("connection.inputMode")}
            >
              <button
                className={draft.mode === "url" ? "active" : ""}
                type="button"
                onClick={() => onUpdateDraft({ mode: "url" })}
              >
                URL
              </button>
              <button
                className={draft.mode === "fields" ? "active" : ""}
                type="button"
                onClick={() => onUpdateDraft({ mode: "fields" })}
              >
                {engineSettings.fieldsLabel}
              </button>
            </div>
          </div>
          {draft.mode === "url" ? (
            <label className="full-row">
              <span>{engineSettings.urlLabel}</span>
              <input
                value={draft.url}
                placeholder={engineSettings.urlPlaceholder}
                onChange={(event) =>
                  onUpdateDraft({ url: event.currentTarget.value })
                }
              />
            </label>
          ) : (
            <div className="connection-form-stack full-row">
              {socketSupported ? (
                <div
                  className="connection-transport-toggle form-toggle"
                  aria-label={t("connection.transportMode")}
                >
                  <button
                    className={transportMode === "tcp" ? "active" : ""}
                    type="button"
                    onClick={() =>
                      onUpdateDraft({ connectionTransport: "tcp" })
                    }
                  >
                    {t("connection.transportTcp")}
                  </button>
                  <button
                    className={transportMode === "socket" ? "active" : ""}
                    type="button"
                    onClick={() =>
                      onUpdateDraft({ connectionTransport: "socket" })
                    }
                  >
                    {t("connection.transportSocket")}
                  </button>
                </div>
              ) : null}
              <div className="connection-form-grid">
                {transportMode === "socket" ? (
                  <label className="full-row">
                    <span>{t(socketPathLabelKey(draft.engine))}</span>
                    <input
                      value={draft.socketPath}
                      placeholder={socketPathPlaceholder(draft.engine)}
                      onChange={(event) =>
                        onUpdateDraft({ socketPath: event.currentTarget.value })
                      }
                    />
                  </label>
                ) : (
                  <>
                    {engineSettings.showHost ? (
                      <label>
                        <span>{engineSettings.hostLabel}</span>
                        <input
                          value={draft.host}
                          placeholder={engineSettings.hostPlaceholder}
                          onChange={(event) =>
                            onUpdateDraft({ host: event.currentTarget.value })
                          }
                        />
                      </label>
                    ) : null}
                    {engineSettings.showPort ? (
                      <label>
                        <span>{engineSettings.portLabel}</span>
                        <input
                          inputMode="numeric"
                          value={draft.port}
                          onChange={(event) =>
                            onUpdateDraft({ port: event.currentTarget.value })
                          }
                        />
                      </label>
                    ) : null}
                  </>
                )}
                {engineSettings.showUser ? (
                  <label>
                    <span>{engineSettings.userLabel}</span>
                    <input
                      value={draft.user}
                      placeholder={engineSettings.userPlaceholder}
                      onChange={(event) =>
                        onUpdateDraft({ user: event.currentTarget.value })
                      }
                    />
                  </label>
                ) : null}
                {engineSettings.showPassword ? (
                  <label>
                    <span>{engineSettings.passwordLabel}</span>
                    <input
                      type="password"
                      value={draft.password}
                      placeholder={engineSettings.passwordPlaceholder}
                      onChange={(event) =>
                        onUpdateDraft({ password: event.currentTarget.value })
                      }
                    />
                  </label>
                ) : null}
                <label className="full-row">
                  <span>{engineSettings.databaseLabel}</span>
                  <input
                    value={draft.database}
                    placeholder={engineSettings.databasePlaceholder}
                    onChange={(event) =>
                      onUpdateDraft({ database: event.currentTarget.value })
                    }
                  />
                </label>
              </div>
            </div>
          )}
          <label className="connection-readonly-toggle full-row">
            <input
              type="checkbox"
              checked={draft.readOnly}
              onChange={(event) =>
                onUpdateDraft({ readOnly: event.currentTarget.checked })
              }
            />
            <span>
              <LockKeyhole size={14} />
              <strong>{t("connection.readOnly")}</strong>
            </span>
          </label>
          <div className="connection-transport full-row">
            <ShieldCheck size={15} />
            <span>{t("connection.transport")}</span>
            <strong>
              {draft.mode === "fields" && transportMode === "socket"
                ? t(socketPathLabelKey(draft.engine))
                : engineSettings.transportLabel}
            </strong>
          </div>
          {error ? (
            <ErrorDetails
              className="inline-error full-row error-callout"
              error={error}
              icon={<AlertTriangle size={13} />}
            />
          ) : null}
        </div>
        <div className="dialog-footer">
          <button
            className="text-button danger"
            type="button"
            onClick={() => {
              void confirm({
                title: t("connection.confirmDelete.title"),
                message: t("connection.confirmDelete.message", {
                  name: draft.name.trim() || draft.id,
                }),
                confirmLabel: t("common.delete"),
                tone: "danger",
              }).then((confirmed) => {
                if (confirmed) {
                  onDeleteProfile();
                }
              });
            }}
          >
            {t("common.delete")}
          </button>
          <button
            className="text-button"
            type="button"
            disabled={!activeConnectionOpen}
            onClick={onDisconnect}
          >
            <Power size={13} />
            {t("connection.disconnect")}
          </button>
          <button className="text-button" type="button" onClick={onSave}>
            {t("common.save")}
          </button>
          <button
            className="text-button"
            type="button"
            disabled={testing || selectedEngineMissing}
            onClick={onTest}
          >
            {testing ? t("connection.testing") : t("connection.test")}
          </button>
          <button
            className="primary-action"
            type="submit"
            disabled={connecting || selectedEngineMissing}
          >
            <Database size={14} />
            {connecting ? t("connection.connecting") : t("connection.connect")}
          </button>
        </div>
      </form>
      {confirmElement}
    </DialogShell>
  );
}
