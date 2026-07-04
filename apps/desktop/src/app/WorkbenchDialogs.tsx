import { Suspense, lazy } from "react";
import type { ShowActionNotice } from "@/app/ActionToast";
import { AboutDialog } from "@/app/AboutDialog";
import {
  APP_IDENTIFIER,
  APP_NAME,
  APP_VERSION,
  appCommandCatalog,
} from "@/app/app-config";
import { tauriRuntimeError } from "@/app/app-workbench-utils";
import { CommandPalette } from "@/app/CommandPalette";
import type { ConnectionController } from "@/app/controllers/workbench-controllers";
import type { useErdDiagram } from "@/app/controllers/use-erd-diagram";
import type { useHistoryActions } from "@/app/controllers/use-history-actions";
import type { KeybindingManager } from "@/app/controllers/use-keybinding-manager";
import type { useQueryRunner } from "@/app/controllers/use-query-runner";
import type { SettingsController } from "@/app/controllers/use-settings-controller";
import type { ThemeManager } from "@/app/controllers/use-theme-manager";
import type { useWorkspaceActions } from "@/app/controllers/use-workspace-actions";
import {
  ConnectionManagerDialog,
  type WorkspaceConnection,
} from "@/features/connections";
import { ErdDialog, hasDiagram } from "@/features/erd";
import { ImportDialog } from "@/features/import";
import { usePreferencesStore } from "@/features/preferences";
import {
  QueryParameterDialog,
  type SqlEditorHandle,
} from "@/features/query-editor";
import { useQueryHistoryStore } from "@/features/query-history/query-history-store";
import {
  formatResultGridCell as formatCell,
  toCount,
  useResultsStore,
} from "@/features/results";
import {
  SchemaDesignerDialog,
  useSchemaDesignerStore,
} from "@/features/schema-designer";
import { SchemaDiagramDialog } from "@/features/schema-diagram";
import { SettingsDialog } from "@/features/settings";
import { AiGenerateDialog } from "@/features/ai/AiGenerateDialog";
import { TerminalPanel } from "@/features/terminal/TerminalPanel";
import { useWorkbenchStore } from "@/features/workbench";
import type { DatabaseMetadata, DbEngine } from "@/generated/irodori-api";

const MigrationStudioDialog = lazy(() =>
  import("@/features/migration").then((module) => ({
    default: module.MigrationStudioDialog,
  })),
);
const QueryHistoryDialog = lazy(() =>
  import("@/features/query-history/QueryHistoryDialog").then((module) => ({
    default: module.QueryHistoryDialog,
  })),
);

export type WorkbenchDialogsProps = {
  themes: ThemeManager;
  settings: SettingsController;
  erd: ReturnType<typeof useErdDiagram>;
  workspace: ReturnType<typeof useWorkspaceActions>;
  keybindings: KeybindingManager;
  queryRunner: Pick<
    ReturnType<typeof useQueryRunner>,
    | "running"
    | "pendingQueryParameters"
    | "parameterDraftValues"
    | "setParameterDraftValues"
    | "setPendingQueryParameters"
    | "submitQueryParameters"
  >;
  historyActions: ReturnType<typeof useHistoryActions>;
  connectionController: ConnectionController | null;
  connectionById: Map<string, WorkspaceConnection>;
  activeConnection: WorkspaceConnection;
  activeConnectionId: string;
  activeConnectionOpen: boolean;
  activeMetadata: DatabaseMetadata | undefined;
  editorEngine: DbEngine;
  activeEditorApi: () => SqlEditorHandle | null;
  runCommand: (commandId: string) => void;
  paletteOpen: boolean;
  paletteQuery: string;
  setPaletteQuery: (value: string) => void;
  closePalette: () => void;
  aboutOpen: boolean;
  closeAbout: () => void;
  migrationStudioOpen: boolean;
  closeMigrationStudio: () => void;
  aiGenerateOpen: boolean;
  closeAiGenerate: () => void;
  terminalOpen: boolean;
  closeTerminal: () => void;
  showActionNotice: ShowActionNotice;
};

// Every modal/overlay surface the workbench can open, in one place. State that
// only dialogs read or write (settings toggles, dialog-open flags in stores)
// is subscribed here so the composition root stays about wiring, not forms.
export function WorkbenchDialogs({
  themes,
  settings,
  erd,
  workspace,
  keybindings,
  queryRunner,
  historyActions,
  connectionController,
  connectionById,
  activeConnection,
  activeConnectionId,
  activeConnectionOpen,
  activeMetadata,
  editorEngine,
  activeEditorApi,
  runCommand,
  paletteOpen,
  paletteQuery,
  setPaletteQuery,
  closePalette,
  aboutOpen,
  closeAbout,
  migrationStudioOpen,
  closeMigrationStudio,
  aiGenerateOpen,
  closeAiGenerate,
  terminalOpen,
  closeTerminal,
  showActionNotice,
}: WorkbenchDialogsProps) {
  const locale = usePreferencesStore((state) => state.locale);
  const setLocale = usePreferencesStore((state) => state.setLocale);
  const vimMode = usePreferencesStore((state) => state.vimMode);
  const formatter = usePreferencesStore((state) => state.formatter);
  const setFormatter = usePreferencesStore((state) => state.setFormatter);
  const sqlLinter = usePreferencesStore((state) => state.sqlLinter);
  const setSqlLinter = usePreferencesStore((state) => state.setSqlLinter);
  const sqlSnippets = usePreferencesStore((state) => state.sqlSnippets);
  const setSqlSnippets = usePreferencesStore((state) => state.setSqlSnippets);
  const editorBackgroundImage = usePreferencesStore(
    (state) => state.editorBackgroundImage,
  );
  const setEditorBackgroundImage = usePreferencesStore(
    (state) => state.setEditorBackgroundImage,
  );
  const editorBackgroundOpacity = usePreferencesStore(
    (state) => state.editorBackgroundOpacity,
  );
  const setEditorBackgroundOpacity = usePreferencesStore(
    (state) => state.setEditorBackgroundOpacity,
  );
  const animationsEnabled = usePreferencesStore(
    (state) => state.animationsEnabled,
  );
  const setAnimationsEnabled = usePreferencesStore(
    (state) => state.setAnimationsEnabled,
  );
  const autoCommit = usePreferencesStore((state) => state.autoCommit);
  const setAutoCommit = usePreferencesStore((state) => state.setAutoCommit);
  const uiZoom = usePreferencesStore((state) => state.uiZoom);
  const setUiZoom = usePreferencesStore((state) => state.setUiZoom);
  const sidebarOpen = useWorkbenchStore((state) => state.sidebarOpen);
  const setSidebarOpen = useWorkbenchStore((state) => state.setSidebarOpen);
  const resultOffloadEnabled = useResultsStore(
    (state) => state.resultOffloadEnabled,
  );
  const setResultOffloadEnabled = useResultsStore(
    (state) => state.setResultOffloadEnabled,
  );
  const resultMemoryBudget = useResultsStore(
    (state) => state.resultMemoryBudget,
  );
  const setResultMemoryBudget = useResultsStore(
    (state) => state.setResultMemoryBudget,
  );
  const queryHistoryDialogOpen = useQueryHistoryStore((state) => state.open);
  const schemaDesignerOpen = useSchemaDesignerStore((state) => state.open);
  const setSchemaDesignerOpen = useSchemaDesignerStore(
    (state) => state.setOpen,
  );
  const schemaDraft = useSchemaDesignerStore((state) => state.draft);
  const setSchemaDraft = useSchemaDesignerStore((state) => state.setDraft);
  const paletteResults = appCommandCatalog.filter((command) =>
    `${command.title} ${command.category}`
      .toLowerCase()
      .includes(paletteQuery.trim().toLowerCase()),
  );

  return (
    <>
      {connectionController ? (
        <ConnectionManagerDialog {...connectionController} />
      ) : null}

      {migrationStudioOpen ? (
        <Suspense fallback={null}>
          <MigrationStudioDialog
            onClose={closeMigrationStudio}
            onCopyText={(text, label) =>
              void workspace.copyMigrationText(text, label)
            }
            onPutTextInEditor={workspace.putMigrationTextInEditor}
          />
        </Suspense>
      ) : null}

      <AiGenerateDialog
        open={aiGenerateOpen}
        onClose={closeAiGenerate}
        connectionId={activeConnectionId}
        engine={editorEngine}
        onInsert={(sql) => activeEditorApi()?.insertText(sql)}
        notify={showActionNotice}
      />

      {terminalOpen && (
        <div className="terminal-dock">
          <TerminalPanel onClose={closeTerminal} />
        </div>
      )}

      {settings.settingsOpen ? (
        <SettingsDialog
          settingsTab={settings.settingsTab}
          onOpenSection={settings.openSettingsSection}
          onClose={() => settings.setSettingsOpen(false)}
          locale={locale}
          setLocale={setLocale}
          vimMode={vimMode}
          setVimMode={settings.setVimMode}
          editorBackgroundImage={editorBackgroundImage}
          setEditorBackgroundImage={setEditorBackgroundImage}
          editorBackgroundOpacity={editorBackgroundOpacity}
          setEditorBackgroundOpacity={setEditorBackgroundOpacity}
          animationsEnabled={animationsEnabled}
          setAnimationsEnabled={setAnimationsEnabled}
          autoCommit={autoCommit}
          setAutoCommit={setAutoCommit}
          uiZoom={uiZoom}
          setUiZoom={setUiZoom}
          themePreference={themes.themePreference}
          themeKind={themes.themeKind}
          setThemePreference={themes.activateThemePreference}
          setThemeKind={themes.activateBuiltInTheme}
          activeDefaultThemeId={
            themes.activeDefaultTheme?.id ?? themes.activeDefaultThemeId
          }
          activeDefaultThemeName={themes.activeDefaultTheme?.name ?? null}
          setActiveDefaultThemeId={themes.activateDefaultTheme}
          customThemes={themes.customThemes}
          activeCustomThemeId={themes.activeCustomThemeId}
          activeCustomThemeName={themes.activeCustomTheme?.name ?? null}
          setActiveCustomThemeId={themes.activateCustomTheme}
          clearCustomTheme={() => themes.activateBuiltInTheme(themes.themeKind)}
          formatter={formatter}
          setFormatter={setFormatter}
          sqlLinter={sqlLinter}
          setSqlLinter={setSqlLinter}
          sqlSnippets={sqlSnippets}
          setSqlSnippets={setSqlSnippets}
          resultOffloadEnabled={resultOffloadEnabled}
          setResultOffloadEnabled={setResultOffloadEnabled}
          resultMemoryBudget={resultMemoryBudget}
          setResultMemoryBudget={setResultMemoryBudget}
          queryHistoryMaxItems={settings.queryHistoryMaxItems}
          setQueryHistoryMaxItems={settings.setQueryHistoryMaxItems}
          queryHistoryResultRows={settings.queryHistoryResultRows}
          setQueryHistoryResultRows={settings.setQueryHistoryResultRows}
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
          commandCatalog={appCommandCatalog}
          keymap={keybindings.keymap}
          keymapOverrides={keybindings.keymapOverrides}
          keymapConflicts={keybindings.keymapConflicts}
          vimKeymapConflicts={keybindings.vimKeymapConflicts}
          recordingCommand={keybindings.recordingCommand}
          recordingSequence={keybindings.recordingSequence}
          runCommand={runCommand}
          beginRecording={keybindings.beginRecording}
          resetKeybinding={keybindings.resetKeybinding}
          applyVimKeybindingResolutions={keybindings.applyVimKeybindingPlan}
          jobs={settings.jobs}
          jobsLoading={settings.jobsLoading}
          jobsError={settings.jobsError}
          refreshJobs={settings.refreshJobs}
          settingsJsonDraft={settings.settingsJsonDraft}
          setSettingsJsonDraft={settings.setSettingsJsonDraft}
          settingsJsonError={settings.settingsJsonError}
          setSettingsJsonError={settings.setSettingsJsonError}
          resetSettingsJsonDraft={settings.resetSettingsJsonDraft}
          applySettingsJson={settings.applySettingsJson}
        />
      ) : null}

      {aboutOpen ? (
        <AboutDialog
          appName={APP_NAME}
          appVersion={APP_VERSION}
          appIdentifier={APP_IDENTIFIER}
          runtimeLabel={
            tauriRuntimeError() ? "Browser preview" : "Tauri desktop"
          }
          activeConnectionLabel={`${activeConnection.name} · ${
            activeConnectionOpen ? "connected" : "closed"
          }`}
          onClose={closeAbout}
          onCopyDiagnostics={() => void workspace.copyAppDiagnostics()}
        />
      ) : null}

      {queryHistoryDialogOpen ? (
        <Suspense fallback={null}>
          <QueryHistoryDialog
            activeConnectionId={activeConnectionId}
            activeConnectionOpen={activeConnectionOpen}
            running={queryRunner.running}
            connectionById={connectionById}
            onLoad={historyActions.loadHistoryItem}
            onRun={(item) => void historyActions.runHistoryItem(item)}
            onRestoreResult={historyActions.restoreHistoryResult}
          />
        </Suspense>
      ) : null}

      {queryRunner.pendingQueryParameters ? (
        <QueryParameterDialog
          pending={queryRunner.pendingQueryParameters}
          values={queryRunner.parameterDraftValues}
          onValuesChange={queryRunner.setParameterDraftValues}
          onClose={() => queryRunner.setPendingQueryParameters(null)}
          onSubmit={queryRunner.submitQueryParameters}
        />
      ) : null}

      {paletteOpen ? (
        <CommandPalette
          query={paletteQuery}
          commands={paletteResults}
          keymap={keybindings.keymap}
          onQueryChange={setPaletteQuery}
          onRunCommand={runCommand}
          onClose={closePalette}
        />
      ) : null}

      {workspace.importPreview ? (
        <ImportDialog
          preview={workspace.importPreview}
          sqlPreview={workspace.importSqlPreview}
          onPreviewChange={workspace.setImportPreview}
          onClose={() => {
            workspace.setImportPreview(null);
          }}
          onPutSqlInEditor={workspace.putImportSqlInEditor}
          formatCell={formatCell}
          formatCount={toCount}
        />
      ) : null}

      {schemaDesignerOpen ? (
        <SchemaDesignerDialog
          draft={schemaDraft}
          sqlPreview={workspace.schemaSqlPreview}
          onDraftChange={setSchemaDraft}
          onClose={() => setSchemaDesignerOpen(false)}
          onCopySql={() => void workspace.copySchemaSql()}
          onPutSqlInEditor={workspace.putSchemaSqlInEditor}
        />
      ) : null}

      {erd.diagramOpen ? (
        <ErdDialog
          activeConnectionName={activeConnection.name}
          model={erd.diagramModel}
          layout={erd.diagramLayout}
          svgRef={erd.diagramSvgRef}
          canvasRef={erd.diagramCanvasRef}
          svgStyle={erd.diagramSvgStyle}
          zoom={erd.diagramZoom}
          search={erd.diagramSearch}
          schemaNames={erd.diagramSchemaNames}
          availableSchemas={erd.availableDiagramSchemas}
          error={erd.diagramError}
          metadataLoaded={Boolean(activeMetadata)}
          onClose={() => erd.setDiagramOpen(false)}
          onFit={erd.fitDiagramToViewport}
          onZoomChange={erd.setDiagramZoom}
          onSearchChange={erd.setDiagramSearch}
          onSchemaNamesChange={erd.setDiagramSchemaNames}
          onCopySvg={erd.copyDiagramSvg}
          onCopyPng={() => void erd.copyDiagramPng()}
          onDownloadSvg={erd.downloadDiagramSvg}
          onDownloadPng={() => void erd.downloadDiagramPng()}
          onDownloadSpecMarkdown={erd.downloadTableSpecMarkdown}
          onDownloadSpecJson={erd.downloadTableSpecJson}
          onLoadSpecDdl={() => erd.schemaSpecFileRef.current?.click()}
          onCreateDatabaseSql={erd.createDatabaseSqlFromDiagram}
          onEditInDesigner={erd.editDiagramInDesigner}
          onSelectTable={erd.editDiagramTableColumns}
          onCopyMermaid={() => void erd.copyDiagramMermaid()}
        />
      ) : null}

      {erd.schemaDiagramOpen ? (
        <SchemaDiagramDialog
          onClose={erd.closeSchemaDiagram}
          onPutSqlInEditor={erd.putDiagramDesignerSqlInEditor}
          onCopySql={(sql) => void erd.copyDiagramDesignerSql(sql)}
          onSeedFromDb={erd.seedSchemaDiagramFromDb}
          canSeedFromDb={Boolean(activeMetadata && hasDiagram(activeMetadata))}
        />
      ) : null}

      <input
        ref={erd.schemaSpecFileRef}
        type="file"
        accept=".json,.irodori-schema.json,application/json"
        hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) {
            void erd.handleSchemaSpecFile(file);
          }
        }}
      />
    </>
  );
}
