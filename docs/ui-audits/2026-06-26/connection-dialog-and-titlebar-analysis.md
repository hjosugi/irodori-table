# UI Audit: Connection Dialog and Titlebar

Date: 2026-06-26

Scope:
- Connection manager dialog sizing and responsive behavior.
- Connection rail and object sidebar layout after the TablePlus/Beekeeper pass.
- Titlebar after removing the inactive `Open anything` control.

## Saved Screenshots

| File | Viewport | Purpose |
|---|---:|---|
| [workspace-layout-after-rail.png](screenshots/workspace-layout-after-rail.png) | 1280 x 720 | Workspace layout after splitting connection rail from object sidebar. |
| [connection-dialog-before-list-overflow-fix-1366.png](screenshots/connection-dialog-before-list-overflow-fix-1366.png) | 1366 x 768 | Intermediate capture showing connection list rows overflowing past the left picker. |
| [connection-dialog-final-1366.png](screenshots/connection-dialog-final-1366.png) | 1366 x 768 | Final desktop connection dialog after size and overflow fixes. |
| [connection-dialog-final-900.png](screenshots/connection-dialog-final-900.png) | 900 x 720 | Narrow desktop check. Dialog remains in two columns and fits. |
| [connection-dialog-final-720.png](screenshots/connection-dialog-final-720.png) | 720 x 680 | Small viewport check. Dialog switches to stacked layout and footer remains visible. |
| [workspace-current-no-open-anything-1366.png](screenshots/workspace-current-no-open-anything-1366.png) | 1366 x 768 | Current titlebar check after removing the inactive `Open anything` field. |

## Findings

The original connection manager felt oversized because it used a wide two-column grid with a large viewport-height cap. The form body also had enough free space to visually stretch the dialog into a settings-page shape instead of a lightweight connection popup.

The intermediate screenshot also exposed a separate sizing bug: `.connection-profile-list` and its child rows were allowed to resolve wider than the `.connection-picker` track. This made the right-side status dot bleed into the form area.

The final desktop target is a compact TablePlus-style popup:
- Desktop dialog: `880px` max width, roughly `387px` tall with current sample data.
- Left picker: fixed compact column, no overflow into the form.
- Form body: content starts at the top instead of spreading through empty space.
- Footer: always visible in the tested desktop and small viewport captures.

The 900px viewport now keeps a two-column dialog, which is better for desktop use. The 720px viewport switches to stacked layout with internal scrolling where needed.

The titlebar `Open anything` field was removed because it was only a visual placeholder. The current titlebar screenshot verifies:
- No `Open anything` text in the DOM.
- No `.global-search` element in the DOM.
- Right-side controls remain available.

## Measurements

Measured during Playwright checks:

| Viewport | Dialog result |
|---:|---|
| 1366 x 768 | `880 x 387`, centered, footer visible |
| 900 x 720 | `852 x 387`, two columns, footer visible |
| 720 x 680 | `680 x 656`, stacked, footer visible |

## Decisions Kept

- Use `connection-overlay` instead of changing generic `.palette-overlay`, so command palette and settings dialogs keep their own behavior.
- Set `grid-template-columns: minmax(0, 1fr)` on `.connection-picker` to prevent internal grid content from pushing outside its track.
- Keep mobile/very narrow fallback at `760px`, not `920px`, so small desktop windows still get the efficient two-column connection editor.
- Remove the titlebar search markup and CSS rather than hiding it, because the feature is not implemented yet.

## Remaining UI Watchpoints

- The connection manager is now usable, but the visual hierarchy can still be refined: primary action contrast, disabled button tone, and form label density.
- Existing screenshots before titlebar search removal contain the old titlebar. Use `workspace-current-no-open-anything-1366.png` as the latest titlebar reference.
- Connection dialog screenshots should be regenerated after any future connection form redesign.
