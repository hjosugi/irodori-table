//! Real-database integration tests against the Docker `samples` stack.
//!
//! Skipped unless `IRODORI_PG_URL` / `IRODORI_MYSQL_URL` are set. Bring the stack
//! up and run them with `scripts/dev-db.sh up` then `scripts/dev-db.sh test`.
//!
//! Queries stay within sqlx `Any`'s supported types (int, bigint, text). Rich
//! type coverage (decimal, timestamp, json, bytea) needs the per-engine native
//! pools tracked as EXEC-009/SRC-001 — see docs/implementation-backlog.md.

use desktop_lib::db::{connect_impl, run_query_impl, ConnectionProfile, DbEngine, DbState};

fn url_profile(id: &str, engine: DbEngine, url: String) -> ConnectionProfile {
    ConnectionProfile {
        id: id.to_string(),
        engine,
        host: None,
        port: None,
        user: None,
        password: None,
        database: None,
        url: Some(url),
    }
}

async fn exercise(engine: DbEngine, url: String) {
    let state = DbState::default();
    let info = connect_impl(&state, url_profile("it", engine, url))
        .await
        .expect("connect to sample db");
    assert_eq!(info.engine, engine);
    assert!(!info.server_version.is_empty(), "server version present");
    eprintln!("connected: {engine:?} {}", info.server_version);

    // 4 sample customers are seeded by samples/<engine>/01_samples.sql.
    let count = run_query_impl(
        &state,
        "it".into(),
        "select count(*) as n from customers".into(),
        None,
    )
    .await
    .expect("count customers");
    assert_eq!(count.columns, vec!["n"]);
    let n = count.rows[0][0]
        .as_i64()
        .or_else(|| count.rows[0][0].as_str().and_then(|s| s.parse().ok()));
    assert_eq!(n, Some(4), "expected 4 seeded customers");

    // Join that returns only Any-supported types (text + bigint).
    let join = run_query_impl(
        &state,
        "it".into(),
        "select c.name, count(o.id) as orders from customers c \
         join orders o on o.customer_id = c.id group by c.name order by c.name"
            .into(),
        None,
    )
    .await
    .expect("join query");
    assert_eq!(join.columns, vec!["name", "orders"]);
    assert!(join.row_count >= 1, "join returns rows");

    // Rich types now decode correctly (the sqlx-`Any` gap is closed): a decimal
    // column becomes an exact string and a timestamp a string, instead of erroring.
    let rich = run_query_impl(
        &state,
        "it".into(),
        "select total, created_at from orders order by id limit 1".into(),
        None,
    )
    .await
    .expect("rich types");
    assert_eq!(rich.columns, vec!["total", "created_at"]);
    assert!(
        rich.rows[0][0].is_string(),
        "decimal -> string, got {:?}",
        rich.rows[0][0]
    );
    assert!(
        rich.rows[0][1].is_string(),
        "timestamp -> string, got {:?}",
        rich.rows[0][1]
    );
    eprintln!(
        "rich types: total={} created_at={}",
        rich.rows[0][0], rich.rows[0][1]
    );

    // Postgres-only: a jsonb column round-trips as a JSON object (skipped on MySQL,
    // whose sample `events` table has no payload column).
    if let Ok(j) = run_query_impl(
        &state,
        "it".into(),
        "select payload from events limit 1".into(),
        None,
    )
    .await
    {
        assert!(
            j.rows.is_empty() || j.rows[0][0].is_object(),
            "jsonb -> object, got {:?}",
            j.rows.first()
        );
    }

    // If the bulk `events` table exists (10M rows), a full unbounded scan must
    // stay light: the stream stops at the default page cap instead of buffering
    // every row. This is the anti-"TablePlus eats all memory" guarantee.
    if let Ok(scan) = run_query_impl(
        &state,
        "it".into(),
        "select id, user_id, kind from events".into(),
        None,
    )
    .await
    {
        assert_eq!(scan.row_count, 10_000, "capped at the default page size");
        assert!(scan.truncated, "truncated flag set when more rows remain");
        eprintln!(
            "events full scan capped at {} rows (truncated={}) in {} ms",
            scan.row_count, scan.truncated, scan.elapsed_ms
        );
    }
    // Pools close when `state` drops at end of scope.
}

#[test]
fn postgres_samples() {
    let Ok(url) = std::env::var("IRODORI_PG_URL") else {
        eprintln!("skip: IRODORI_PG_URL not set");
        return;
    };
    tokio::runtime::Runtime::new()
        .unwrap()
        .block_on(exercise(DbEngine::Postgres, url));
}

#[test]
fn mysql_samples() {
    let Ok(url) = std::env::var("IRODORI_MYSQL_URL") else {
        eprintln!("skip: IRODORI_MYSQL_URL not set");
        return;
    };
    tokio::runtime::Runtime::new()
        .unwrap()
        .block_on(exercise(DbEngine::Mysql, url));
}

/// Lighter check (connect + `select 1`) for wire-compatible engines we route
/// through the existing postgres/mysql drivers, no seed required.
async fn connect_only(engine: DbEngine, url: String) {
    let state = DbState::default();
    let info = connect_impl(&state, url_profile("it", engine, url))
        .await
        .expect("connect");
    assert_eq!(info.engine, engine);
    assert!(!info.server_version.is_empty());
    eprintln!("connected: {engine:?} {}", info.server_version);
    let one = run_query_impl(&state, "it".into(), "select 1 as one".into(), None)
        .await
        .expect("select 1");
    assert_eq!(one.columns, vec!["one"]);
}

#[test]
fn cockroachdb_connect() {
    let Ok(url) = std::env::var("IRODORI_CRDB_URL") else {
        eprintln!("skip: IRODORI_CRDB_URL not set");
        return;
    };
    tokio::runtime::Runtime::new()
        .unwrap()
        .block_on(connect_only(DbEngine::CockroachDb, url));
}

#[test]
fn mariadb_connect() {
    let Ok(url) = std::env::var("IRODORI_MARIADB_URL") else {
        eprintln!("skip: IRODORI_MARIADB_URL not set");
        return;
    };
    tokio::runtime::Runtime::new()
        .unwrap()
        .block_on(connect_only(DbEngine::MariaDb, url));
}

/// SQL Server via the pure-Rust tiberius driver. `IRODORI_MSSQL_URL` is an ADO
/// string, e.g. `server=tcp:localhost,11433;User Id=sa;Password=...;TrustServerCertificate=true`.
async fn exercise_mssql(url: String) {
    let state = DbState::default();
    let info = connect_impl(&state, url_profile("it", DbEngine::SqlServer, url))
        .await
        .expect("connect");
    assert_eq!(info.engine, DbEngine::SqlServer);
    assert!(!info.server_version.is_empty());
    eprintln!("connected: SqlServer {}", info.server_version);

    // Self-contained: a VALUES table constructor avoids temp tables (tiberius
    // sends via sp_executesql, which scopes #temp tables away).
    let r = run_query_impl(
        &state,
        "it".into(),
        "select a, b from (values (1, cast('hi' as nvarchar(50))), \
         (2, cast(null as nvarchar(50)))) v(a, b) order by a"
            .into(),
        None,
    )
    .await
    .expect("select");
    assert_eq!(r.columns, vec!["a", "b"]);
    assert_eq!(r.row_count, 2);
    assert_eq!(r.rows[0][0], serde_json::json!(1));
    assert_eq!(r.rows[0][1], serde_json::json!("hi"));
    assert_eq!(r.rows[1][1], serde_json::Value::Null);
}

#[test]
fn sqlserver_samples() {
    let Ok(url) = std::env::var("IRODORI_MSSQL_URL") else {
        eprintln!("skip: IRODORI_MSSQL_URL not set");
        return;
    };
    tokio::runtime::Runtime::new()
        .unwrap()
        .block_on(exercise_mssql(url));
}

// TimescaleDB is Postgres-wire and seeded with the Postgres sample schema.
#[test]
fn timescaledb_samples() {
    let Ok(url) = std::env::var("IRODORI_TIMESCALE_URL") else {
        eprintln!("skip: IRODORI_TIMESCALE_URL not set");
        return;
    };
    tokio::runtime::Runtime::new()
        .unwrap()
        .block_on(exercise(DbEngine::Timescale, url));
}

#[test]
fn yugabytedb_connect() {
    let Ok(url) = std::env::var("IRODORI_YUGABYTE_URL") else {
        eprintln!("skip: IRODORI_YUGABYTE_URL not set");
        return;
    };
    tokio::runtime::Runtime::new()
        .unwrap()
        .block_on(connect_only(DbEngine::YugabyteDb, url));
}

#[test]
fn tidb_connect() {
    let Ok(url) = std::env::var("IRODORI_TIDB_URL") else {
        eprintln!("skip: IRODORI_TIDB_URL not set");
        return;
    };
    tokio::runtime::Runtime::new()
        .unwrap()
        .block_on(connect_only(DbEngine::TiDb, url));
}

/// Embedded DuckDB round trip. Only meaningful with `--features duckdb`; without
/// it, `connect` returns a "not built in" error and the test skips.
async fn exercise_duckdb() {
    let state = DbState::default();
    let profile = url_profile("it", DbEngine::DuckDb, ":memory:".into());
    let info = match connect_impl(&state, profile).await {
        Ok(info) => info,
        Err(e) if e.contains("not built in") => {
            eprintln!("skip: duckdb feature off");
            return;
        }
        Err(e) => panic!("connect: {e}"),
    };
    assert_eq!(info.engine, DbEngine::DuckDb);
    eprintln!("connected: DuckDb {}", info.server_version);

    run_query_impl(
        &state,
        "it".into(),
        "create table t(a integer, b varchar, c double)".into(),
        None,
    )
    .await
    .expect("create");
    run_query_impl(
        &state,
        "it".into(),
        "insert into t values (1,'hi',1.5),(2,null,2.5)".into(),
        None,
    )
    .await
    .expect("insert");
    let r = run_query_impl(&state, "it".into(), "select a,b,c from t order by a".into(), None)
        .await
        .expect("select");
    assert_eq!(r.columns, vec!["a", "b", "c"]);
    assert_eq!(r.row_count, 2);
    assert_eq!(r.rows[0][0], serde_json::json!(1));
    assert_eq!(r.rows[0][1], serde_json::json!("hi"));
    assert_eq!(r.rows[0][2], serde_json::json!(1.5));
    assert_eq!(r.rows[1][1], serde_json::Value::Null);
}

#[test]
fn duckdb_in_memory() {
    tokio::runtime::Runtime::new()
        .unwrap()
        .block_on(exercise_duckdb());
}
