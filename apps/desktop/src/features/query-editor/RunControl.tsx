import { useEffect, type RefObject } from "react";
import { ChevronDown, Play, Save } from "lucide-react";

export type RunControlProps = {
  running: boolean;
  runControlRef: RefObject<HTMLDivElement | null>;
  runMenuOpen: boolean;
  setRunMenuOpen: (value: boolean | ((open: boolean) => boolean)) => void;
  runPrimaryLabel: string;
  runShortcutLabel: string;
  runCurrentShortcutLabel: string;
  runFromStartShortcutLabel: string;
  runAllShortcutLabel: string;
  hasSelectedEditorSql: boolean;
  saveCurrentQuery: () => void;
  runQuery: () => Promise<void>;
  runSelectionQuery: () => Promise<void>;
  runCurrentQuery: () => Promise<void>;
  runFromStartQuery: () => Promise<void>;
  runAllQuery: () => Promise<void>;
};

export function RunControl({
  running,
  runControlRef,
  runMenuOpen,
  setRunMenuOpen,
  runPrimaryLabel,
  runShortcutLabel,
  runCurrentShortcutLabel,
  runFromStartShortcutLabel,
  runAllShortcutLabel,
  hasSelectedEditorSql,
  saveCurrentQuery,
  runQuery,
  runSelectionQuery,
  runCurrentQuery,
  runFromStartQuery,
  runAllQuery,
}: RunControlProps) {
  useEffect(() => {
    if (!runMenuOpen) {
      return;
    }

    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && runControlRef.current?.contains(target)) {
        return;
      }
      setRunMenuOpen(false);
    };
    const closeOnBlur = () => setRunMenuOpen(false);

    window.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("blur", closeOnBlur);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("blur", closeOnBlur);
    };
  }, [runControlRef, runMenuOpen, setRunMenuOpen]);

  return (
    <div className="editor-primary-actions">
      <button
        className="text-button toolbar-command"
        type="button"
        title="Save query"
        aria-label="Save query"
        onClick={saveCurrentQuery}
      >
        <Save size={15} />
        <span>Save</span>
      </button>
      <div className="run-control editor-floating-run" ref={runControlRef}>
        <button
          className="primary-action run-main-button"
          type="button"
          title={
            runShortcutLabel
              ? `${runPrimaryLabel} (${runShortcutLabel})`
              : runPrimaryLabel
          }
          disabled={running}
          onClick={() => void runQuery()}
        >
          <Play size={15} fill="currentColor" />
          <span>{runPrimaryLabel}</span>
        </button>
        <button
          className="primary-action run-menu-toggle"
          type="button"
          title="Run options"
          aria-label="Run options"
          aria-haspopup="menu"
          aria-expanded={runMenuOpen}
          disabled={running}
          onClick={() => setRunMenuOpen((open) => !open)}
        >
          <ChevronDown size={14} />
        </button>
        {runMenuOpen ? (
          <RunOptionsMenu
            runPrimaryLabel={runPrimaryLabel}
            runShortcutLabel={runShortcutLabel}
            runCurrentShortcutLabel={runCurrentShortcutLabel}
            runFromStartShortcutLabel={runFromStartShortcutLabel}
            runAllShortcutLabel={runAllShortcutLabel}
            hasSelectedEditorSql={hasSelectedEditorSql}
            runQuery={runQuery}
            runSelectionQuery={runSelectionQuery}
            runCurrentQuery={runCurrentQuery}
            runFromStartQuery={runFromStartQuery}
            runAllQuery={runAllQuery}
          />
        ) : null}
      </div>
    </div>
  );
}

function RunOptionsMenu({
  runPrimaryLabel,
  runShortcutLabel,
  runCurrentShortcutLabel,
  runFromStartShortcutLabel,
  runAllShortcutLabel,
  hasSelectedEditorSql,
  runQuery,
  runSelectionQuery,
  runCurrentQuery,
  runFromStartQuery,
  runAllQuery,
}: Omit<
  RunControlProps,
  | "running"
  | "runControlRef"
  | "runMenuOpen"
  | "setRunMenuOpen"
  | "saveCurrentQuery"
>) {
  return (
    <div className="app-menu-popover run-menu-popover" role="menu">
      <button type="button" role="menuitem" onClick={() => void runQuery()}>
        <span>{runPrimaryLabel}</span>
        {runShortcutLabel ? <kbd>{runShortcutLabel}</kbd> : null}
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={!hasSelectedEditorSql}
        onClick={() => void runSelectionQuery()}
      >
        <span>Run Selection</span>
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => void runCurrentQuery()}
      >
        <span>Run Current</span>
        {runCurrentShortcutLabel ? <kbd>{runCurrentShortcutLabel}</kbd> : null}
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => void runFromStartQuery()}
      >
        <span>Run From Top</span>
        {runFromStartShortcutLabel ? (
          <kbd>{runFromStartShortcutLabel}</kbd>
        ) : null}
      </button>
      <button type="button" role="menuitem" onClick={() => void runAllQuery()}>
        <span>Run All</span>
        {runAllShortcutLabel ? <kbd>{runAllShortcutLabel}</kbd> : null}
      </button>
    </div>
  );
}
