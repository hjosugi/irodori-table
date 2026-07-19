# Schema designer

A form that builds `CREATE TABLE` or `ALTER TABLE` SQL. **It generates text — it
never changes your database.** There is no Apply or Execute button; the outputs
are the clipboard and the editor.

Two dialogs in this app both title themselves **Schema Designer**. This page is
the form-based one. The canvas is [Schema diagram
designer](schema-diagram.md).

## Opening it

| Route | Mode |
| --- | --- |
| Objects header **+** ▸ **New Table** | Create |
| Object menu ▸ **Structure** (tables only) | Alter |
| Empty-database ▸ **Create a table** | Create |
| Clicking a table in the [ERD](erd.md) | Alter |

No command-palette entry, no menu item, and no keyboard shortcut. **New Table**
works with no connection at all.

## The form

A badge shows whether you are producing `CREATE TABLE` or `ALTER TABLE`, and
**Mode** switches between them. **Schema** and **Table** name the target.

Three sections, each with an add button:

- **Columns** (**+ Column**) — name, type, **NN** (not null), **PK**, and a
  default value.
- **Indexes** (**+ Index**) — name (auto-named when blank), columns, **Unique**.
- **Foreign Keys** (**+ FK**) — name, local columns, referenced schema, table,
  and columns, plus **On delete** (`CASCADE`, `SET NULL`, `RESTRICT`, `NO
  ACTION`, or blank).

A live SQL preview sits below the form. **Copy SQL** copies it; **Put SQL in
editor** replaces the active editor tab's contents — with no confirmation, so
save first.

Type is a free-text field with no list and no validation. A blank type becomes
`TEXT`.

## Alter mode is additive only

Opening **Structure** on an existing table loads its current shape read-only and
lets you *add* to it. Existing columns, indexes, and foreign keys are locked,
including their delete buttons.

The generated `ALTER` therefore only ever contains:

- `ADD COLUMN` for new columns
- `CREATE INDEX` for new indexes
- `ADD CONSTRAINT … FOREIGN KEY` for new foreign keys

There is **no DROP COLUMN, no RENAME, no ALTER COLUMN TYPE, no DROP INDEX, and
no DROP CONSTRAINT** — not hidden, simply not implemented. Until you add
something, the preview is a single comment: `-- Add a new column, index, or
foreign key to generate ALTER SQL.`

## Gaps

- **It cannot change anything.** Copy the SQL or send it to the editor and run
  it yourself.
- **Identifiers are always quoted with ANSI double quotes**, regardless of
  engine. The generated SQL is not valid as written on MySQL/MariaDB (backticks)
  or SQL Server (brackets) — fix the quoting after pasting.
- **Alter mode only adds** (above).
- **Foreign-key names shown for existing tables are invented.** The backend does
  not return constraint names, so the form synthesises `fk_<table>_<columns>`,
  which usually will not match your database.
- **ON DELETE is never read back** from an existing table, and **ON UPDATE is
  not supported at all**.
- **Switching Mode from Alter to Create unlocks everything** and emits a full
  `CREATE TABLE` including the pre-existing columns.
- **The dialog is not translated** — it stays English under the Japanese
  locale.
- **A blank identifier silently becomes `"unnamed"`.**
