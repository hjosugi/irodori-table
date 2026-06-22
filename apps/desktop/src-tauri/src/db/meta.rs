//! Shared schema/object/column/index accumulator for the relational engines.
//!
//! Every SQL engine introspects the same way — list tables and views, then their
//! columns, then their indexes — and finally flattens a `schema -> object` map
//! into [`DatabaseMetadata`]. This builder owns that shape so each engine writes
//! only its catalog queries (a minimal slice of DBeaver's metamodel split).

use std::collections::BTreeMap;

use super::{DatabaseMetadata, DbObjectMetadata, DbObjectMetadataKind, SchemaMetadata};

#[derive(Default)]
pub(crate) struct MetaBuilder {
    schemas: BTreeMap<String, BTreeMap<String, DbObjectMetadata>>,
}

impl MetaBuilder {
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
                columns: Vec::new(),
                indexes: Vec::new(),
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
