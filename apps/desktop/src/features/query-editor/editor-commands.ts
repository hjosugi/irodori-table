import type { ComponentType } from "react";
import {
  AlignJustify,
  AlignLeft,
  IndentDecrease,
  IndentIncrease,
  TerminalSquare,
} from "lucide-react";

export type EditorToolbarCommand = {
  commandId: string;
  title: string;
  ariaLabel: string;
  label: string;
  icon: ComponentType<{ size?: number | string }>;
};

export type EditorContextCommand = {
  commandId: string;
  label: string;
};

export const editorToolbarCommands: readonly EditorToolbarCommand[] = [
  {
    commandId: "editor.format",
    title: "Format SQL",
    ariaLabel: "Format SQL",
    label: "Format",
    icon: AlignLeft,
  },
  {
    commandId: "editor.transform.unformat",
    title: "Unformat SQL to one line",
    ariaLabel: "Unformat SQL to one line",
    label: "One line",
    icon: AlignJustify,
  },
  {
    commandId: "editor.comment.toggle",
    title: "Toggle SQL comment",
    ariaLabel: "Toggle SQL comment",
    label: "Comment",
    icon: TerminalSquare,
  },
  {
    commandId: "editor.outdent",
    title: "Outdent line or selection",
    ariaLabel: "Outdent line or selection",
    label: "Outdent",
    icon: IndentDecrease,
  },
  {
    commandId: "editor.indent",
    title: "Indent line or selection",
    ariaLabel: "Indent line or selection",
    label: "Indent",
    icon: IndentIncrease,
  },
];

export const editorContextCommandGroups: readonly (readonly EditorContextCommand[])[] =
  [
    [
      { commandId: "query.run", label: "" },
      { commandId: "editor.quickFix", label: "Show Problems and Quick Fixes" },
      { commandId: "editor.cleanup", label: "Code Cleanup" },
      { commandId: "editor.format", label: "Format SQL" },
      { commandId: "editor.comment.toggle", label: "Toggle Comment" },
      { commandId: "editor.outdent", label: "Outdent Line or Selection" },
      { commandId: "editor.indent", label: "Indent Line or Selection" },
      { commandId: "editor.quickDefinition", label: "Quick Definition" },
    ],
    [
      { commandId: "editor.transform.uppercase", label: "Uppercase selection" },
      { commandId: "editor.transform.lowercase", label: "Lowercase selection" },
      { commandId: "editor.transform.unformat", label: "Unformat to one line" },
      { commandId: "editor.transform.addCommas", label: "Add commas to lines" },
      {
        commandId: "editor.transform.doubleToSingleQuotes",
        label: "Double quotes to single quotes",
      },
    ],
  ];
