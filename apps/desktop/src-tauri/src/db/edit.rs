//! Result-grid write-back: turn the edits the UI collected (cell updates, new
//! rows, deletes) into parameterized SQL so changes are committed safely.
//!
//! Generation is pure and dialect-aware (identifier quoting + placeholder style)
//! so it can be unit-tested without a database; the per-engine modules bind the
//! params and run the statements in a transaction. Rows are identified by a
//! caller-supplied key set (the table's primary key where available); a `NULL`
//! key becomes `IS NULL` so it still matches.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::engine::Wire;

/// One column name paired with its JSON-decoded value.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct CellValue {
    pub column: String,
    pub value: serde_json::Value,
}

/// Set `set` on the row matched by `keys`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct RowUpdate {
    pub keys: Vec<CellValue>,
    pub set: Vec<CellValue>,
}

/// Insert a new row from `values`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct RowInsert {
    pub values: Vec<CellValue>,
}

/// Delete the row matched by `keys`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct RowDelete {
    pub keys: Vec<CellValue>,
}

/// A batch of edits against one table, committed together in a transaction.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct TableEdits {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub schema: Option<String>,
    pub table: String,
    #[serde(default)]
    pub updates: Vec<RowUpdate>,
    #[serde(default)]
    pub inserts: Vec<RowInsert>,
    #[serde(default)]
    pub deletes: Vec<RowDelete>,
}

/// How many rows each kind of edit affected.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct AppliedEdits {
    pub updated: u64,
    pub inserted: u64,
    pub deleted: u64,
}

/// A parameterized statement: `sql` with positional placeholders and the `params`
/// to bind in order. (`NULL` key comparisons are inlined as `IS NULL`, so they do
/// not consume a param.)
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Statement {
    pub sql: String,
    pub params: Vec<serde_json::Value>,
}

/// Statements grouped by kind so the executor can attribute affected-row counts.
/// Deletes run before updates before inserts (the order the UI reasons about a
/// committed grid), all inside one transaction.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Plan {
    pub deletes: Vec<Statement>,
    pub updates: Vec<Statement>,
    pub inserts: Vec<Statement>,
}

use irodori_sql::dialect::{
    MySqlDialect, OracleDialect, PostgresDialect, SqlDialect, SqlServerDialect, SqliteDialect,
};

fn get_dialect(wire: Wire) -> Box<dyn SqlDialect> {
    match wire {
        Wire::Postgres => Box::new(PostgresDialect),
        Wire::Mysql => Box::new(MySqlDialect),
        Wire::Sqlite => Box::new(SqliteDialect),
        Wire::SqlServer => Box::new(SqlServerDialect),
        Wire::Oracle => Box::new(OracleDialect),
        _ => Box::new(PostgresDialect),
    }
}

/// Build the parameterized statements for a batch of edits.
pub(crate) fn plan(wire: Wire, edits: &TableEdits) -> Result<Plan, String> {
    if edits.table.trim().is_empty() {
        return Err("no target table for edits".to_string());
    }
    let dialect = get_dialect(wire);
    let target = qualified(&*dialect, edits.schema.as_deref(), &edits.table);
    Ok(Plan {
        deletes: edits
            .deletes
            .iter()
            .map(|d| build_delete(&*dialect, &target, d))
            .collect::<Result<_, _>>()?,
        updates: edits
            .updates
            .iter()
            .map(|u| build_update(&*dialect, &target, u))
            .collect::<Result<_, _>>()?,
        inserts: edits
            .inserts
            .iter()
            .map(|i| build_insert(&*dialect, &target, i))
            .collect::<Result<_, _>>()?,
    })
}

fn build_update(
    dialect: &dyn SqlDialect,
    target: &str,
    update: &RowUpdate,
) -> Result<Statement, String> {
    if update.set.is_empty() {
        return Err("update has no columns to set".to_string());
    }
    if update.keys.is_empty() {
        return Err("update has no key columns (would touch every row)".to_string());
    }
    let mut params = Vec::new();
    let mut next = 1;
    let set = update
        .set
        .iter()
        .map(|cell| {
            params.push(cell.value.clone());
            let ph = dialect.placeholder(next);
            next += 1;
            format!("{} = {ph}", dialect.quote_identifier(&cell.column))
        })
        .collect::<Vec<_>>()
        .join(", ");
    let where_clause = build_where(dialect, &update.keys, &mut params, &mut next);
    Ok(Statement {
        sql: format!("UPDATE {target} SET {set} WHERE {where_clause}"),
        params,
    })
}

fn build_delete(
    dialect: &dyn SqlDialect,
    target: &str,
    delete: &RowDelete,
) -> Result<Statement, String> {
    if delete.keys.is_empty() {
        return Err("delete has no key columns (would touch every row)".to_string());
    }
    let mut params = Vec::new();
    let mut next = 1;
    let where_clause = build_where(dialect, &delete.keys, &mut params, &mut next);
    Ok(Statement {
        sql: format!("DELETE FROM {target} WHERE {where_clause}"),
        params,
    })
}

fn build_insert(
    dialect: &dyn SqlDialect,
    target: &str,
    insert: &RowInsert,
) -> Result<Statement, String> {
    if insert.values.is_empty() {
        return Err("insert has no values".to_string());
    }
    let mut params = Vec::new();
    let mut next = 1;
    let columns = insert
        .values
        .iter()
        .map(|cell| dialect.quote_identifier(&cell.column))
        .collect::<Vec<_>>()
        .join(", ");
    let placeholders = insert
        .values
        .iter()
        .map(|cell| {
            params.push(cell.value.clone());
            let ph = dialect.placeholder(next);
            next += 1;
            ph
        })
        .collect::<Vec<_>>()
        .join(", ");
    Ok(Statement {
        sql: format!("INSERT INTO {target} ({columns}) VALUES ({placeholders})"),
        params,
    })
}

/// Build a `key = ? AND ...` clause; a JSON `null` key becomes `key IS NULL` so it
/// still matches and does not consume a placeholder.
fn build_where(
    dialect: &dyn SqlDialect,
    keys: &[CellValue],
    params: &mut Vec<serde_json::Value>,
    next: &mut usize,
) -> String {
    keys.iter()
        .map(|cell| {
            let ident = dialect.quote_identifier(&cell.column);
            if cell.value.is_null() {
                format!("{ident} IS NULL")
            } else {
                params.push(cell.value.clone());
                let ph = dialect.placeholder(*next);
                *next += 1;
                format!("{ident} = {ph}")
            }
        })
        .collect::<Vec<_>>()
        .join(" AND ")
}

fn qualified(dialect: &dyn SqlDialect, schema: Option<&str>, table: &str) -> String {
    match schema.filter(|s| !s.is_empty()) {
        Some(schema) => format!(
            "{}.{}",
            dialect.quote_identifier(schema),
            dialect.quote_identifier(table)
        ),
        None => dialect.quote_identifier(table),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn cell(column: &str, value: serde_json::Value) -> CellValue {
        CellValue {
            column: column.to_string(),
            value,
        }
    }

    #[test]
    fn update_uses_dialect_quoting_and_placeholders() {
        let edits = TableEdits {
            schema: Some("public".into()),
            table: "users".into(),
            updates: vec![RowUpdate {
                set: vec![cell("name", json!("Ann"))],
                keys: vec![cell("id", json!(7))],
            }],
            inserts: vec![],
            deletes: vec![],
        };

        let pg = plan(Wire::Postgres, &edits).unwrap();
        assert_eq!(
            pg.updates[0].sql,
            "UPDATE \"public\".\"users\" SET \"name\" = $1 WHERE \"id\" = $2"
        );
        assert_eq!(pg.updates[0].params, vec![json!("Ann"), json!(7)]);

        let my = plan(Wire::Mysql, &edits).unwrap();
        assert_eq!(
            my.updates[0].sql,
            "UPDATE `public`.`users` SET `name` = ? WHERE `id` = ?"
        );
    }

    #[test]
    fn null_key_becomes_is_null_and_skips_a_param() {
        let edits = TableEdits {
            schema: None,
            table: "t".into(),
            updates: vec![RowUpdate {
                set: vec![cell("a", json!(1))],
                keys: vec![cell("b", serde_json::Value::Null), cell("c", json!(2))],
            }],
            inserts: vec![],
            deletes: vec![],
        };
        let s = plan(Wire::Sqlite, &edits).unwrap();
        assert_eq!(
            s.updates[0].sql,
            "UPDATE \"t\" SET \"a\" = ? WHERE \"b\" IS NULL AND \"c\" = ?"
        );
        // params: the SET value and the non-null key only.
        assert_eq!(s.updates[0].params, vec![json!(1), json!(2)]);
    }

    #[test]
    fn insert_and_delete_shapes() {
        let edits = TableEdits {
            schema: None,
            table: "t".into(),
            updates: vec![],
            inserts: vec![RowInsert {
                values: vec![cell("a", json!(1)), cell("b", json!("x"))],
            }],
            deletes: vec![RowDelete {
                keys: vec![cell("id", json!(9))],
            }],
        };
        let s = plan(Wire::Postgres, &edits).unwrap();
        assert_eq!(s.deletes[0].sql, "DELETE FROM \"t\" WHERE \"id\" = $1");
        assert_eq!(s.deletes[0].params, vec![json!(9)]);
        assert_eq!(
            s.inserts[0].sql,
            "INSERT INTO \"t\" (\"a\", \"b\") VALUES ($1, $2)"
        );
        assert_eq!(s.inserts[0].params, vec![json!(1), json!("x")]);
    }

    #[test]
    fn rejects_unsafe_or_empty_edits() {
        let no_keys = TableEdits {
            schema: None,
            table: "t".into(),
            updates: vec![RowUpdate {
                set: vec![cell("a", json!(1))],
                keys: vec![],
            }],
            inserts: vec![],
            deletes: vec![],
        };
        assert!(plan(Wire::Sqlite, &no_keys).is_err());

        let no_table = TableEdits {
            schema: None,
            table: "  ".into(),
            updates: vec![],
            inserts: vec![],
            deletes: vec![],
        };
        assert!(plan(Wire::Sqlite, &no_table).is_err());
    }
}
