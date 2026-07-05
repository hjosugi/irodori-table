import type { CSSProperties } from "react";
import { Plus } from "lucide-react";
import { useWorkbenchContext } from "@/app/workbench-context";
import { EngineIcon } from "@/components/EngineIcon";
import { useConnectionStore } from "@/features/connections";
import { usePreferencesStore } from "@/features/preferences";
import { createTranslator } from "@/i18n";

/**
 * TablePlus-style vertical rail at the far-left edge of the workspace: one
 * icon per saved connection with its color tag always visible. Clicking a
 * connected profile switches the active connection (the explorer sidebar
 * follows); clicking a disconnected one opens the Connection Manager with
 * that profile selected.
 */
export function ConnectionsRail() {
  const { connections } = useWorkbenchContext();
  const locale = usePreferencesStore((state) => state.locale);
  const { t } = createTranslator(locale);
  const profiles = useConnectionStore((state) => state.profiles);
  const {
    activeConnectionId,
    setActiveConnectionId,
    connectedIds,
    setConnectionManagerOpen,
    connectionActions,
  } = connections;

  return (
    <nav className="connections-rail" aria-label={t("rail.connections")}>
      <div className="connections-rail-list" role="list">
        {profiles.map((profile) => {
          const connected = connectedIds.has(profile.id);
          const active = profile.id === activeConnectionId;
          const title = connected
            ? `${profile.name} · ${t("rail.connected")}`
            : profile.name;
          return (
            <button
              key={profile.id}
              type="button"
              role="listitem"
              className={[
                "connections-rail-item",
                active ? "active" : null,
                connected ? "connected" : null,
              ]
                .filter(Boolean)
                .join(" ")}
              style={{ "--rail-color": profile.color } as CSSProperties}
              title={title}
              aria-label={title}
              aria-pressed={active}
              onClick={() => {
                if (connected) {
                  setActiveConnectionId(profile.id);
                  return;
                }
                connectionActions.selectProfile(profile);
                setConnectionManagerOpen(true);
              }}
              onDoubleClick={() => {
                connectionActions.selectProfile(profile);
                setConnectionManagerOpen(true);
              }}
            >
              <EngineIcon engine={profile.engine} size={17} />
              <span className="connections-rail-color" aria-hidden="true" />
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="connections-rail-item connections-rail-add"
        title={t("rail.addConnection")}
        aria-label={t("rail.addConnection")}
        onClick={() => {
          connectionActions.addProfile();
          setConnectionManagerOpen(true);
        }}
      >
        <Plus size={16} />
      </button>
    </nav>
  );
}
