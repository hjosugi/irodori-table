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
