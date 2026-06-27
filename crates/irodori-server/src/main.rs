//! Standalone runner for the local data API.
//!
//! Configured via environment variables:
//! - `IRODORI_SERVER_ADDR`     bind address (default `127.0.0.1:8787`)
//! - `IRODORI_SERVER_SQLITE`   SQLite path to serve (`:memory:` or a file path)
//! - `IRODORI_SERVER_TOKEN`    bearer token granting read+write; unset = open read-only mode (localhost/dev)
//! - `IRODORI_SERVER_WRITABLE` `1`/`true` to allow writes against the source

use std::net::SocketAddr;
use std::sync::Arc;

use irodori_server::auth::{Authenticator, Scope, Token};
use irodori_server::{serve, ApiServer, Registry, SqliteDataSource};

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("irodori-server: {error}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let addr: SocketAddr = std::env::var("IRODORI_SERVER_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:8787".to_string())
        .parse()?;
    let sqlite_path =
        std::env::var("IRODORI_SERVER_SQLITE").unwrap_or_else(|_| ":memory:".to_string());
    let writable = matches!(
        std::env::var("IRODORI_SERVER_WRITABLE").as_deref(),
        Ok("1") | Ok("true") | Ok("TRUE")
    );

    let source = SqliteDataSource::open(&sqlite_path, !writable)?;
    let registry = Registry::new().with("default", Arc::new(source));

    let auth = match std::env::var("IRODORI_SERVER_TOKEN") {
        Ok(token) if !token.trim().is_empty() => {
            Authenticator::new(vec![Token::new("default", token, [Scope::Read, Scope::Write])])
        }
        _ => Authenticator::default(), // open, read-only
    };

    let server = Arc::new(ApiServer::new(registry, auth));
    serve(addr, server).await?;
    Ok(())
}
