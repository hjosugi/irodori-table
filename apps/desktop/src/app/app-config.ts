import {
  commandCatalog,
  type CommandMeta,
  type Keymap,
} from "@/core";
import type { WorkspaceSnapshot } from "../generated/irodori-api";

export const APP_NAME = "Irodori Table";
export const APP_VERSION = "0.2.23";
export const APP_IDENTIFIER = "dev.irodori.table";

const resultCopyCommands: CommandMeta[] = [
  {
    id: "result.copySelection",
    title: "Copy selected cell or row",
    category: "Result",
    scope: "grid",
  },
  {
    id: "result.copyRow",
    title: "Copy selected row as TSV",
    category: "Result",
    scope: "grid",
  },
  {
    id: "result.copyVisible",
    title: "Copy visible result as TSV",
    category: "Result",
    scope: "grid",
  },
];

const developerCommands: CommandMeta[] = import.meta.env.DEV
  ? [
      {
        id: "developer.openDevtools",
        title: "Open Developer Tools",
        category: "Help",
        scope: "global",
      },
    ]
  : [];

const shellCommands: CommandMeta[] = [
  {
    id: "connection.manager",
    title: "Open Connection Manager",
    category: "Workspace",
    scope: "global",
  },
  {
    id: "settings.open",
    title: "Open Settings",
    category: "Preferences",
    scope: "global",
  },
  {
    id: "settings.keymap",
    title: "Open Keyboard Shortcuts",
    category: "Preferences",
    scope: "global",
  },
  {
    id: "app.exit",
    title: "Exit",
    category: "File",
    scope: "global",
  },
  {
    id: "theme.toggle",
    title: "Toggle Color Theme",
    category: "Preferences",
    scope: "global",
  },
  {
    id: "view.sidebar.toggle",
    title: "Toggle Sidebar",
    category: "View",
    scope: "global",
  },
  {
    id: "view.completion.toggle",
    title: "Toggle Completion Panel",
    category: "View",
    scope: "global",
  },
  {
    id: "view.history.toggle",
    title: "Toggle History Panel",
    category: "View",
    scope: "global",
  },
  {
    id: "view.zoomIn",
    title: "Zoom In",
    category: "View",
    scope: "global",
  },
  {
    id: "view.zoomOut",
    title: "Zoom Out",
    category: "View",
    scope: "global",
  },
  {
    id: "view.zoomReset",
    title: "Reset Zoom",
    category: "View",
    scope: "global",
  },
  {
    id: "history.open",
    title: "Open Query History",
    category: "View",
    scope: "global",
  },
  {
    id: "git.open",
    title: "Open Git Panel",
    category: "Workspace",
    scope: "global",
  },
  {
    id: "help.open",
    title: "Open Help",
    category: "Help",
    scope: "global",
  },
  {
    id: "about.open",
    title: "About Irodori Table",
    category: "Help",
    scope: "global",
  },
];

export const appCommandCatalog: CommandMeta[] = [
  ...commandCatalog,
  ...shellCommands,
  ...resultCopyCommands,
];

export const appMenuCommandCatalog: CommandMeta[] = [
  ...appCommandCatalog,
  ...developerCommands,
];

export type AppMenuItem = {
  commandId: string;
};

export type AppMenuSection = {
  label: string;
  items: AppMenuItem[];
};

export const workspaceMenuSections: AppMenuSection[] = [
  {
    label: "Workspace",
    items: [
      { commandId: "palette.open" },
      { commandId: "connection.manager" },
      { commandId: "migration.studio" },
      { commandId: "git.open" },
    ],
  },
  {
    label: "Edit",
    items: [
      { commandId: "editor.quickFix" },
      { commandId: "editor.cleanup" },
      { commandId: "editor.format" },
      { commandId: "editor.comment.toggle" },
    ],
  },
  {
    label: "View",
    items: [
      { commandId: "editor.quickDefinition" },
      { commandId: "view.sidebar.toggle" },
      { commandId: "view.completion.toggle" },
      { commandId: "view.history.toggle" },
      { commandId: "view.zoomIn" },
      { commandId: "view.zoomOut" },
      { commandId: "view.zoomReset" },
    ],
  },
  {
    label: "Preferences",
    items: [
      { commandId: "settings.open" },
      { commandId: "settings.keymap" },
      { commandId: "theme.toggle" },
    ],
  },
  {
    label: "Help",
    items: [
      { commandId: "help.open" },
      { commandId: "about.open" },
    ],
  },
];

export const menuBarSections: AppMenuSection[] = [
  {
    label: "File",
    items: [
      { commandId: "tab.new" },
      { commandId: "tab.close" },
      { commandId: "file.save" },
      { commandId: "file.saveAs" },
      { commandId: "connection.manager" },
      { commandId: "settings.open" },
      { commandId: "app.exit" },
    ],
  },
  {
    label: "Edit",
    items: [
      { commandId: "editor.quickFix" },
      { commandId: "editor.cleanup" },
      { commandId: "editor.format" },
      { commandId: "editor.comment.toggle" },
    ],
  },
  {
    label: "View",
    items: [
      { commandId: "palette.open" },
      { commandId: "editor.quickDefinition" },
      { commandId: "view.sidebar.toggle" },
      { commandId: "view.completion.toggle" },
      { commandId: "view.history.toggle" },
      { commandId: "history.open" },
      { commandId: "git.open" },
      { commandId: "view.zoomIn" },
      { commandId: "view.zoomOut" },
      { commandId: "view.zoomReset" },
    ],
  },
  {
    label: "Run",
    items: [
      { commandId: "query.run" },
      { commandId: "query.runCurrent" },
      { commandId: "query.runFromStart" },
      { commandId: "query.runAll" },
      { commandId: "query.cancel" },
    ],
  },
  {
    label: "Tools",
    items: [
      { commandId: "migration.studio" },
      { commandId: "schema.indexBuild" },
      { commandId: "editor.cleanup" },
      { commandId: "settings.keymap" },
      { commandId: "theme.toggle" },
    ],
  },
  {
    label: "Help",
    items: [
      { commandId: "help.open" },
      ...developerCommands.map((command) => ({ commandId: command.id })),
      { commandId: "about.open" },
    ],
  },
];

export const resultCopyDefaultKeymap: Keymap = {
  "result.copySelection": "Mod+C",
};

export const fallbackSnapshot: WorkspaceSnapshot = {
  activeConnectionId: "local-pg",
  connections: [
    {
      id: "local-pg",
      name: "Local Postgres",
      engine: "PostgreSQL 16",
      status: "idle",
      latencyMs: 0,
      proxy: "direct",
      objects: [
        { name: "cheeses", kind: "table", rows: "5" },
        { name: "countries", kind: "table", rows: "5" },
        { name: "orders", kind: "table", rows: "1.2M" },
        { name: "customers", kind: "table", rows: "83K" },
        { name: "invoice_lines", kind: "table", rows: "4.8M" },
        { name: "cheese_summary", kind: "view" },
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

export const tabs = [
  { id: "scratch", label: "scratch.sql" },
  { id: "audit", label: "audit-window.sql" },
  { id: "explain", label: "explain-plan.sql" },
];

export const savedQueryStorageKey = "irodori.savedScratchQuery.v1";

const legacySeedQuery = `select
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

export const initialQuery = "";

export const resultRows = [
  ["1029", "Kawase Foods", "9841200", "2026-06-20 18:34"],
  ["917", "Northwind Retail", "7720100", "2026-06-20 11:12"],
  ["1441", "Aster Works", "6533000", "2026-06-19 23:41"],
  ["447", "Minato Labs", "5128800", "2026-06-19 08:03"],
  ["620", "Higashi Market", "4889100", "2026-06-18 19:27"],
  ["233", "Shiro Systems", "4412200", "2026-06-18 16:15"],
  ["1104", "Iris Trading", "3824000", "2026-06-17 21:06"],
];

export function loadSavedQuery(): string {
  const stored = window.localStorage.getItem(savedQueryStorageKey);
  if (!stored || stored === legacySeedQuery) {
    return initialQuery;
  }
  return stored;
}
