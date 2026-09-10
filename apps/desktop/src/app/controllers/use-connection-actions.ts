import type { FormEvent } from "react";
import type { ShowActionNotice } from "@/app/ActionToast";
import {
  describeConnection,
  engineCorrectnessWarning,
  engineLabel,
  exportConnectionProfiles,
  importConnectionProfiles,
  isPristineDraftProfile,
  memoryDefaults,
  newDraft,
  prepareConnectionRequest,
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
import {
  type ValueUpdater,
  errorDisplay,
  errorMessage,
  isRetryableError,
} from "@/core";
import type { Translator } from "@/i18n";
import type {
  ConnectionInfo,
  DatabaseMetadata,
  InstalledExtension,
} from "@/generated/irodori-api";
import { connectionModelForEngine } from "@/features/extensions/connection-model";
import { tauriRuntimeError } from "../app-workbench-utils";

// Mirrors the connection-store setter contract: accept either the next value or
// an updater that derives it from the current value.

export type ConnectionActionsDeps = {
  draft: ConnectionDraft;
  profiles: ConnectionDraft[];
  connectedIds: Set<string>;
  activeConnectionId: string;
  setDraft: (value: ValueUpdater<ConnectionDraft>) => void;
  setConnectionError: (value: ValueUpdater<unknown | null>) => void;
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
  installedExtensions: readonly InstalledExtension[];
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
    installedExtensions,
  } = deps;

  const modelFor = (profile: ConnectionDraft) =>
    connectionModelForEngine(installedExtensions, profile.engine);

  function updateDraft(patch: Partial<ConnectionDraft>) {
    setDraft((current) => {
      const next = patch.engine
        ? {
            ...current,
            ...memoryDefaults(
              patch.engine,
              connectionModelForEngine(installedExtensions, patch.engine),
            ),
            // Connector credentials are engine-specific. Clear every transient
            // credential carrier so a DSN, access-key identity, token, or
            // private key cannot cross into the next connector by accident.
            url: "",
            user: "",
            password: "",
            options: undefined,
            secretOptions: undefined,
            customOptionsJson: undefined,
            ...patch,
          }
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
    const validationError = validateDraft(draft, modelFor(draft));
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
    // Reuse an untouched draft instead of persisting another "Connection N"
    // on every open of the manager.
    const pristine = profiles.find(isPristineDraftProfile);
    if (pristine) {
      setSelectedProfileId(pristine.id);
      setDraft(pristine);
      setConnectionError(null);
      return;
    }
    const usedIds = new Set(profiles.map((profile) => profile.id));
    let seed = profiles.length + 1;
    while (usedIds.has(`connection-${seed}`)) {
      seed += 1;
    }
    const next = newDraft(seed);
    setProfiles((current) => [...current, sanitizedProfile(next)]);
    setSelectedProfileId(next.id);
    setDraft(next);
    setConnectionError(null);
    showActionNotice("info", t("notice.connection.draftCreated"), next.name);
  }

  // Closing the manager throws away drafts the user never touched, so
  // open/close cycles stop accumulating persisted "Connection N" entries.
  function prunePristineDrafts() {
    setProfiles((current) => {
      const kept = current.filter((profile) => {
        if (!isPristineDraftProfile(profile)) {
          return true;
        }
        if (connectedIds.has(profile.id)) {
          return true;
        }
        // The form draft holds unsaved edits for this row — keep it so the
        // user can come back and save.
        return profile.id === draft.id && !isPristineDraftProfile(draft);
      });
      if (kept.length === current.length) {
        return current;
      }
      if (!kept.some((profile) => profile.id === draft.id)) {
        const fallback = kept[0] ?? null;
        if (fallback) {
          setSelectedProfileId(fallback.id);
          setDraft(fallback);
        }
      }
      return kept;
    });
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

  async function deleteProfiles(ids: string[]) {
    const targets = Array.from(new Set(ids));
    if (targets.length === 0) {
      return;
    }
    for (const id of targets) {
      if (connectedIds.has(id)) {
        await queryService.disconnect(id).catch(() => undefined);
      }
    }
    setConnectedIds((current) => {
      const next = new Set(current);
      targets.forEach((id) => next.delete(id));
      return next;
    });
    setProfiles((current) => {
      const removed = new Set(targets);
      const next = current.filter((profile) => !removed.has(profile.id));
      // Deleting the last profile must leave the saved list empty (the empty
      // state takes over); the form just falls back to a fresh unsaved draft.
      // Re-seeding the list with that draft made the deleted connection look
      // like it never went away.
      const fallback = next[0] ?? newDraft(1);
      setSelectedProfileId(fallback.id);
      setDraft(fallback);
      return next;
    });
    showActionNotice(
      "success",
      targets.length > 1
        ? t("notice.connection.deletedMany", { count: targets.length })
        : t("notice.connection.deleted"),
      targets.join(", "),
    );
  }

  async function testActiveProfile() {
    const validationError = validateDraft(draft, modelFor(draft));
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
      const model = modelFor(draft);
      const request = await prepareConnectionRequest(
        draft,
        profileFromDraft(draft, model),
        model,
      );
      try {
        await queryService.connect({ ...request.profile, id: testId });
      } finally {
        await request.release();
      }
      await queryService.disconnect(testId);
      setConnectionError(null);
      showActionNotice(
        "success",
        t("notice.connection.testSucceeded"),
        `${draft.name.trim()} (${engineLabel(draft.engine)})`,
      );
    } catch (error) {
      const display = errorDisplay(error);
      setConnectionError(error);
      showActionNotice(
        "error",
        t("notice.connection.testFailed"),
        display.detail ?? display.title,
      );
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
      const model = modelFor(profile);
      const request = await prepareConnectionRequest(
        profile,
        profileFromDraft(profile, model),
        model,
      );
      let info: ConnectionInfo;
      try {
        info = await queryService.connect(request.profile);
      } finally {
        await request.release();
      }
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
      // A connector that can return wrong rows has to say so on every connect,
      // not once in the docs (#117). This rides after the success notice
      // because the connection genuinely opened; it is the results that cannot
      // be trusted. Warnings do not auto-dismiss.
      const correctness = engineCorrectnessWarning(profile.engine);
      if (correctness) {
        showActionNotice(
          "warning",
          t(correctness.titleKey),
          t(correctness.detailKey),
        );
      }
    } catch (error) {
      const display = errorDisplay(error);
      setConnectionError(error);
      showActionNotice(
        "error",
        t("notice.connection.connectFailed"),
        display.detail ?? display.title,
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
      // Persist the sample profile only once it actually connected, so a
      // failed attempt doesn't leave a dead "SQLite Sample" entry behind.
      setProfiles((current) =>
        current.some((profile) => profile.id === sample.id)
          ? current
          : [...current, sample],
      );
    });
  }

  async function disconnectActiveProfile() {
    await disconnectProfile(activeConnectionId);
  }

  /** Close one connection by id, from the rail menu or an empty-group Ctrl+W. */
  async function disconnectProfile(id: string) {
    if (!connectedIds.has(id)) {
      return;
    }
    await queryService.disconnect(id).catch(() => undefined);
    const remaining = new Set(
      [...connectedIds].filter((value) => value !== id),
    );
    setConnectedIds(remaining);
    // The rail lists open connections only, so a closed one leaves the rail.
    // Leaving it active would point the workbench at an icon that is no longer
    // there; hand the session to another open connection, or to none. Profile
    // order decides the successor so it matches what the rail shows.
    if (activeConnectionId === id) {
      setActiveConnectionId(
        profiles.find((profile) => remaining.has(profile.id))?.id ?? "",
      );
    }
    setMetadataByConnection((current) => {
      const { [id]: _removed, ...next } = current;
      return next;
    });
    setMetadataErrors((current) => {
      const { [id]: _removed, ...next } = current;
      return next;
    });
    showActionNotice(
      "success",
      t("notice.connection.disconnected"),
      profiles.find((profile) => profile.id === id)?.name ?? id,
    );
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
      const display = errorDisplay(error);
      const message = display.detail ?? display.title;
      setMetadataErrors((current) => ({
        ...current,
        [connectionId]: display.title,
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
    prunePristineDrafts,
    importConnectionFile,
    exportConnectionFile,
    deleteProfiles,
    testActiveProfile,
    connectActiveProfile,
    connectProfile,
    openSqliteSample,
    disconnectActiveProfile,
    disconnectProfile,
    refreshObjects,
  };
}
