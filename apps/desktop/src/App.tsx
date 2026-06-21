import { useEffect, useMemo, useState } from "react";
import {
  Bolt,
  ChevronDown,
  Clock3,
  Columns3,
  Database,
  FilePlus2,
  Folder,
  Keyboard,
  Layers3,
  Play,
  Plus,
  Save,
  Search,
  ShieldCheck,
  SplitSquareHorizontal,
  Square,
  Table2,
  TerminalSquare,
} from "lucide-react";
import {
  workspaceSnapshot,
  type WorkspaceSnapshot,
} from "./generated/irodori-api";
import "./App.css";

const fallbackSnapshot: WorkspaceSnapshot = {
  activeConnectionId: "local-pg",
  connections: [
    {
      id: "local-pg",
      name: "Local Warehouse",
      engine: "PostgreSQL 16",
      status: "connected",
      latencyMs: 3,
      proxy: "direct",
      objects: [
        { name: "orders", kind: "table", rows: "1.2M" },
        { name: "customers", kind: "table", rows: "83K" },
        { name: "invoice_lines", kind: "table", rows: "4.8M" },
        { name: "recent_revenue", kind: "view" },
        { name: "refresh_rollups", kind: "procedure" },
      ],
    },
    {
      id: "oracle-dev",
      name: "Oracle Dev",
      engine: "Oracle 23ai",
      status: "idle",
      latencyMs: 18,
      proxy: "ssh > socks5",
      objects: [
        { name: "APP_USERS", kind: "table", rows: "42K" },
        { name: "LEDGER_ENTRY", kind: "table", rows: "9.1M" },
        { name: "PKG_BILLING", kind: "procedure" },
      ],
    },
  ],
};

const tabs = [
  { id: "scratch", label: "scratch.sql", group: "Daily work" },
  { id: "audit", label: "audit-window.sql", group: "Revenue" },
  { id: "explain", label: "explain-plan.sql", group: "Tuning" },
];

const initialQuery = `select
  c.id,
  c.name,
  sum(o.total) as lifetime_value,
  max(o.created_at) as last_order_at
from customers c
join orders o on o.customer_id = c.id
where o.created_at >= now() - interval '90 days'
group by c.id, c.name
order by lifetime_value desc
limit 200;`;

const resultRows = [
  ["1029", "Kawase Foods", "9841200", "2026-06-20 18:34"],
  ["917", "Northwind Retail", "7720100", "2026-06-20 11:12"],
  ["1441", "Aster Works", "6533000", "2026-06-19 23:41"],
  ["447", "Minato Labs", "5128800", "2026-06-19 08:03"],
  ["620", "Higashi Market", "4889100", "2026-06-18 19:27"],
  ["233", "Shiro Systems", "4412200", "2026-06-18 16:15"],
  ["1104", "Iris Trading", "3824000", "2026-06-17 21:06"],
];

const completions = [
  { label: "orders.customer_id", detail: "fk -> customers.id" },
  { label: "customers.name", detail: "text, indexed" },
  { label: "recent_revenue", detail: "view, refreshed 2m ago" },
  { label: "date_trunc('day', ...)", detail: "PostgreSQL function" },
];

const commands = [
  "Run current statement",
  "Open anything",
  "Toggle Vim mode",
  "Split editor right",
  "Show explain plan",
];

function App() {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>(fallbackSnapshot);
  const [activeTab, setActiveTab] = useState(tabs[0].id);
  const [activeConnectionId, setActiveConnectionId] = useState(
    fallbackSnapshot.activeConnectionId,
  );
  const [query, setQuery] = useState(initialQuery);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    workspaceSnapshot()
      .then((nextSnapshot) => {
        setSnapshot(nextSnapshot);
        setActiveConnectionId(nextSnapshot.activeConnectionId);
      })
      .catch(() => {
        setSnapshot(fallbackSnapshot);
      });
  }, []);

  const activeConnection = useMemo(
    () =>
      snapshot.connections.find((item) => item.id === activeConnectionId) ??
      snapshot.connections[0],
    [activeConnectionId, snapshot.connections],
  );

  const lineNumbers = useMemo(
    () =>
      query
        .split("\n")
        .map((_, index) => index + 1)
        .join("\n"),
    [query],
  );

  const activeTabLabel = tabs.find((tab) => tab.id === activeTab)?.label;

  function runQuery() {
    setRunning(true);
    window.setTimeout(() => setRunning(false), 700);
  }

  return (
    <main className="app-shell">
      <header className="titlebar">
        <div className="window-controls" aria-hidden="true">
          <span className="dot red" />
          <span className="dot amber" />
          <span className="dot green" />
        </div>
        <div className="brand">
          <Database size={18} />
          <span>Irodori Table</span>
        </div>
        <div className="global-search">
          <Search size={15} />
          <input aria-label="Search" placeholder="Open anything" />
        </div>
        <div className="keymap-chip">
          <Keyboard size={14} />
          <span>Vim</span>
        </div>
      </header>

      <section className="toolbar" aria-label="Workspace toolbar">
        <button className="connection-select" type="button">
          <Database size={16} />
          <span>{activeConnection.name}</span>
          <small>{activeConnection.engine}</small>
          <ChevronDown size={15} />
        </button>
        <button className="primary-action" type="button" onClick={runQuery}>
          <Play size={15} fill="currentColor" />
          <span>Run Current</span>
        </button>
        <button
          className="icon-button"
          type="button"
          title="Cancel query"
          aria-label="Cancel query"
          disabled={!running}
          onClick={() => setRunning(false)}
        >
          <Square size={15} />
        </button>
        <button
          className="icon-button"
          type="button"
          title="Save query"
          aria-label="Save query"
        >
          <Save size={15} />
        </button>
        <button
          className="icon-button"
          type="button"
          title="Split editor"
          aria-label="Split editor"
        >
          <SplitSquareHorizontal size={15} />
        </button>
        <div className="toolbar-spacer" />
        <div className="latency">
          <Bolt size={14} />
          <span>{activeConnection.latencyMs} ms</span>
        </div>
        <div className="latency proxy">
          <ShieldCheck size={14} />
          <span>{activeConnection.proxy}</span>
        </div>
      </section>

      <div className="workspace">
        <aside className="sidebar">
          <section className="sidebar-section">
            <div className="section-heading">
              <span>Connections</span>
              <button
                className="mini-button"
                type="button"
                title="New connection"
                aria-label="New connection"
              >
                <Plus size={14} />
              </button>
            </div>
            <div className="connection-list">
              {snapshot.connections.map((connection) => (
                <button
                  className={
                    connection.id === activeConnectionId
                      ? "connection-item active"
                      : "connection-item"
                  }
                  key={connection.id}
                  type="button"
                  onClick={() => setActiveConnectionId(connection.id)}
                >
                  <Database size={16} />
                  <span>
                    <strong>{connection.name}</strong>
                    <small>{connection.engine}</small>
                  </span>
                  <i className={connection.status} />
                </button>
              ))}
            </div>
          </section>

          <section className="sidebar-section browser-section">
            <div className="section-heading">
              <span>public</span>
              <button
                className="mini-button"
                type="button"
                title="New SQL tab"
                aria-label="New SQL tab"
              >
                <FilePlus2 size={14} />
              </button>
            </div>
            <div className="object-browser">
              {activeConnection.objects.map((object) => (
                <button className="object-row" key={object.name} type="button">
                  {object.kind === "procedure" ? (
                    <TerminalSquare size={15} />
                  ) : (
                    <Table2 size={15} />
                  )}
                  <span>{object.name}</span>
                  <small>{object.rows ?? object.kind}</small>
                </button>
              ))}
            </div>
          </section>
        </aside>

        <section className="main-pane">
          <div className="tab-strip">
            <div className="tab-folder">
              <Folder size={14} />
              <span>{tabs.find((tab) => tab.id === activeTab)?.group}</span>
            </div>
            {tabs.map((tab) => (
              <button
                className={tab.id === activeTab ? "tab active" : "tab"}
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
            <button
              className="mini-button"
              type="button"
              title="New tab"
              aria-label="New tab"
            >
              <Plus size={14} />
            </button>
          </div>

          <div className="editor-and-inspector">
            <section className="editor-pane" aria-label={activeTabLabel}>
              <div className="editor-meta">
                <span>{activeTabLabel}</span>
                <span>{running ? "running..." : "ready"}</span>
              </div>
              <div className="editor-shell">
                <pre className="line-numbers" aria-hidden="true">
                  {lineNumbers}
                </pre>
                <textarea
                  aria-label="SQL editor"
                  spellCheck={false}
                  value={query}
                  onChange={(event) => setQuery(event.currentTarget.value)}
                />
              </div>
            </section>

            <aside className="inspector">
              <section>
                <div className="section-heading">
                  <span>Completion</span>
                  <Columns3 size={14} />
                </div>
                <div className="completion-list">
                  {completions.map((item) => (
                    <button className="completion-item" key={item.label}>
                      <strong>{item.label}</strong>
                      <small>{item.detail}</small>
                    </button>
                  ))}
                </div>
              </section>
              <section>
                <div className="section-heading">
                  <span>Commands</span>
                  <Layers3 size={14} />
                </div>
                <div className="command-list">
                  {commands.map((command) => (
                    <button className="command-item" key={command}>
                      {command}
                    </button>
                  ))}
                </div>
              </section>
            </aside>
          </div>

          <section className="results-pane">
            <div className="results-header">
              <div>
                <strong>Result 1</strong>
                <span>200 rows in 42 ms</span>
              </div>
              <div className="results-actions">
                <button className="text-button" type="button">
                  Export CSV
                </button>
                <button className="text-button" type="button">
                  Edit Data
                </button>
              </div>
            </div>
            <div className="result-grid" role="table" aria-label="Query result">
              <div className="grid-row header" role="row">
                <span role="columnheader">id</span>
                <span role="columnheader">name</span>
                <span role="columnheader">lifetime_value</span>
                <span role="columnheader">last_order_at</span>
              </div>
              {resultRows.map((row) => (
                <div className="grid-row" role="row" key={row.join("-")}>
                  {row.map((cell) => (
                    <span role="cell" key={cell}>
                      {cell}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </section>
        </section>
      </div>

      <footer className="statusbar">
        <span>
          <Clock3 size={13} />
          history scoped to {activeConnection.name}
        </span>
        <span>{query.split("\n").length} lines</span>
        <span>{running ? "query running" : "idle"}</span>
      </footer>
    </main>
  );
}

export default App;
