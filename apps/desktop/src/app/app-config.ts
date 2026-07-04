import { commandCatalog, type CommandMeta, type Keymap } from "@/core";
import type { WorkspaceSnapshot } from "../generated/irodori-api";

export const APP_NAME = "Irodori Table";
export const APP_VERSION = "0.7.7";
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
    id: "view.plan.toggle",
    title: "Toggle Plan Panel",
    category: "View",
    scope: "global",
  },
  {
    id: "view.bi.toggle",
    title: "Toggle BI Panel",
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

const aiCommands: CommandMeta[] = [
  {
    id: "editor.generateSql",
    title: "Generate SQL with AI",
    category: "Editor",
    scope: "editor",
  },
  {
    id: "query.explainPlan",
    title: "Explain Plan",
    category: "Query",
    scope: "editor",
  },
  {
    id: "query.explainAnalyze",
    title: "Explain Analyse",
    category: "Query",
    scope: "editor",
  },
  {
    id: "terminal.toggle",
    title: "Toggle Terminal",
    category: "View",
    scope: "global",
  },
];

export const appCommandCatalog: CommandMeta[] = [
  ...commandCatalog,
  ...shellCommands,
  ...resultCopyCommands,
  ...aiCommands,
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
      { commandId: "editor.transform.unformat" },
      { commandId: "editor.comment.toggle" },
      { commandId: "editor.indent" },
      { commandId: "editor.outdent" },
    ],
  },
  {
    label: "View",
    items: [
      { commandId: "editor.quickDefinition" },
      { commandId: "view.sidebar.toggle" },
      { commandId: "view.completion.toggle" },
      { commandId: "view.history.toggle" },
      { commandId: "view.plan.toggle" },
      { commandId: "view.bi.toggle" },
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
    items: [{ commandId: "help.open" }, { commandId: "about.open" }],
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
      { commandId: "editor.transform.unformat" },
      { commandId: "editor.comment.toggle" },
      { commandId: "editor.indent" },
      { commandId: "editor.outdent" },
      { commandId: "query.explainPlan" },
      { commandId: "query.explainAnalyze" },
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
      { commandId: "view.plan.toggle" },
      { commandId: "view.bi.toggle" },
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
  activeConnectionId: "",
  connections: [],
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

export function loadSavedQuery(
  options: { restoreSaved?: boolean } = {},
): string {
  const restoreSaved = options.restoreSaved ?? !import.meta.env.DEV;
  const stored = window.localStorage.getItem(savedQueryStorageKey);
  if (!restoreSaved || !stored || stored === legacySeedQuery) {
    return initialQuery;
  }
  return stored;
}
