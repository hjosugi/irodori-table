import { create } from "zustand";
import type { DbObjectMetadata } from "@/generated/irodori-api";
import {
  blankSchemaDraft,
  schemaDraftFromObject,
  type SchemaDesignerDraft,
} from "./schema-designer";

type ValueUpdater<T> = T | ((current: T) => T);

type SchemaDesignerState = {
  open: boolean;
  draft: SchemaDesignerDraft;
  setOpen: (value: ValueUpdater<boolean>) => void;
  setDraft: (value: ValueUpdater<SchemaDesignerDraft>) => void;
  openBlank: () => void;
  openForObject: (object: DbObjectMetadata) => void;
  close: () => void;
};

function resolveValue<T>(current: T, value: ValueUpdater<T>): T {
  return typeof value === "function"
    ? (value as (current: T) => T)(current)
    : value;
}

export const useSchemaDesignerStore = create<SchemaDesignerState>((set) => ({
  open: false,
  draft: blankSchemaDraft(),
  setOpen: (value) =>
    set((state) => ({ open: resolveValue(state.open, value) })),
  setDraft: (value) =>
    set((state) => ({ draft: resolveValue(state.draft, value) })),
  openBlank: () =>
    set({
      open: true,
      draft: blankSchemaDraft(),
    }),
  openForObject: (object) =>
    set({
      open: true,
      draft: schemaDraftFromObject(object),
    }),
  close: () => set({ open: false }),
}));
