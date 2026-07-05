import { Square } from "lucide-react";
import { usePreferencesStore } from "@/features/preferences";
import { createTranslator, type TranslationKey } from "@/i18n";
import type { SqlFormatterId } from "../../sql/formatter";
import { editorToolbarCommands } from "./editor-commands";

const toolbarCommandText: Record<
  string,
  { title: TranslationKey; label: TranslationKey }
> = {
  "editor.format": {
    title: "editorBar.format.title",
    label: "editorBar.format.label",
  },
  "editor.transform.unformat": {
    title: "editorBar.unformat.title",
    label: "editorBar.unformat.label",
  },
  "editor.comment.toggle": {
    title: "editorBar.comment.title",
    label: "editorBar.comment.label",
  },
  "editor.outdent": {
    title: "editorBar.outdent.title",
    label: "editorBar.outdent.label",
  },
  "editor.indent": {
    title: "editorBar.indent.title",
    label: "editorBar.indent.label",
  },
};

type EditorCommandBarProps = {
  formatter: SqlFormatterId;
  running: boolean;
  runCommand: (commandId: string) => void;
  cancelQuery: () => Promise<void>;
};

export function EditorCommandBar({
  formatter,
  running,
  runCommand,
  cancelQuery,
}: EditorCommandBarProps) {
  const locale = usePreferencesStore((state) => state.locale);
  const { t } = createTranslator(locale);
  return (
    <div className="editor-command-bar">
      {editorToolbarCommands.map((command) => {
        const Icon = command.icon;
        const text = toolbarCommandText[command.commandId];
        const baseTitle = text ? t(text.title) : command.title;
        const title =
          command.commandId === "editor.format"
            ? `${baseTitle} (${formatter})`
            : baseTitle;
        return (
          <button
            className="icon-button editor-toolbar-button"
            type="button"
            title={title}
            aria-label={baseTitle}
            key={command.commandId}
            onClick={() => runCommand(command.commandId)}
          >
            <Icon size={15} />
            <span>{text ? t(text.label) : command.label}</span>
          </button>
        );
      })}
      <button
        className="icon-button editor-toolbar-button"
        type="button"
        title={t("editorBar.cancel.title")}
        aria-label={t("editorBar.cancel.title")}
        disabled={!running}
        onClick={() => void cancelQuery()}
      >
        <Square size={15} />
        <span>{t("editorBar.cancel.label")}</span>
      </button>
    </div>
  );
}
