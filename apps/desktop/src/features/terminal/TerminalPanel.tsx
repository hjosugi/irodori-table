import { useCallback, useRef, useState } from "react";
import { usePreferencesStore } from "@/features/preferences";
import { createTranslator } from "@/i18n";
import { isPtyRuntimeAvailable } from "@/lib/tauri/pty";
import { TerminalView } from "./TerminalView";
import "./terminal.css";

// The label is derived from the index at render time (not stored) so tab
// names follow the active locale.
type Tab = { id: string; index: number };

/**
 * VSCode-style bottom terminal panel with tabs. Each tab owns a PTY-backed
 * [`TerminalView`]; inactive tabs stay mounted (hidden) so their sessions persist.
 */
export function TerminalPanel({ onClose }: { onClose: () => void }) {
  const locale = usePreferencesStore((state) => state.locale);
  const { t } = createTranslator(locale);
  const counter = useRef(1);
  const [tabs, setTabs] = useState<Tab[]>([{ id: "term-1", index: 1 }]);
  const [activeId, setActiveId] = useState("term-1");

  const addTab = useCallback(() => {
    counter.current += 1;
    const id = `term-${counter.current}`;
    setTabs((current) => [...current, { id, index: counter.current }]);
    setActiveId(id);
  }, []);

  const closeTab = useCallback(
    (id: string) => {
      setTabs((current) => {
        const next = current.filter((tab) => tab.id !== id);
        if (next.length === 0) {
          onClose();
          return current;
        }
        setActiveId((active) =>
          active === id ? next[next.length - 1].id : active,
        );
        return next;
      });
    },
    [onClose],
  );

  // A plain browser (vite preview, Playwright harness) has no Tauri runtime,
  // so no PTY can ever spawn; degrade to a clear notice instead of mounting
  // terminal views (#186). Availability cannot change within a page load, so
  // branching after the hooks is stable.
  if (!isPtyRuntimeAvailable()) {
    return (
      <div className="terminal-panel">
        <div className="terminal-tabbar">
          <div className="terminal-tabs" />
          <button
            type="button"
            className="terminal-action"
            aria-label={t("terminal.closePanel")}
            onClick={onClose}
          >
            ⨯
          </button>
        </div>
        <div className="terminal-unavailable" role="status">
          {t("terminal.requiresDesktop")}
        </div>
      </div>
    );
  }

  return (
    <div className="terminal-panel">
      <div className="terminal-tabbar">
        <div className="terminal-tabs">
          {/* Real role="tab" buttons: a keyboard user could previously reach
              only the (destructive) close button on a background terminal but
              had no way to switch to it (#134). The close control is a sibling
              of the tab button, never nested inside it — nested interactive
              elements are invalid. Only tabs live inside the tablist; the
              "new terminal" action stays outside it. */}
          <div
            className="terminal-tablist"
            role="tablist"
            aria-label={t("terminal.tabs")}
          >
            {tabs.map((tab) => {
              const label = t("terminal.tabLabel", { index: tab.index });
              return (
                <div
                  key={tab.id}
                  role="presentation"
                  className={`terminal-tab${tab.id === activeId ? " is-active" : ""}`}
                >
                  <button
                    type="button"
                    role="tab"
                    className="terminal-tab-select"
                    aria-selected={tab.id === activeId}
                    onClick={() => setActiveId(tab.id)}
                  >
                    {label}
                  </button>
                  <button
                    type="button"
                    className="terminal-tab-close"
                    aria-label={t("terminal.closeTab", { label })}
                    onClick={() => closeTab(tab.id)}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            className="terminal-action"
            aria-label={t("terminal.newTerminal")}
            onClick={addTab}
          >
            +
          </button>
        </div>
        <button
          type="button"
          className="terminal-action"
          aria-label={t("terminal.closePanel")}
          onClick={onClose}
        >
          ⨯
        </button>
      </div>
      <div className="terminal-bodies">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className="terminal-body"
            style={{ display: tab.id === activeId ? "block" : "none" }}
          >
            <TerminalView active={tab.id === activeId} />
          </div>
        ))}
      </div>
    </div>
  );
}
