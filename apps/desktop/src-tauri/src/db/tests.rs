use super::*;

#[tokio::test]
async fn with_timeout_passes_through_and_trips() {
    // No limit (None / 0) runs to completion.
    let ok = with_timeout(None, async { Ok::<_, String>(42) }).await;
    assert_eq!(ok, Ok(42));
    let zero = with_timeout(Some(0), async { Ok::<_, String>(7) }).await;
    assert_eq!(zero, Ok(7));

    // A slow future past the deadline returns a clean timeout error.
    let slow = with_timeout(Some(5), async {
        tokio::time::sleep(Duration::from_secs(30)).await;
        Ok::<_, String>(())
    })
    .await;
    assert_eq!(slow, Err("query timed out after 5ms".to_string()));
}

#[tokio::test]
async fn metadata_cache_integration_test() {
    let state = DbState::default();
    let conn_id = "cache_test".to_string();

    // 1. Establish connection to temporary sqlite db
    connect_impl(
        &state,
        &SecurityState::default(),
        temp_sqlite_profile(&conn_id),
    )
    .await
    .expect("connect");

    // Give a tiny yield to let the background refresh finish populating the cache
    tokio::time::sleep(Duration::from_millis(150)).await;

    // Verify snapshot is present in the cache
    {
        let cache = state.metadata_cache.lock().await;
        assert!(cache.snapshot(&conn_id).is_some());
        assert_eq!(cache.list_schemas(&conn_id)[0].name, "main");
    }

    // 2. Clear cache manually and test list_objects_impl fetches blockingly and populates cache
    {
        let mut cache = state.metadata_cache.lock().await;
        cache.invalidate_connection(&conn_id);
        assert!(cache.snapshot(&conn_id).is_none());
    }

    // Call list_objects_impl (which will fetch blockingly and populate)
    let db_meta = list_objects_impl(&state, conn_id.clone())
        .await
        .expect("list objects");
    assert!(!db_meta.schemas.is_empty());

    // Verify cache is populated again
    {
        let cache = state.metadata_cache.lock().await;
        assert!(cache.snapshot(&conn_id).is_some());
    }

    // 3. Test autocomplete on the cached metadata directly via irodori_completion
    {
        // First create a table
        run_query_impl(
            &state,
            conn_id.clone(),
            "create table test_table (id integer primary key, name text)".into(),
            None,
        )
        .await
        .expect("create table");
    }

    // Fetch objects blockingly to warm cache with new table
    list_objects_impl(&state, conn_id.clone())
        .await
        .expect("list objects");

    // Query autocomplete directly on cache
    let cache = state.metadata_cache.lock().await;
    let engine = irodori_completion::CompletionEngine::new();
    let req = irodori_completion::CompletionRequest::new(&conn_id).with_prefix("test");
    let items = engine.complete(&cache, &req);
    assert!(!items.is_empty());
    assert!(items.iter().any(|item| item.label == "test_table"));

    // 4. Test hover inspection card directly on cache
    let card =
        irodori_completion::inspection::inspect_object(&cache, &conn_id, "main", "test_table")
            .expect("card present");
    match card {
        irodori_completion::inspection::InspectionCard::Object(obj) => {
            assert_eq!(obj.name, "test_table");
            assert_eq!(obj.schema, "main");
            assert_eq!(obj.columns.len(), 2);
        }
        _ => panic!("expected object card"),
    }
}

#[test]
fn detects_sql_that_can_change_metadata() {
    assert!(!sql_may_change_metadata(
        "select 'create table fake' as sql_text from users"
    ));
    assert!(!sql_may_change_metadata(
        r#"select "drop" as quoted_identifier from users"#
    ));
    assert!(sql_may_change_metadata(
        "-- migrate\ncreate table users(id integer primary key)"
    ));
    assert!(sql_may_change_metadata(
        "with changed as (select 1) insert into audit_log select * from changed"
    ));
    assert!(sql_may_change_metadata(
        "/* maintenance */ vacuum; analyze users"
    ));
}

#[test]
fn detects_sql_that_can_write_for_read_only_connections() {
    assert!(!sql_may_write(
        "select 'delete from users' as sql_text, $$create table fake$$"
    ));
    assert!(!sql_may_write(
        r#"select "update" as quoted_identifier from users"#
    ));
    assert!(sql_may_write(
        "with changed as (select 1) insert into audit_log select * from changed"
    ));
    assert!(sql_may_write("/* maintenance */ vacuum; analyze users"));
    assert!(sql_may_write("call refresh_rollups()"));
}

#[tokio::test]
async fn read_only_connection_blocks_writes_and_grid_edits() {
    let state = DbState::default();
    let mut profile = temp_sqlite_profile("readonly");
    connect_impl(&state, &SecurityState::default(), profile.clone())
        .await
        .expect("connect writable");
    run_query_impl(
        &state,
        "readonly".into(),
        "create table t(id integer primary key, name text)".into(),
        None,
    )
    .await
    .expect("create");
    disconnect_impl(&state, "readonly".into())
        .await
        .expect("disconnect writable");

    profile.read_only = true;
    connect_impl(&state, &SecurityState::default(), profile)
        .await
        .expect("connect read-only");

    run_query_impl(&state, "readonly".into(), "select 1 as ok".into(), None)
        .await
        .expect("select allowed");

    let err = run_query_impl(
        &state,
        "readonly".into(),
        "insert into t(name) values ('blocked')".into(),
        None,
    )
    .await
    .unwrap_err();
    assert!(err.contains("read-only connection"), "{err}");

    let (tx, _rx) = mpsc::channel(2);
    let err = run_query_stream_impl(
        &state,
        "readonly".into(),
        "delete from t".into(),
        None,
        None,
        None,
        tx,
    )
    .await
    .unwrap_err();
    assert!(err.contains("read-only connection"), "{err}");

    let err = apply_edits_impl(
        &state,
        "readonly".into(),
        TableEdits {
            schema: Some("main".into()),
            table: "t".into(),
            updates: Vec::new(),
            inserts: vec![RowInsert {
                values: vec![CellValue {
                    column: "name".into(),
                    value: serde_json::json!("blocked"),
                }],
            }],
            deletes: Vec::new(),
        },
    )
    .await
    .unwrap_err();
    assert!(err.contains("read-only connection"), "{err}");
}

#[tokio::test]
async fn successful_mutation_refreshes_metadata_without_manual_invalidation() {
    let state = DbState::default();
    let conn_id = "metadata_mutation".to_string();
    connect_impl(
        &state,
        &SecurityState::default(),
        temp_sqlite_profile(&conn_id),
    )
    .await
    .expect("connect");

    list_objects_impl(&state, conn_id.clone())
        .await
        .expect("initial metadata");

    run_query_impl(
        &state,
        conn_id.clone(),
        "create table mutation_visible (id integer primary key, label text)".into(),
        None,
    )
    .await
    .expect("create table");

    let metadata = list_objects_impl(&state, conn_id.clone())
        .await
        .expect("refreshed metadata");
    let objects: Vec<_> = metadata
        .schemas
        .iter()
        .flat_map(|schema| schema.objects.iter().map(|object| object.name.as_str()))
        .collect();
    assert!(
        objects.contains(&"mutation_visible"),
        "expected mutation_visible table in refreshed metadata, got {objects:?}"
    );
}

#[tokio::test]
async fn cancel_signals_a_registered_query_then_is_a_noop() {
    let state = DbState::default();
    let token = CancellationToken::new();
    state
        .cancels
        .lock()
        .await
        .insert("q1".to_string(), token.clone());

    // A run that resolves to the cancel arm once the token fires (mirrors the
    // `select!` in run_query_managed_impl, without needing a live database).
    let run = tokio::spawn(async move {
        tokio::select! {
            biased;
            _ = token.cancelled() => Err::<(), String>("query cancelled".to_string()),
            _ = tokio::time::sleep(Duration::from_secs(30)) => Ok(()),
        }
    });

    assert!(cancel_query_impl(&state, "q1".to_string()).await);
    assert_eq!(run.await.unwrap(), Err("query cancelled".to_string()));
    // The entry is gone, so a second cancel (or an unknown id) is a no-op.
    assert!(!cancel_query_impl(&state, "q1".to_string()).await);
    assert!(!cancel_query_impl(&state, "missing".to_string()).await);
}

#[tokio::test]
async fn stream_delivers_header_then_rows() {
    let state = DbState::default();
    connect_impl(&state, &SecurityState::default(), temp_sqlite_profile("st"))
        .await
        .expect("connect");
    run_query_impl(
        &state,
        "st".into(),
        "create table t(a integer, b text)".into(),
        None,
    )
    .await
    .expect("create");
    run_query_impl(
        &state,
        "st".into(),
        "insert into t(a,b) values (1,'x'),(2,'y'),(3,'z')".into(),
        None,
    )
    .await
    .expect("insert");

    let (tx, mut rx) = mpsc::channel::<stream::FetchEvent>(16);
    let summary = run_query_stream_impl(
        &state,
        "st".into(),
        "select a,b from t order by a".into(),
        None,
        None,
        None,
        tx,
    )
    .await
    .expect("stream");
    assert_eq!(summary.row_count, 3);
    assert!(!summary.truncated);

    let mut columns: Vec<String> = Vec::new();
    let mut rows: Vec<Vec<serde_json::Value>> = Vec::new();
    while let Some(event) = rx.recv().await {
        match event {
            stream::FetchEvent::Columns {
                result_set_index,
                columns: c,
            } => {
                assert_eq!(result_set_index, 0);
                columns = c;
            }
            stream::FetchEvent::Rows {
                result_set_index,
                rows: mut r,
            } => {
                assert_eq!(result_set_index, 0);
                rows.append(&mut r);
            }
        }
    }
    assert_eq!(columns, vec!["a", "b"]);
    assert_eq!(rows.len(), 3);
    assert_eq!(rows[0][0], serde_json::json!(1));
    assert_eq!(rows[2][1], serde_json::json!("z"));
}

#[tokio::test]
async fn stream_caps_rows_and_flags_truncation() {
    let state = DbState::default();
    connect_impl(
        &state,
        &SecurityState::default(),
        temp_sqlite_profile("stcap"),
    )
    .await
    .expect("connect");
    run_query_impl(
        &state,
        "stcap".into(),
        "create table t(a integer)".into(),
        None,
    )
    .await
    .expect("create");
    run_query_impl(
        &state,
        "stcap".into(),
        "insert into t(a) values (1),(2),(3),(4)".into(),
        None,
    )
    .await
    .expect("insert");

    let (tx, mut rx) = mpsc::channel::<stream::FetchEvent>(16);
    let summary = run_query_stream_impl(
        &state,
        "stcap".into(),
        "select a from t order by a".into(),
        Some(2),
        None,
        None,
        tx,
    )
    .await
    .expect("stream");
    assert_eq!(summary.row_count, 2);
    assert!(summary.truncated);

    let mut delivered = 0;
    while let Some(event) = rx.recv().await {
        if let stream::FetchEvent::Rows { rows: r, .. } = event {
            delivered += r.len();
        }
    }
    assert_eq!(delivered, 2);
}

#[test]
fn splits_sql_statements_without_cutting_literals_or_comments() {
    assert_eq!(
        split_sql_statements("select 1; select 2;"),
        vec!["select 1", "select 2"]
    );
    assert_eq!(
        split_sql_statements("select ';'; -- ignored ;\n select 2"),
        vec!["select ';'", "-- ignored ;\n select 2"]
    );
    assert_eq!(
        split_sql_statements(r#"select "semi;colon"; select 2"#),
        vec![r#"select "semi;colon""#, "select 2"]
    );
    assert_eq!(
        split_sql_statements("select /* ; */ 1; select $$;$$"),
        vec!["select /* ; */ 1", "select $$;$$"]
    );
}

#[tokio::test]
async fn sqlite_multi_statement_run_returns_result_sets() {
    let state = DbState::default();
    connect_impl(
        &state,
        &SecurityState::default(),
        temp_sqlite_profile("multi"),
    )
    .await
    .expect("connect");

    let result = run_query_impl(
        &state,
        "multi".into(),
        "select 1 as one; select 'two' as two".into(),
        None,
    )
    .await
    .expect("multi run");

    assert_eq!(result.columns, vec!["one"]);
    assert_eq!(result.rows[0][0], serde_json::json!(1));
    assert_eq!(result.result_sets.len(), 2);
    assert_eq!(result.result_sets[0].statement_index, 0);
    assert_eq!(result.result_sets[0].columns, vec!["one"]);
    assert_eq!(result.result_sets[1].statement_index, 1);
    assert_eq!(result.result_sets[1].columns, vec!["two"]);
    assert_eq!(result.result_sets[1].rows[0][0], serde_json::json!("two"));
}

#[tokio::test]
async fn sqlite_multi_statement_stream_tags_result_set_events() {
    let state = DbState::default();
    connect_impl(
        &state,
        &SecurityState::default(),
        temp_sqlite_profile("multistream"),
    )
    .await
    .expect("connect");

    let (tx, mut rx) = mpsc::channel::<stream::FetchEvent>(16);
    let summary = run_query_stream_impl(
        &state,
        "multistream".into(),
        "select 1 as one; select 2 as two".into(),
        None,
        None,
        None,
        tx,
    )
    .await
    .expect("stream");

    assert_eq!(summary.result_sets.len(), 2);
    assert_eq!(summary.row_count, 2);
    let mut seen = Vec::new();
    while let Some(event) = rx.recv().await {
        match event {
            stream::FetchEvent::Columns {
                result_set_index,
                columns,
            } => seen.push((result_set_index, columns.join(","))),
            stream::FetchEvent::Rows {
                result_set_index,
                rows,
            } => seen.push((result_set_index, rows.len().to_string())),
        }
    }
    assert!(seen.contains(&(0, "one".to_string())));
    assert!(seen.contains(&(0, "1".to_string())));
    assert!(seen.contains(&(1, "two".to_string())));
    assert!(seen.contains(&(1, "1".to_string())));
}

#[tokio::test]
async fn query_parameters_are_detected_bound_and_streamed() {
    let state = DbState::default();
    connect_impl(
        &state,
        &SecurityState::default(),
        temp_sqlite_profile("params"),
    )
    .await
    .expect("connect");
    run_query_impl(
        &state,
        "params".into(),
        "create table t(id integer, name text, active integer)".into(),
        None,
    )
    .await
    .expect("create");
    run_query_impl(
        &state,
        "params".into(),
        "insert into t values (1,'ann',1),(2,'bob',0),(3,'ann',1)".into(),
        None,
    )
    .await
    .expect("insert");

    let sql = "select id from t where name = :name and active = ? order by id";
    let prompts = query_parameter_prompt_set(sql).expect("prompts");
    assert_eq!(prompts.prompts.len(), 2);
    assert_eq!(prompts.prompts[0].id, "name:name");
    assert_eq!(prompts.prompts[1].id, "position:1");

    let params = vec![
        QueryParameterInput {
            key: QueryParameterKey::Name {
                name: "name".into(),
            },
            value: serde_json::json!("ann"),
        },
        QueryParameterInput {
            key: QueryParameterKey::Position { position: 1 },
            value: serde_json::json!(1),
        },
    ];
    let result = run_query_with_params_impl(
        &state,
        "params".into(),
        sql.into(),
        None,
        Some(params.clone()),
    )
    .await
    .expect("parameterized query");
    assert_eq!(result.columns, vec!["id"]);
    assert_eq!(
        result.rows,
        vec![vec![serde_json::json!(1)], vec![serde_json::json!(3)]]
    );

    let (tx, mut rx) = mpsc::channel::<stream::FetchEvent>(16);
    let summary = run_query_stream_with_params_impl(
        &state,
        "params".into(),
        "select name from t where id = :id".into(),
        None,
        None,
        None,
        Some(vec![QueryParameterInput {
            key: QueryParameterKey::Name { name: "id".into() },
            value: serde_json::json!(2),
        }]),
        tx,
    )
    .await
    .expect("parameterized stream");
    assert_eq!(summary.row_count, 1);

    let mut rows = Vec::new();
    while let Some(event) = rx.recv().await {
        if let stream::FetchEvent::Rows { rows: mut r, .. } = event {
            rows.append(&mut r);
        }
    }
    assert_eq!(rows, vec![vec![serde_json::json!("bob")]]);
}

#[tokio::test]
async fn stream_query_stops_on_a_cancelled_token() {
    let state = DbState::default();
    connect_impl(
        &state,
        &SecurityState::default(),
        temp_sqlite_profile("stcancel"),
    )
    .await
    .expect("connect");
    run_query_impl(
        &state,
        "stcancel".into(),
        "create table t(a integer)".into(),
        None,
    )
    .await
    .expect("create");
    run_query_impl(
        &state,
        "stcancel".into(),
        "insert into t(a) values (1),(2),(3)".into(),
        None,
    )
    .await
    .expect("insert");

    let conn = state
        .conns
        .lock()
        .await
        .get("stcancel")
        .cloned()
        .expect("conn");
    let (tx, _rx) = mpsc::channel::<stream::FetchEvent>(16);
    let token = CancellationToken::new();
    token.cancel();
    let ctx = stream::StreamCtx {
        cap: 10,
        batch_rows: STREAM_BATCH_ROWS,
        result_set_index: 0,
        token,
        sink: tx,
    };
    let res = conn.stream_query("select a from t", &ctx).await;
    assert!(
        matches!(&res, Err(m) if m.as_str() == "query cancelled"),
        "got {res:?}"
    );
}

#[tokio::test]
async fn apply_edits_commits_update_insert_delete() {
    let state = DbState::default();
    connect_impl(
        &state,
        &SecurityState::default(),
        temp_sqlite_profile("edit"),
    )
    .await
    .expect("connect");
    run_query_impl(
        &state,
        "edit".into(),
        "create table t(id integer primary key, name text)".into(),
        None,
    )
    .await
    .expect("create");
    run_query_impl(
        &state,
        "edit".into(),
        "insert into t(id,name) values (1,'a'),(2,'b'),(3,'c')".into(),
        None,
    )
    .await
    .expect("insert");

    fn cell(column: &str, value: serde_json::Value) -> CellValue {
        CellValue {
            column: column.to_string(),
            value,
        }
    }
    let edits = TableEdits {
        schema: None,
        table: "t".into(),
        updates: vec![RowUpdate {
            keys: vec![cell("id", serde_json::json!(1))],
            set: vec![cell("name", serde_json::json!("A"))],
        }],
        inserts: vec![RowInsert {
            values: vec![
                cell("id", serde_json::json!(4)),
                cell("name", serde_json::json!("d")),
            ],
        }],
        deletes: vec![RowDelete {
            keys: vec![cell("id", serde_json::json!(2))],
        }],
    };
    let applied = apply_edits_impl(&state, "edit".into(), edits)
        .await
        .expect("apply");
    assert_eq!(applied.updated, 1);
    assert_eq!(applied.inserted, 1);
    assert_eq!(applied.deleted, 1);

    let result = run_query_impl(
        &state,
        "edit".into(),
        "select id,name from t order by id".into(),
        None,
    )
    .await
    .expect("select");
    assert_eq!(result.row_count, 3);
    assert_eq!(
        result.rows[0],
        vec![serde_json::json!(1), serde_json::json!("A")]
    );
    assert_eq!(
        result.rows[1],
        vec![serde_json::json!(3), serde_json::json!("c")]
    );
    assert_eq!(
        result.rows[2],
        vec![serde_json::json!(4), serde_json::json!("d")]
    );
}

#[tokio::test]
async fn metadata_reports_primary_and_foreign_keys() {
    let state = DbState::default();
    connect_impl(
        &state,
        &SecurityState::default(),
        temp_sqlite_profile("keys"),
    )
    .await
    .expect("connect");
    run_query_impl(
        &state,
        "keys".into(),
        "create table author(id integer primary key, name text)".into(),
        None,
    )
    .await
    .expect("author");
    run_query_impl(
        &state,
        "keys".into(),
        "create table book(id integer primary key, \
             author_id integer references author(id), title text)"
            .into(),
        None,
    )
    .await
    .expect("book");

    let meta = list_objects_impl(&state, "keys".into())
        .await
        .expect("metadata");
    let book = meta
        .schemas
        .iter()
        .flat_map(|schema| &schema.objects)
        .find(|object| object.name == "book")
        .expect("book object");
    assert_eq!(book.primary_key, vec!["id"]);
    assert_eq!(book.foreign_keys.len(), 1);
    assert_eq!(book.foreign_keys[0].columns, vec!["author_id"]);
    assert_eq!(book.foreign_keys[0].references_table, "author");
    assert_eq!(book.foreign_keys[0].references_columns, vec!["id"]);
}

fn temp_sqlite_profile(id: &str) -> ConnectionProfile {
    let mut path = std::env::temp_dir();
    path.push(format!("irodori_dbtest_{id}_{}.sqlite", std::process::id()));
    let _ = std::fs::remove_file(&path);
    ConnectionProfile {
        id: id.to_string(),
        engine: DbEngine::Sqlite,
        host: None,
        port: None,
        user: None,
        password: None,
        database: None,
        socket_path: None,
        url: Some(format!("sqlite://{}?mode=rwc", path.display())),
        transport: None,
        read_only: false,
        options: Default::default(),
    }
}

#[tokio::test]
async fn sqlite_connect_and_query_round_trip() {
    let state = DbState::default();
    let info = connect_impl(&state, &SecurityState::default(), temp_sqlite_profile("rt"))
        .await
        .expect("connect");
    assert_eq!(info.engine, DbEngine::Sqlite);

    run_query_impl(
        &state,
        "rt".into(),
        "create table t(a integer, b text, c real)".into(),
        None,
    )
    .await
    .expect("create table");
    run_query_impl(
        &state,
        "rt".into(),
        "create index t_b_idx on t(b)".into(),
        None,
    )
    .await
    .expect("create index");
    run_query_impl(
        &state,
        "rt".into(),
        "create view t_view as select a,b from t".into(),
        None,
    )
    .await
    .expect("create view");
    run_query_impl(
        &state,
        "rt".into(),
        "insert into t(a,b,c) values (1,'hi',1.5),(2,null,2.5)".into(),
        None,
    )
    .await
    .expect("insert");

    let result = run_query_impl(
        &state,
        "rt".into(),
        "select a,b,c from t order by a".into(),
        None,
    )
    .await
    .expect("select");
    assert_eq!(result.columns, vec!["a", "b", "c"]);
    assert_eq!(result.row_count, 2);
    assert_eq!(result.rows[0][0], serde_json::json!(1));
    assert_eq!(result.rows[0][1], serde_json::json!("hi"));
    assert_eq!(result.rows[1][1], serde_json::Value::Null);

    let metadata = list_objects_impl(&state, "rt".into())
        .await
        .expect("metadata");
    let main = metadata
        .schemas
        .iter()
        .find(|schema| schema.name == "main")
        .expect("main schema");
    let table = main
        .objects
        .iter()
        .find(|object| object.name == "t")
        .expect("table t");
    assert_eq!(table.columns.len(), 3);
    assert!(table.indexes.iter().any(|index| index.name == "t_b_idx"));
    assert!(main.objects.iter().any(|object| object.name == "t_view"));

    disconnect_impl(&state, "rt".into())
        .await
        .expect("disconnect");
}

#[tokio::test]
async fn sqlite_memory_profile_uses_in_memory_database() {
    let state = DbState::default();
    let profile = ConnectionProfile {
        id: "mem".into(),
        engine: DbEngine::Sqlite,
        host: None,
        port: None,
        user: None,
        password: None,
        database: Some(":memory:".into()),
        socket_path: None,
        url: None,
        transport: None,
        read_only: false,
        options: Default::default(),
    };
    connect_impl(&state, &SecurityState::default(), profile)
        .await
        .expect("connect memory");
    run_query_impl(
        &state,
        "mem".into(),
        "create table t(id integer primary key, name text not null)".into(),
        None,
    )
    .await
    .expect("create table");
    run_query_impl(
        &state,
        "mem".into(),
        "insert into t(name) values ('memory')".into(),
        None,
    )
    .await
    .expect("insert");
    let result = run_query_impl(&state, "mem".into(), "select name from t".into(), None)
        .await
        .expect("select");
    assert_eq!(result.rows[0][0], serde_json::json!("memory"));
}

#[tokio::test]
async fn spill_run_keeps_memory_flat_and_pages_deep_rows_from_disk() {
    // EXEC-010 end-to-end: stream a result far larger than the in-memory budget
    // through the disk-offload path against a real SQLite connection, then prove
    // (a) only the resident page streams to the UI, (b) the store retains every
    // row with RAM bounded by the budget, and (c) deep windows page back from
    // disk correctly, including across the RAM/disk seam and at the tail.
    let state = DbState::default();
    let profile = ConnectionProfile {
        id: "spill".into(),
        engine: DbEngine::Sqlite,
        host: None,
        port: None,
        user: None,
        password: None,
        database: Some(":memory:".into()),
        socket_path: None,
        url: None,
        transport: None,
        read_only: false,
        options: Default::default(),
    };
    connect_impl(&state, &SecurityState::default(), profile)
        .await
        .expect("connect memory");

    const TOTAL: u64 = 50_000;
    const BUDGET: usize = 500;
    let config = SpillConfig {
        memory_budget: BUDGET,
        offload_enabled: true,
        max_total_rows: MAX_SPILL_ROWS,
    };
    // A recursive CTE generates TOTAL rows server-side so the stream is real.
    let sql = format!(
            "WITH RECURSIVE seq(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM seq WHERE n + 1 < {TOTAL}) \
             SELECT n, 'row_' || n AS label FROM seq"
        );

    // Drain the UI prefix channel concurrently so the producer never blocks.
    let (ui_tx, mut ui_rx) = mpsc::channel::<stream::FetchEvent>(16);
    let drain = tokio::spawn(async move {
        let mut prefix_rows = 0u64;
        let mut columns: Vec<String> = Vec::new();
        while let Some(event) = ui_rx.recv().await {
            match event {
                stream::FetchEvent::Columns { columns: cols, .. } => columns = cols,
                stream::FetchEvent::Rows { rows, .. } => prefix_rows += rows.len() as u64,
            }
        }
        (columns, prefix_rows)
    });

    let result = run_query_spill_impl(&state, "spill".into(), sql, config, None, None, None, ui_tx)
        .await
        .expect("spill run");
    let (columns, prefix_rows) = drain.await.expect("drain ui channel");

    assert_eq!(
        result.total_rows, TOTAL,
        "the store retains every streamed row"
    );
    assert_eq!(
        result.in_memory_rows, BUDGET as u64,
        "the resident page is exactly the budget"
    );
    assert!(result.spilled, "overflow spilled to disk");
    assert!(!result.truncated);
    assert_eq!(
        prefix_rows, BUDGET as u64,
        "only the resident page is forwarded to the UI"
    );
    assert_eq!(columns, vec!["n".to_string(), "label".to_string()]);

    for &offset in &[0u64, 499, 500, 25_000, 49_995] {
        let page = result_window_impl(&state, result.handle.clone(), offset, 3)
            .await
            .expect("window");
        assert_eq!(page.offset, offset);
        let want = (3u64).min(TOTAL - offset) as usize;
        assert_eq!(page.rows.len(), want, "row count at offset {offset}");
        for (i, row) in page.rows.iter().enumerate() {
            let n = offset + i as u64;
            assert_eq!(row[0], serde_json::json!(n as i64), "n at offset {offset}");
            assert_eq!(
                row[1],
                serde_json::json!(format!("row_{n}")),
                "label at offset {offset}"
            );
        }
    }

    assert!(
        release_result_impl(&state, result.handle.clone()).await,
        "release frees the retained store"
    );
    assert!(
        !release_result_impl(&state, result.handle).await,
        "double release is a no-op"
    );
}

#[tokio::test]
async fn spill_run_offload_disabled_caps_at_budget() {
    // With offload off the disk path is never taken: the result caps at the
    // budget and reports truncation, matching the legacy bounded-memory page.
    let state = DbState::default();
    let profile = ConnectionProfile {
        id: "cap".into(),
        engine: DbEngine::Sqlite,
        host: None,
        port: None,
        user: None,
        password: None,
        database: Some(":memory:".into()),
        socket_path: None,
        url: None,
        transport: None,
        read_only: false,
        options: Default::default(),
    };
    connect_impl(&state, &SecurityState::default(), profile)
        .await
        .expect("connect memory");

    let config = SpillConfig {
        memory_budget: 100,
        offload_enabled: false,
        max_total_rows: MAX_SPILL_ROWS,
    };
    let sql =
        "WITH RECURSIVE seq(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM seq WHERE n + 1 < 5000) \
                   SELECT n FROM seq"
            .to_string();
    let (ui_tx, mut ui_rx) = mpsc::channel::<stream::FetchEvent>(16);
    let drain = tokio::spawn(async move { while ui_rx.recv().await.is_some() {} });
    let result = run_query_spill_impl(&state, "cap".into(), sql, config, None, None, None, ui_tx)
        .await
        .expect("spill run");
    drain.await.expect("drain");
    assert_eq!(result.total_rows, 100, "capped at the budget");
    assert!(!result.spilled, "offload off never creates a temp file");
    assert!(result.truncated);
}

#[tokio::test]
async fn command_boundary_rejects_invalid_inputs() {
    let state = DbState::default();
    let mut invalid = temp_sqlite_profile("invalid");
    invalid.id = "  ".into();
    let err = connect_impl(&state, &SecurityState::default(), invalid)
        .await
        .unwrap_err();
    assert!(err.contains("connection id is required"));

    let missing_host = ConnectionProfile {
        id: "missing-host".into(),
        engine: DbEngine::Postgres,
        host: None,
        port: None,
        user: None,
        password: None,
        database: Some("samples".into()),
        socket_path: None,
        url: None,
        transport: None,
        read_only: false,
        options: Default::default(),
    };
    let err = connect_impl(&state, &SecurityState::default(), missing_host)
        .await
        .unwrap_err();
    assert!(err.contains("host is required"));

    let unsupported = ConnectionProfile {
        id: "pinecone".into(),
        engine: DbEngine::Pinecone,
        host: Some("localhost".into()),
        port: None,
        user: None,
        password: None,
        database: None,
        socket_path: None,
        url: None,
        transport: None,
        read_only: false,
        options: Default::default(),
    };
    let err = connect_impl(&state, &SecurityState::default(), unsupported)
        .await
        .unwrap_err();
    assert!(err.contains("irodori.pinecone"));
    assert!(err.contains("connector extension"));
    assert!(err.contains("data-source-support-status"));
    assert!(!err.contains("core app"));

    let duckdb = ConnectionProfile {
        id: "duckdb-memory".into(),
        engine: DbEngine::DuckDb,
        host: None,
        port: None,
        user: None,
        password: None,
        database: Some(":memory:".into()),
        socket_path: None,
        url: None,
        transport: None,
        read_only: false,
        options: Default::default(),
    };
    let err = connect_impl(&state, &SecurityState::default(), duckdb)
        .await
        .unwrap_err();
    assert!(err.contains("irodori.duckdb"));
    assert!(err.contains("connector extension"));
    assert!(!err.contains("not available in this desktop build"));

    let err = run_query_impl(&state, " ".into(), "select 1".into(), None)
        .await
        .unwrap_err();
    assert!(err.contains("connection id is required"));
}

#[tokio::test]
async fn query_bounds_are_enforced() {
    let state = DbState::default();
    connect_impl(
        &state,
        &SecurityState::default(),
        ConnectionProfile {
            id: "bounds".into(),
            engine: DbEngine::Sqlite,
            host: None,
            port: None,
            user: None,
            password: None,
            database: Some(":memory:".into()),
            socket_path: None,
            url: None,
            transport: None,
            read_only: false,
            options: Default::default(),
        },
    )
    .await
    .expect("connect memory");

    let err = run_query_impl(&state, "bounds".into(), "   ".into(), None)
        .await
        .unwrap_err();
    assert!(err.contains("query is empty"));

    let err = run_query_impl(&state, "bounds".into(), "select 1".into(), Some(0))
        .await
        .unwrap_err();
    assert!(err.contains("maxRows must be at least 1"));

    let err = run_query_impl(
        &state,
        "bounds".into(),
        "select 1".into(),
        Some(MAX_RESULT_ROWS + 1),
    )
    .await
    .unwrap_err();
    assert!(err.contains("maxRows must be at most"));

    run_query_impl(
        &state,
        "bounds".into(),
        "create table t(id integer)".into(),
        None,
    )
    .await
    .expect("create");
    run_query_impl(
        &state,
        "bounds".into(),
        "insert into t values (1),(2)".into(),
        None,
    )
    .await
    .expect("insert");
    let result = run_query_impl(
        &state,
        "bounds".into(),
        "select id from t order by id".into(),
        Some(1),
    )
    .await
    .expect("bounded select");
    assert_eq!(result.row_count, 1);
    assert!(result.truncated);
    assert_eq!(result.message.as_deref(), Some("result capped at 1 rows"));
}

#[tokio::test]
async fn reconnect_replaces_existing_connection() {
    let state = DbState::default();
    let profile = ConnectionProfile {
        id: "replace".into(),
        engine: DbEngine::Sqlite,
        host: None,
        port: None,
        user: None,
        password: None,
        database: Some(":memory:".into()),
        socket_path: None,
        url: None,
        transport: None,
        read_only: false,
        options: Default::default(),
    };
    connect_impl(&state, &SecurityState::default(), profile.clone())
        .await
        .expect("connect memory");
    run_query_impl(
        &state,
        "replace".into(),
        "create table t(id integer)".into(),
        None,
    )
    .await
    .expect("create");

    connect_impl(&state, &SecurityState::default(), profile)
        .await
        .expect("reconnect memory");
    let err = run_query_impl(&state, "replace".into(), "select * from t".into(), None)
        .await
        .unwrap_err();
    assert!(
        err.to_ascii_lowercase().contains("no such table"),
        "unexpected error: {err}"
    );
}

#[test]
fn secret_redaction_handles_urls_and_connection_strings() {
    let profile = ConnectionProfile {
        id: "redact".into(),
        engine: DbEngine::Postgres,
        host: None,
        port: None,
        user: Some("user".into()),
        password: Some("secret".into()),
        database: None,
        socket_path: None,
        url: Some("postgres://user:secret@localhost/samples".into()),
        transport: None,
        read_only: false,
        options: Default::default(),
    };
    let message = "connect failed for postgres://user:secret@localhost/samples; Password=secret; PWD=other; token=abc&secret=def api_key=ghi";
    let redacted = redact_secret_text(message, &profile);
    assert!(!redacted.contains("user:secret"), "{redacted}");
    assert!(!redacted.contains("Password=secret"), "{redacted}");
    assert!(!redacted.contains("other"), "{redacted}");
    assert!(!redacted.contains("abc"), "{redacted}");
    assert!(!redacted.contains("def"), "{redacted}");
    assert!(!redacted.contains("ghi"), "{redacted}");
    assert!(redacted.contains("postgres://user:****@localhost/samples"));
    assert!(redacted.contains("Password=****;"));
    assert!(redacted.contains("PWD=****;"));
    assert!(redacted.contains("token=****&"));
    assert!(redacted.contains("api_key=****"));
}
