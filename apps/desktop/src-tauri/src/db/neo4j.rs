//! Neo4j graph database adapter via `neo4rs`.

use std::collections::BTreeMap;

use neo4rs::{query, ConfigBuilder, Graph};
use serde_json::Value;

use super::{
    ColumnMetadata, ConnectionProfile, DatabaseMetadata, DbObjectMetadata, DbObjectMetadataKind,
    RowSet, SchemaMetadata,
};

pub struct Neo4jConn {
    graph: Graph,
    db_name: String,
}

pub async fn connect(profile: &ConnectionProfile) -> Result<Neo4jConn, String> {
    let uri = match &profile.url {
        Some(u) => u.clone(),
        None => {
            let host = profile.host.clone().unwrap_or_else(|| "127.0.0.1".into());
            let port = profile.port.unwrap_or(7687);
            format!("bolt://{host}:{port}")
        }
    };
    let user = profile.user.clone().unwrap_or_else(|| "neo4j".into());
    let password = profile.password.clone().unwrap_or_default();
    let db_name = profile.database.clone().unwrap_or_else(|| "neo4j".into());

    let config = ConfigBuilder::default()
        .uri(&uri)
        .user(&user)
        .password(&password)
        .db(db_name.as_str())
        .build()
        .map_err(|e| format!("failed to build neo4j config: {e}"))?;

    let graph = Graph::connect(config)
        .await
        .map_err(|e| format!("failed to connect to neo4j: {e}"))?;

    Ok(Neo4jConn { graph, db_name })
}

pub async fn version(conn: &Neo4jConn) -> Option<String> {
    // In Neo4j, version can be queried by CALL dbms.components()
    let q = query("CALL dbms.components() YIELD name, versions, edition RETURN name, versions[0] AS version, edition");
    let mut res = conn.graph.execute(q).await.ok()?;
    if let Some(row) = res.next().await.ok().flatten() {
        let version: String = row.get("version").ok()?;
        let edition: String = row.get("edition").ok()?;
        return Some(format!("Neo4j {version} ({edition})"));
    }
    Some("Neo4j".to_string())
}

pub async fn run_query(conn: &Neo4jConn, sql: &str, cap: usize) -> Result<RowSet, String> {
    let mut result = conn
        .graph
        .execute(query(sql))
        .await
        .map_err(|e| format!("Neo4j query execution failed: {e}"))?;

    let mut columns = Vec::new();
    let mut records: Vec<BTreeMap<String, Value>> = Vec::new();
    let mut truncated = false;

    while let Some(row) = result
        .next()
        .await
        .map_err(|e| format!("failed to fetch row: {e}"))?
    {
        if records.len() >= cap {
            truncated = true;
            break;
        }

        let record = row
            .to::<BTreeMap<String, Value>>()
            .map_err(|e| format!("failed to decode neo4j row: {e}"))?;
        for key in record.keys() {
            if !columns.contains(key) {
                columns.push(key.clone());
            }
        }
        records.push(record);
    }

    let rows = records
        .into_iter()
        .map(|record| {
            columns
                .iter()
                .map(|column| record.get(column).cloned().unwrap_or(Value::Null))
                .collect()
        })
        .collect();

    Ok((columns, rows, truncated))
}

pub async fn metadata(conn: &Neo4jConn) -> Result<DatabaseMetadata, String> {
    let mut objects = Vec::new();

    // 1. Fetch Node Labels
    let label_query = query("CALL db.labels() YIELD label RETURN label");
    let mut label_res = conn
        .graph
        .execute(label_query)
        .await
        .map_err(|e| e.to_string())?;
    let mut labels = Vec::new();
    while let Some(row) = label_res.next().await.map_err(|e| e.to_string())? {
        if let Ok(label) = row.get::<String>("label") {
            labels.push(label);
        }
    }

    for label in labels {
        // Sample properties for this label to populate columns
        let prop_sql =
            format!("MATCH (n:`{label}`) UNWIND keys(n) AS key RETURN DISTINCT key LIMIT 100");
        let mut prop_res = conn
            .graph
            .execute(query(&prop_sql))
            .await
            .map_err(|e| e.to_string())?;
        let mut columns = Vec::new();
        let mut idx = 1;
        while let Some(row) = prop_res.next().await.map_err(|e| e.to_string())? {
            if let Ok(key) = row.get::<String>("key") {
                columns.push(ColumnMetadata {
                    name: key,
                    data_type: "property".to_string(),
                    nullable: true,
                    ordinal: idx,
                    default_value: None,
                    comment: None,
                });
                idx += 1;
            }
        }

        objects.push(DbObjectMetadata {
            schema: conn.db_name.clone(),
            name: label,
            kind: DbObjectMetadataKind::Table,
            comment: None,
            ddl: None,
            row_estimate: None,
            sample: None,
            columns,
            indexes: Vec::new(),
            primary_key: Vec::new(),
            foreign_keys: Vec::new(),
        });
    }

    // 2. Fetch Relationship Types
    let rel_query =
        query("CALL db.relationshipTypes() YIELD relationshipType RETURN relationshipType");
    let mut rel_res = conn
        .graph
        .execute(rel_query)
        .await
        .map_err(|e| e.to_string())?;
    let mut rel_types = Vec::new();
    while let Some(row) = rel_res.next().await.map_err(|e| e.to_string())? {
        if let Ok(rel_type) = row.get::<String>("relationshipType") {
            rel_types.push(rel_type);
        }
    }

    for rel_type in rel_types {
        let prop_sql = format!(
            "MATCH ()-[r:`{rel_type}`]->() UNWIND keys(r) AS key RETURN DISTINCT key LIMIT 100"
        );
        let mut prop_res = conn
            .graph
            .execute(query(&prop_sql))
            .await
            .map_err(|e| e.to_string())?;
        let mut columns = Vec::new();
        let mut idx = 1;
        while let Some(row) = prop_res.next().await.map_err(|e| e.to_string())? {
            if let Ok(key) = row.get::<String>("key") {
                columns.push(ColumnMetadata {
                    name: key,
                    data_type: "property".to_string(),
                    nullable: true,
                    ordinal: idx,
                    default_value: None,
                    comment: None,
                });
                idx += 1;
            }
        }

        objects.push(DbObjectMetadata {
            schema: conn.db_name.clone(),
            name: rel_type,
            kind: DbObjectMetadataKind::View,
            comment: None,
            ddl: None,
            row_estimate: None,
            sample: None,
            columns,
            indexes: Vec::new(),
            primary_key: Vec::new(),
            foreign_keys: Vec::new(),
        });
    }

    Ok(DatabaseMetadata {
        schemas: vec![SchemaMetadata {
            name: conn.db_name.clone(),
            objects,
        }],
    })
}
