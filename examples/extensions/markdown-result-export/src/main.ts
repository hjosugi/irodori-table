import {
  formatResultGridAsMarkdown,
  type ExtensionContext,
} from "@irodori-table/extension-sdk";

export async function activate(context: ExtensionContext): Promise<void> {
  context.subscriptions.push(
    context.commands.registerCommand("markdownResultExport.copy", async () => {
      context.permissions.require("queryResults:read");

      const snapshot = await context.resultGrid.getActiveSnapshot();
      if (!snapshot) {
        context.log.warn("Markdown export skipped because no result grid is active");
        return;
      }

      await context.resultGrid.copyText(formatResultGridAsMarkdown(snapshot));
      context.log.info("Copied result grid as Markdown");
    }),
  );
}
