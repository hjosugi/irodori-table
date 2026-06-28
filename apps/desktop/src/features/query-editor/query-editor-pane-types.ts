import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type { SqlEditorSelection } from "./SqlEditor";
import type { EditorSplitMode } from "../workbench";

export type EditorGroup = "primary" | "secondary";
export type EditorSelection = SqlEditorSelection;
export type EditorSelections = readonly EditorSelection[];

export type EditorSplitModeUpdater =
  | EditorSplitMode
  | ((mode: EditorSplitMode) => EditorSplitMode);

export type EditorSplitControlsProps = {
  editorSplitOpen: boolean;
  editorSplitMode: EditorSplitMode;
  setEditorSplitMode: (value: EditorSplitModeUpdater) => void;
};

export type EditorSplitResizeProps = {
  beginEditorSplitResize: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onEditorSplitResizeKey: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
};
