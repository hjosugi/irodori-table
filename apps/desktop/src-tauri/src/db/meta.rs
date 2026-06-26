//! Shared schema/object/column/index accumulator for the relational engines.
//!
//! Every SQL engine introspects the same way — list tables and views, then their
//! columns, then their indexes — and finally flattens a `schema -> object` map
//! into [`DatabaseMetadata`]. This builder owns that shape so each engine writes
//! only its catalog queries (a minimal slice of DBeaver's metamodel split).

use std::collections::BTreeMap;

use irodori_completion::inspection::{ColumnInspection, InspectionCard};
use irodori_completion::metadata::{
    ColumnMetadata as CmpColumnMetadata, ForeignKeyMetadata as CmpForeignKeyMetadata,
    IndexMetadata as CmpIndexMetadata, MetadataObjectKind as CmpMetadataObjectKind,
    MetadataSnapshot, ObjectMetadata as CmpObjectMetadata, QuickSample as CmpQuickSample,
    RoutineKind as CmpRoutineKind, RoutineMetadata as CmpRoutineMetadata,
    SchemaMetadata as CmpSchemaMetadata,
};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{
    ColumnMetadata, DatabaseMetadata, DbObjectMetadata, DbObjectMetadataKind, DbQuickSample,
    ForeignKey, IndexMetadata, SchemaMetadata,
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

pub(crate) fn convert_metadata_to_snapshot(
    connection_id: &str,
    db_meta: &DatabaseMetadata,
) -> MetadataSnapshot {
    let mut snapshot = MetadataSnapshot::new(connection_id, 1, std::time::SystemTime::now());
    for schema in &db_meta.schemas {
        let mut cmp_schema = CmpSchemaMetadata::new(&schema.name);
        for object in &schema.objects {
            match object.kind {
                DbObjectMetadataKind::Table | DbObjectMetadataKind::View => {
                    cmp_schema.objects.push(convert_object_to_cmp(object));
                }
                DbObjectMetadataKind::Procedure | DbObjectMetadataKind::Function => {
                    cmp_schema.routines.push(convert_routine_to_cmp(object));
                }
                _ => {}
            }
        }
        snapshot.schemas.push(cmp_schema);
    }
    snapshot
}

pub(crate) fn convert_snapshot_to_metadata(snapshot: &MetadataSnapshot) -> DatabaseMetadata {
    let schemas = snapshot
        .schemas
        .iter()
        .map(|schema| SchemaMetadata {
            name: schema.name.clone(),
            objects: snapshot_schema_objects(schema),
        })
        .collect();
    DatabaseMetadata { schemas }
}

fn convert_object_to_cmp(object: &DbObjectMetadata) -> CmpObjectMetadata {
    let mut cmp_object = if object.kind == DbObjectMetadataKind::View {
        CmpObjectMetadata::view(&object.name)
    } else {
        CmpObjectMetadata::table(&object.name)
    };
    cmp_object.comment = object.comment.clone();
    cmp_object.ddl = object.ddl.clone();
    cmp_object.row_estimate = object.row_estimate;
    cmp_object.sample = object.sample.as_ref().map(|sample| CmpQuickSample {
        columns: sample.columns.clone(),
        rows: sample.rows.clone(),
        truncated: sample.truncated,
    });
    cmp_object
        .columns
        .extend(object.columns.iter().map(convert_column_to_cmp));
    cmp_object
        .indexes
        .extend(object.indexes.iter().map(|index| {
            let mut cmp_index = CmpIndexMetadata::new(&index.name, index.columns.clone());
            cmp_index.unique = index.unique;
            cmp_index.primary = object.primary_key.contains(&index.name)
                || index
                    .columns
                    .iter()
                    .all(|column| object.primary_key.contains(column));
            cmp_index
        }));
    cmp_object
        .foreign_keys
        .extend(object.foreign_keys.iter().map(|foreign_key| {
            CmpForeignKeyMetadata::new(
                foreign_key.columns.clone(),
                foreign_key.references_schema.clone().unwrap_or_default(),
                &foreign_key.references_table,
                foreign_key.references_columns.clone(),
            )
        }));
    cmp_object
}

fn convert_column_to_cmp(column: &ColumnMetadata) -> CmpColumnMetadata {
    let mut cmp_column = CmpColumnMetadata::new(
        &column.name,
        &column.data_type,
        column.nullable,
        column.ordinal as u32,
    );
    cmp_column.default_value = column.default_value.clone();
    cmp_column.comment = column.comment.clone();
    cmp_column
}

fn convert_routine_to_cmp(object: &DbObjectMetadata) -> CmpRoutineMetadata {
    if object.kind == DbObjectMetadataKind::Function {
        CmpRoutineMetadata::new(&object.name, "()")
    } else {
        CmpRoutineMetadata::procedure(&object.name, "()")
    }
}

fn snapshot_schema_objects(schema: &CmpSchemaMetadata) -> Vec<DbObjectMetadata> {
    let mut objects: Vec<_> = schema
        .objects
        .iter()
        .map(|object| snapshot_object(schema, object))
        .collect();
    objects.extend(
        schema
            .routines
            .iter()
            .map(|routine| snapshot_routine(schema, routine)),
    );
    objects
}

fn snapshot_object(schema: &CmpSchemaMetadata, object: &CmpObjectMetadata) -> DbObjectMetadata {
    let kind = match object.kind {
        CmpMetadataObjectKind::View => DbObjectMetadataKind::View,
        _ => DbObjectMetadataKind::Table,
    };
    let indexes: Vec<_> = object
        .indexes
        .iter()
        .map(|index| IndexMetadata {
            name: index.name.clone(),
            columns: index.columns.clone(),
            unique: index.unique,
        })
        .collect();
    let primary_key = object
        .indexes
        .iter()
        .find(|index| index.primary)
        .map(|index| index.columns.clone())
        .unwrap_or_default();
    DbObjectMetadata {
        schema: schema.name.clone(),
        name: object.name.clone(),
        kind,
        comment: object.comment.clone(),
        ddl: object.ddl.clone(),
        row_estimate: object.row_estimate,
        sample: object.sample.as_ref().map(|sample| DbQuickSample {
            columns: sample.columns.clone(),
            rows: sample.rows.clone(),
            truncated: sample.truncated,
        }),
        columns: object
            .columns
            .iter()
            .map(|column| ColumnMetadata {
                name: column.name.clone(),
                data_type: column.data_type.clone(),
                nullable: column.nullable,
                ordinal: column.ordinal as i32,
                default_value: column.default_value.clone(),
                comment: column.comment.clone(),
            })
            .collect(),
        indexes,
        primary_key,
        foreign_keys: object
            .foreign_keys
            .iter()
            .map(|foreign_key| ForeignKey {
                columns: foreign_key.columns.clone(),
                references_schema: Some(foreign_key.references_schema.clone()),
                references_table: foreign_key.references_object.clone(),
                references_columns: foreign_key.references_columns.clone(),
            })
            .collect(),
    }
}

fn snapshot_routine(schema: &CmpSchemaMetadata, routine: &CmpRoutineMetadata) -> DbObjectMetadata {
    let kind = match routine.kind {
        CmpRoutineKind::Function => DbObjectMetadataKind::Function,
        CmpRoutineKind::Procedure => DbObjectMetadataKind::Procedure,
    };
    DbObjectMetadata {
        schema: schema.name.clone(),
        name: routine.name.clone(),
        kind,
        comment: None,
        ddl: None,
        row_estimate: None,
        sample: None,
        columns: Vec::new(),
        indexes: Vec::new(),
        primary_key: Vec::new(),
        foreign_keys: Vec::new(),
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
