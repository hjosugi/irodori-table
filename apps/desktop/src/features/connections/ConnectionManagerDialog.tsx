import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEventHandler,
} from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Database,
  MoreHorizontal,
  Plus,
  Power,
  Search,
  ShieldCheck,
  Upload,
} from "lucide-react";
import type { DbEngine } from "@/generated/irodori-api";
import {
  connectionColorOptions,
  engineLabel,
  engineOptions,
  normalizeConnectionColor,
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

const environmentOrder = ["prod", "stg", "dev", "local", "other"] as const;
const environmentLabels: Record<(typeof environmentOrder)[number], string> = {
  prod: "PRD / Production",
  stg: "STG / Staging",
  dev: "DEV / Development",
  local: "Local",
  other: "Other",
};

function connectionSearchText(profile: ConnectionDraft) {
  return [
    profile.id,
    profile.name,
    profile.host,
    profile.database,
    profile.url,
  ]
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
  const [transferMenuOpen, setTransferMenuOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(),
  );
  const groupedProfiles = useMemo(
    () => groupConnectionProfiles(profiles),
    [profiles],
  );

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
    <div
      className="palette-overlay connection-overlay"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="connection-dialog"
        role="dialog"
        aria-label="Connection manager"
        onClick={(event) => event.stopPropagation()}
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
                className={transferMenuOpen ? "icon-button active" : "icon-button"}
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
              <div className="connection-color-options">
                {connectionColorOptions.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={
                      draft.color === color
                        ? "connection-color-swatch active"
                        : "connection-color-swatch"
                    }
                    style={{ background: color }}
                    aria-label={`Use color ${color}`}
                    onClick={() => onUpdateDraft({ color })}
                  />
                ))}
                <label className="connection-custom-color">
                  <input
                    type="color"
                    value={normalizeConnectionColor(draft.color)}
                    onChange={(event) =>
                      onUpdateDraft({ color: event.currentTarget.value })
                    }
                    aria-label="Use custom connection color"
                  />
                  <input
                    value={draft.color}
                    spellCheck={false}
                    aria-label="Connection color hex"
                    onBlur={() =>
                      onUpdateDraft({
                        color: normalizeConnectionColor(draft.color),
                      })
                    }
                    onChange={(event) =>
                      onUpdateDraft({ color: event.currentTarget.value })
                    }
                  />
                </label>
              </div>
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
                  Fields
                </button>
              </div>
            </div>
            {draft.mode === "url" ? (
              <label className="full-row">
                <span>URL / DSN</span>
                <input
                  value={draft.url}
                  placeholder="postgres://user:password@host:5432/database"
                  onChange={(event) =>
                    onUpdateDraft({ url: event.currentTarget.value })
                  }
                />
              </label>
            ) : (
              <div className="connection-form-grid">
                <label>
                  <span>Host / socket</span>
                  <input
                    value={draft.host}
                    placeholder="localhost"
                    onChange={(event) =>
                      onUpdateDraft({ host: event.currentTarget.value })
                    }
                  />
                </label>
                <label>
                  <span>Port</span>
                  <input
                    inputMode="numeric"
                    value={draft.port}
                    onChange={(event) =>
                      onUpdateDraft({ port: event.currentTarget.value })
                    }
                  />
                </label>
                <label>
                  <span>User</span>
                  <input
                    value={draft.user}
                    onChange={(event) =>
                      onUpdateDraft({ user: event.currentTarget.value })
                    }
                  />
                </label>
                <label>
                  <span>Password</span>
                  <input
                    type="password"
                    value={draft.password}
                    placeholder="Session only"
                    onChange={(event) =>
                      onUpdateDraft({ password: event.currentTarget.value })
                    }
                  />
                </label>
                <label className="full-row">
                  <span>Database / service / path</span>
                  <input
                    value={draft.database}
                    onChange={(event) =>
                      onUpdateDraft({ database: event.currentTarget.value })
                    }
                  />
                </label>
              </div>
            )}
            <div className="connection-transport full-row">
              <ShieldCheck size={15} />
              <span>Transport</span>
              <strong>Direct TCP / local file</strong>
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
              onClick={onDeleteProfile}
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
      </div>
    </div>
  );
}
