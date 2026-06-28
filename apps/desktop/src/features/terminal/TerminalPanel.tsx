import { useCallback, useRef, useState } from "react";
import { TerminalView } from "./TerminalView";
import "./terminal.css";

type Tab = { id: string; label: string };

/**
 * VSCode-style bottom terminal panel with tabs. Each tab owns a PTY-backed
 * [`TerminalView`]; inactive tabs stay mounted (hidden) so their sessions persist.
 */
export function TerminalPanel({ onClose }: { onClose: () => void }) {
  const counter = useRef(1);
  const [tabs, setTabs] = useState<Tab[]>([
    { id: "term-1", label: "Terminal 1" },
  ]);
  const [activeId, setActiveId] = useState("term-1");

  const addTab = useCallback(() => {
    counter.current += 1;
    const id = `term-${counter.current}`;
    setTabs((current) => [
      ...current,
      { id, label: `Terminal ${counter.current}` },
    ]);
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

  return (
    <div className="terminal-panel">
      <div className="terminal-tabbar">
        <div className="terminal-tabs">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`terminal-tab${tab.id === activeId ? " is-active" : ""}`}
              onClick={() => setActiveId(tab.id)}
            >
              <span>{tab.label}</span>
              <button
                type="button"
                className="terminal-tab-close"
                aria-label={`Close ${tab.label}`}
                onClick={(event) => {
                  event.stopPropagation();
                  closeTab(tab.id);
                }}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            className="terminal-action"
            aria-label="New terminal"
            onClick={addTab}
          >
            +
          </button>
        </div>
        <button
          type="button"
          className="terminal-action"
          aria-label="Close panel"
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
