import { create } from "zustand";
import type { DatabaseMetadata } from "@/generated/irodori-api";
import {
  loadProfiles,
  newDraft,
  profilesStorageKey,
  sanitizedProfile,
  type ConnectionDraft,
  type WorkspaceConnection,
} from "./connection-profiles";

type ValueUpdater<T> = T | ((current: T) => T);

type ConnectionState = {
  activeConnectionId: string;
  profiles: ConnectionDraft[];
  selectedProfileId: string;
  draft: ConnectionDraft;
  connectionManagerOpen: boolean;
  connectionSearch: string;
  connectedIds: Set<string>;
  liveConnections: Record<string, WorkspaceConnection>;
  connecting: boolean;
  testingConnection: boolean;
  connectionError: string | null;
  metadataByConnection: Record<string, DatabaseMetadata>;
  metadataLoading: Set<string>;
  metadataErrors: Record<string, string>;
  objectActionMenu: string | null;
  setActiveConnectionId: (value: ValueUpdater<string>) => void;
  setProfiles: (value: ValueUpdater<ConnectionDraft[]>) => void;
  setSelectedProfileId: (value: ValueUpdater<string>) => void;
  setDraft: (value: ValueUpdater<ConnectionDraft>) => void;
  setConnectionManagerOpen: (value: ValueUpdater<boolean>) => void;
  setConnectionSearch: (value: ValueUpdater<string>) => void;
  setConnectedIds: (value: ValueUpdater<Set<string>>) => void;
  setLiveConnections: (
    value: ValueUpdater<Record<string, WorkspaceConnection>>,
  ) => void;
  setConnecting: (value: ValueUpdater<boolean>) => void;
  setTestingConnection: (value: ValueUpdater<boolean>) => void;
  setConnectionError: (value: ValueUpdater<string | null>) => void;
  setMetadataByConnection: (
    value: ValueUpdater<Record<string, DatabaseMetadata>>,
  ) => void;
  setMetadataLoading: (value: ValueUpdater<Set<string>>) => void;
  setMetadataErrors: (value: ValueUpdater<Record<string, string>>) => void;
  setObjectActionMenu: (value: ValueUpdater<string | null>) => void;
};

function resolveValue<T>(current: T, value: ValueUpdater<T>): T {
  return typeof value === "function"
    ? (value as (current: T) => T)(current)
    : value;
}

const initialProfiles = loadProfiles();
const initialDraft = initialProfiles[0] ?? newDraft(1);

export const useConnectionStore = create<ConnectionState>((set) => ({
  // Empty when no connection is configured yet; the app renders a safe
  // "no connection" placeholder until the user adds one.
  activeConnectionId: initialProfiles[0]?.id ?? "",
  profiles: initialProfiles,
  selectedProfileId: initialProfiles[0]?.id ?? initialDraft.id,
  draft: initialDraft,
  connectionManagerOpen: false,
  connectionSearch: "",
  connectedIds: new Set(),
  liveConnections: {},
  connecting: false,
  testingConnection: false,
  connectionError: null,
  metadataByConnection: {},
  metadataLoading: new Set(),
  metadataErrors: {},
  objectActionMenu: null,
  setActiveConnectionId: (value) =>
    set((state) => ({
      activeConnectionId: resolveValue(state.activeConnectionId, value),
    })),
  setProfiles: (value) =>
    set((state) => ({ profiles: resolveValue(state.profiles, value) })),
  setSelectedProfileId: (value) =>
    set((state) => ({
      selectedProfileId: resolveValue(state.selectedProfileId, value),
    })),
  setDraft: (value) =>
    set((state) => ({ draft: resolveValue(state.draft, value) })),
  setConnectionManagerOpen: (value) =>
    set((state) => ({
      connectionManagerOpen: resolveValue(state.connectionManagerOpen, value),
    })),
  setConnectionSearch: (value) =>
    set((state) => ({
      connectionSearch: resolveValue(state.connectionSearch, value),
    })),
  setConnectedIds: (value) =>
    set((state) => ({
      connectedIds: resolveValue(state.connectedIds, value),
    })),
  setLiveConnections: (value) =>
    set((state) => ({
      liveConnections: resolveValue(state.liveConnections, value),
    })),
  setConnecting: (value) =>
    set((state) => ({ connecting: resolveValue(state.connecting, value) })),
  setTestingConnection: (value) =>
    set((state) => ({
      testingConnection: resolveValue(state.testingConnection, value),
    })),
  setConnectionError: (value) =>
    set((state) => ({
      connectionError: resolveValue(state.connectionError, value),
    })),
  setMetadataByConnection: (value) =>
    set((state) => ({
      metadataByConnection: resolveValue(state.metadataByConnection, value),
    })),
  setMetadataLoading: (value) =>
    set((state) => ({
      metadataLoading: resolveValue(state.metadataLoading, value),
    })),
  setMetadataErrors: (value) =>
    set((state) => ({
      metadataErrors: resolveValue(state.metadataErrors, value),
    })),
  setObjectActionMenu: (value) =>
    set((state) => ({
      objectActionMenu: resolveValue(state.objectActionMenu, value),
    })),
}));

let lastPersistedProfiles = useConnectionStore.getState().profiles;
useConnectionStore.subscribe((state) => {
  if (state.profiles === lastPersistedProfiles) {
    return;
  }
  lastPersistedProfiles = state.profiles;
  window.localStorage.setItem(
    profilesStorageKey,
    JSON.stringify(state.profiles.map(sanitizedProfile)),
  );
});
