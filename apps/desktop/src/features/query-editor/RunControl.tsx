import { useEffect, type RefObject } from "react";
import { ChevronDown, Play } from "lucide-react";
import { usePreferencesStore } from "@/features/preferences";
import { createTranslator, type Translator } from "@/i18n";

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
  runQuery,
  runSelectionQuery,
  runCurrentQuery,
  runFromStartQuery,
  runAllQuery,
}: RunControlProps) {
  const locale = usePreferencesStore((state) => state.locale);
  const { t } = createTranslator(locale);
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
          title={t("run.options")}
          aria-label={t("run.options")}
          aria-haspopup="menu"
          aria-expanded={runMenuOpen}
          disabled={running}
          onClick={() => setRunMenuOpen((open) => !open)}
        >
          <ChevronDown size={14} />
        </button>
        {runMenuOpen ? (
          <RunOptionsMenu
            t={t}
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
  t,
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
  "running" | "runControlRef" | "runMenuOpen" | "setRunMenuOpen"
> & { t: Translator["t"] }) {
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
        <span>{t("run.selection")}</span>
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => void runCurrentQuery()}
      >
        <span>{t("run.current")}</span>
        {runCurrentShortcutLabel ? <kbd>{runCurrentShortcutLabel}</kbd> : null}
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => void runFromStartQuery()}
      >
        <span>{t("run.fromTop")}</span>
        {runFromStartShortcutLabel ? (
          <kbd>{runFromStartShortcutLabel}</kbd>
        ) : null}
      </button>
      <button type="button" role="menuitem" onClick={() => void runAllQuery()}>
        <span>{t("run.all")}</span>
        {runAllShortcutLabel ? <kbd>{runAllShortcutLabel}</kbd> : null}
      </button>
    </div>
  );
}
