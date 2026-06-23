use std::collections::BTreeMap;
use std::time::{Duration, SystemTime};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MetadataCache {
    snapshots: BTreeMap<String, MetadataSnapshot>,
    refresh_requests: Vec<RefreshRequest>,
}

impl Default for MetadataCache {
    fn default() -> Self {
        Self::new()
    }
}

impl MetadataCache {
    pub fn new() -> Self {
        Self {
            snapshots: BTreeMap::new(),
            refresh_requests: Vec::new(),
        }
    }

    pub fn upsert_snapshot(&mut self, snapshot: MetadataSnapshot) {
        self.snapshots
            .insert(snapshot.connection_id.clone(), snapshot);
    }

    pub fn snapshot(&self, connection_id: &str) -> Option<&MetadataSnapshot> {
        self.snapshots.get(connection_id)
    }

    pub fn request_refresh(&mut self, scope: RefreshScope, reason: RefreshReason) {
        let request = RefreshRequest { scope, reason };
        if !self.refresh_requests.contains(&request) {
            self.refresh_requests.push(request);
        }
    }

    pub fn refresh_requests(&self) -> &[RefreshRequest] {
        &self.refresh_requests
    }

    pub fn drain_refresh_requests(&mut self) -> Vec<RefreshRequest> {
        std::mem::take(&mut self.refresh_requests)
    }

    pub fn stale_snapshots(&self, now: SystemTime) -> Vec<RefreshRequest> {
        self.snapshots
            .values()
            .filter(|snapshot| snapshot.is_stale(now))
            .map(|snapshot| RefreshRequest {
                scope: RefreshScope::Connection {
                    connection_id: snapshot.connection_id.clone(),
                },
                reason: RefreshReason::Stale,
            })
            .collect()
    }

    /// Ensure the caller has a usable snapshot and enqueue background refresh
    /// work when the cache is missing or stale.
    ///
    /// Returns `true` when a snapshot exists and can still be used immediately.
    /// Stale snapshots return `true` because completion/hover can continue from
    /// cached metadata while the host refreshes in the background.
    pub fn ensure_fresh(&mut self, connection_id: &str, now: SystemTime) -> bool {
        match self.snapshot(connection_id) {
            None => {
                self.request_refresh(
                    RefreshScope::Connection {
                        connection_id: connection_id.to_string(),
                    },
                    RefreshReason::Missing,
                );
                false
            }
            Some(snapshot) if snapshot.is_stale(now) => {
                self.request_refresh(
                    RefreshScope::Connection {
                        connection_id: connection_id.to_string(),
                    },
                    RefreshReason::Stale,
                );
                true
            }
            Some(_) => true,
        }
    }

    pub fn invalidate_connection(&mut self, connection_id: &str) -> bool {
        let removed = self.snapshots.remove(connection_id).is_some();
        if removed {
            self.request_refresh(
                RefreshScope::Connection {
                    connection_id: connection_id.to_string(),
                },
                RefreshReason::Invalidated,
            );
        }
        removed
    }

    pub fn invalidate_schema(&mut self, connection_id: &str, schema: &str) -> bool {
        let removed = self
            .snapshots
            .get_mut(connection_id)
            .map(|snapshot| snapshot.remove_schema(schema))
            .unwrap_or(false);

        if removed {
            self.request_refresh(
                RefreshScope::Schema {
                    connection_id: connection_id.to_string(),
                    schema: schema.to_string(),
                },
                RefreshReason::Invalidated,
            );
        }

        removed
    }

    pub fn invalidate_object(&mut self, connection_id: &str, schema: &str, object: &str) -> bool {
        let removed = self
            .snapshots
            .get_mut(connection_id)
            .and_then(|snapshot| snapshot.schema_mut(schema))
            .map(|schema| schema.remove_object(object))
            .unwrap_or(false);

        if removed {
            self.request_refresh(
                RefreshScope::Object {
                    connection_id: connection_id.to_string(),
                    schema: schema.to_string(),
                    object: object.to_string(),
                },
                RefreshReason::Invalidated,
            );
        }

        removed
    }

    pub fn list_schemas(&self, connection_id: &str) -> Vec<&SchemaMetadata> {
        self.snapshot(connection_id)
            .map(|snapshot| snapshot.schemas.iter().collect())
            .unwrap_or_default()
    }

    pub fn list_objects(&self, connection_id: &str, schema: &str) -> Vec<&ObjectMetadata> {
        self.lookup_schema(connection_id, schema)
            .map(|schema| schema.objects.iter().collect())
            .unwrap_or_default()
    }

    pub fn list_columns(
        &self,
        connection_id: &str,
        schema: &str,
        object: &str,
    ) -> Vec<&ColumnMetadata> {
        self.lookup_object(connection_id, schema, object)
            .map(|object| object.columns.iter().collect())
            .unwrap_or_default()
    }

    pub fn lookup_schema(&self, connection_id: &str, schema: &str) -> Option<&SchemaMetadata> {
        self.snapshot(connection_id)
            .and_then(|snapshot| snapshot.schema(schema))
    }

    pub fn lookup_object(
        &self,
        connection_id: &str,
        schema: &str,
        object: &str,
    ) -> Option<&ObjectMetadata> {
        self.lookup_schema(connection_id, schema)
            .and_then(|schema| schema.object(object))
    }

    pub fn lookup_column(
        &self,
        connection_id: &str,
        schema: &str,
        object: &str,
        column: &str,
    ) -> Option<&ColumnMetadata> {
        self.lookup_object(connection_id, schema, object)
            .and_then(|object| object.column(column))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MetadataSnapshot {
    pub connection_id: String,
    pub generation: u64,
    pub loaded_at: SystemTime,
    pub stale_after: Duration,
    pub schemas: Vec<SchemaMetadata>,
}

impl MetadataSnapshot {
    pub fn new(connection_id: impl Into<String>, generation: u64, loaded_at: SystemTime) -> Self {
        Self {
            connection_id: connection_id.into(),
            generation,
            loaded_at,
            stale_after: Duration::from_secs(300),
            schemas: Vec::new(),
        }
    }

    pub fn with_stale_after(mut self, stale_after: Duration) -> Self {
        self.stale_after = stale_after;
        self
    }

    pub fn is_stale(&self, now: SystemTime) -> bool {
        now.duration_since(self.loaded_at)
            .map(|age| age >= self.stale_after)
            .unwrap_or(false)
    }

    pub fn schema(&self, name: &str) -> Option<&SchemaMetadata> {
        self.schemas.iter().find(|schema| schema.name == name)
    }

    fn schema_mut(&mut self, name: &str) -> Option<&mut SchemaMetadata> {
        self.schemas.iter_mut().find(|schema| schema.name == name)
    }

    fn remove_schema(&mut self, name: &str) -> bool {
        let before = self.schemas.len();
        self.schemas.retain(|schema| schema.name != name);
        before != self.schemas.len()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SchemaMetadata {
    pub name: String,
    pub permissions: MetadataPermissions,
    pub objects: Vec<ObjectMetadata>,
    pub routines: Vec<RoutineMetadata>,
}

impl SchemaMetadata {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            permissions: MetadataPermissions::readable(),
            objects: Vec::new(),
            routines: Vec::new(),
        }
    }

    pub fn object(&self, name: &str) -> Option<&ObjectMetadata> {
        self.objects.iter().find(|object| object.name == name)
    }

    pub fn routines_named(&self, name: &str) -> Vec<&RoutineMetadata> {
        self.routines
            .iter()
            .filter(|routine| routine.name == name)
            .collect()
    }

    fn remove_object(&mut self, name: &str) -> bool {
        let object_count = self.objects.len();
        let routine_count = self.routines.len();
        self.objects.retain(|object| object.name != name);
        self.routines.retain(|routine| routine.name != name);
        object_count != self.objects.len() || routine_count != self.routines.len()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObjectMetadata {
    pub name: String,
    pub kind: MetadataObjectKind,
    pub permissions: MetadataPermissions,
    pub columns: Vec<ColumnMetadata>,
    pub indexes: Vec<IndexMetadata>,
    pub foreign_keys: Vec<ForeignKeyMetadata>,
}

impl ObjectMetadata {
    pub fn table(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            kind: MetadataObjectKind::Table,
            permissions: MetadataPermissions::readable(),
            columns: Vec::new(),
            indexes: Vec::new(),
            foreign_keys: Vec::new(),
        }
    }

    pub fn view(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            kind: MetadataObjectKind::View,
            permissions: MetadataPermissions::readable(),
            columns: Vec::new(),
            indexes: Vec::new(),
            foreign_keys: Vec::new(),
        }
    }

    pub fn column(&self, name: &str) -> Option<&ColumnMetadata> {
        self.columns.iter().find(|column| column.name == name)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MetadataObjectKind {
    Table,
    View,
    MaterializedView,
    Collection,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ColumnMetadata {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub ordinal: u32,
    pub permissions: MetadataPermissions,
}

impl ColumnMetadata {
    pub fn new(
        name: impl Into<String>,
        data_type: impl Into<String>,
        nullable: bool,
        ordinal: u32,
    ) -> Self {
        Self {
            name: name.into(),
            data_type: data_type.into(),
            nullable,
            ordinal,
            permissions: MetadataPermissions::readable(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IndexMetadata {
    pub name: String,
    pub columns: Vec<String>,
    pub unique: bool,
    pub primary: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ForeignKeyMetadata {
    pub columns: Vec<String>,
    pub references_schema: String,
    pub references_object: String,
    pub references_columns: Vec<String>,
}

impl ForeignKeyMetadata {
    pub fn new(
        columns: Vec<String>,
        references_schema: impl Into<String>,
        references_object: impl Into<String>,
        references_columns: Vec<String>,
    ) -> Self {
        Self {
            columns,
            references_schema: references_schema.into(),
            references_object: references_object.into(),
            references_columns,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RoutineKind {
    Function,
    Procedure,
}

impl IndexMetadata {
    pub fn new(name: impl Into<String>, columns: Vec<String>) -> Self {
        Self {
            name: name.into(),
            columns,
            unique: false,
            primary: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoutineMetadata {
    pub name: String,
    pub kind: RoutineKind,
    pub signature: String,
    pub return_type: Option<String>,
    pub permissions: MetadataPermissions,
}

impl RoutineMetadata {
    pub fn new(name: impl Into<String>, signature: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            kind: RoutineKind::Function,
            signature: signature.into(),
            return_type: None,
            permissions: MetadataPermissions::readable(),
        }
    }

    pub fn procedure(name: impl Into<String>, signature: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            kind: RoutineKind::Procedure,
            signature: signature.into(),
            return_type: None,
            permissions: MetadataPermissions::readable(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MetadataPermissions {
    pub can_introspect: bool,
    pub can_read: bool,
    pub can_write: bool,
}

impl MetadataPermissions {
    pub fn readable() -> Self {
        Self {
            can_introspect: true,
            can_read: true,
            can_write: false,
        }
    }

    pub fn denied() -> Self {
        Self {
            can_introspect: false,
            can_read: false,
            can_write: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RefreshRequest {
    pub scope: RefreshScope,
    pub reason: RefreshReason,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RefreshScope {
    Connection {
        connection_id: String,
    },
    Schema {
        connection_id: String,
        schema: String,
    },
    Object {
        connection_id: String,
        schema: String,
        object: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RefreshReason {
    Missing,
    Stale,
    Invalidated,
    Manual,
}

#[cfg(test)]
mod tests {
    use super::*;

    const CONN: &str = "conn-1";

    fn sample_snapshot() -> MetadataSnapshot {
        let mut table = ObjectMetadata::table("accounts");
        table
            .columns
            .push(ColumnMetadata::new("id", "integer", false, 1));
        table
            .columns
            .push(ColumnMetadata::new("email", "text", false, 2));
        table.indexes.push(IndexMetadata {
            name: "accounts_pkey".to_string(),
            columns: vec!["id".to_string()],
            unique: true,
            primary: true,
        });

        let mut view = ObjectMetadata::view("active_accounts");
        view.columns
            .push(ColumnMetadata::new("email", "text", false, 1));

        let mut schema = SchemaMetadata::new("public");
        schema.objects.push(table);
        schema.objects.push(view);
        schema
            .routines
            .push(RoutineMetadata::new("normalize_email", "(email text)"));

        let mut snapshot = MetadataSnapshot::new(CONN, 7, SystemTime::UNIX_EPOCH)
            .with_stale_after(Duration::from_secs(30));
        snapshot.schemas.push(schema);
        snapshot
    }

    #[test]
    fn snapshot_round_trips_through_cache() {
        let mut cache = MetadataCache::new();
        cache.upsert_snapshot(sample_snapshot());

        let snapshot = cache.snapshot(CONN).expect("snapshot");
        assert_eq!(snapshot.generation, 7);
        assert_eq!(cache.list_schemas(CONN)[0].name, "public");
        assert_eq!(cache.list_objects(CONN, "public").len(), 2);
        assert_eq!(
            cache
                .lookup_column(CONN, "public", "accounts", "email")
                .expect("column")
                .data_type,
            "text"
        );
    }

    #[test]
    fn invalidates_connection_schema_and_object() {
        let mut cache = MetadataCache::new();
        cache.upsert_snapshot(sample_snapshot());

        assert!(cache.invalidate_object(CONN, "public", "accounts"));
        assert!(cache.lookup_object(CONN, "public", "accounts").is_none());
        assert_eq!(
            cache.refresh_requests().last(),
            Some(&RefreshRequest {
                scope: RefreshScope::Object {
                    connection_id: CONN.to_string(),
                    schema: "public".to_string(),
                    object: "accounts".to_string(),
                },
                reason: RefreshReason::Invalidated,
            })
        );

        assert!(cache.invalidate_schema(CONN, "public"));
        assert!(cache.lookup_schema(CONN, "public").is_none());

        cache.upsert_snapshot(sample_snapshot());
        assert!(cache.invalidate_connection(CONN));
        assert!(cache.snapshot(CONN).is_none());
    }

    #[test]
    fn permissions_flags_survive_lookup_and_list() {
        let mut snapshot = sample_snapshot();
        snapshot.schemas[0].permissions = MetadataPermissions::denied();
        snapshot.schemas[0].objects[0].permissions = MetadataPermissions {
            can_introspect: true,
            can_read: true,
            can_write: true,
        };
        snapshot.schemas[0].objects[0].columns[0].permissions = MetadataPermissions {
            can_introspect: true,
            can_read: false,
            can_write: false,
        };

        let mut cache = MetadataCache::new();
        cache.upsert_snapshot(snapshot);

        assert!(!cache.list_schemas(CONN)[0].permissions.can_read);
        assert!(cache.list_objects(CONN, "public")[0].permissions.can_write);
        assert!(
            !cache
                .lookup_column(CONN, "public", "accounts", "id")
                .expect("column")
                .permissions
                .can_read
        );
    }

    #[test]
    fn stale_snapshots_return_refresh_requests() {
        let mut cache = MetadataCache::new();
        cache.upsert_snapshot(sample_snapshot());

        assert!(cache
            .stale_snapshots(SystemTime::UNIX_EPOCH + Duration::from_secs(29))
            .is_empty());

        assert_eq!(
            cache.stale_snapshots(SystemTime::UNIX_EPOCH + Duration::from_secs(30)),
            vec![RefreshRequest {
                scope: RefreshScope::Connection {
                    connection_id: CONN.to_string(),
                },
                reason: RefreshReason::Stale,
            }]
        );
    }

    #[test]
    fn ensure_fresh_queues_missing_and_stale_refresh_once() {
        let mut cache = MetadataCache::new();

        assert!(!cache.ensure_fresh(CONN, SystemTime::UNIX_EPOCH));
        assert!(!cache.ensure_fresh(CONN, SystemTime::UNIX_EPOCH));
        assert_eq!(
            cache.refresh_requests(),
            &[RefreshRequest {
                scope: RefreshScope::Connection {
                    connection_id: CONN.to_string(),
                },
                reason: RefreshReason::Missing,
            }]
        );

        cache.upsert_snapshot(sample_snapshot());
        assert!(cache.ensure_fresh(CONN, SystemTime::UNIX_EPOCH + Duration::from_secs(30)));
        assert!(cache.refresh_requests().contains(&RefreshRequest {
            scope: RefreshScope::Connection {
                connection_id: CONN.to_string(),
            },
            reason: RefreshReason::Stale,
        }));
    }
}
