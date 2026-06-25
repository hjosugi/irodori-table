//! Optional local/headless data API runtime.

pub mod audit;
pub mod auth;
pub mod guard;
pub mod model;

pub const CRATE_NAME: &str = "irodori-server";

// Dependency smoke check — confirms the offline crate sources are available before
// the full implementation lands. Replaced in the next step.
#[allow(unused_imports)]
mod _dep_check {
    use bytes::Bytes;
    use http_body_util::Full;
    use hyper::Response;
    use serde::Serialize;
    use sqlx::sqlite::SqlitePoolOptions;
    use subtle::ConstantTimeEq;

    #[derive(Serialize)]
    struct Ping {
        ok: bool,
    }

    #[allow(dead_code)]
    async fn _uses(pool_url: &str) -> Result<(), sqlx::Error> {
        let _pool = SqlitePoolOptions::new().connect(pool_url).await?;
        let _ = serde_json::to_string(&Ping { ok: true });
        let _resp: Response<Full<Bytes>> = Response::new(Full::new(Bytes::from_static(b"{}")));
        let _ = 1u8.ct_eq(&1u8);
        Ok(())
    }
}
