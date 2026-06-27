//! GEN-010 — the schema shape the generator consumes.
//!
//! Deliberately decoupled from any particular metadata source: the desktop layer
//! converts whatever it has (the completion metadata cache) into a [`GenSchema`].
//! [`SchemaIndex`] is the case-insensitive lookup used by validation to prove that
//! every generated identifier exists.

use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RelationKind {
    Table,
    View,
}

#[derive(Debug, Clone)]
pub struct GenColumn {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
}

impl GenColumn {
    pub fn new(name: impl Into<String>, data_type: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            data_type: data_type.into(),
            nullable: true,
        }
    }
}

/// A foreign key from this table's `columns` to `ref_table`.`ref_columns`.
#[derive(Debug, Clone)]
pub struct GenForeignKey {
    pub columns: Vec<String>,
    pub ref_schema: Option<String>,
    pub ref_table: String,
    pub ref_columns: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct GenTable {
    pub schema: Option<String>,
    pub name: String,
    pub kind: RelationKind,
    pub columns: Vec<GenColumn>,
    pub primary_key: Vec<String>,
    pub foreign_keys: Vec<GenForeignKey>,
}

impl GenTable {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            schema: None,
            name: name.into(),
            kind: RelationKind::Table,
            columns: Vec::new(),
            primary_key: Vec::new(),
            foreign_keys: Vec::new(),
        }
    }

    pub fn with_columns(mut self, columns: Vec<GenColumn>) -> Self {
        self.columns = columns;
        self
    }

    pub fn has_column(&self, name: &str) -> bool {
        self.columns
            .iter()
            .any(|c| c.name.eq_ignore_ascii_case(name))
    }
}

#[derive(Debug, Clone, Default)]
pub struct GenSchema {
    pub default_schema: Option<String>,
    pub tables: Vec<GenTable>,
}

impl GenSchema {
    pub fn new(tables: Vec<GenTable>) -> Self {
        Self {
            default_schema: None,
            tables,
        }
    }
}

/// Case-insensitive lookup over a [`GenSchema`] for validation and planning.
#[derive(Debug, Clone)]
pub struct SchemaIndex {
    tables: Vec<GenTable>,
    by_name: HashMap<String, usize>,
}

impl SchemaIndex {
    pub fn build(schema: &GenSchema) -> Self {
        let tables = schema.tables.clone();
        let mut by_name = HashMap::new();
        for (i, table) in tables.iter().enumerate() {
            // First definition wins so a default-schema table shadows a same-named
            // table in another schema (matches how unqualified names resolve).
            by_name.entry(table.name.to_ascii_lowercase()).or_insert(i);
        }
        Self { tables, by_name }
    }

    pub fn is_empty(&self) -> bool {
        self.tables.is_empty()
    }

    pub fn tables(&self) -> &[GenTable] {
        &self.tables
    }

    /// Resolve a (possibly schema-qualified) object name to a table.
    pub fn table(&self, name: &str) -> Option<&GenTable> {
        let key = name.rsplit('.').next().unwrap_or(name).to_ascii_lowercase();
        self.by_name.get(&key).map(|&i| &self.tables[i])
    }

    /// Tables (by name) among `candidates` that contain `column`.
    pub fn tables_with_column<'a>(
        &self,
        candidates: &'a [&'a GenTable],
        column: &str,
    ) -> Vec<&'a GenTable> {
        candidates
            .iter()
            .copied()
            .filter(|t| t.has_column(column))
            .collect()
    }
}
