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
import type { DbEngine } from "@/generated/irodori-api";
import { DialogShell } from "@/components/DialogShell";
import { useConfirm } from "@/components/ConfirmDialog";
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
  label: string;
  profiles: ConnectionDraft[];
};

type ConnectionColorPickerProps = {
  color: string;
  normalizedColor: string;
  onChange: (color: string) => void;
  onNormalize: () => void;
};

const environmentOrder = ["prod", "stg", "dev", "local", "other"] as const;
const environmentLabels: Record<(typeof environmentOrder)[number], string> = {
  prod: "PRD / Production",
  stg: "STG / Staging",
  dev: "DEV / Development",
  local: "Local",
  other: "Other",
};

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
      label: environmentLabels[key],
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

function socketPathLabel(engine: DbEngine) {
  return isMysqlSocketEngine(engine) ? "Socket file" : "Socket directory";
}

function socketPathPlaceholder(engine: DbEngine) {
  return isMysqlSocketEngine(engine)
    ? "/var/run/mysqld/mysqld.sock"
    : "/var/run/postgresql";
}

function ConnectionColorPicker({
  color,
  normalizedColor,
  onChange,
  onNormalize,
}: ConnectionColorPickerProps) {
  return (
    <div className="connection-color-options">
      <div className="connection-color-bar">
        <div
          className="connection-color-grid"
          role="group"
          aria-label="Connection color"
        >
          {connectionColorOptions.map((option) => (
            <ConnectionColorSwatch
              key={option}
              color={option}
              selected={normalizedColor === option}
              className="connection-color-swatch"
              onSelect={onChange}
            />
          ))}
          <label
            className="connection-color-custom"
            title="Pick a custom color"
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
              aria-label="Use custom connection color"
            />
          </label>
        </div>
        <input
          className="connection-color-hex"
          value={color}
          spellCheck={false}
          aria-label="Connection color hex"
          onBlur={onNormalize}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      </div>
      <details className="connection-color-more">
        <summary>
          <ChevronRight size={13} />
          <span>More colors</span>
        </summary>
        <div
          className="connection-color-palette"
          role="group"
          aria-label="Extended color palette"
        >
          {connectionCustomColorOptions.map((option) => (
            <ConnectionColorSwatch
              key={option}
              color={option}
              selected={normalizedColor === option}
              className="connection-color-chip"
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
  onSelect,
}: {
  color: string;
  selected: boolean;
  className: string;
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
      aria-label={`Use color ${color}`}
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
  error: string | null;
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
  const { confirm, confirmElement } = useConfirm();
  const [transferMenuOpen, setTransferMenuOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(),
  );
  const groupedProfiles = useMemo(
    () => groupConnectionProfiles(profiles),
    [profiles],
  );
  const normalizedDraftColor = normalizeConnectionColor(draft.color);
  const socketSupported = supportsSocketTransport(draft.engine);
  const transportMode =
    socketSupported && draft.connectionTransport === "socket"
      ? "socket"
      : "tcp";

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
            {profile.readOnly ? " · read-only" : ""}
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
            <strong>{group.label}</strong>
            <small>
              {connectedCount > 0
                ? connectedCount +
                  " connected · " +
                  group.profiles.length +
                  " total"
                : group.profiles.length + " total"}
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

  return (
    <DialogShell
      className="connection-dialog"
      overlayClassName="palette-overlay connection-overlay"
      label="Connection manager"
      onClose={onClose}
      autoFocus={false}
    >
      <aside className="connection-picker">
        <div className="connection-picker-header">
          <button
            className="icon-button"
            type="button"
            title="New connection"
            aria-label="New connection"
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
              title="Connection import and export"
              aria-label="Connection import and export"
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
                  <span>Import Connections...</span>
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
                    <span>Export {format.label}</span>
                    <small>No passwords</small>
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
              placeholder="Search connections"
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
          {profiles.length === 0 ? "No matching connections" : null}
        </div>
      </aside>
      <form className="connection-form" onSubmit={onConnect}>
        <div className="dialog-header">
          <strong>{draft.name.trim() || "New Connection"}</strong>
          <span>{engineLabel(draft.engine)}</span>
          <button className="text-button" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="dialog-body connection-form-body">
          <label className="full-row">
            <span>Connection name</span>
            <input
              value={draft.name}
              placeholder="Connection's name"
              onChange={(event) =>
                onUpdateDraft({ name: event.currentTarget.value })
              }
            />
          </label>
          <div className="connection-color-row full-row">
            <span>Color tag</span>
            <ConnectionColorPicker
              color={draft.color}
              normalizedColor={normalizedDraftColor}
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
              <span>Engine</span>
              <select
                value={draft.engine}
                onChange={(event) =>
                  onUpdateDraft({
                    engine: event.currentTarget.value as DbEngine,
                  })
                }
              >
                {engineOptions.map((engine) => (
                  <option key={engine.value} value={engine.value}>
                    {engine.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Profile ID</span>
              <input
                value={draft.id}
                onChange={(event) =>
                  onUpdateDraft({ id: event.currentTarget.value })
                }
              />
            </label>
            <div
              className="mode-toggle form-toggle"
              aria-label="Connection input mode"
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
                  aria-label="Connection transport"
                >
                  <button
                    className={transportMode === "tcp" ? "active" : ""}
                    type="button"
                    onClick={() =>
                      onUpdateDraft({ connectionTransport: "tcp" })
                    }
                  >
                    Direct TCP
                  </button>
                  <button
                    className={transportMode === "socket" ? "active" : ""}
                    type="button"
                    onClick={() =>
                      onUpdateDraft({ connectionTransport: "socket" })
                    }
                  >
                    Unix socket
                  </button>
                </div>
              ) : null}
              <div className="connection-form-grid">
                {transportMode === "socket" ? (
                  <label className="full-row">
                    <span>{socketPathLabel(draft.engine)}</span>
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
              <strong>Read-only mode</strong>
            </span>
          </label>
          <div className="connection-transport full-row">
            <ShieldCheck size={15} />
            <span>Transport</span>
            <strong>
              {draft.mode === "fields" && transportMode === "socket"
                ? socketPathLabel(draft.engine)
                : engineSettings.transportLabel}
            </strong>
          </div>
          {error ? (
            <p className="inline-error full-row">
              <AlertTriangle size={13} />
              <span>{error}</span>
            </p>
          ) : null}
        </div>
        <div className="dialog-footer">
          <button
            className="text-button danger"
            type="button"
            onClick={() => {
              void confirm({
                title: "Delete connection?",
                message: `"${
                  draft.name.trim() || draft.id
                }" will be removed from your saved connections. This can't be undone.`,
                confirmLabel: "Delete",
                tone: "danger",
              }).then((confirmed) => {
                if (confirmed) {
                  onDeleteProfile();
                }
              });
            }}
          >
            Delete
          </button>
          <button
            className="text-button"
            type="button"
            disabled={!activeConnectionOpen}
            onClick={onDisconnect}
          >
            <Power size={13} />
            Disconnect
          </button>
          <button className="text-button" type="button" onClick={onSave}>
            Save
          </button>
          <button
            className="text-button"
            type="button"
            disabled={testing}
            onClick={onTest}
          >
            {testing ? "Testing" : "Test"}
          </button>
          <button
            className="primary-action"
            type="submit"
            disabled={connecting}
          >
            <Database size={14} />
            {connecting ? "Connecting" : "Connect"}
          </button>
        </div>
      </form>
      {confirmElement}
    </DialogShell>
  );
}
