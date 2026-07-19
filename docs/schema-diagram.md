# Schema diagram designer

A free-form canvas for modelling tables and relationships, which generates a
`CREATE` script. Like the [Schema designer](schema-designer.md) it produces text
only and never touches a database.

Both dialogs display the title **Schema Designer**. Tell them apart by how you
opened them: this one is the canvas with draggable table cards.

> **Your work is not saved.** Closing the dialog — including by pressing
> `Escape` or clicking outside it — discards the canvas. Reopening rebuilds it
> from the database or from blank. **Export** to JSON is the only way to keep a
> design.

## Opening it

- Objects header **+** ▸ **Design on Canvas**
- The **Designer** button in the [ERD](erd.md)

No palette entry, no menu item, no shortcut.

## The canvas

Drag a table card by its header to move it. Click empty canvas to deselect.
Zoom runs 40%–160% in 10% steps, with **Fit** to frame everything.

Toolbar:

| Button | Effect |
| --- | --- |
| **Table** | Adds a table |
| **From DB** | *Replace the canvas with the connected database schema* |
| **Export** | Writes the diagram as JSON |
| **Import** | Reads a diagram JSON back |
| **Copy SQL** | Copies the generated `CREATE` script |
| **Create DB SQL** | *Generate the runnable CREATE script in the editor* |
| **Fit**, zoom in/out | View controls |

Per table: a name field, **Remove table**, and per column a primary-key toggle,
name, type, **NN** (not null), and **Remove column**. **+ Column** adds one, and
**FK** adds a foreign key — disabled until a second table exists.

Each relationship row picks a local column, a referenced table, and a referenced
column.

## Export and import

**Export** writes `irodori-schema-diagram.json` in the app's own format.
**Import** accepts only that format and rejects anything else with *Unsupported
schema diagram format. Expected irodori.schema-diagram.v1.*

The filename is fixed — exporting twice from the same folder collides. Rename as
you save if you are keeping several designs.

**Create DB SQL** replaces the active editor tab's contents without
confirmation.

## Gaps

- **Nothing persists.** No autosave, no undo, no redo. `Escape` or a stray click
  outside the dialog loses everything, silently.
- **Indexes are dropped entirely.** There is no index UI, and seeding **From
  DB** then generating SQL produces a script with none of the source table's
  indexes.
- **Composite foreign keys are destroyed on edit.** A multi-column FK renders as
  if it had one column, and touching the dropdown permanently collapses it to
  that single column.
- **Self-referencing foreign keys display the wrong table.** The referenced-table
  dropdown excludes the table itself, so a self-FK shows some other table as
  selected. The generated SQL is still correct.
- **Column defaults are invisible but still emitted.** Defaults seeded from the
  database appear in the generated SQL with no field showing them.
- **Per-table schema cannot be set.** Every new table inherits the first table's
  schema.
- **No ON DELETE or ON UPDATE.**
- **Dragging inside the table-name field moves the table** instead of selecting
  text.
- **Table selection is decorative** — it draws a highlight and nothing acts on
  it. There is no delete-selected.
- **The dialog is not translated.**
