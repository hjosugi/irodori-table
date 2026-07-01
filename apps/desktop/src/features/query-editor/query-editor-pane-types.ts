import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type { SqlEditorSelection } from "./SqlEditor";

export type EditorGroup = "primary" | "secondary";
export type EditorSelection = SqlEditorSelection;
export type EditorSelections = readonly EditorSelection[];

export type EditorSplitResizeProps = {
  beginEditorSplitResize: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onEditorSplitResizeKey: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
};
