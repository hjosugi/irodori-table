import {
  formatResultGridAsMarkdown,
  type ExtensionContext,
  type SqlDialectDefinition,
  type ThemeDefinition,
} from "@irodori-table/extension-sdk";

const theme: ThemeDefinition = {
  id: "typescriptBasic.calmLight",
  name: "Calm Light",
  kind: "light",
  colors: {
    "workbench.background": "#f7f8f6",
    "editor.background": "#fffef9",
    "editor.foreground": "#20242a",
    "accent.primary": "#2e7a56",
  },
  tokenColors: [
    {
      scope: ["keyword", "storage"],
      settings: {
        foreground: "#3367a5",
        fontStyle: "bold",
      },
    },
  ],
};

const dialect: SqlDialectDefinition = {
  id: "typescriptBasic.acmeSql",
  name: "Acme SQL",
  aliases: ["acme"],
  keywords: [
    {
      word: "select",
      category: "keyword",
    },
    {
      word: "customer_score",
      category: "function",
    },
  ],
  snippets: [
    {
      label: "select customers",
      insertText: "select id, name from customers limit 100;",
      detail: "Read sample customers",
    },
  ],
  formatter: {
    keywordCase: "lower",
    identifierQuote: "\"",
  },
};

export async function activate(context: ExtensionContext): Promise<void> {
  context.log.info("activating TypeScript basic extension");

  context.subscriptions.push(context.themes.registerTheme(theme));
  context.subscriptions.push(context.sqlDialects.registerDialect(dialect));

  context.subscriptions.push(
    context.commands.registerCommand("typescriptBasic.copyResultAsMarkdown", async () => {
      context.permissions.require("queryResults:read");

      const snapshot = await context.resultGrid.getActiveSnapshot();
      if (!snapshot) {
        context.log.warn("no active result grid");
        return;
      }

      await context.resultGrid.copyText(formatResultGridAsMarkdown(snapshot));
    }),
  );
}
