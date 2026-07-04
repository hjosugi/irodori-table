//! Shared schema/object/column/index accumulator for the relational engines.
//!
//! Every SQL engine introspects the same way — list tables and views, then their
//! columns, then their indexes — and finally flattens a `schema -> object` map
//! into [`DatabaseMetadata`]. This builder owns that shape so each engine writes
//! only its catalog queries (a minimal slice of DBeaver's metamodel split).

use std::collections::BTreeMap;

use irodori_completion::inspection::{ColumnInspection, InspectionCard};
use irodori_completion::metadata::MetadataObjectKind as CmpMetadataObjectKind;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{
    DatabaseMetadata, DbObjectMetadata, DbObjectMetadataKind, DbQuickSample, ForeignKey,
    IndexMetadata, SchemaMetadata,
};

pub(crate) use irodori_completion::api_metadata::{
    metadata_to_snapshot as convert_metadata_to_snapshot,
    snapshot_to_metadata as convert_snapshot_to_metadata,
};

#[derive(Default)]
pub(crate) struct MetaBuilder {
    schemas: BTreeMap<String, BTreeMap<String, DbObjectMetadata>>,
}

impl MetaBuilder {
    pub(crate) fn ensure_schema(&mut self, schema: String) {
        self.schemas.entry(schema).or_default();
    }

    /// Register a table or view. Empty names are skipped so a malformed catalog
    /// row cannot create a phantom object.
    pub(crate) fn add_object(&mut self, schema: String, name: String, kind: DbObjectMetadataKind) {
        if name.is_empty() {
            return;
        }
        self.schemas.entry(schema.clone()).or_default().insert(
            name.clone(),
            DbObjectMetadata {
                schema,
                name,
                kind,
                comment: None,
                ddl: None,
                row_estimate: None,
                sample: None,
                columns: Vec::new(),
                indexes: Vec::new(),
                primary_key: Vec::new(),
                foreign_keys: Vec::new(),
            },
        );
    }

    /// Mutable handle to a previously-registered object, for attaching columns or
    /// indexes. `None` if the object was filtered out at the list step (e.g. a
    /// column row referencing a system table we skipped).
    pub(crate) fn object_mut(&mut self, schema: &str, name: &str) -> Option<&mut DbObjectMetadata> {
        self.schemas
            .get_mut(schema)
            .and_then(|objects| objects.get_mut(name))
    }

    /// Every `(schema, object)` pair registered so far — for engines that must
    /// introspect columns/indexes one object at a time (e.g. SQLite pragmas).
    pub(crate) fn object_keys(&self) -> Vec<(String, String)> {
        self.schemas
            .iter()
            .flat_map(|(schema, objects)| {
                objects
                    .keys()
                    .map(move |name| (schema.clone(), name.clone()))
            })
            .collect()
    }

    pub(crate) fn finish(self) -> DatabaseMetadata {
        DatabaseMetadata {
            schemas: self
                .schemas
                .into_iter()
                .map(|(name, objects)| SchemaMetadata {
                    name,
                    objects: objects.into_values().collect(),
                })
                .collect(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct DbCompletionItem {
    pub label: String,
    pub insert_text: String,
    pub kind: DbCompletionItemKind,
    pub detail: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub enum DbCompletionItemKind {
    Schema,
    Table,
    View,
    Column,
    Function,
    Procedure,
    Keyword,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "camelCase")]
#[ts(tag = "type", rename_all = "camelCase")]
pub enum DbInspectionCard {
    Object(DbObjectInspection),
    Column(DbColumnInspection),
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct DbObjectInspection {
    pub schema: String,
    pub name: String,
    pub kind: DbObjectMetadataKind,
    pub comment: Option<String>,
    pub ddl: Option<String>,
    pub row_estimate: Option<u64>,
    pub sample: Option<DbQuickSample>,
    pub columns: Vec<DbColumnInspection>,
    pub indexes: Vec<IndexMetadata>,
    pub foreign_keys: Vec<ForeignKey>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct DbColumnInspection {
    pub schema: String,
    pub object: String,
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub ordinal: u32,
    pub default_value: Option<String>,
    pub comment: Option<String>,
    pub primary_key: bool,
    pub indexes: Vec<String>,
    pub references: Vec<DbColumnReference>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct DbColumnReference {
    pub schema: String,
    pub object: String,
    pub column: String,
}

pub(crate) fn convert_inspection_card(card: InspectionCard) -> DbInspectionCard {
    match card {
        InspectionCard::Object(object) => DbInspectionCard::Object(DbObjectInspection {
            schema: object.schema,
            name: object.name,
            kind: match object.kind {
                CmpMetadataObjectKind::View => DbObjectMetadataKind::View,
                _ => DbObjectMetadataKind::Table,
            },
            comment: object.comment,
            ddl: object.ddl,
            row_estimate: object.row_estimate,
            sample: object.sample.map(|sample| DbQuickSample {
                columns: sample.columns,
                rows: sample.rows,
                truncated: sample.truncated,
            }),
            columns: object
                .columns
                .into_iter()
                .map(convert_column_inspection)
                .collect(),
            indexes: object
                .indexes
                .into_iter()
                .map(|index| IndexMetadata {
                    name: index.name,
                    columns: index.columns,
                    unique: index.unique,
                })
                .collect(),
            foreign_keys: object
                .foreign_keys
                .into_iter()
                .map(|foreign_key| ForeignKey {
                    columns: foreign_key.columns,
                    references_schema: Some(foreign_key.references_schema),
                    references_table: foreign_key.references_object,
                    references_columns: foreign_key.references_columns,
                })
                .collect(),
        }),
        InspectionCard::Column(column) => {
            DbInspectionCard::Column(convert_column_inspection(column))
        }
    }
}

fn convert_column_inspection(column: ColumnInspection) -> DbColumnInspection {
    DbColumnInspection {
        schema: column.schema,
        object: column.object,
        name: column.name,
        data_type: column.data_type,
        nullable: column.nullable,
        ordinal: column.ordinal,
        default_value: column.default_value,
        comment: column.comment,
        primary_key: column.primary_key,
        indexes: column.indexes,
        references: column
            .references
            .into_iter()
            .map(|reference| DbColumnReference {
                schema: reference.schema,
                object: reference.object,
                column: reference.column,
            })
            .collect(),
    }
}
