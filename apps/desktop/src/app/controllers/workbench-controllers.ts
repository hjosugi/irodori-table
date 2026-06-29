import type { ComponentProps } from "react";

import type { ConnectionManagerDialog } from "@/features/connections";
import type { QueryEditorPane } from "@/features/query-editor";
import type { ResultsPane } from "@/features/results";

export type QueryEditorController = ComponentProps<typeof QueryEditorPane>;
export type ResultGridController = ComponentProps<typeof ResultsPane>;
export type ConnectionController = ComponentProps<
  typeof ConnectionManagerDialog
>;
