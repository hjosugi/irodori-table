use std::path::Path;
use std::sync::Arc;

use serde::Deserialize;
use serde_json::{Map, Value};

use crate::db::{
    ColumnMetadata, ConnectionProfile, DatabaseMetadata, DbEngine, DbObjectMetadata,
    DbObjectMetadataKind, ForeignKey, IndexMetadata, RowSet, SchemaMetadata,
};

use super::abi::{connector_request, NativeConnector};
use super::InstalledExtension;

#[derive(Clone)]
pub(crate) struct NativeExtensionConnection {
    connector: Arc<NativeConnector>,
    connection_id: String,
    engine: DbEngine,
    server_version: String,
}

impl NativeExtensionConnection {
    pub(crate) fn connect(
        extension: &InstalledExtension,
        profile: &ConnectionProfile,
    ) -> Result<Self, String> {
        let library_path = extension
            .library_path
            .as_deref()
            .ok_or_else(|| format!("extension {} is not a native connector", extension.id))?;
        let engine = extension.engine.as_deref().ok_or_else(|| {
            format!(
                "extension {} does not declare a connector engine",
                extension.id
            )
        })?;
        let connector = NativeConnector::load(Path::new(library_path))?;
        if connector.engine() != engine {
            return Err(format!(
                "installed extension engine mismatch: registry={}, abi={}",
                engine,
                connector.engine()
            ));
        }

        let request = connect_request(profile)?;
        let response = connector.call_ok(request)?;
        let server_version = response
            .get("serverVersion")
            .and_then(Value::as_str)
            .filter(|version| !version.trim().is_empty())
            .unwrap_or_else(|| connector.engine())
            .to_string();

        Ok(Self {
            connector: Arc::new(connector),
            connection_id: profile.id.clone(),
            engine: profile.engine,
            server_version,
        })
    }

    pub(crate) fn engine(&self) -> DbEngine {
        self.engine
    }

    pub(crate) fn server_version(&self) -> &str {
        &self.server_version
    }

    pub(crate) fn run_query(&self, sql: &str, cap: usize) -> Result<RowSet, String> {
        let mut request = request_with_connection("query", &self.connection_id);
        request.insert("sql".to_string(), Value::String(sql.to_string()));
        request.insert(
            "maxRows".to_string(),
            Value::Number(serde_json::Number::from(cap as u64)),
        );
        let response = self.connector.call_ok(Value::Object(request))?;
        row_set_from_response(response)
    }

    pub(crate) fn metadata(&self) -> Result<DatabaseMetadata, String> {
        let response = self
            .connector
            .call_ok(connector_request("metadata", &self.connection_id))?;
        metadata_from_response(response)
    }

    pub(crate) fn close(&self) {
        let _ = self
            .connector
            .call(connector_request("close", &self.connection_id));
    }
}

fn connect_request(profile: &ConnectionProfile) -> Result<Value, String> {
    let profile_value = serde_json::to_value(profile)
        .map_err(|error| format!("failed to encode connector profile: {error}"))?;
    let mut request = match profile_value.as_object() {
        Some(profile) => profile.clone(),
        None => Map::new(),
    };
    request.insert("method".to_string(), Value::String("connect".to_string()));
    request.insert(
        "connectionId".to_string(),
        Value::String(profile.id.clone()),
    );
    request.insert("profile".to_string(), profile_value);
    Ok(Value::Object(request))
}

fn request_with_connection(method: &str, connection_id: &str) -> Map<String, Value> {
    let mut request = Map::new();
    request.insert("method".to_string(), Value::String(method.to_string()));
    request.insert(
        "connectionId".to_string(),
        Value::String(connection_id.to_string()),
    );
    request
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtensionQueryResponse {
    columns: Vec<String>,
    rows: Vec<Vec<Value>>,
    #[serde(default)]
    truncated: bool,
}

fn row_set_from_response(response: Value) -> Result<RowSet, String> {
    let decoded: ExtensionQueryResponse = serde_json::from_value(response)
        .map_err(|error| format!("connector query response is invalid: {error}"))?;
    Ok((decoded.columns, decoded.rows, decoded.truncated))
}

fn metadata_from_response(response: Value) -> Result<DatabaseMetadata, String> {
    let metadata = response
        .get("metadata")
        .cloned()
        .ok_or_else(|| "connector metadata response did not include metadata".to_string())?;
    metadata_from_value(metadata)
}

fn metadata_from_value(metadata: Value) -> Result<DatabaseMetadata, String> {
    let mut decoded: ExtensionDatabaseMetadata = serde_json::from_value(metadata)
        .map_err(|error| format!("connector metadata response is invalid: {error}"))?;
    Ok(decoded.normalize())
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtensionDatabaseMetadata {
    #[serde(default)]
    schemas: Vec<ExtensionSchemaMetadata>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtensionSchemaMetadata {
    name: String,
    #[serde(default)]
    objects: Vec<ExtensionObjectMetadata>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtensionObjectMetadata {
    #[serde(default)]
    schema: Option<String>,
    name: String,
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    comment: Option<String>,
    #[serde(default)]
    ddl: Option<String>,
    #[serde(default)]
    row_estimate: Option<u64>,
    #[serde(default)]
    columns: Vec<ExtensionColumnMetadata>,
    #[serde(default)]
    indexes: Vec<ExtensionIndexMetadata>,
    #[serde(default)]
    primary_key: Vec<String>,
    #[serde(default)]
    foreign_keys: Vec<ExtensionForeignKey>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtensionColumnMetadata {
    name: String,
    #[serde(default)]
    data_type: Option<String>,
    #[serde(default)]
    nullable: Option<bool>,
    #[serde(default)]
    ordinal: Option<i32>,
    #[serde(default)]
    default_value: Option<String>,
    #[serde(default)]
    comment: Option<String>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtensionIndexMetadata {
    name: String,
    #[serde(default)]
    columns: Vec<String>,
    #[serde(default)]
    unique: bool,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtensionForeignKey {
    #[serde(default)]
    columns: Vec<String>,
    #[serde(default)]
    references_schema: Option<String>,
    #[serde(default)]
    references_table: Option<String>,
    #[serde(default)]
    references_columns: Vec<String>,
}

impl ExtensionDatabaseMetadata {
    fn normalize(&mut self) -> DatabaseMetadata {
        DatabaseMetadata {
            schemas: std::mem::take(&mut self.schemas)
                .into_iter()
                .map(ExtensionSchemaMetadata::normalize)
                .collect(),
        }
    }
}

impl ExtensionSchemaMetadata {
    fn normalize(mut self) -> SchemaMetadata {
        let schema_name = self.name.clone();
        SchemaMetadata {
            name: self.name,
            objects: self
                .objects
                .drain(..)
                .map(|object| object.normalize(&schema_name))
                .collect(),
        }
    }
}

impl ExtensionObjectMetadata {
    fn normalize(self, schema_name: &str) -> DbObjectMetadata {
        DbObjectMetadata {
            schema: self.schema.unwrap_or_else(|| schema_name.to_string()),
            name: self.name,
            kind: normalize_object_kind(self.kind.as_deref()),
            comment: self.comment,
            ddl: self.ddl,
            row_estimate: self.row_estimate,
            sample: None,
            columns: self
                .columns
                .into_iter()
                .enumerate()
                .map(|(index, column)| column.normalize(index))
                .collect(),
            indexes: self
                .indexes
                .into_iter()
                .map(ExtensionIndexMetadata::normalize)
                .collect(),
            primary_key: self.primary_key,
            foreign_keys: self
                .foreign_keys
                .into_iter()
                .filter_map(ExtensionForeignKey::normalize)
                .collect(),
        }
    }
}

impl ExtensionColumnMetadata {
    fn normalize(self, index: usize) -> ColumnMetadata {
        ColumnMetadata {
            name: self.name,
            data_type: self.data_type.unwrap_or_else(|| "unknown".to_string()),
            nullable: self.nullable.unwrap_or(true),
            ordinal: self.ordinal.unwrap_or((index + 1) as i32),
            default_value: self.default_value,
            comment: self.comment,
        }
    }
}

impl ExtensionIndexMetadata {
    fn normalize(self) -> IndexMetadata {
        IndexMetadata {
            name: self.name,
            columns: self.columns,
            unique: self.unique,
        }
    }
}

impl ExtensionForeignKey {
    fn normalize(self) -> Option<ForeignKey> {
        Some(ForeignKey {
            columns: self.columns,
            references_schema: self.references_schema,
            references_table: self.references_table?,
            references_columns: self.references_columns,
        })
    }
}

fn normalize_object_kind(kind: Option<&str>) -> DbObjectMetadataKind {
    match kind.unwrap_or("table").to_ascii_lowercase().as_str() {
        "view" => DbObjectMetadataKind::View,
        "index" => DbObjectMetadataKind::Index,
        "procedure" => DbObjectMetadataKind::Procedure,
        "function" => DbObjectMetadataKind::Function,
        _ => DbObjectMetadataKind::Table,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn normalizes_graph_metadata_to_desktop_metadata() {
        let metadata = metadata_from_value(json!({
            "schemas": [{
                "name": "memgraph",
                "objects": [{
                    "name": "Person",
                    "kind": "nodeLabel",
                    "columns": [{"name": "age"}],
                    "indexes": [],
                    "primaryKey": [],
                    "foreignKeys": []
                }]
            }]
        }))
        .unwrap();

        assert_eq!(metadata.schemas[0].name, "memgraph");
        assert_eq!(metadata.schemas[0].objects[0].schema, "memgraph");
        assert_eq!(
            metadata.schemas[0].objects[0].kind,
            DbObjectMetadataKind::Table
        );
        assert_eq!(
            metadata.schemas[0].objects[0].columns[0].data_type,
            "unknown"
        );
        assert_eq!(metadata.schemas[0].objects[0].columns[0].ordinal, 1);
    }

    #[test]
    fn decodes_connector_query_rows() {
        let (columns, rows, truncated) = row_set_from_response(json!({
            "ok": true,
            "columns": ["name"],
            "rows": [["Irodori"]],
            "truncated": true
        }))
        .unwrap();

        assert_eq!(columns, vec!["name"]);
        assert_eq!(rows[0][0], json!("Irodori"));
        assert!(truncated);
    }
}
