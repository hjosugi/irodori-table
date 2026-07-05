import { useMemo, useState } from "react";

import type { ShowActionNotice } from "@/app/ActionToast";
import {
  APP_IDENTIFIER,
  APP_NAME,
  APP_VERSION,
  savedQueryStorageKey,
} from "@/app/app-config";
import {
  sqlDownloadFileName,
  tauriRuntimeError,
} from "@/app/app-workbench-utils";
import { flushEditorTabsEvent } from "@/app/controllers/use-editor-groups";
import {
  detectImportFileKind,
  generateImportSql,
  inferImportTableName,
  parseImportText,
  type ImportPreview,
} from "@/features/import";
import {
  buildSchemaSql,
  type SchemaDesignerDraft,
} from "@/features/schema-designer";
import { downloadBlob, writeTextToClipboard } from "@/features/erd";
import {
  qualifiedObjectName,
  quoteSqlIdentifier,
  tablePreviewSql,
  workbenchRuntimeService,
  type CompletionHint,
} from "@/features/workbench";
import { toCount } from "@/features/results";
import type { SqlEditorHandle } from "@/features/query-editor";
import type { Translator } from "@/i18n";
import { errorMessage } from "@/core";
import type { SqlMetadataTarget } from "@/sql/metadata-inspection";
import type {
  DbEngine,
  DbObjectMetadata,
  QueryParameterInput,
} from "@/generated/irodori-api";
import type { WorkspaceConnection } from "@/features/connections";

type ValueUpdater<T> = T | ((current: T) => T);

export type WorkspaceActionsDeps = {
  query: string;
  activeTabLabel: string | null;
  activeConnectionId: string;
  activeConnectionOpen: boolean;
  activeEngine: DbEngine;
  editorEngine: DbEngine;
  themeKind: string;
  schemaDraft: SchemaDesignerDraft;
  setQuery: (value: string) => void;
  setMigrationStudioOpen: (value: boolean) => void;
  setSchemaDesignerOpen: (value: boolean) => void;
  setObjectActionMenu: (value: ValueUpdater<string | null>) => void;
  setTableViewObject: (value: DbObjectMetadata | null) => void;
  setResultMode: (value: "data") => void;
  activeEditorApi: () => SqlEditorHandle | null;
  executeQuery: (
    sqlToRun: string,
    params?: QueryParameterInput[],
    options?: { sourceObject?: DbObjectMetadata },
  ) => Promise<void>;
  openObjectSchemaDesigner: (object: DbObjectMetadata) => void;
  openDiagramForSearch: (search: string) => void;
  showActionNotice: ShowActionNotice;
  t: Translator["t"];
};

export function useWorkspaceActions({
  query,
  activeTabLabel,
  activeConnectionId,
  activeConnectionOpen,
  activeEngine,
  editorEngine,
  themeKind,
  schemaDraft,
  setQuery,
  setMigrationStudioOpen,
  setSchemaDesignerOpen,
  setObjectActionMenu,
  setTableViewObject,
  setResultMode,
  activeEditorApi,
  executeQuery,
  openObjectSchemaDesigner,
  openDiagramForSearch,
  showActionNotice,
  t,
}: WorkspaceActionsDeps) {
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(
    null,
  );
  const importSqlPreview = useMemo(
    () =>
      importPreview
        ? generateImportSql(
            importPreview.tableName,
            importPreview.columns,
            importPreview.rows,
          )
        : "",
    [importPreview],
  );
  const schemaSqlPreview = useMemo(
    () => buildSchemaSql(schemaDraft),
    [schemaDraft],
  );

  async function handleImportFile(file: File) {
    const kind = detectImportFileKind(file.name);
    setImportPreview(null);
    if (!kind) {
      showActionNotice(
        "error",
        t("notice.workbench.importFailed"),
        t("notice.workbench.importUnsupportedDetail"),
      );
      return;
    }
    const text = await file.text();
    if (kind === "sql") {
      setQuery(text);
      showActionNotice("success", t("notice.workbench.sqlLoaded"), file.name);
      return;
    }
    if (kind === "excel") {
      showActionNotice(
        "error",
        t("notice.workbench.importFailed"),
        t("notice.workbench.importExcelDetail"),
      );
      return;
    }
    try {
      const parsed = parseImportText(text, kind);
      setImportPreview({
        ...parsed,
        fileName: file.name,
        format: kind,
        tableName: inferImportTableName(file.name),
      });
      showActionNotice(
        "success",
        t("notice.workbench.importPreviewReady"),
        t("notice.workbench.importPreviewReadyDetail", {
          name: file.name,
          count: toCount(parsed.totalRows),
        }),
      );
    } catch (error) {
      showActionNotice(
        "error",
        t("notice.workbench.importFailed"),
        errorMessage(error),
      );
    }
  }

  function putImportSqlInEditor() {
    if (!importPreview) {
      return;
    }
    setQuery(
      generateImportSql(
        importPreview.tableName,
        importPreview.columns,
        importPreview.rows,
      ),
    );
    setImportPreview(null);
    showActionNotice(
      "success",
      t("notice.workbench.importSqlGenerated"),
      importPreview.tableName,
    );
  }

  function putMigrationTextInEditor(text: string) {
    setQuery(text);
    setMigrationStudioOpen(false);
    showActionNotice("success", t("notice.workbench.migrationOutputLoaded"));
  }

  async function copyMigrationText(text: string, label: string) {
    try {
      await writeTextToClipboard(text);
      showActionNotice("success", t("notice.workbench.labelCopied", { label }));
    } catch (error) {
      showActionNotice(
        "error",
        t("notice.workbench.copyFailed"),
        errorMessage(error),
      );
    }
  }

  async function openTableData(object: DbObjectMetadata) {
    if (object.kind !== "table" && object.kind !== "view") {
      return;
    }
    const sql = tablePreviewSql(editorEngine, object);
    setQuery(sql);
    setObjectActionMenu(null);
    setTableViewObject(object);
    setResultMode("data");
    if (activeConnectionOpen) {
      await executeQuery(sql, undefined, { sourceObject: object });
    }
  }

  function openSnapshotObject(object: WorkspaceConnection["objects"][number]) {
    if (object.kind === "procedure") {
      return;
    }
    const sql =
      editorEngine === "sqlserver"
        ? `select top (200) * from ${quoteSqlIdentifier(editorEngine, object.name)};`
        : `select * from ${quoteSqlIdentifier(editorEngine, object.name)} limit 200;`;
    setQuery(sql);
    if (activeConnectionOpen) {
      void executeQuery(sql);
    }
  }

  function showObjectInDiagram(object: DbObjectMetadata) {
    openDiagramForSearch(object.name);
    setObjectActionMenu(null);
  }

  function jumpToSqlMetadata(target: SqlMetadataTarget) {
    openObjectSchemaDesigner(target.object);
    setObjectActionMenu(null);
  }

  function putSchemaSqlInEditor() {
    setQuery(buildSchemaSql(schemaDraft));
    setSchemaDesignerOpen(false);
    showActionNotice(
      "success",
      t("notice.workbench.schemaSqlGenerated"),
      schemaDraft.table,
    );
  }

  async function copySchemaSql() {
    try {
      await writeTextToClipboard(schemaSqlPreview);
      showActionNotice("success", t("notice.workbench.schemaSqlCopied"));
    } catch (error) {
      showActionNotice(
        "error",
        t("notice.workbench.copyFailed"),
        errorMessage(error),
      );
    }
  }

  function insertCompletionHint(hint: CompletionHint) {
    activeEditorApi()?.insertText(hint.insertText);
    activeEditorApi()?.focus();
  }

  function saveCurrentQuery() {
    try {
      window.localStorage.setItem(savedQueryStorageKey, query);
      showActionNotice(
        "success",
        t("notice.workbench.querySaved"),
        activeTabLabel ?? "scratch",
      );
    } catch (error) {
      showActionNotice(
        "error",
        t("notice.workbench.querySaveFailed"),
        errorMessage(error),
      );
    }
  }

  async function saveCurrentQueryAsFile() {
    const fileName = sqlDownloadFileName(activeTabLabel ?? "query.sql");
    const outcome = await downloadBlob(
      new Blob([query], { type: "application/sql;charset=utf-8" }),
      fileName,
    );
    if (outcome.kind !== "cancelled") {
      showActionNotice(
        "success",
        t("notice.workbench.sqlExportStarted"),
        outcome.kind === "native" ? outcome.path : fileName,
      );
    }
  }

  async function exitApplication() {
    const runtimeError = tauriRuntimeError();
    if (runtimeError) {
      showActionNotice(
        "info",
        t("notice.workbench.exitUnavailable"),
        t("notice.workbench.exitUnavailableDetail"),
      );
      return;
    }
    try {
      // Flush the debounced editor-tab persistence before the window goes
      // away; unload events are not guaranteed to fire on a Tauri close.
      window.dispatchEvent(new Event(flushEditorTabsEvent));
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
    } catch (error) {
      showActionNotice(
        "error",
        t("notice.workbench.exitFailed"),
        errorMessage(error),
      );
    }
  }

  async function copyAppDiagnostics() {
    const diagnostics = [
      `${APP_NAME} ${APP_VERSION}`,
      `Identifier: ${APP_IDENTIFIER}`,
      `Runtime: ${tauriRuntimeError() ? "browser preview" : "Tauri desktop"}`,
      `Theme: ${themeKind}`,
      `Active connection: ${activeConnectionId}`,
      `Connection status: ${activeConnectionOpen ? "connected" : "closed"}`,
      `Engine: ${activeEngine}`,
      `User agent: ${navigator.userAgent}`,
    ].join("\n");
    try {
      await navigator.clipboard?.writeText(diagnostics);
      showActionNotice("success", t("notice.workbench.diagnosticsCopied"));
    } catch (error) {
      showActionNotice(
        "error",
        t("notice.workbench.copyFailed"),
        errorMessage(error),
      );
    }
  }

  async function openAppDeveloperTools() {
    try {
      await workbenchRuntimeService.openDeveloperTools();
    } catch (error) {
      showActionNotice(
        "error",
        t("notice.workbench.devToolsUnavailable"),
        errorMessage(error),
      );
    }
  }

  return {
    importPreview,
    setImportPreview,
    importSqlPreview,
    schemaSqlPreview,
    formatObjectName: (object: DbObjectMetadata) =>
      qualifiedObjectName(editorEngine, object),
    handleImportFile,
    putImportSqlInEditor,
    putMigrationTextInEditor,
    copyMigrationText,
    openTableData,
    openSnapshotObject,
    showObjectInDiagram,
    jumpToSqlMetadata,
    putSchemaSqlInEditor,
    copySchemaSql,
    insertCompletionHint,
    saveCurrentQuery,
    saveCurrentQueryAsFile,
    exitApplication,
    copyAppDiagnostics,
    openAppDeveloperTools,
  };
}
