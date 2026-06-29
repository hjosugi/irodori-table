import type { FormEvent } from "react";
import type { ActionNotice } from "@/app/ActionToast";
import {
  describeConnection,
  engineLabel,
  exportConnectionProfiles,
  importConnectionProfiles,
  memoryDefaults,
  newDraft,
  profileFromDraft,
  repairBuiltinSampleProfile,
  sanitizedProfile,
  validateDraft,
  withStarterProfiles,
  withUniqueProfileIds,
  type ConnectionTransferFormat,
  type ConnectionDraft,
  type WorkspaceConnection,
} from "@/features/connections";
import { toCount } from "@/features/results";
import { downloadBlob } from "@/features/erd";
import { queryService } from "@/features/workbench";
import { errorMessage } from "@/core";
import type { DatabaseMetadata } from "@/generated/irodori-api";
import { tauriRuntimeError } from "../app-workbench-utils";

// Mirrors the connection-store setter contract: accept either the next value or
// an updater that derives it from the current value.
type ValueUpdater<T> = T | ((current: T) => T);

export type ConnectionActionsDeps = {
  draft: ConnectionDraft;
  profiles: ConnectionDraft[];
  connectedIds: Set<string>;
  activeConnectionId: string;
  setDraft: (value: ValueUpdater<ConnectionDraft>) => void;
  setConnectionError: (value: ValueUpdater<string | null>) => void;
  setSelectedProfileId: (value: ValueUpdater<string>) => void;
  setActiveConnectionId: (value: ValueUpdater<string>) => void;
  setProfiles: (value: ValueUpdater<ConnectionDraft[]>) => void;
  setConnectionSearch: (value: ValueUpdater<string>) => void;
  setConnectedIds: (value: ValueUpdater<Set<string>>) => void;
  setLiveConnections: (
    value: ValueUpdater<Record<string, WorkspaceConnection>>,
  ) => void;
  setMetadataByConnection: (
    value: ValueUpdater<Record<string, DatabaseMetadata>>,
  ) => void;
  setMetadataErrors: (value: ValueUpdater<Record<string, string>>) => void;
  setMetadataLoading: (value: ValueUpdater<Set<string>>) => void;
  setTestingConnection: (value: ValueUpdater<boolean>) => void;
  setConnecting: (value: ValueUpdater<boolean>) => void;
  setConnectionManagerOpen: (value: ValueUpdater<boolean>) => void;
  showActionNotice: (
    kind: ActionNotice["kind"],
    title: string,
    detail?: string,
  ) => void;
};

export function useConnectionActions(deps: ConnectionActionsDeps) {
  const {
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
  } = deps;

  function updateDraft(patch: Partial<ConnectionDraft>) {
    setDraft((current) => {
      const next = patch.engine
        ? { ...current, ...memoryDefaults(patch.engine), ...patch }
        : { ...current, ...patch };
      return next;
    });
    setConnectionError(null);
  }

  function selectProfile(profile: ConnectionDraft) {
    const repaired = repairBuiltinSampleProfile(profile);
    setSelectedProfileId(repaired.id);
    setDraft(repaired);
    setConnectionError(null);
  }

  function selectSidebarConnection(
    connection: WorkspaceConnection,
    profile: ConnectionDraft | undefined,
  ) {
    setActiveConnectionId(connection.id);
    if (profile) {
      selectProfile(profile);
    }
  }

  function saveDraft(showSaved = true) {
    const validationError = validateDraft(draft);
    if (validationError) {
      setConnectionError(validationError);
      showActionNotice("error", "Connection was not saved", validationError);
      return false;
    }
    const cleanDraft = sanitizedProfile(repairBuiltinSampleProfile(draft));
    setProfiles((current) => {
      const existing = current.findIndex(
        (profile) => profile.id === cleanDraft.id,
      );
      if (existing === -1) {
        return [...current, cleanDraft];
      }
      return current.map((profile, index) =>
        index === existing ? cleanDraft : profile,
      );
    });
    setSelectedProfileId(cleanDraft.id);
    if (showSaved) {
      setConnectionError(null);
      showActionNotice("success", "Connection saved", cleanDraft.name);
    }
    return true;
  }

  function addProfile() {
    const next = newDraft(profiles.length + 1);
    setProfiles((current) => [...current, sanitizedProfile(next)]);
    setSelectedProfileId(next.id);
    setDraft(next);
    setConnectionError(null);
    showActionNotice("info", "New connection draft created", next.name);
  }

  async function importConnectionFile(file: File) {
    setConnectionError(null);
    try {
      const text = await file.text();
      const imported = importConnectionProfiles(text, file.name);
      const importedProfiles = imported.profiles;
      const firstImportedRef: { current: ConnectionDraft | null } = {
        current: null,
      };
      setProfiles((current) => {
        const merged = withUniqueProfileIds([...current, ...importedProfiles]);
        const mergedImported = merged.slice(current.length);
        firstImportedRef.current = mergedImported[0] ?? null;
        return withStarterProfiles(merged);
      });
      setConnectionSearch("");
      const firstImported = firstImportedRef.current;
      if (firstImported) {
        setSelectedProfileId(firstImported.id);
        setDraft(firstImported);
        setActiveConnectionId(firstImported.id);
      }
      showActionNotice(
        "success",
        "Connections imported",
        `${imported.source} · ${toCount(importedProfiles.length)} profile(s)`,
      );
    } catch (error) {
      const message = errorMessage(error);
      setConnectionError(message);
      showActionNotice("error", "Connection import failed", message);
    }
  }

  function exportConnectionFile(format: ConnectionTransferFormat) {
    try {
      const exported = exportConnectionProfiles(profiles, format);
      downloadBlob(
        new Blob([exported.content], {
          type: `${exported.mime};charset=utf-8`,
        }),
        exported.fileName,
      );
      const skipped =
        exported.skippedCount > 0
          ? ` · ${toCount(exported.skippedCount)} skipped`
          : "";
      showActionNotice(
        "success",
        "Connections exported",
        `${exported.label} · ${toCount(exported.profileCount)} profile(s)${skipped}`,
      );
    } catch (error) {
      const message = errorMessage(error);
      setConnectionError(message);
      showActionNotice("error", "Connection export failed", message);
    }
  }

  async function deleteProfile() {
    const id = draft.id;
    if (connectedIds.has(id)) {
      await queryService.disconnect(id).catch(() => undefined);
    }
    setConnectedIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    setProfiles((current) => {
      const next = current.filter((profile) => profile.id !== id);
      const fallback = next[0] ?? newDraft(1);
      setSelectedProfileId(fallback.id);
      setDraft(fallback);
      return next.length > 0 ? next : [sanitizedProfile(fallback)];
    });
    showActionNotice("success", "Connection deleted", id);
  }

  async function testActiveProfile() {
    const validationError = validateDraft(draft);
    if (validationError) {
      setConnectionError(validationError);
      showActionNotice("error", "Connection test failed", validationError);
      return;
    }
    const runtimeError = tauriRuntimeError();
    if (runtimeError) {
      setConnectionError(runtimeError);
      showActionNotice("error", "Connection test failed", runtimeError);
      return;
    }
    setTestingConnection(true);
    setConnectionError(null);
    const testId = `__test_${draft.id}_${Date.now()}`;
    try {
      await queryService.connect({
        ...profileFromDraft(draft),
        id: testId,
      });
      await queryService.disconnect(testId);
      setConnectionError(null);
      showActionNotice(
        "success",
        "Connection test succeeded",
        `${draft.name.trim()} (${engineLabel(draft.engine)})`,
      );
    } catch (error) {
      const message = errorMessage(error);
      setConnectionError(message);
      showActionNotice("error", "Connection test failed", message);
    } finally {
      setTestingConnection(false);
    }
  }

  async function connectActiveProfile(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!saveDraft(false)) {
      return;
    }
    const runtimeError = tauriRuntimeError();
    if (runtimeError) {
      setConnectionError(runtimeError);
      showActionNotice("error", "Connect failed", runtimeError);
      return;
    }
    setConnecting(true);
    setConnectionError(null);
    try {
      const started = performance.now();
      const info = await queryService.connect(profileFromDraft(draft));
      const elapsedMs = Math.max(1, Math.round(performance.now() - started));
      const nextConnection = describeConnection(
        info,
        elapsedMs,
        draft.name.trim(),
      );
      setLiveConnections((current) => ({
        ...current,
        [nextConnection.id]: nextConnection,
      }));
      setConnectedIds((current) => new Set(current).add(nextConnection.id));
      setActiveConnectionId(nextConnection.id);
      void refreshObjects(nextConnection.id, true);
      setConnectionManagerOpen(false);
      showActionNotice(
        "success",
        "Connected",
        `${draft.name.trim()} · ${elapsedMs} ms`,
      );
    } catch (error) {
      const message = errorMessage(error);
      setConnectionError(message);
      showActionNotice("error", "Connect failed", message);
    } finally {
      setConnecting(false);
    }
  }

  async function disconnectActiveProfile() {
    const id = activeConnectionId;
    if (!connectedIds.has(id)) {
      return;
    }
    await queryService.disconnect(id).catch(() => undefined);
    setConnectedIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    setMetadataByConnection((current) => {
      const { [id]: _removed, ...next } = current;
      return next;
    });
    setMetadataErrors((current) => {
      const { [id]: _removed, ...next } = current;
      return next;
    });
    showActionNotice("success", "Disconnected", id);
  }

  async function refreshObjects(
    connectionId = activeConnectionId,
    force = false,
    notify = false,
  ) {
    if (!force && !connectedIds.has(connectionId)) {
      return;
    }
    const runtimeError = tauriRuntimeError();
    if (runtimeError) {
      setMetadataErrors((current) => ({
        ...current,
        [connectionId]: runtimeError,
      }));
      if (notify) {
        showActionNotice("error", "Refresh failed", runtimeError);
      }
      return;
    }
    setMetadataLoading((current) => new Set(current).add(connectionId));
    setMetadataErrors((current) => {
      const { [connectionId]: _removed, ...next } = current;
      return next;
    });
    try {
      const metadata = await queryService.listObjects(connectionId);
      setMetadataByConnection((current) => ({
        ...current,
        [connectionId]: metadata,
      }));
      if (notify) {
        const objectCount = metadata.schemas.reduce(
          (count, schema) => count + schema.objects.length,
          0,
        );
        showActionNotice(
          "success",
          "Objects refreshed",
          `${toCount(objectCount)} objects loaded`,
        );
      }
    } catch (error) {
      const message = errorMessage(error);
      setMetadataErrors((current) => ({
        ...current,
        [connectionId]: message,
      }));
      if (notify) {
        showActionNotice("error", "Refresh failed", message);
      }
    } finally {
      setMetadataLoading((current) => {
        const next = new Set(current);
        next.delete(connectionId);
        return next;
      });
    }
  }

  return {
    updateDraft,
    selectProfile,
    selectSidebarConnection,
    saveDraft,
    addProfile,
    importConnectionFile,
    exportConnectionFile,
    deleteProfile,
    testActiveProfile,
    connectActiveProfile,
    disconnectActiveProfile,
    refreshObjects,
  };
}
