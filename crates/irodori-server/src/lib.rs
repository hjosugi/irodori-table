//! Optional local/headless data API runtime.
//!
//! Exposes read and safe-write data operations over HTTP behind the same
//! token-scoped auth, read-only-by-default SQL guard, and audit trail the desktop
//! uses. [`server::ApiServer`] is transport-agnostic and unit-tested; [`server::serve`]
//! is the hyper adapter. A built-in [`source::SqliteDataSource`] makes it runnable
//! standalone; other backends implement [`source::DataSource`].

pub mod audit;
pub mod auth;
pub mod guard;
pub mod model;
pub mod server;
pub mod source;

pub use server::{serve, ApiResponse, ApiServer};
pub use source::{DataError, DataSource, Registry, SqliteDataSource};

pub const CRATE_NAME: &str = "irodori-server";
