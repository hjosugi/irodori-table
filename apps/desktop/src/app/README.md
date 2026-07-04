# `src/app` — Workbench architecture

The workbench is built from three layers with one rule: **wiring happens in
exactly one place**. If you remember nothing else: state lives in stores and
controllers, controllers are combined only in `use-workbench.ts`, and views
only render what the context gives them.

```
feature stores (zustand)          src/features/*/…-store.ts
        │  subscribed by
        ▼
domain controllers (hooks)        src/app/controllers/use-<domain>.ts
        │  wired together by
        ▼
composition root                  src/app/controllers/use-workbench.ts  ← the ONLY wiring site
        │  distributed via
        ▼
WorkbenchProvider (context)       src/app/workbench-context.tsx
        │  consumed by
        ▼
views                             WorkbenchRoot / WorkbenchSidebar / WorkbenchDialogs
```

## Entry point

`AppWorkbench.tsx` is intentionally tiny:

```tsx
const workbench = useWorkbench();          // build everything
return (
  <WorkbenchProvider workbench={workbench}>
    <WorkbenchRoot />                      // render everything
  </WorkbenchProvider>
);
```

## File map

| File | Role |
| --- | --- |
| `AppWorkbench.tsx` | Entry: composition + provider + root view. |
| `controllers/use-workbench.ts` | Composition root. Creates every domain controller in dependency order, cross-wires them, returns the `Workbench` object. |
| `workbench-context.tsx` | `WorkbenchProvider` / `useWorkbenchContext()`. |
| `WorkbenchRoot.tsx` | The one top-level view: shell chrome, dock layout, center panes, sidebars, dialogs, toasts. |
| `WorkbenchSidebar.tsx` | One side (left/right): view rail + dockable panels. |
| `WorkbenchDialogs.tsx` | Every modal/overlay surface. |
| `controllers/use-<domain>.ts` | One hook per domain (below). |
| `app-config.ts` | Command catalog, menu bar sections, app constants. |
| `app-workbench-utils.ts` | Pure helpers (no hooks). |

## Domain controllers

Each controller owns one concern, takes its dependencies as an argument
object, and returns plain state + actions. None of them import views or each
other's internals — they meet only inside `use-workbench.ts`.

| Controller | Owns |
| --- | --- |
| `use-workbench-connections` | Connection profiles, active connection facts, metadata, the connection manager dialog controller. |
| `use-editor-workspace` | Editor tabs/groups/split, active-editor accessors, the `QueryEditorPane` prop bundle. |
| `use-result-grid-workspace` | Result grid state (selection, editing, filters, export), the `ResultsPane` prop bundle. |
| `use-query-runner` | Executing SQL, cancellation, parameter prompts, EXPLAIN. |
| `use-editor-commands` | Editor-scoped commands (run/format/cleanup/indent…). |
| `use-workbench-commands` | Maps every command id → owning controller (palette, menu, keys). |
| `use-workbench-overlays` | Open/close state of app-level overlays (palette, about, terminal…). |
| `use-sidebar-views` | Which dockable view lives on which side, toggle/open/close flows. |
| `use-keybinding-manager` | Keymap overrides, chord resolution, rebind recording. |
| `use-workspace-actions` | Save/import/export, schema designer glue, app-level actions. |
| `use-history-actions` | Query-history load/run/restore. |
| `use-erd-diagram` | ERD dialog state and exports. |
| `use-settings-controller` | Settings dialog state, settings JSON, jobs. |
| `use-theme-manager` | Theme selection and switching. |

## The rules

1. **Views never wire.** A view reads `useWorkbenchContext()` (and feature
   stores for view-local concerns) and renders. If a view needs two
   controllers to talk to each other, that conversation belongs in
   `use-workbench.ts`.
2. **Controllers never import views** and never reach into another
   controller — dependencies arrive through their argument object.
3. **One command surface.** Anything a user can trigger (menu, palette,
   shortcut) is a command id: declared in `app-config.ts`, mapped in
   `use-workbench-commands.ts`.
4. **Store state stays in stores.** `useState` in a controller is fine for
   ephemeral UI state; anything persisted or shared across features belongs
   in a zustand store under `src/features/*`.

## Recipes

**Add a command** — declare the id in the catalog in `app-config.ts`, map it
to a controller action in `use-workbench-commands.ts`. Default shortcut: see
the keymap consumed by `use-keybinding-manager`.

**Add a dialog** — put its open/close state in `use-workbench-overlays.ts`
(or the owning feature store), render it in `WorkbenchDialogs.tsx`, open it
via a command.

**Add a sidebar panel** — register the view id/placement in
`src/features/workbench` (see `workbenchViewIds`), render the panel in
`WorkbenchSidebar.tsx`, add a toggle command.

**Add a domain controller** — create `controllers/use-<name>.ts` taking a
deps object, instantiate it in `use-workbench.ts` at the right point in the
dependency order, expose it on the returned `Workbench` object.

**Consume workbench state in a new component** — render it under
`WorkbenchRoot` and call `useWorkbenchContext()`; never thread controller
props through intermediate components.
