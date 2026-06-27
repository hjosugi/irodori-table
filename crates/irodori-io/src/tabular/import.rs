use std::io;

use serde::{Deserialize, Serialize};

use super::OwnedCell;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InferredColumn {
    pub name: String,
    pub data_type: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum InferredType {
    Null,
    Bool,
    Integer,
    Float,
    Text,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ImportColumn {
    pub source_name: String,
    pub target_name: String,
    pub inferred_type: InferredType,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ImportPreview {
    pub columns: Vec<ImportColumn>,
    pub rows: Vec<Vec<OwnedCell>>,
    pub total_rows_seen: usize,
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ColumnMapping {
    pub source_name: String,
    pub target_name: Option<String>,
}

impl ImportPreview {
    pub fn mapped_columns(&self, mapping: &[ColumnMapping]) -> Vec<String> {
        self.columns
            .iter()
            .filter_map(|column| {
                if let Some(item) = mapping
                    .iter()
                    .find(|item| item.source_name == column.source_name)
                {
                    item.target_name.clone()
                } else {
                    Some(column.target_name.clone())
                }
            })
            .collect()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ImportPreviewOptions {
    pub max_rows: usize,
}

impl Default for ImportPreviewOptions {
    fn default() -> Self {
        Self { max_rows: 100 }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DelimitedImportOptions {
    pub delimiter: u8,
    pub quote: u8,
    pub has_header: bool,
    pub null_values: Vec<String>,
    pub preview: ImportPreviewOptions,
}

impl DelimitedImportOptions {
    pub fn csv() -> Self {
        Self {
            delimiter: b',',
            quote: b'"',
            has_header: true,
            null_values: vec![String::new()],
            preview: ImportPreviewOptions::default(),
        }
    }

    pub fn tsv() -> Self {
        Self {
            delimiter: b'\t',
            quote: b'"',
            has_header: true,
            null_values: vec![String::new()],
            preview: ImportPreviewOptions::default(),
        }
    }

    pub fn with_header(mut self, has_header: bool) -> Self {
        self.has_header = has_header;
        self
    }

    pub fn with_max_preview_rows(mut self, max_rows: usize) -> Self {
        self.preview.max_rows = max_rows;
        self
    }
}

pub fn preview_json(input: &str, options: ImportPreviewOptions) -> io::Result<ImportPreview> {
    let value = serde_json::from_str::<serde_json::Value>(input)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    let rows = match value {
        serde_json::Value::Array(rows) => rows,
        serde_json::Value::Object(_) => vec![value],
        _ => {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "JSON import expects an object or array of objects",
            ));
        }
    };
    preview_json_values(rows.into_iter(), options.max_rows)
}

pub fn preview_ndjson(input: &str, options: ImportPreviewOptions) -> io::Result<ImportPreview> {
    let mut values = Vec::new();
    for (line_index, line) in input.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        let value = serde_json::from_str::<serde_json::Value>(line).map_err(|error| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                format!("invalid NDJSON at line {}: {error}", line_index + 1),
            )
        })?;
        values.push(value);
    }
    preview_json_values(values.into_iter(), options.max_rows)
}

pub fn preview_delimited<R: io::Read>(
    reader: R,
    options: DelimitedImportOptions,
) -> io::Result<ImportPreview> {
    let mut rdr = csv::ReaderBuilder::new()
        .delimiter(options.delimiter)
        .quote(options.quote)
        .has_headers(options.has_header)
        .from_reader(reader);

    let headers = if options.has_header {
        rdr.headers()?
            .iter()
            .map(|s| s.to_string())
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };

    let mut record = csv::StringRecord::new();
    let mut rows = Vec::new();
    let mut width = headers.len();
    let mut total_rows_seen = 0;
    while rdr.read_record(&mut record)? {
        if width == 0 {
            width = record.len();
        }
        total_rows_seen += 1;
        if rows.len() < options.preview.max_rows {
            rows.push(
                (0..width)
                    .map(|index| {
                        infer_delimited_cell(
                            record.get(index).unwrap_or_default(),
                            &options.null_values,
                        )
                    })
                    .collect::<Vec<_>>(),
            );
        }
    }

    let headers = if options.has_header {
        headers
    } else {
        (0..width)
            .map(|index| format!("column_{}", index + 1))
            .collect()
    };
    Ok(build_preview(
        headers,
        rows,
        total_rows_seen,
        total_rows_seen > options.preview.max_rows,
    ))
}

pub fn infer_csv_schema<R: io::Read>(
    reader: R,
    delimiter: u8,
    has_header: bool,
) -> io::Result<Vec<InferredColumn>> {
    let mut rdr = csv::ReaderBuilder::new()
        .delimiter(delimiter)
        .has_headers(has_header)
        .from_reader(reader);

    let headers = if has_header {
        rdr.headers()?
            .iter()
            .map(|s| s.to_string())
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };

    let mut record = csv::StringRecord::new();
    let mut sampled_rows = Vec::new();
    let mut num_cols = headers.len();

    while rdr.read_record(&mut record)? {
        if num_cols == 0 {
            num_cols = record.len();
        }
        sampled_rows.push(record.clone());
        if sampled_rows.len() >= 100 {
            break;
        }
    }

    let headers = if has_header {
        headers
    } else {
        (0..num_cols).map(|i| format!("col_{}", i + 1)).collect()
    };

    let mut inferred = Vec::new();
    for col_idx in 0..num_cols {
        let mut is_bool = true;
        let mut is_int = true;
        let mut is_float = true;
        let mut has_vals = false;

        for row in &sampled_rows {
            if let Some(val) = row.get(col_idx) {
                let trimmed = val.trim();
                if trimmed.is_empty() {
                    continue;
                }
                has_vals = true;
                if trimmed.to_lowercase() != "true" && trimmed.to_lowercase() != "false" {
                    is_bool = false;
                }
                if trimmed.parse::<i64>().is_err() {
                    is_int = false;
                }
                if trimmed.parse::<f64>().is_err() {
                    is_float = false;
                }
            }
        }

        let dtype = if !has_vals {
            "text"
        } else if is_bool {
            "boolean"
        } else if is_int {
            "integer"
        } else if is_float {
            "double"
        } else {
            "text"
        };

        inferred.push(InferredColumn {
            name: headers
                .get(col_idx)
                .cloned()
                .unwrap_or_else(|| format!("col_{}", col_idx + 1)),
            data_type: dtype.to_string(),
        });
    }

    Ok(inferred)
}

pub fn generate_inserts_from_csv<R: io::Read, W: io::Write>(
    reader: R,
    delimiter: u8,
    has_header: bool,
    table_name: &str,
    mut sql_writer: W,
    dialect: &dyn irodori_sql::dialect::SqlDialect,
) -> io::Result<usize> {
    let mut rdr = csv::ReaderBuilder::new()
        .delimiter(delimiter)
        .has_headers(has_header)
        .from_reader(reader);

    let headers = if has_header {
        rdr.headers()?
            .iter()
            .map(|s| s.to_string())
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };

    let mut record = csv::StringRecord::new();
    let mut num_cols = headers.len();
    let mut count = 0;

    let quoted_table = dialect.quote_identifier(table_name);

    while rdr.read_record(&mut record)? {
        if num_cols == 0 {
            num_cols = record.len();
        }
        let col_names = if has_header {
            headers.clone()
        } else {
            (0..num_cols).map(|i| format!("col_{}", i + 1)).collect()
        };

        let quoted_cols: Vec<String> = col_names
            .iter()
            .map(|c| dialect.quote_identifier(c))
            .collect();
        let cols_str = quoted_cols.join(", ");

        let mut vals = Vec::new();
        for val in record.iter() {
            let trimmed = val.trim();
            if trimmed.is_empty() || trimmed.to_lowercase() == "null" {
                vals.push("NULL".to_string());
            } else if trimmed.to_lowercase() == "true" {
                vals.push("true".to_string());
            } else if trimmed.to_lowercase() == "false" {
                vals.push("false".to_string());
            } else if trimmed.parse::<i64>().is_ok() || trimmed.parse::<f64>().is_ok() {
                vals.push(trimmed.to_string());
            } else {
                let escaped = trimmed.replace('\'', "''");
                vals.push(format!("'{escaped}'"));
            }
        }
        let vals_str = vals.join(", ");

        writeln!(
            sql_writer,
            "INSERT INTO {} ({}) VALUES ({});",
            quoted_table, cols_str, vals_str
        )?;
        count += 1;
    }

    Ok(count)
}

fn preview_json_values(
    values: impl Iterator<Item = serde_json::Value>,
    max_rows: usize,
) -> io::Result<ImportPreview> {
    let mut headers = Vec::<String>::new();
    let mut rows = Vec::<Vec<(String, OwnedCell)>>::new();
    let mut total_rows_seen = 0;

    for value in values {
        let serde_json::Value::Object(map) = value else {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "JSON import expects only objects as rows",
            ));
        };
        total_rows_seen += 1;
        if total_rows_seen <= max_rows {
            let mut row = Vec::new();
            for (key, value) in map {
                if !headers.iter().any(|existing| existing == &key) {
                    headers.push(key.clone());
                }
                row.push((key, owned_cell_from_json(value)));
            }
            rows.push(row);
        }
    }

    let preview_rows = rows
        .into_iter()
        .map(|row| {
            headers
                .iter()
                .map(|header| {
                    row.iter()
                        .find(|(key, _)| key == header)
                        .map(|(_, value)| value.clone())
                        .unwrap_or(OwnedCell::Null)
                })
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();

    Ok(build_preview(
        headers,
        preview_rows,
        total_rows_seen,
        total_rows_seen > max_rows,
    ))
}

fn build_preview(
    headers: Vec<String>,
    rows: Vec<Vec<OwnedCell>>,
    total_rows_seen: usize,
    truncated: bool,
) -> ImportPreview {
    let columns = headers
        .into_iter()
        .enumerate()
        .map(|(index, source_name)| {
            let inferred_type = infer_column_type(rows.iter().filter_map(|row| row.get(index)));
            ImportColumn {
                target_name: sanitize_column_name(&source_name, index),
                source_name,
                inferred_type,
            }
        })
        .collect();
    ImportPreview {
        columns,
        rows,
        total_rows_seen,
        truncated,
    }
}

fn owned_cell_from_json(value: serde_json::Value) -> OwnedCell {
    match value {
        serde_json::Value::Null => OwnedCell::Null,
        serde_json::Value::Bool(value) => OwnedCell::Bool(value),
        serde_json::Value::Number(value) => {
            if let Some(value) = value.as_i64() {
                OwnedCell::Integer(value)
            } else if let Some(value) = value.as_f64() {
                OwnedCell::Float(value)
            } else {
                OwnedCell::Text(value.to_string())
            }
        }
        serde_json::Value::String(value) => OwnedCell::Text(value),
        serde_json::Value::Array(_) | serde_json::Value::Object(_) => {
            OwnedCell::Text(value.to_string())
        }
    }
}

fn infer_delimited_cell(value: &str, null_values: &[String]) -> OwnedCell {
    if null_values.iter().any(|null_value| null_value == value) {
        return OwnedCell::Null;
    }
    let trimmed = value.trim();
    if trimmed.eq_ignore_ascii_case("true") {
        OwnedCell::Bool(true)
    } else if trimmed.eq_ignore_ascii_case("false") {
        OwnedCell::Bool(false)
    } else if let Ok(value) = trimmed.parse::<i64>() {
        OwnedCell::Integer(value)
    } else if let Ok(value) = trimmed.parse::<f64>() {
        OwnedCell::Float(value)
    } else {
        OwnedCell::Text(value.to_string())
    }
}

fn infer_column_type<'a>(cells: impl Iterator<Item = &'a OwnedCell>) -> InferredType {
    cells.fold(InferredType::Null, |current, cell| {
        merge_types(current, cell_type(cell))
    })
}

fn cell_type(cell: &OwnedCell) -> InferredType {
    match cell {
        OwnedCell::Null => InferredType::Null,
        OwnedCell::Bool(_) => InferredType::Bool,
        OwnedCell::Integer(_) => InferredType::Integer,
        OwnedCell::Float(_) => InferredType::Float,
        OwnedCell::Text(_) => InferredType::Text,
    }
}

fn merge_types(left: InferredType, right: InferredType) -> InferredType {
    match (left, right) {
        (InferredType::Null, other) | (other, InferredType::Null) => other,
        (InferredType::Integer, InferredType::Float)
        | (InferredType::Float, InferredType::Integer) => InferredType::Float,
        (same_left, same_right) if same_left == same_right => same_left,
        _ => InferredType::Text,
    }
}

fn sanitize_column_name(value: &str, index: usize) -> String {
    let mut out = String::new();
    for ch in value.trim().chars() {
        if ch == '_' || ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
        } else if !out.ends_with('_') {
            out.push('_');
        }
    }
    let out = out.trim_matches('_').to_string();
    if out.is_empty() {
        format!("column_{}", index + 1)
    } else if out.chars().next().is_some_and(|ch| ch.is_ascii_digit()) {
        format!("column_{out}")
    } else {
        out
    }
}
