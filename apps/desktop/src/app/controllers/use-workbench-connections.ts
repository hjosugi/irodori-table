import { useEffect, useMemo, useState } from "react";
import type { ShowActionNotice } from "@/app/ActionToast";
import { fallbackSnapshot } from "@/app/app-config";
import { NO_ACTIVE_CONNECTION } from "@/app/app-workbench-utils";
import type { ConnectionController } from "@/app/controllers/workbench-controllers";
import { useConnectionActions } from "@/app/controllers/use-connection-actions";
import {
  defaultConnectionColor,
  engineLabel,
  useConnectionStore,
  type WorkspaceConnection,
} from "@/features/connections";
import {
  completionHintsFromMetadata,
  workbenchRuntimeService,
} from "@/features/workbench";
import type { Translator } from "@/i18n";
import type { DbEngine, WorkspaceSnapshot } from "@/generated/irodori-api";

type WorkbenchConnectionsDeps = {
  showActionNotice: ShowActionNotice;
  t: Translator["t"];
};

// The connection domain behind one seam: store state, the workspace snapshot,
// derived active-connection facts, metadata refresh, the connection actions,
// and the ConnectionManagerDialog controller.
export function useWorkbenchConnections({
  showActionNotice,
  t,
}: WorkbenchConnectionsDeps) {
  const activeConnectionId = useConnectionStore(
    (state) => state.activeConnectionId,
  );
  const setActiveConnectionId = useConnectionStore(
    (state) => state.setActiveConnectionId,
  );
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>(fallbackSnapshot);
  const profiles = useConnectionStore((state) => state.profiles);
  const setProfiles = useConnectionStore((state) => state.setProfiles);
  const selectedProfileId = useConnectionStore(
    (state) => state.selectedProfileId,
  );
  const setSelectedProfileId = useConnectionStore(
    (state) => state.setSelectedProfileId,
  );
  const draft = useConnectionStore((state) => state.draft);
  const setDraft = useConnectionStore((state) => state.setDraft);
  const connectionManagerOpen = useConnectionStore(
    (state) => state.connectionManagerOpen,
  );
  const setConnectionManagerOpen = useConnectionStore(
    (state) => state.setConnectionManagerOpen,
  );
  const connectionSearch = useConnectionStore(
    (state) => state.connectionSearch,
  );
  const setConnectionSearch = useConnectionStore(
    (state) => state.setConnectionSearch,
  );
  const connectedIds = useConnectionStore((state) => state.connectedIds);
  const setConnectedIds = useConnectionStore((state) => state.setConnectedIds);
  const liveConnections = useConnectionStore((state) => state.liveConnections);
  const setLiveConnections = useConnectionStore(
    (state) => state.setLiveConnections,
  );
  const connecting = useConnectionStore((state) => state.connecting);
  const setConnecting = useConnectionStore((state) => state.setConnecting);
  const testingConnection = useConnectionStore(
    (state) => state.testingConnection,
  );
  const setTestingConnection = useConnectionStore(
    (state) => state.setTestingConnection,
  );
  const connectionError = useConnectionStore((state) => state.connectionError);
  const setConnectionError = useConnectionStore(
    (state) => state.setConnectionError,
  );
  const metadataByConnection = useConnectionStore(
    (state) => state.metadataByConnection,
  );
  const setMetadataByConnection = useConnectionStore(
    (state) => state.setMetadataByConnection,
  );
  const metadataLoading = useConnectionStore((state) => state.metadataLoading);
  const setMetadataLoading = useConnectionStore(
    (state) => state.setMetadataLoading,
  );
  const metadataErrors = useConnectionStore((state) => state.metadataErrors);
  const setMetadataErrors = useConnectionStore(
    (state) => state.setMetadataErrors,
  );
  const objectActionMenu = useConnectionStore(
    (state) => state.objectActionMenu,
  );
  const setObjectActionMenu = useConnectionStore(
    (state) => state.setObjectActionMenu,
  );
  useEffect(() => {
    workbenchRuntimeService
      .snapshot()
      .then((nextSnapshot) => {
        setSnapshot(nextSnapshot);
        setActiveConnectionId(nextSnapshot.activeConnectionId);
      })
      .catch(() => {
        setSnapshot(fallbackSnapshot);
      });
  }, []);

  const connections = useMemo(() => {
    const byId = new Map<string, WorkspaceConnection>();
    snapshot.connections.forEach((connection) => {
      byId.set(connection.id, connection);
    });
    Object.values(liveConnections).forEach((connection) => {
      byId.set(connection.id, connection);
    });
    return Array.from(byId.values()).map((connection) => ({
      ...connection,
      status: connectedIds.has(connection.id) ? "connected" : connection.status,
    }));
  }, [connectedIds, liveConnections, snapshot.connections]);
  const connectionById = useMemo(
    () => new Map(connections.map((connection) => [connection.id, connection])),
    [connections],
  );
  const profileById = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile])),
    [profiles],
  );
  const filteredProfiles = useMemo(() => {
    const needle = connectionSearch.trim().toLowerCase();
    if (!needle) {
      return profiles;
    }
    return profiles.filter((profile) =>
      `${profile.name} ${profile.id} ${engineLabel(profile.engine)} ${profile.host} ${profile.database} ${profile.url}`
        .toLowerCase()
        .includes(needle),
    );
  }, [connectionSearch, profiles]);

  const activeConnection = useMemo(
    () =>
      connections.find((item) => item.id === activeConnectionId) ??
      connections[0] ??
      NO_ACTIVE_CONNECTION,
    [activeConnectionId, connections],
  );
  const activeProfile = profiles.find(
    (profile) => profile.id === activeConnectionId,
  );
  const activeEngine = activeProfile?.engine ?? draft.engine;
  const activeConnectionOpen = connectedIds.has(activeConnectionId);
  const activeConnectionReadOnly = activeProfile?.readOnly ?? false;
  const activeConnectionColor =
    activeProfile?.color ||
    profileById.get(activeConnectionId)?.color ||
    defaultConnectionColor;
  const activeConnectionStatus = activeConnectionOpen
    ? `${activeConnectionReadOnly ? "Read-only · " : ""}Connected · ${activeConnection.latencyMs} ms`
    : "Disconnected";
  const activeTransportLabel =
    activeConnection.proxy === "direct"
      ? "Direct connection"
      : activeConnection.proxy || "Transport not configured";

  const activeMetadata = metadataByConnection[activeConnectionId];
  const activeMetadataLoading = metadataLoading.has(activeConnectionId);
  const activeMetadataError = metadataErrors[activeConnectionId];
  const completionHints = useMemo(
    () => completionHintsFromMetadata(activeMetadata),
    [activeMetadata],
  );

  const connectionActions = useConnectionActions({
    draft,
    profiles,
    connectedIds,
    activeConnectionId,
    setDraft,
    setConnectionError,
    setSelectedProfileId,
    setActiveConnectionId,
    setProfiles,
    setConnectionSearch,
    setConnectedIds,
    setLiveConnections,
    setMetadataByConnection,
    setMetadataErrors,
    setMetadataLoading,
    setTestingConnection,
    setConnecting,
    setConnectionManagerOpen,
    showActionNotice,
    t,
  });
  const {
    updateDraft,
    selectProfile,
    saveDraft,
    addProfile,
    importConnectionFile,
    exportConnectionFile,
    deleteProfile,
    testActiveProfile,
    connectActiveProfile,
    disconnectActiveProfile,
    refreshObjects,
  } = connectionActions;

  useEffect(() => {
    if (
      activeConnectionOpen &&
      !activeMetadata &&
      !activeMetadataLoading &&
      !activeMetadataError
    ) {
      void refreshObjects(activeConnectionId);
    }
  }, [
    activeConnectionId,
    activeConnectionOpen,
    activeMetadata,
    activeMetadataError,
    activeMetadataLoading,
  ]);

  // Dialect for the editor: prefer the active connection's profile engine,
  // then the connection-form draft, then Postgres.
  const editorEngine = useMemo<DbEngine>(() => {
    const profile = profiles.find((item) => item.id === activeConnectionId);
    return profile?.engine ?? draft.engine ?? "postgres";
  }, [profiles, activeConnectionId, draft.engine]);

  const connectionController = connectionManagerOpen
    ? ({
        profiles: filteredProfiles,
        connectedIds,
        selectedProfileId,
        draft,
        search: connectionSearch,
        error: connectionError,
        activeConnectionOpen,
        testing: testingConnection,
        connecting,
        onClose: () => setConnectionManagerOpen(false),
        onSearchChange: setConnectionSearch,
        onAddProfile: addProfile,
        onImportProfiles: (file) => void importConnectionFile(file),
        onExportProfiles: exportConnectionFile,
        onSelectProfile: selectProfile,
        onUpdateDraft: updateDraft,
        onDeleteProfile: () => void deleteProfile(),
        onDisconnect: () => void disconnectActiveProfile(),
        onSave: () => saveDraft(),
        onTest: () => void testActiveProfile(),
        onConnect: connectActiveProfile,
      } satisfies ConnectionController)
    : null;

  return {
    activeConnectionId,
    setActiveConnectionId,
    connections,
    connectionById,
    profileById,
    activeConnection,
    activeConnectionOpen,
    activeConnectionReadOnly,
    activeEngine,
    activeConnectionColor,
    activeConnectionStatus,
    activeTransportLabel,
    activeMetadata,
    activeMetadataLoading,
    activeMetadataError,
    metadataByConnection,
    connectedIds,
    objectActionMenu,
    setObjectActionMenu,
    connectionManagerOpen,
    setConnectionManagerOpen,
    editorEngine,
    completionHints,
    connectionActions,
    connectionController,
  };
}

export type WorkbenchConnections = ReturnType<typeof useWorkbenchConnections>;
