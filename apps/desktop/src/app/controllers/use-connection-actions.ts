import type { FormEvent } from "react";
import type { ShowActionNotice } from "@/app/ActionToast";
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
  sqliteSampleProfile,
  sqliteSampleSeedSql,
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
import { errorMessage, isRetryableError } from "@/core";
import type { Translator } from "@/i18n";
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
  showActionNotice: ShowActionNotice;
  t: Translator["t"];
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
    t,
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
      showActionNotice(
        "error",
        t("notice.connection.notSaved"),
        validationError,
      );
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
      showActionNotice(
        "success",
        t("notice.connection.saved"),
        cleanDraft.name,
      );
    }
    return true;
  }

  function addProfile() {
    const next = newDraft(profiles.length + 1);
    setProfiles((current) => [...current, sanitizedProfile(next)]);
    setSelectedProfileId(next.id);
    setDraft(next);
    setConnectionError(null);
    showActionNotice("info", t("notice.connection.draftCreated"), next.name);
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
        t("notice.connection.imported"),
        t("notice.connection.importedDetail", {
          source: imported.source,
          count: toCount(importedProfiles.length),
        }),
      );
    } catch (error) {
      const message = errorMessage(error);
      setConnectionError(message);
      showActionNotice("error", t("notice.connection.importFailed"), message);
    }
  }

  async function exportConnectionFile(format: ConnectionTransferFormat) {
    try {
      const exported = exportConnectionProfiles(profiles, format);
      const outcome = await downloadBlob(
        new Blob([exported.content], {
          type: `${exported.mime};charset=utf-8`,
        }),
        exported.fileName,
      );
      if (outcome.kind === "cancelled") {
        return;
      }
      const skipped =
        exported.skippedCount > 0
          ? t("notice.connection.exportedSkippedSuffix", {
              count: toCount(exported.skippedCount),
            })
          : "";
      showActionNotice(
        "success",
        t("notice.connection.exported"),
        `${t("notice.connection.exportedDetail", {
          label: exported.label,
          count: toCount(exported.profileCount),
        })}${skipped}`,
      );
    } catch (error) {
      const message = errorMessage(error);
      setConnectionError(message);
      showActionNotice("error", t("notice.connection.exportFailed"), message);
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
    showActionNotice("success", t("notice.connection.deleted"), id);
  }

  async function testActiveProfile() {
    const validationError = validateDraft(draft);
    if (validationError) {
      setConnectionError(validationError);
      showActionNotice(
        "error",
        t("notice.connection.testFailed"),
        validationError,
      );
      return;
    }
    const runtimeError = tauriRuntimeError();
    if (runtimeError) {
      setConnectionError(runtimeError);
      showActionNotice(
        "error",
        t("notice.connection.testFailed"),
        runtimeError,
      );
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
        t("notice.connection.testSucceeded"),
        `${draft.name.trim()} (${engineLabel(draft.engine)})`,
      );
    } catch (error) {
      const message = errorMessage(error);
      setConnectionError(message);
      showActionNotice("error", t("notice.connection.testFailed"), message);
    } finally {
      setTestingConnection(false);
    }
  }

  async function connectProfile(
    profile: ConnectionDraft,
    afterConnect?: (connectionId: string) => Promise<void>,
  ) {
    const runtimeError = tauriRuntimeError();
    if (runtimeError) {
      setConnectionError(runtimeError);
      showActionNotice(
        "error",
        t("notice.connection.connectFailed"),
        runtimeError,
      );
      return;
    }
    setConnecting(true);
    setConnectionError(null);
    try {
      const started = performance.now();
      const info = await queryService.connect(profileFromDraft(profile));
      await afterConnect?.(info.id);
      const elapsedMs = Math.max(1, Math.round(performance.now() - started));
      const nextConnection = describeConnection(
        info,
        elapsedMs,
        profile.name.trim(),
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
        t("notice.connection.connected"),
        t("notice.connection.connectedDetail", {
          name: profile.name.trim(),
          ms: elapsedMs,
        }),
      );
    } catch (error) {
      const message = errorMessage(error);
      setConnectionError(message);
      showActionNotice(
        "error",
        t("notice.connection.connectFailed"),
        message,
        isRetryableError(error)
          ? {
              action: {
                label: t("common.retry"),
                run: () => void connectProfile(profile, afterConnect),
              },
            }
          : undefined,
      );
    } finally {
      setConnecting(false);
    }
  }

  async function connectActiveProfile(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!saveDraft(false)) {
      return;
    }
    await connectProfile(draft);
  }

  // Empty-state CTA: create (or reuse) the in-memory SQLite sample, connect,
  // and seed its demo tables so the first workspace is explorable right away.
  async function openSqliteSample() {
    const existing = profiles.find(
      (profile) => profile.id === sqliteSampleProfile().id,
    );
    const sample = existing
      ? repairBuiltinSampleProfile(existing)
      : sqliteSampleProfile();
    if (!existing) {
      setProfiles((current) => [...current, sample]);
    }
    setSelectedProfileId(sample.id);
    setDraft(sample);
    setConnectionError(null);
    if (connectedIds.has(sample.id)) {
      setActiveConnectionId(sample.id);
      return;
    }
    await connectProfile(sample, async (connectionId) => {
      for (const sql of sqliteSampleSeedSql) {
        await queryService.execute({
          connectionId,
          sql,
          maxRows: 1,
          timeoutMs: 10_000,
        });
      }
    });
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
    showActionNotice("success", t("notice.connection.disconnected"), id);
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
        showActionNotice(
          "error",
          t("notice.connection.refreshFailed"),
          runtimeError,
        );
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
          t("notice.connection.objectsRefreshed"),
          t("notice.connection.objectsRefreshedDetail", {
            count: toCount(objectCount),
          }),
        );
      }
    } catch (error) {
      const message = errorMessage(error);
      setMetadataErrors((current) => ({
        ...current,
        [connectionId]: message,
      }));
      if (notify) {
        showActionNotice(
          "error",
          t("notice.connection.refreshFailed"),
          message,
        );
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
    openSqliteSample,
    disconnectActiveProfile,
    refreshObjects,
  };
}
