import { commandCatalog, type CommandMeta, type Keymap } from "@/core";
import type { TranslationKey, Translator } from "@/i18n";
import type { WorkspaceSnapshot } from "../generated/irodori-api";

export const APP_NAME = "Irodori Table";
export const APP_VERSION = "0.7.23";
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

type CommandTranslationKeys = {
  category: TranslationKey;
  title: TranslationKey;
};

const commandCategoryKeys: Partial<Record<string, TranslationKey>> = {
  Edit: "commands.category.edit",
  Editor: "commands.category.editor",
  File: "commands.category.file",
  General: "commands.category.general",
  Help: "commands.category.help",
  Preferences: "commands.category.preferences",
  Query: "commands.category.query",
  Result: "commands.category.result",
  Search: "commands.category.search",
  View: "commands.category.view",
  Workspace: "commands.category.workspace",
};

const commandTranslationKeys: Partial<Record<string, CommandTranslationKeys>> =
  {
    "about.open": {
      title: "commands.about.open.title",
      category: "commands.category.help",
    },
    "app.exit": {
      title: "commands.app.exit.title",
      category: "commands.category.file",
    },
    "connection.manager": {
      title: "commands.connection.manager.title",
      category: "commands.category.workspace",
    },
    "developer.openDevtools": {
      title: "commands.developer.openDevtools.title",
      category: "commands.category.help",
    },
    "diagram.show": {
      title: "commands.diagram.show.title",
      category: "commands.category.general",
    },
    "edit.addRow": {
      title: "commands.edit.addRow.title",
      category: "commands.category.edit",
    },
    "edit.commit": {
      title: "commands.edit.commit.title",
      category: "commands.category.edit",
    },
    "edit.toggle": {
      title: "commands.edit.toggle.title",
      category: "commands.category.edit",
    },
    "edit.undo": {
      title: "commands.edit.undo.title",
      category: "commands.category.edit",
    },
    "editor.cleanup": {
      title: "commands.editor.cleanup.title",
      category: "commands.category.editor",
    },
    "editor.comment.toggle": {
      title: "commands.editor.comment.toggle.title",
      category: "commands.category.editor",
    },
    "editor.focus": {
      title: "commands.editor.focus.title",
      category: "commands.category.editor",
    },
    "editor.format": {
      title: "commands.editor.format.title",
      category: "commands.category.editor",
    },
    "editor.generateSql": {
      title: "commands.editor.generateSql.title",
      category: "commands.category.editor",
    },
    "editor.indent": {
      title: "commands.editor.indent.title",
      category: "commands.category.editor",
    },
    "editor.outdent": {
      title: "commands.editor.outdent.title",
      category: "commands.category.editor",
    },
    "editor.quickDefinition": {
      title: "commands.editor.quickDefinition.title",
      category: "commands.category.editor",
    },
    "editor.quickFix": {
      title: "commands.editor.quickFix.title",
      category: "commands.category.editor",
    },
    "editor.searchInAllTabs": {
      title: "commands.editor.searchInAllTabs.title",
      category: "commands.category.search",
    },
    "editor.transform.addCommas": {
      title: "commands.editor.transform.addCommas.title",
      category: "commands.category.editor",
    },
    "editor.transform.doubleToSingleQuotes": {
      title: "commands.editor.transform.doubleToSingleQuotes.title",
      category: "commands.category.editor",
    },
    "editor.transform.lowercase": {
      title: "commands.editor.transform.lowercase.title",
      category: "commands.category.editor",
    },
    "editor.transform.unformat": {
      title: "commands.editor.transform.unformat.title",
      category: "commands.category.editor",
    },
    "editor.transform.uppercase": {
      title: "commands.editor.transform.uppercase.title",
      category: "commands.category.editor",
    },
    "file.save": {
      title: "commands.file.save.title",
      category: "commands.category.file",
    },
    "file.saveAs": {
      title: "commands.file.saveAs.title",
      category: "commands.category.file",
    },
    "git.open": {
      title: "commands.git.open.title",
      category: "commands.category.workspace",
    },
    "help.open": {
      title: "commands.help.open.title",
      category: "commands.category.help",
    },
    "history.open": {
      title: "commands.history.open.title",
      category: "commands.category.view",
    },
    "migration.studio": {
      title: "commands.migration.studio.title",
      category: "commands.category.general",
    },
    "palette.open": {
      title: "commands.palette.open.title",
      category: "commands.category.general",
    },
    "query.cancel": {
      title: "commands.query.cancel.title",
      category: "commands.category.query",
    },
    "query.explainAnalyze": {
      title: "commands.query.explainAnalyze.title",
      category: "commands.category.query",
    },
    "query.explainPlan": {
      title: "commands.query.explainPlan.title",
      category: "commands.category.query",
    },
    "query.run": {
      title: "commands.query.run.title",
      category: "commands.category.query",
    },
    "query.runAll": {
      title: "commands.query.runAll.title",
      category: "commands.category.query",
    },
    "query.runCurrent": {
      title: "commands.query.runCurrent.title",
      category: "commands.category.query",
    },
    "query.runFromStart": {
      title: "commands.query.runFromStart.title",
      category: "commands.category.query",
    },
    "result.copyRow": {
      title: "commands.result.copyRow.title",
      category: "commands.category.result",
    },
    "result.copySelection": {
      title: "commands.result.copySelection.title",
      category: "commands.category.result",
    },
    "result.copySqlInserts": {
      title: "commands.result.copySqlInserts.title",
      category: "commands.category.result",
    },
    "result.copyVisible": {
      title: "commands.result.copyVisible.title",
      category: "commands.category.result",
    },
    "result.export": {
      title: "commands.result.export.title",
      category: "commands.category.result",
    },
    "result.exportSqlInserts": {
      title: "commands.result.exportSqlInserts.title",
      category: "commands.category.result",
    },
    "settings.keymap": {
      title: "commands.settings.keymap.title",
      category: "commands.category.preferences",
    },
    "settings.open": {
      title: "commands.settings.open.title",
      category: "commands.category.preferences",
    },
    "tab.close": {
      title: "commands.tab.close.title",
      category: "commands.category.workspace",
    },
    "tab.new": {
      title: "commands.tab.new.title",
      category: "commands.category.workspace",
    },
    "terminal.toggle": {
      title: "commands.terminal.toggle.title",
      category: "commands.category.view",
    },
    "theme.toggle": {
      title: "commands.theme.toggle.title",
      category: "commands.category.preferences",
    },
    "view.aiChat.toggle": {
      title: "commands.view.aiChat.toggle.title",
      category: "commands.category.view",
    },
    "view.bi.toggle": {
      title: "commands.view.bi.toggle.title",
      category: "commands.category.view",
    },
    "view.completion.toggle": {
      title: "commands.view.completion.toggle.title",
      category: "commands.category.view",
    },
    "view.history.toggle": {
      title: "commands.view.history.toggle.title",
      category: "commands.category.view",
    },
    "view.plan.toggle": {
      title: "commands.view.plan.toggle.title",
      category: "commands.category.view",
    },
    "view.search.toggle": {
      title: "commands.view.search.toggle.title",
      category: "commands.category.view",
    },
    "view.sidebar.toggle": {
      title: "commands.view.sidebar.toggle.title",
      category: "commands.category.view",
    },
    "view.zoomIn": {
      title: "commands.view.zoomIn.title",
      category: "commands.category.view",
    },
    "view.zoomOut": {
      title: "commands.view.zoomOut.title",
      category: "commands.category.view",
    },
    "view.zoomReset": {
      title: "commands.view.zoomReset.title",
      category: "commands.category.view",
    },
  };

const menuSectionLabelKeys: Partial<Record<string, TranslationKey>> = {
  Edit: "menu.section.edit",
  File: "menu.section.file",
  Help: "menu.section.help",
  Preferences: "menu.section.preferences",
  Run: "menu.section.run",
  Tools: "menu.section.tools",
  View: "menu.section.view",
  Workspace: "menu.section.workspace",
};

export function localizeCommandCatalog(
  commands: readonly CommandMeta[],
  t: Translator["t"],
): CommandMeta[] {
  return commands.map((command) => {
    const keys = commandTranslationKeys[command.id];
    const categoryKey = commandCategoryKeys[command.category];
    return {
      ...command,
      title: keys ? t(keys.title) : command.title,
      category: keys
        ? t(keys.category)
        : categoryKey
          ? t(categoryKey)
          : command.category,
    };
  });
}

export type AppMenuItem = {
  commandId: string;
};

export type AppMenuSection = {
  label: string;
  items: AppMenuItem[];
};

export function localizeMenuSections(
  sections: readonly AppMenuSection[],
  t: Translator["t"],
): AppMenuSection[] {
  return sections.map((section) => {
    const labelKey = menuSectionLabelKeys[section.label];
    return {
      ...section,
      label: labelKey ? t(labelKey) : section.label,
    };
  });
}

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
