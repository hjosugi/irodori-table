# Wasm SQL Dialect Skeleton

This template is dual-licensed as `MIT OR 0BSD`.

It reserves the Rust/Wasm path for high-performance dialect work such as parsers,
formatters, completion enrichers, and renderers. The host ABI is still marked
`irodori-sql-dialect-v0`, so keep logic isolated from the exported ABI shim while
the desktop extension host stabilizes.
