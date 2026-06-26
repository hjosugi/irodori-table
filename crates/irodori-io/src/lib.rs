//! Tabular import/export primitives and job-driven export helpers.

pub mod export;
mod tabular;

pub use tabular::{
    generate_inserts_from_csv, infer_csv_schema, preview_delimited, preview_json, preview_ndjson,
    Cell, ColumnMapping, DelimitedEncoder, DelimitedImportOptions, DelimitedOptions, ImportColumn,
    ImportPreview, ImportPreviewOptions, InferredColumn, InferredType, JsonEncoder, NdjsonEncoder,
    OwnedCell, QuoteStyle, SqlColumnSpec, SqlInsertEncoder, SqlScriptEncoder, SqlScriptOptions,
    SqlWriteMode, TabularEncoder, UpsertStyle,
};

#[cfg(feature = "avro")]
pub use tabular::AvroEncoder;

#[cfg(feature = "parquet")]
pub use tabular::ParquetEncoder;
