// Editor buffer language, routed from the tab's file name (EDITOR-178).
//
// Tabs are named like files (`scratch.sql`, `query-2.sql`, and free-form via
// rename), so the extension is the one signal every tab already carries. SQL
// stays the fallback: it is what the editor has always assumed, and every
// default tab name ends in `.sql` anyway.

export type EditorLanguage = "sql" | "csv" | "tsv" | "log" | "text";

const editorLanguageByExtension: Record<string, EditorLanguage> = {
  sql: "sql",
  csv: "csv",
  tsv: "tsv",
  tab: "tsv",
  log: "log",
  txt: "text",
  text: "text",
};

/** Language for a tab label ("orders.csv" -> "csv"); unknown names stay SQL. */
export function editorLanguageForTabLabel(label: string): EditorLanguage {
  const match = /\.([a-z0-9]+)$/i.exec(label.trim());
  const extension = match?.[1].toLowerCase();
  return (extension && editorLanguageByExtension[extension]) || "sql";
}
