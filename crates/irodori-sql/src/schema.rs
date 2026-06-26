//! ADV-001 — schema comparison and migration preview.
//!
//! A pure, source-agnostic schema model plus a structural diff and a migration
//! **preview** generator. [`diff_schemas`] turns two [`Schema`] snapshots into a
//! readable [`SchemaDiff`] (tables/columns/indexes added, dropped, or altered),
//! and [`SchemaDiff::to_migration`] renders dialect-quoted DDL for it.
//!
//! Safe-apply contract: this module only *generates* SQL — it never executes it.
//! Every statement is tagged [`MigrationStatement::destructive`] (a `DROP` that can
//! lose data), so a caller can preview the change set, require explicit
//! confirmation for destructive steps, and run the script inside a transaction on
//! dialects that support transactional DDL. Reviewing the preview before applying
//! is the intended workflow.

use crate::dialect::SqlDialect;

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Column {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub default: Option<String>,
}

impl Column {
    pub fn new(name: impl Into<String>, data_type: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            data_type: data_type.into(),
            nullable: true,
            default: None,
        }
    }

    pub fn not_null(mut self) -> Self {
        self.nullable = false;
        self
    }

    pub fn with_default(mut self, default: impl Into<String>) -> Self {
        self.default = Some(default.into());
        self
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Index {
    pub name: String,
    pub columns: Vec<String>,
    pub unique: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Table {
    pub name: String,
    pub columns: Vec<Column>,
    pub primary_key: Vec<String>,
    pub indexes: Vec<Index>,
}

impl Table {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            ..Default::default()
        }
    }

    pub fn with_columns(mut self, columns: Vec<Column>) -> Self {
        self.columns = columns;
        self
    }

    pub fn with_primary_key(mut self, primary_key: Vec<String>) -> Self {
        self.primary_key = primary_key;
        self
    }

    pub fn with_indexes(mut self, indexes: Vec<Index>) -> Self {
        self.indexes = indexes;
        self
    }

    fn column(&self, name: &str) -> Option<&Column> {
        self.columns.iter().find(|c| c.name == name)
    }

    fn index(&self, name: &str) -> Option<&Index> {
        self.indexes.iter().find(|i| i.name == name)
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Schema {
    pub tables: Vec<Table>,
}

impl Schema {
    pub fn new(tables: Vec<Table>) -> Self {
        Self { tables }
    }

    fn table(&self, name: &str) -> Option<&Table> {
        self.tables.iter().find(|t| t.name == name)
    }
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ColumnChange {
    Type {
        from: String,
        to: String,
    },
    Nullability {
        nullable: bool,
    },
    Default {
        from: Option<String>,
        to: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AlteredColumn {
    /// The column as it should become (used by single-statement `MODIFY` dialects).
    pub column: Column,
    pub changes: Vec<ColumnChange>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AlteredTable {
    pub name: String,
    pub added_columns: Vec<Column>,
    pub dropped_columns: Vec<String>,
    pub altered_columns: Vec<AlteredColumn>,
    pub added_indexes: Vec<Index>,
    pub dropped_indexes: Vec<String>,
}

impl AlteredTable {
    fn is_empty(&self) -> bool {
        self.added_columns.is_empty()
            && self.dropped_columns.is_empty()
            && self.altered_columns.is_empty()
            && self.added_indexes.is_empty()
            && self.dropped_indexes.is_empty()
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SchemaDiff {
    pub added_tables: Vec<Table>,
    pub dropped_tables: Vec<String>,
    pub altered_tables: Vec<AlteredTable>,
}

impl SchemaDiff {
    pub fn is_empty(&self) -> bool {
        self.added_tables.is_empty()
            && self.dropped_tables.is_empty()
            && self.altered_tables.is_empty()
    }

    /// Whether the diff drops a table, column, or index (data-losing changes).
    pub fn has_destructive_changes(&self) -> bool {
        !self.dropped_tables.is_empty()
            || self
                .altered_tables
                .iter()
                .any(|table| !table.dropped_columns.is_empty() || !table.dropped_indexes.is_empty())
    }

    /// A short, human-readable change set for the preview header.
    pub fn summary(&self) -> String {
        if self.is_empty() {
            return "no schema changes".to_string();
        }
        let mut parts = Vec::new();
        if !self.added_tables.is_empty() {
            parts.push(format!("+{} table(s)", self.added_tables.len()));
        }
        if !self.dropped_tables.is_empty() {
            parts.push(format!("-{} table(s)", self.dropped_tables.len()));
        }
        for table in &self.altered_tables {
            let mut bits = Vec::new();
            if !table.added_columns.is_empty() {
                bits.push(format!("+{}col", table.added_columns.len()));
            }
            if !table.dropped_columns.is_empty() {
                bits.push(format!("-{}col", table.dropped_columns.len()));
            }
            if !table.altered_columns.is_empty() {
                bits.push(format!("~{}col", table.altered_columns.len()));
            }
            if !table.added_indexes.is_empty() {
                bits.push(format!("+{}idx", table.added_indexes.len()));
            }
            if !table.dropped_indexes.is_empty() {
                bits.push(format!("-{}idx", table.dropped_indexes.len()));
            }
            parts.push(format!("{} ({})", table.name, bits.join(", ")));
        }
        parts.join("; ")
    }
}

/// Diff `old` into `new`: what would have to change to turn `old` into `new`.
pub fn diff_schemas(old: &Schema, new: &Schema) -> SchemaDiff {
    let mut diff = SchemaDiff::default();

    for new_table in &new.tables {
        if old.table(&new_table.name).is_none() {
            diff.added_tables.push(new_table.clone());
        }
    }
    for old_table in &old.tables {
        if new.table(&old_table.name).is_none() {
            diff.dropped_tables.push(old_table.name.clone());
        }
    }
    for new_table in &new.tables {
        if let Some(old_table) = old.table(&new_table.name) {
            let altered = diff_table(old_table, new_table);
            if !altered.is_empty() {
                diff.altered_tables.push(altered);
            }
        }
    }
    diff
}

fn diff_table(old: &Table, new: &Table) -> AlteredTable {
    let mut altered = AlteredTable {
        name: new.name.clone(),
        added_columns: Vec::new(),
        dropped_columns: Vec::new(),
        altered_columns: Vec::new(),
        added_indexes: Vec::new(),
        dropped_indexes: Vec::new(),
    };

    for new_column in &new.columns {
        match old.column(&new_column.name) {
            None => altered.added_columns.push(new_column.clone()),
            Some(old_column) => {
                let changes = diff_column(old_column, new_column);
                if !changes.is_empty() {
                    altered.altered_columns.push(AlteredColumn {
                        column: new_column.clone(),
                        changes,
                    });
                }
            }
        }
    }
    for old_column in &old.columns {
        if new.column(&old_column.name).is_none() {
            altered.dropped_columns.push(old_column.name.clone());
        }
    }
    for new_index in &new.indexes {
        match old.index(&new_index.name) {
            // Unchanged: nothing to do.
            Some(existing) if existing == new_index => {}
            // Changed definition: drop and recreate.
            Some(_) => {
                altered.dropped_indexes.push(new_index.name.clone());
                altered.added_indexes.push(new_index.clone());
            }
            // Brand new index.
            None => altered.added_indexes.push(new_index.clone()),
        }
    }
    for old_index in &old.indexes {
        if new.index(&old_index.name).is_none() {
            altered.dropped_indexes.push(old_index.name.clone());
        }
    }
    altered
}

fn diff_column(old: &Column, new: &Column) -> Vec<ColumnChange> {
    let mut changes = Vec::new();
    if old.data_type != new.data_type {
        changes.push(ColumnChange::Type {
            from: old.data_type.clone(),
            to: new.data_type.clone(),
        });
    }
    if old.nullable != new.nullable {
        changes.push(ColumnChange::Nullability {
            nullable: new.nullable,
        });
    }
    if old.default != new.default {
        changes.push(ColumnChange::Default {
            from: old.default.clone(),
            to: new.default.clone(),
        });
    }
    changes
}

// ---------------------------------------------------------------------------
// Migration preview
// ---------------------------------------------------------------------------

/// How a dialect alters an existing column. `Standard` is Postgres/ANSI-style
/// granular `ALTER COLUMN`; `MySql` rewrites the whole column with `MODIFY COLUMN`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AlterColumnStyle {
    Standard,
    MySql,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MigrationStatement {
    pub sql: String,
    /// True for `DROP` statements that can lose data.
    pub destructive: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MigrationScript {
    pub statements: Vec<MigrationStatement>,
}

impl MigrationScript {
    pub fn is_empty(&self) -> bool {
        self.statements.is_empty()
    }

    pub fn destructive_count(&self) -> usize {
        self.statements.iter().filter(|s| s.destructive).count()
    }

    /// The full script as one newline-joined SQL string.
    pub fn to_sql(&self) -> String {
        self.statements
            .iter()
            .map(|statement| statement.sql.as_str())
            .collect::<Vec<_>>()
            .join("\n")
    }
}

impl SchemaDiff {
    /// Render this diff as a dialect-quoted migration preview. Statements are
    /// ordered create-tables → drop-tables → per-altered-table changes; each is
    /// flagged destructive when it drops something.
    pub fn to_migration(
        &self,
        dialect: &dyn SqlDialect,
        style: AlterColumnStyle,
    ) -> MigrationScript {
        let mut statements = Vec::new();

        for table in &self.added_tables {
            statements.push(MigrationStatement {
                sql: create_table_sql(dialect, table),
                destructive: false,
            });
            for index in &table.indexes {
                statements.push(MigrationStatement {
                    sql: create_index_sql(dialect, &table.name, index),
                    destructive: false,
                });
            }
        }
        for name in &self.dropped_tables {
            statements.push(MigrationStatement {
                sql: format!("DROP TABLE {};", dialect.quote_identifier(name)),
                destructive: true,
            });
        }
        for table in &self.altered_tables {
            emit_altered_table(dialect, style, table, &mut statements);
        }

        MigrationScript { statements }
    }
}

fn create_table_sql(dialect: &dyn SqlDialect, table: &Table) -> String {
    let mut lines: Vec<String> = table
        .columns
        .iter()
        .map(|column| format!("  {}", column_definition(dialect, column)))
        .collect();
    if !table.primary_key.is_empty() {
        let keys = table
            .primary_key
            .iter()
            .map(|key| dialect.quote_identifier(key))
            .collect::<Vec<_>>()
            .join(", ");
        lines.push(format!("  PRIMARY KEY ({keys})"));
    }
    format!(
        "CREATE TABLE {} (\n{}\n);",
        dialect.quote_identifier(&table.name),
        lines.join(",\n")
    )
}

fn column_definition(dialect: &dyn SqlDialect, column: &Column) -> String {
    let mut def = format!(
        "{} {}",
        dialect.quote_identifier(&column.name),
        column.data_type
    );
    if !column.nullable {
        def.push_str(" NOT NULL");
    }
    if let Some(default) = &column.default {
        def.push_str(&format!(" DEFAULT {default}"));
    }
    def
}

fn emit_altered_table(
    dialect: &dyn SqlDialect,
    style: AlterColumnStyle,
    table: &AlteredTable,
    out: &mut Vec<MigrationStatement>,
) {
    let quoted_table = dialect.quote_identifier(&table.name);

    // Order so the script applies cleanly: add and alter columns, drop the
    // indexes that may reference soon-to-be-dropped columns, drop columns, then
    // (re)create indexes against the final column set.
    for column in &table.added_columns {
        out.push(MigrationStatement {
            sql: format!(
                "ALTER TABLE {quoted_table} ADD COLUMN {};",
                column_definition(dialect, column)
            ),
            destructive: false,
        });
    }
    for altered in &table.altered_columns {
        match style {
            AlterColumnStyle::MySql => {
                out.push(MigrationStatement {
                    sql: format!(
                        "ALTER TABLE {quoted_table} MODIFY COLUMN {};",
                        column_definition(dialect, &altered.column)
                    ),
                    destructive: false,
                });
            }
            AlterColumnStyle::Standard => {
                let column = dialect.quote_identifier(&altered.column.name);
                for change in &altered.changes {
                    let sql = match change {
                        ColumnChange::Type { to, .. } => {
                            format!("ALTER TABLE {quoted_table} ALTER COLUMN {column} TYPE {to};")
                        }
                        ColumnChange::Nullability { nullable: false } => format!(
                            "ALTER TABLE {quoted_table} ALTER COLUMN {column} SET NOT NULL;"
                        ),
                        ColumnChange::Nullability { nullable: true } => format!(
                            "ALTER TABLE {quoted_table} ALTER COLUMN {column} DROP NOT NULL;"
                        ),
                        ColumnChange::Default {
                            to: Some(value), ..
                        } => format!(
                            "ALTER TABLE {quoted_table} ALTER COLUMN {column} SET DEFAULT {value};"
                        ),
                        ColumnChange::Default { to: None, .. } => format!(
                            "ALTER TABLE {quoted_table} ALTER COLUMN {column} DROP DEFAULT;"
                        ),
                    };
                    out.push(MigrationStatement {
                        sql,
                        destructive: false,
                    });
                }
            }
        }
    }
    for name in &table.dropped_indexes {
        let sql = match style {
            // MySQL scopes a dropped index to its table.
            AlterColumnStyle::MySql => format!(
                "DROP INDEX {} ON {quoted_table};",
                dialect.quote_identifier(name)
            ),
            AlterColumnStyle::Standard => {
                format!("DROP INDEX {};", dialect.quote_identifier(name))
            }
        };
        out.push(MigrationStatement {
            sql,
            destructive: true,
        });
    }
    for name in &table.dropped_columns {
        out.push(MigrationStatement {
            sql: format!(
                "ALTER TABLE {quoted_table} DROP COLUMN {};",
                dialect.quote_identifier(name)
            ),
            destructive: true,
        });
    }
    for index in &table.added_indexes {
        out.push(MigrationStatement {
            sql: create_index_sql(dialect, &table.name, index),
            destructive: false,
        });
    }
}

fn create_index_sql(dialect: &dyn SqlDialect, table: &str, index: &Index) -> String {
    let columns = index
        .columns
        .iter()
        .map(|column| dialect.quote_identifier(column))
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "CREATE {}INDEX {} ON {} ({columns});",
        if index.unique { "UNIQUE " } else { "" },
        dialect.quote_identifier(&index.name),
        dialect.quote_identifier(table)
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dialect::{MySqlDialect, PostgresDialect};

    fn col(name: &str, ty: &str) -> Column {
        Column::new(name, ty)
    }

    fn users_v1() -> Table {
        Table::new("users")
            .with_columns(vec![
                col("id", "integer").not_null(),
                col("email", "text").not_null(),
                col("note", "text"),
            ])
            .with_primary_key(vec!["id".into()])
            .with_indexes(vec![Index {
                name: "users_email_idx".into(),
                columns: vec!["email".into()],
                unique: true,
            }])
    }

    #[test]
    fn identical_schemas_have_no_diff() {
        let schema = Schema::new(vec![users_v1()]);
        let diff = diff_schemas(&schema, &schema);
        assert!(diff.is_empty());
        assert!(!diff.has_destructive_changes());
        assert_eq!(diff.summary(), "no schema changes");
        assert!(diff
            .to_migration(&PostgresDialect, AlterColumnStyle::Standard)
            .is_empty());
    }

    #[test]
    fn added_table_creates_with_columns_and_primary_key() {
        let old = Schema::default();
        let new = Schema::new(vec![users_v1()]);
        let diff = diff_schemas(&old, &new);
        assert_eq!(diff.added_tables.len(), 1);
        assert!(!diff.has_destructive_changes());

        let script = diff.to_migration(&PostgresDialect, AlterColumnStyle::Standard);
        assert_eq!(script.statements.len(), 2); // create table + create index
        assert_eq!(
            script.statements[0].sql,
            "CREATE TABLE \"users\" (\n  \"id\" integer NOT NULL,\n  \"email\" text NOT NULL,\n  \"note\" text,\n  PRIMARY KEY (\"id\")\n);"
        );
        assert_eq!(
            script.statements[1].sql,
            "CREATE UNIQUE INDEX \"users_email_idx\" ON \"users\" (\"email\");"
        );
        assert_eq!(script.destructive_count(), 0);
    }

    #[test]
    fn dropped_table_is_destructive() {
        let old = Schema::new(vec![users_v1()]);
        let new = Schema::default();
        let diff = diff_schemas(&old, &new);
        assert_eq!(diff.dropped_tables, vec!["users".to_string()]);
        assert!(diff.has_destructive_changes());
        let script = diff.to_migration(&PostgresDialect, AlterColumnStyle::Standard);
        assert_eq!(script.statements[0].sql, "DROP TABLE \"users\";");
        assert!(script.statements[0].destructive);
    }

    #[test]
    fn column_add_drop_and_alter_postgres() {
        let old = Schema::new(vec![users_v1()]);
        // v2: drop `note`, add `active bool not null default true`, widen email
        // type, make it nullable.
        let new = Schema::new(vec![Table::new("users")
            .with_columns(vec![
                col("id", "integer").not_null(),
                col("email", "varchar(320)"),
                col("active", "boolean").not_null().with_default("true"),
            ])
            .with_primary_key(vec!["id".into()])
            .with_indexes(vec![Index {
                name: "users_email_idx".into(),
                columns: vec!["email".into()],
                unique: true,
            }])]);

        let diff = diff_schemas(&old, &new);
        let altered = &diff.altered_tables[0];
        assert_eq!(altered.name, "users");
        assert_eq!(altered.added_columns.len(), 1);
        assert_eq!(altered.dropped_columns, vec!["note".to_string()]);
        assert_eq!(altered.altered_columns.len(), 1); // email: type + nullability
        assert!(diff.has_destructive_changes()); // dropping `note`

        let sql = diff
            .to_migration(&PostgresDialect, AlterColumnStyle::Standard)
            .to_sql();
        assert!(sql.contains(
            "ALTER TABLE \"users\" ADD COLUMN \"active\" boolean NOT NULL DEFAULT true;"
        ));
        assert!(sql.contains("ALTER TABLE \"users\" DROP COLUMN \"note\";"));
        assert!(sql.contains("ALTER TABLE \"users\" ALTER COLUMN \"email\" TYPE varchar(320);"));
        assert!(sql.contains("ALTER TABLE \"users\" ALTER COLUMN \"email\" DROP NOT NULL;"));
    }

    #[test]
    fn alter_column_mysql_uses_modify_and_backticks() {
        let old = Schema::new(vec![
            Table::new("t").with_columns(vec![col("c", "int").not_null()])
        ]);
        let new = Schema::new(vec![
            Table::new("t").with_columns(vec![col("c", "bigint").with_default("0")])
        ]);
        let diff = diff_schemas(&old, &new);
        let script = diff.to_migration(&MySqlDialect, AlterColumnStyle::MySql);
        // One MODIFY statement carrying the full target definition.
        assert_eq!(script.statements.len(), 1);
        assert_eq!(
            script.statements[0].sql,
            "ALTER TABLE `t` MODIFY COLUMN `c` bigint DEFAULT 0;"
        );
    }

    #[test]
    fn index_add_drop_and_recreate_on_change() {
        let old = Schema::new(vec![Table::new("t").with_indexes(vec![
            Index {
                name: "keep".into(),
                columns: vec!["a".into()],
                unique: false,
            },
            Index {
                name: "gone".into(),
                columns: vec!["b".into()],
                unique: false,
            },
            Index {
                name: "changed".into(),
                columns: vec!["c".into()],
                unique: false,
            },
        ])]);
        let new = Schema::new(vec![Table::new("t").with_indexes(vec![
            Index {
                name: "keep".into(),
                columns: vec!["a".into()],
                unique: false,
            },
            Index {
                name: "changed".into(),
                columns: vec!["c".into(), "d".into()], // now multi-column
                unique: false,
            },
            Index {
                name: "fresh".into(),
                columns: vec!["e".into()],
                unique: true,
            },
        ])]);

        let diff = diff_schemas(&old, &new);
        let altered = &diff.altered_tables[0];
        // `gone` dropped; `changed` recreated (drop + add); `fresh` added.
        assert!(altered.dropped_indexes.contains(&"gone".to_string()));
        assert!(altered.dropped_indexes.contains(&"changed".to_string()));
        assert_eq!(altered.added_indexes.len(), 2); // changed + fresh

        let mysql = diff
            .to_migration(&MySqlDialect, AlterColumnStyle::MySql)
            .to_sql();
        assert!(mysql.contains("DROP INDEX `gone` ON `t`;"));
        assert!(mysql.contains("CREATE INDEX `changed` ON `t` (`c`, `d`);"));
        assert!(mysql.contains("CREATE UNIQUE INDEX `fresh` ON `t` (`e`);"));
    }

    #[test]
    fn summary_reads_clearly() {
        let old = Schema::new(vec![users_v1(), Table::new("temp")]);
        let new = Schema::new(vec![Table::new("users")
            .with_columns(vec![
                col("id", "integer").not_null(),
                col("created", "timestamp"),
            ])
            .with_primary_key(vec!["id".into()])
            .with_indexes(vec![Index {
                name: "users_email_idx".into(),
                columns: vec!["email".into()],
                unique: true,
            }])]);
        let diff = diff_schemas(&old, &new);
        let summary = diff.summary();
        assert!(summary.contains("-1 table(s)")); // temp dropped
        assert!(summary.contains("users"));
    }
}
