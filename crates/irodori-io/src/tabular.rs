use serde::{Deserialize, Serialize};
use std::io::{self, Write};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QuoteStyle {
    /// Quote only fields that need it because they contain a delimiter, quote, or
    /// line break.
    Necessary,
    /// Quote every field, including headers and null markers.
    Always,
    /// Never quote fields. Writing a field that needs quoting returns an error.
    Never,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DelimitedOptions {
    pub delimiter: u8,
    pub quote: u8,
    pub include_header: bool,
    pub null_value: String,
    pub line_ending: String,
    pub quote_style: QuoteStyle,
}

impl DelimitedOptions {
    pub fn csv() -> Self {
        Self {
            delimiter: b',',
            quote: b'"',
            include_header: true,
            null_value: String::new(),
            line_ending: "\n".into(),
            quote_style: QuoteStyle::Necessary,
        }
    }

    pub fn tsv() -> Self {
        Self {
            delimiter: b'\t',
            quote: b'"',
            include_header: true,
            null_value: String::new(),
            line_ending: "\n".into(),
            quote_style: QuoteStyle::Necessary,
        }
    }

    pub fn with_header(mut self, include_header: bool) -> Self {
        self.include_header = include_header;
        self
    }

    pub fn with_delimiter(mut self, delimiter: u8) -> Self {
        self.delimiter = delimiter;
        self
    }

    pub fn with_quote(mut self, quote: u8) -> Self {
        self.quote = quote;
        self
    }

    pub fn with_null_value(mut self, null_value: impl Into<String>) -> Self {
        self.null_value = null_value.into();
        self
    }

    pub fn with_quote_style(mut self, quote_style: QuoteStyle) -> Self {
        self.quote_style = quote_style;
        self
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Cell<'a> {
    Null,
    Bool(bool),
    Integer(i64),
    Float(f64),
    Text(&'a str),
    /// A structured value that the caller has already serialized, usually JSON.
    Object(&'a str),
}

impl<'a> Cell<'a> {
    pub fn text(value: &'a str) -> Self {
        Self::Text(value)
    }

    pub fn object(value: &'a str) -> Self {
        Self::Object(value)
    }
}

impl<'a> From<&'a str> for Cell<'a> {
    fn from(value: &'a str) -> Self {
        Self::Text(value)
    }
}

impl From<bool> for Cell<'_> {
    fn from(value: bool) -> Self {
        Self::Bool(value)
    }
}

impl From<i64> for Cell<'_> {
    fn from(value: i64) -> Self {
        Self::Integer(value)
    }
}

impl From<i32> for Cell<'_> {
    fn from(value: i32) -> Self {
        Self::Integer(value.into())
    }
}

impl From<f64> for Cell<'_> {
    fn from(value: f64) -> Self {
        Self::Float(value)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum OwnedCell {
    Null,
    Bool(bool),
    Integer(i64),
    Float(f64),
    Text(String),
}

impl<'a> Cell<'a> {
    pub fn to_owned(&self) -> OwnedCell {
        match self {
            Cell::Null => OwnedCell::Null,
            Cell::Bool(b) => OwnedCell::Bool(*b),
            Cell::Integer(i) => OwnedCell::Integer(*i),
            Cell::Float(f) => OwnedCell::Float(*f),
            Cell::Text(s) | Cell::Object(s) => OwnedCell::Text(s.to_string()),
        }
    }
}

pub trait TabularEncoder {
    fn write_row(&mut self, row: &[Cell<'_>]) -> io::Result<()>;
    fn finish(&mut self) -> io::Result<()>;
}

pub struct DelimitedEncoder<W> {
    writer: W,
    options: DelimitedOptions,
}

impl<W: Write> DelimitedEncoder<W> {
    pub fn csv<S: AsRef<str>>(writer: W, columns: &[S]) -> io::Result<Self> {
        Self::new(writer, columns, DelimitedOptions::csv())
    }

    pub fn tsv<S: AsRef<str>>(writer: W, columns: &[S]) -> io::Result<Self> {
        Self::new(writer, columns, DelimitedOptions::tsv())
    }

    pub fn new<S: AsRef<str>>(
        writer: W,
        columns: &[S],
        options: DelimitedOptions,
    ) -> io::Result<Self> {
        validate_options(&options)?;
        let mut encoder = Self { writer, options };
        if encoder.options.include_header {
            encoder.write_fields(columns.iter().map(AsRef::as_ref))?;
        }
        Ok(encoder)
    }

    pub fn into_inner(self) -> W {
        self.writer
    }

    pub fn write_row(&mut self, row: &[Cell<'_>]) -> io::Result<()> {
        for (index, cell) in row.iter().enumerate() {
            if index > 0 {
                self.writer.write_all(&[self.options.delimiter])?;
            }
            match cell {
                Cell::Null => {
                    let null_value = self.options.null_value.clone();
                    self.write_field(&null_value)?;
                }
                Cell::Bool(value) => self.write_field(if *value { "true" } else { "false" })?,
                Cell::Integer(value) => self.write_field(&value.to_string())?,
                Cell::Float(value) => self.write_field(&value.to_string())?,
                Cell::Text(value) | Cell::Object(value) => self.write_field(value)?,
            }
        }
        self.writer.write_all(self.options.line_ending.as_bytes())
    }

    pub fn finish(&mut self) -> io::Result<()> {
        self.writer.flush()
    }

    fn write_fields<'a>(&mut self, fields: impl Iterator<Item = &'a str>) -> io::Result<()> {
        for (index, field) in fields.enumerate() {
            if index > 0 {
                self.writer.write_all(&[self.options.delimiter])?;
            }
            self.write_field(field)?;
        }
        self.writer.write_all(self.options.line_ending.as_bytes())
    }

    fn write_field(&mut self, field: &str) -> io::Result<()> {
        let needs_quote = needs_quote(field, &self.options);
        let quoted = match self.options.quote_style {
            QuoteStyle::Always => true,
            QuoteStyle::Necessary => needs_quote,
            QuoteStyle::Never if needs_quote => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "field requires quoting but quote style is Never",
                ));
            }
            QuoteStyle::Never => false,
        };

        if quoted {
            self.writer.write_all(&[self.options.quote])?;
            for byte in field.as_bytes() {
                if *byte == self.options.quote {
                    self.writer
                        .write_all(&[self.options.quote, self.options.quote])?;
                } else {
                    self.writer.write_all(&[*byte])?;
                }
            }
            self.writer.write_all(&[self.options.quote])
        } else {
            self.writer.write_all(field.as_bytes())
        }
    }
}

impl<W: Write> TabularEncoder for DelimitedEncoder<W> {
    fn write_row(&mut self, row: &[Cell<'_>]) -> io::Result<()> {
        DelimitedEncoder::write_row(self, row)
    }

    fn finish(&mut self) -> io::Result<()> {
        DelimitedEncoder::finish(self)
    }
}

pub struct SqlInsertEncoder<W> {
    writer: W,
    table_name: String,
    columns: Vec<String>,
}

impl<W: Write> SqlInsertEncoder<W> {
    pub fn new(
        writer: W,
        table_name: impl Into<String>,
        columns: &[impl AsRef<str>],
        dialect: &dyn irodori_sql::dialect::SqlDialect,
    ) -> Self {
        let cols = columns
            .iter()
            .map(|c| dialect.quote_identifier(c.as_ref()))
            .collect();
        let quoted_table = dialect.quote_identifier(&table_name.into());
        Self {
            writer,
            table_name: quoted_table,
            columns: cols,
        }
    }

    pub fn write_row(&mut self, row: &[Cell<'_>]) -> io::Result<()> {
        let cols_str = self.columns.join(", ");
        let vals: Vec<String> = row
            .iter()
            .map(|cell| match cell {
                Cell::Null => "NULL".to_string(),
                Cell::Bool(b) => if *b { "true" } else { "false" }.to_string(),
                Cell::Integer(i) => i.to_string(),
                Cell::Float(f) => f.to_string(),
                Cell::Text(t) | Cell::Object(t) => {
                    let escaped = t.replace('\'', "''");
                    format!("'{escaped}'")
                }
            })
            .collect();
        let vals_str = vals.join(", ");
        writeln!(
            self.writer,
            "INSERT INTO {} ({}) VALUES ({});",
            self.table_name, cols_str, vals_str
        )
    }

    pub fn finish(&mut self) -> io::Result<()> {
        self.writer.flush()
    }
}

impl<W: Write> TabularEncoder for SqlInsertEncoder<W> {
    fn write_row(&mut self, row: &[Cell<'_>]) -> io::Result<()> {
        SqlInsertEncoder::write_row(self, row)
    }
    fn finish(&mut self) -> io::Result<()> {
        SqlInsertEncoder::finish(self)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SqlColumnSpec {
    pub name: String,
    pub sql_type: String,
    pub nullable: bool,
}

impl SqlColumnSpec {
    pub fn new(name: impl Into<String>, sql_type: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            sql_type: sql_type.into(),
            nullable: true,
        }
    }

    pub fn not_null(mut self) -> Self {
        self.nullable = false;
        self
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UpsertStyle {
    PostgresOrSqlite,
    MySql,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SqlWriteMode {
    Insert,
    Upsert {
        conflict_columns: Vec<String>,
        update_columns: Vec<String>,
        style: UpsertStyle,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SqlScriptOptions {
    pub batch_size: usize,
    pub mode: SqlWriteMode,
    pub create_table: Option<Vec<SqlColumnSpec>>,
}

impl Default for SqlScriptOptions {
    fn default() -> Self {
        Self {
            batch_size: 1,
            mode: SqlWriteMode::Insert,
            create_table: None,
        }
    }
}

impl SqlScriptOptions {
    pub fn insert() -> Self {
        Self::default()
    }

    pub fn with_batch_size(mut self, batch_size: usize) -> Self {
        self.batch_size = batch_size.max(1);
        self
    }

    pub fn with_create_table(mut self, columns: Vec<SqlColumnSpec>) -> Self {
        self.create_table = Some(columns);
        self
    }

    pub fn upsert(
        conflict_columns: impl IntoIterator<Item = impl Into<String>>,
        update_columns: impl IntoIterator<Item = impl Into<String>>,
        style: UpsertStyle,
    ) -> Self {
        Self {
            mode: SqlWriteMode::Upsert {
                conflict_columns: conflict_columns.into_iter().map(Into::into).collect(),
                update_columns: update_columns.into_iter().map(Into::into).collect(),
                style,
            },
            ..Self::default()
        }
    }
}

pub struct SqlScriptEncoder<'a, W> {
    writer: W,
    table_name: String,
    columns: Vec<String>,
    raw_columns: Vec<String>,
    dialect: &'a dyn irodori_sql::dialect::SqlDialect,
    options: SqlScriptOptions,
    batch: Vec<Vec<String>>,
}

impl<'a, W: Write> SqlScriptEncoder<'a, W> {
    pub fn new<S: AsRef<str>>(
        mut writer: W,
        table_name: impl Into<String>,
        columns: &[S],
        dialect: &'a dyn irodori_sql::dialect::SqlDialect,
        options: SqlScriptOptions,
    ) -> io::Result<Self> {
        let table_name = dialect.quote_identifier(&table_name.into());
        let raw_columns = columns
            .iter()
            .map(|column| column.as_ref().to_string())
            .collect::<Vec<_>>();
        let quoted_columns = raw_columns
            .iter()
            .map(|column| dialect.quote_identifier(column))
            .collect::<Vec<_>>();

        if let Some(schema) = &options.create_table {
            write_create_table(&mut writer, &table_name, schema, dialect)?;
        }

        Ok(Self {
            writer,
            table_name,
            columns: quoted_columns,
            raw_columns,
            dialect,
            options,
            batch: Vec::new(),
        })
    }

    pub fn write_row(&mut self, row: &[Cell<'_>]) -> io::Result<()> {
        self.batch.push(row.iter().map(sql_literal).collect());
        if self.batch.len() >= self.options.batch_size.max(1) {
            self.flush_batch()?;
        }
        Ok(())
    }

    pub fn finish(&mut self) -> io::Result<()> {
        self.flush_batch()?;
        self.writer.flush()
    }

    fn flush_batch(&mut self) -> io::Result<()> {
        if self.batch.is_empty() {
            return Ok(());
        }
        write!(
            self.writer,
            "INSERT INTO {} ({}) VALUES ",
            self.table_name,
            self.columns.join(", ")
        )?;
        for (index, row) in self.batch.iter().enumerate() {
            if index > 0 {
                write!(self.writer, ", ")?;
            }
            write!(self.writer, "({})", row.join(", "))?;
        }
        self.write_upsert_clause()?;
        writeln!(self.writer, ";")?;
        self.batch.clear();
        Ok(())
    }

    fn write_upsert_clause(&mut self) -> io::Result<()> {
        let SqlWriteMode::Upsert {
            conflict_columns,
            update_columns,
            style,
        } = &self.options.mode
        else {
            return Ok(());
        };
        if conflict_columns.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "upsert conflict columns are required",
            ));
        }
        let update_columns = if update_columns.is_empty() {
            self.raw_columns
                .iter()
                .filter(|column| !conflict_columns.iter().any(|key| key == *column))
                .cloned()
                .collect::<Vec<_>>()
        } else {
            update_columns.clone()
        };
        if update_columns.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "upsert update columns are required",
            ));
        }

        match style {
            UpsertStyle::PostgresOrSqlite => {
                let conflicts = conflict_columns
                    .iter()
                    .map(|column| self.dialect.quote_identifier(column))
                    .collect::<Vec<_>>()
                    .join(", ");
                let updates = update_columns
                    .iter()
                    .map(|column| {
                        let quoted = self.dialect.quote_identifier(column);
                        format!("{quoted} = excluded.{quoted}")
                    })
                    .collect::<Vec<_>>()
                    .join(", ");
                write!(
                    self.writer,
                    " ON CONFLICT ({conflicts}) DO UPDATE SET {updates}"
                )?;
            }
            UpsertStyle::MySql => {
                let updates = update_columns
                    .iter()
                    .map(|column| {
                        let quoted = self.dialect.quote_identifier(column);
                        format!("{quoted} = VALUES({quoted})")
                    })
                    .collect::<Vec<_>>()
                    .join(", ");
                write!(self.writer, " ON DUPLICATE KEY UPDATE {updates}")?;
            }
        }
        Ok(())
    }
}

impl<W: Write> TabularEncoder for SqlScriptEncoder<'_, W> {
    fn write_row(&mut self, row: &[Cell<'_>]) -> io::Result<()> {
        SqlScriptEncoder::write_row(self, row)
    }

    fn finish(&mut self) -> io::Result<()> {
        SqlScriptEncoder::finish(self)
    }
}

pub struct JsonEncoder<W> {
    writer: W,
    columns: Vec<String>,
    first: bool,
}

impl<W: Write> JsonEncoder<W> {
    pub fn new<S: AsRef<str>>(mut writer: W, columns: &[S]) -> io::Result<Self> {
        writer.write_all(b"[\n")?;
        Ok(Self {
            writer,
            columns: columns.iter().map(|c| c.as_ref().to_string()).collect(),
            first: true,
        })
    }

    pub fn write_row(&mut self, row: &[Cell<'_>]) -> io::Result<()> {
        if !self.first {
            self.writer.write_all(b",\n")?;
        }
        self.first = false;

        let mut map = serde_json::Map::new();
        for (i, cell) in row.iter().enumerate() {
            let col = self
                .columns
                .get(i)
                .cloned()
                .unwrap_or_else(|| format!("col_{i}"));
            let val = match cell {
                Cell::Null => serde_json::Value::Null,
                Cell::Bool(b) => serde_json::Value::Bool(*b),
                Cell::Integer(i) => serde_json::Value::Number(serde_json::Number::from(*i)),
                Cell::Float(f) => serde_json::Value::Number(
                    serde_json::Number::from_f64(*f).unwrap_or(serde_json::Number::from(0)),
                ),
                Cell::Text(t) => serde_json::Value::String(t.to_string()),
                Cell::Object(o) => {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(o) {
                        v
                    } else {
                        serde_json::Value::String(o.to_string())
                    }
                }
            };
            map.insert(col, val);
        }
        let json_val = serde_json::Value::Object(map);
        serde_json::to_writer(&mut self.writer, &json_val)?;
        Ok(())
    }

    pub fn finish(&mut self) -> io::Result<()> {
        self.writer.write_all(b"\n]\n")?;
        self.writer.flush()
    }
}

impl<W: Write> TabularEncoder for JsonEncoder<W> {
    fn write_row(&mut self, row: &[Cell<'_>]) -> io::Result<()> {
        JsonEncoder::write_row(self, row)
    }
    fn finish(&mut self) -> io::Result<()> {
        JsonEncoder::finish(self)
    }
}

pub struct NdjsonEncoder<W> {
    writer: W,
    columns: Vec<String>,
}

impl<W: Write> NdjsonEncoder<W> {
    pub fn new<S: AsRef<str>>(writer: W, columns: &[S]) -> Self {
        Self {
            writer,
            columns: columns.iter().map(|c| c.as_ref().to_string()).collect(),
        }
    }

    pub fn write_row(&mut self, row: &[Cell<'_>]) -> io::Result<()> {
        let mut map = serde_json::Map::new();
        for (i, cell) in row.iter().enumerate() {
            let col = self
                .columns
                .get(i)
                .cloned()
                .unwrap_or_else(|| format!("col_{i}"));
            let val = match cell {
                Cell::Null => serde_json::Value::Null,
                Cell::Bool(b) => serde_json::Value::Bool(*b),
                Cell::Integer(i) => serde_json::Value::Number(serde_json::Number::from(*i)),
                Cell::Float(f) => serde_json::Value::Number(
                    serde_json::Number::from_f64(*f).unwrap_or(serde_json::Number::from(0)),
                ),
                Cell::Text(t) => serde_json::Value::String(t.to_string()),
                Cell::Object(o) => {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(o) {
                        v
                    } else {
                        serde_json::Value::String(o.to_string())
                    }
                }
            };
            map.insert(col, val);
        }
        let json_val = serde_json::Value::Object(map);
        serde_json::to_writer(&mut self.writer, &json_val)?;
        self.writer.write_all(b"\n")?;
        Ok(())
    }

    pub fn finish(&mut self) -> io::Result<()> {
        self.writer.flush()
    }
}

impl<W: Write> TabularEncoder for NdjsonEncoder<W> {
    fn write_row(&mut self, row: &[Cell<'_>]) -> io::Result<()> {
        NdjsonEncoder::write_row(self, row)
    }
    fn finish(&mut self) -> io::Result<()> {
        NdjsonEncoder::finish(self)
    }
}

#[cfg(feature = "avro")]
pub struct AvroEncoder<W: Write> {
    writer: apache_avro::Writer<'static, W>,
    columns: Vec<String>,
}

#[cfg(feature = "avro")]
impl<W: Write> AvroEncoder<W> {
    pub fn new(writer: W, columns: &[impl AsRef<str>]) -> io::Result<Self> {
        let cols: Vec<String> = columns.iter().map(|c| c.as_ref().to_string()).collect();
        let fields: Vec<String> = cols
            .iter()
            .map(|col| {
                format!(
                    r#"{{"name": "{}", "type": ["null", "boolean", "long", "double", "string"]}}"#,
                    col
                )
            })
            .collect();
        let schema_json = format!(
            r#"{{"type": "record", "name": "row", "fields": [{}]}}"#,
            fields.join(", ")
        );
        let schema = apache_avro::Schema::parse_str(&schema_json)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidInput, e.to_string()))?;

        let schema = Box::leak(Box::new(schema));
        let avro_writer = apache_avro::Writer::new(schema, writer);
        Ok(Self {
            writer: avro_writer,
            columns: cols,
        })
    }

    pub fn write_row(&mut self, row: &[Cell<'_>]) -> io::Result<()> {
        let mut record = apache_avro::types::Record::new(self.writer.schema()).unwrap();
        for (idx, cell) in row.iter().enumerate() {
            if let Some(col_name) = self.columns.get(idx) {
                let val = match cell {
                    Cell::Null => apache_avro::types::Value::Union(
                        0,
                        Box::new(apache_avro::types::Value::Null),
                    ),
                    Cell::Bool(b) => apache_avro::types::Value::Union(
                        1,
                        Box::new(apache_avro::types::Value::Boolean(*b)),
                    ),
                    Cell::Integer(i) => apache_avro::types::Value::Union(
                        2,
                        Box::new(apache_avro::types::Value::Long(*i)),
                    ),
                    Cell::Float(f) => apache_avro::types::Value::Union(
                        3,
                        Box::new(apache_avro::types::Value::Double(*f)),
                    ),
                    Cell::Text(s) | Cell::Object(s) => apache_avro::types::Value::Union(
                        4,
                        Box::new(apache_avro::types::Value::String(s.to_string())),
                    ),
                };
                record.put(col_name, val);
            }
        }
        self.writer
            .append(record)
            .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;
        Ok(())
    }

    pub fn finish(&mut self) -> io::Result<()> {
        self.writer
            .flush()
            .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;
        Ok(())
    }
}

#[cfg(feature = "avro")]
impl<W: Write> TabularEncoder for AvroEncoder<W> {
    fn write_row(&mut self, row: &[Cell<'_>]) -> io::Result<()> {
        AvroEncoder::write_row(self, row)
    }
    fn finish(&mut self) -> io::Result<()> {
        AvroEncoder::finish(self)
    }
}

#[cfg(feature = "parquet")]
pub struct ParquetEncoder<W: Write + Send> {
    writer: Option<W>,
    columns: Vec<String>,
    buffered_rows: Vec<Vec<OwnedCell>>,
}

#[cfg(feature = "parquet")]
impl<W: Write + Send> ParquetEncoder<W> {
    pub fn new(writer: W, columns: &[impl AsRef<str>]) -> Self {
        Self {
            writer: Some(writer),
            columns: columns.iter().map(|c| c.as_ref().to_string()).collect(),
            buffered_rows: Vec::new(),
        }
    }

    pub fn write_row(&mut self, row: &[Cell<'_>]) -> io::Result<()> {
        self.buffered_rows
            .push(row.iter().map(|c| c.to_owned()).collect());
        Ok(())
    }

    pub fn finish(&mut self) -> io::Result<()> {
        use arrow::array::{ArrayRef, BooleanBuilder, Float64Builder, Int64Builder, StringBuilder};
        use arrow::datatypes::{DataType, Field, Schema as ArrowSchema};
        use arrow::record_batch::RecordBatch;
        use parquet::arrow::ArrowWriter;
        use std::sync::Arc;

        let writer = match self.writer.take() {
            Some(w) => w,
            None => return Ok(()),
        };

        let num_rows = self.buffered_rows.len();
        let mut fields = Vec::new();
        let mut arrays: Vec<ArrayRef> = Vec::new();

        for (col_idx, col_name) in self.columns.iter().enumerate() {
            let mut has_int = false;
            let mut has_float = false;
            let mut has_bool = false;
            let mut has_text = false;

            for row in &self.buffered_rows {
                if let Some(cell) = row.get(col_idx) {
                    match cell {
                        OwnedCell::Integer(_) => has_int = true,
                        OwnedCell::Float(_) => has_float = true,
                        OwnedCell::Bool(_) => has_bool = true,
                        OwnedCell::Text(_) => has_text = true,
                        OwnedCell::Null => {}
                    }
                }
            }

            if has_text
                || (has_bool && (has_int || has_float))
                || (has_int && has_float && has_bool)
            {
                let mut builder = StringBuilder::with_capacity(num_rows, num_rows * 16);
                for row in &self.buffered_rows {
                    if let Some(cell) = row.get(col_idx) {
                        match cell {
                            OwnedCell::Null => builder.append_null(),
                            OwnedCell::Bool(b) => {
                                builder.append_value(if *b { "true" } else { "false" })
                            }
                            OwnedCell::Integer(i) => builder.append_value(i.to_string()),
                            OwnedCell::Float(f) => builder.append_value(f.to_string()),
                            OwnedCell::Text(s) => builder.append_value(s),
                        }
                    } else {
                        builder.append_null();
                    }
                }
                fields.push(Field::new(col_name, DataType::Utf8, true));
                arrays.push(Arc::new(builder.finish()));
            } else if has_float {
                let mut builder = Float64Builder::with_capacity(num_rows);
                for row in &self.buffered_rows {
                    if let Some(cell) = row.get(col_idx) {
                        match cell {
                            OwnedCell::Null => builder.append_null(),
                            OwnedCell::Integer(i) => builder.append_value(*i as f64),
                            OwnedCell::Float(f) => builder.append_value(*f),
                            _ => builder.append_null(),
                        }
                    } else {
                        builder.append_null();
                    }
                }
                fields.push(Field::new(col_name, DataType::Float64, true));
                arrays.push(Arc::new(builder.finish()));
            } else if has_int {
                let mut builder = Int64Builder::with_capacity(num_rows);
                for row in &self.buffered_rows {
                    if let Some(cell) = row.get(col_idx) {
                        match cell {
                            OwnedCell::Null => builder.append_null(),
                            OwnedCell::Integer(i) => builder.append_value(*i),
                            _ => builder.append_null(),
                        }
                    } else {
                        builder.append_null();
                    }
                }
                fields.push(Field::new(col_name, DataType::Int64, true));
                arrays.push(Arc::new(builder.finish()));
            } else if has_bool {
                let mut builder = BooleanBuilder::with_capacity(num_rows);
                for row in &self.buffered_rows {
                    if let Some(cell) = row.get(col_idx) {
                        match cell {
                            OwnedCell::Null => builder.append_null(),
                            OwnedCell::Bool(b) => builder.append_value(*b),
                            _ => builder.append_null(),
                        }
                    } else {
                        builder.append_null();
                    }
                }
                fields.push(Field::new(col_name, DataType::Boolean, true));
                arrays.push(Arc::new(builder.finish()));
            } else {
                let mut builder = StringBuilder::with_capacity(num_rows, 0);
                for _ in 0..num_rows {
                    builder.append_null();
                }
                fields.push(Field::new(col_name, DataType::Utf8, true));
                arrays.push(Arc::new(builder.finish()));
            }
        }

        let schema = Arc::new(ArrowSchema::new(fields));
        let batch = RecordBatch::try_new(schema, arrays)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e.to_string()))?;
        let mut arrow_writer = ArrowWriter::try_new(writer, batch.schema(), None)
            .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;
        arrow_writer
            .write(&batch)
            .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;
        arrow_writer
            .close()
            .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;
        Ok(())
    }
}

#[cfg(feature = "parquet")]
impl<W: Write + Send> TabularEncoder for ParquetEncoder<W> {
    fn write_row(&mut self, row: &[Cell<'_>]) -> io::Result<()> {
        ParquetEncoder::write_row(self, row)
    }
    fn finish(&mut self) -> io::Result<()> {
        ParquetEncoder::finish(self)
    }
}

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

fn write_create_table(
    writer: &mut impl Write,
    table_name: &str,
    columns: &[SqlColumnSpec],
    dialect: &dyn irodori_sql::dialect::SqlDialect,
) -> io::Result<()> {
    if columns.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "create table requires at least one column",
        ));
    }
    writeln!(writer, "CREATE TABLE IF NOT EXISTS {table_name} (")?;
    for (index, column) in columns.iter().enumerate() {
        let comma = if index + 1 == columns.len() { "" } else { "," };
        let nullable = if column.nullable { "" } else { " NOT NULL" };
        writeln!(
            writer,
            "  {} {}{}{}",
            dialect.quote_identifier(&column.name),
            column.sql_type,
            nullable,
            comma
        )?;
    }
    writeln!(writer, ");")
}

fn sql_literal(cell: &Cell<'_>) -> String {
    match cell {
        Cell::Null => "NULL".to_string(),
        Cell::Bool(value) => {
            if *value {
                "TRUE".to_string()
            } else {
                "FALSE".to_string()
            }
        }
        Cell::Integer(value) => value.to_string(),
        Cell::Float(value) if value.is_finite() => value.to_string(),
        Cell::Float(_) => "NULL".to_string(),
        Cell::Text(value) | Cell::Object(value) => format!("'{}'", value.replace('\'', "''")),
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

fn validate_options(options: &DelimitedOptions) -> io::Result<()> {
    if options.delimiter == options.quote {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "delimiter and quote must differ",
        ));
    }
    if matches!(options.delimiter, b'\n' | b'\r') {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "delimiter cannot be a line break",
        ));
    }
    if matches!(options.quote, b'\n' | b'\r') {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "quote cannot be a line break",
        ));
    }
    Ok(())
}

fn needs_quote(field: &str, options: &DelimitedOptions) -> bool {
    field.bytes().any(|byte| {
        byte == options.delimiter || byte == options.quote || matches!(byte, b'\n' | b'\r')
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csv_writes_header_and_rows() {
        let mut out = Vec::new();
        let mut encoder = DelimitedEncoder::csv(&mut out, &["id", "name"]).expect("encoder");

        encoder
            .write_row(&[Cell::Integer(1), Cell::Text("irodori")])
            .expect("row");
        encoder.finish().expect("finish");

        assert_eq!(String::from_utf8(out).unwrap(), "id,name\n1,irodori\n");
    }

    #[test]
    fn tsv_can_omit_header() {
        let mut out = Vec::new();
        let options = DelimitedOptions::tsv().with_header(false);
        let mut encoder =
            DelimitedEncoder::new(&mut out, &["id", "name"], options).expect("encoder");

        encoder
            .write_row(&[Cell::Integer(7), Cell::Text("table")])
            .expect("row");

        assert_eq!(String::from_utf8(out).unwrap(), "7\ttable\n");
    }

    #[test]
    fn escaping_quotes_delimiters_and_newlines_is_rfc4180_style() {
        let mut out = Vec::new();
        let options = DelimitedOptions::csv().with_header(false);
        let mut encoder =
            DelimitedEncoder::new(&mut out, &["a", "b", "c"], options).expect("encoder");

        encoder
            .write_row(&[
                Cell::Text("a,b"),
                Cell::Text("line\nbreak"),
                Cell::Text("say \"hi\""),
            ])
            .expect("row");

        assert_eq!(
            String::from_utf8(out).unwrap(),
            "\"a,b\",\"line\nbreak\",\"say \"\"hi\"\"\"\n"
        );
    }

    #[test]
    fn null_and_object_cells_are_written_as_fields() {
        let mut out = Vec::new();
        let options = DelimitedOptions::csv()
            .with_header(false)
            .with_null_value("NULL");
        let mut encoder =
            DelimitedEncoder::new(&mut out, &["missing", "object"], options).expect("encoder");

        encoder
            .write_row(&[Cell::Null, Cell::Object(r#"{"kind":"table"}"#)])
            .expect("row");

        assert_eq!(
            String::from_utf8(out).unwrap(),
            "NULL,\"{\"\"kind\"\":\"\"table\"\"}\"\n"
        );
    }

    #[test]
    fn quote_style_never_rejects_ambiguous_fields() {
        let mut out = Vec::new();
        let options = DelimitedOptions::csv()
            .with_header(false)
            .with_quote_style(QuoteStyle::Never);
        let mut encoder = DelimitedEncoder::new(&mut out, &["value"], options).expect("encoder");

        let err = encoder.write_row(&[Cell::Text("needs,quote")]).unwrap_err();
        assert_eq!(err.kind(), io::ErrorKind::InvalidInput);
    }

    #[test]
    fn sql_insert_writes_statements() {
        let mut out = Vec::new();
        let dialect = irodori_sql::dialect::PostgresDialect;
        let mut encoder = SqlInsertEncoder::new(&mut out, "users", &["id", "name"], &dialect);

        encoder
            .write_row(&[Cell::Integer(42), Cell::Text("Ann's Studio")])
            .expect("row");
        encoder.finish().expect("finish");

        assert_eq!(
            String::from_utf8(out).unwrap(),
            "INSERT INTO \"users\" (\"id\", \"name\") VALUES (42, 'Ann''s Studio');\n"
        );
    }

    #[test]
    fn sql_script_batches_inserts_and_can_emit_schema() {
        let mut out = Vec::new();
        let dialect = irodori_sql::dialect::PostgresDialect;
        let options = SqlScriptOptions::insert()
            .with_batch_size(2)
            .with_create_table(vec![
                SqlColumnSpec::new("id", "integer").not_null(),
                SqlColumnSpec::new("name", "text"),
            ]);
        let mut encoder =
            SqlScriptEncoder::new(&mut out, "users", &["id", "name"], &dialect, options)
                .expect("encoder");

        encoder
            .write_row(&[Cell::Integer(1), Cell::Text("A")])
            .expect("row");
        encoder
            .write_row(&[Cell::Integer(2), Cell::Text("B")])
            .expect("row");
        encoder
            .write_row(&[Cell::Integer(3), Cell::Null])
            .expect("row");
        encoder.finish().expect("finish");

        assert_eq!(
            String::from_utf8(out).unwrap(),
            "CREATE TABLE IF NOT EXISTS \"users\" (\n  \"id\" integer NOT NULL,\n  \"name\" text\n);\n\
INSERT INTO \"users\" (\"id\", \"name\") VALUES (1, 'A'), (2, 'B');\n\
INSERT INTO \"users\" (\"id\", \"name\") VALUES (3, NULL);\n"
        );
    }

    #[test]
    fn sql_script_writes_postgres_and_mysql_upserts() {
        let pg = irodori_sql::dialect::PostgresDialect;
        let mut out = Vec::new();
        let options = SqlScriptOptions::upsert(["id"], ["name"], UpsertStyle::PostgresOrSqlite);
        let mut encoder = SqlScriptEncoder::new(&mut out, "users", &["id", "name"], &pg, options)
            .expect("encoder");
        encoder
            .write_row(&[Cell::Integer(1), Cell::Text("A")])
            .expect("row");
        encoder.finish().expect("finish");
        assert_eq!(
            String::from_utf8(out).unwrap(),
            "INSERT INTO \"users\" (\"id\", \"name\") VALUES (1, 'A') ON CONFLICT (\"id\") DO UPDATE SET \"name\" = excluded.\"name\";\n"
        );

        let mysql = irodori_sql::dialect::MySqlDialect;
        let mut out = Vec::new();
        let options = SqlScriptOptions::upsert(["id"], ["name"], UpsertStyle::MySql);
        let mut encoder =
            SqlScriptEncoder::new(&mut out, "users", &["id", "name"], &mysql, options)
                .expect("encoder");
        encoder
            .write_row(&[Cell::Integer(1), Cell::Text("A")])
            .expect("row");
        encoder.finish().expect("finish");
        assert_eq!(
            String::from_utf8(out).unwrap(),
            "INSERT INTO `users` (`id`, `name`) VALUES (1, 'A') ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);\n"
        );
    }

    #[test]
    fn json_writes_array() {
        let mut out = Vec::new();
        let mut encoder = JsonEncoder::new(&mut out, &["id", "name"]).expect("encoder");

        encoder
            .write_row(&[Cell::Integer(1), Cell::Text("Bob")])
            .expect("row");
        encoder
            .write_row(&[Cell::Integer(2), Cell::Text("Cat")])
            .expect("row");
        encoder.finish().expect("finish");

        assert_eq!(
            String::from_utf8(out).unwrap(),
            "[\n{\"id\":1,\"name\":\"Bob\"},\n{\"id\":2,\"name\":\"Cat\"}\n]\n"
        );
    }

    #[test]
    fn ndjson_writes_lines() {
        let mut out = Vec::new();
        let mut encoder = NdjsonEncoder::new(&mut out, &["id", "name"]);

        encoder
            .write_row(&[Cell::Integer(1), Cell::Text("Bob")])
            .expect("row");
        encoder
            .write_row(&[Cell::Integer(2), Cell::Text("Cat")])
            .expect("row");
        encoder.finish().expect("finish");

        assert_eq!(
            String::from_utf8(out).unwrap(),
            "{\"id\":1,\"name\":\"Bob\"}\n{\"id\":2,\"name\":\"Cat\"}\n"
        );
    }

    #[test]
    fn json_preview_maps_columns_and_infers_types() {
        let preview = preview_json(
            r#"[{"id":1,"name":"Bob","active":true},{"id":2,"name":"Cat","meta":{"tier":"gold"}}]"#,
            ImportPreviewOptions { max_rows: 10 },
        )
        .expect("preview");

        assert_eq!(preview.total_rows_seen, 2);
        assert!(!preview.truncated);
        assert_eq!(
            preview
                .columns
                .iter()
                .map(|column| (&column.source_name, column.inferred_type))
                .collect::<Vec<_>>(),
            vec![
                (&"id".to_string(), InferredType::Integer),
                (&"name".to_string(), InferredType::Text),
                (&"active".to_string(), InferredType::Bool),
                (&"meta".to_string(), InferredType::Text)
            ]
        );
        assert_eq!(preview.columns[0].target_name, "id");
    }

    #[test]
    fn ndjson_preview_truncates_without_losing_total_count() {
        let preview = preview_ndjson(
            "{\"id\":1}\n{\"id\":2}\n{\"id\":3}\n",
            ImportPreviewOptions { max_rows: 2 },
        )
        .expect("preview");

        assert_eq!(preview.rows.len(), 2);
        assert_eq!(preview.total_rows_seen, 3);
        assert!(preview.truncated);
    }

    #[test]
    fn delimited_preview_handles_csv_mapping_quotes_and_types() {
        let preview = preview_delimited(
            "User ID,Display Name,Notes\n1,Alice,\"hello, world\"\n2,Bob,\"line\nbreak\"\n"
                .as_bytes(),
            DelimitedImportOptions::csv(),
        )
        .expect("preview");

        assert_eq!(preview.total_rows_seen, 2);
        assert_eq!(
            preview
                .columns
                .iter()
                .map(|column| (
                    &column.source_name,
                    &column.target_name,
                    column.inferred_type
                ))
                .collect::<Vec<_>>(),
            vec![
                (
                    &"User ID".to_string(),
                    &"user_id".to_string(),
                    InferredType::Integer
                ),
                (
                    &"Display Name".to_string(),
                    &"display_name".to_string(),
                    InferredType::Text
                ),
                (
                    &"Notes".to_string(),
                    &"notes".to_string(),
                    InferredType::Text
                )
            ]
        );
        assert_eq!(
            preview.rows[1],
            vec![
                OwnedCell::Integer(2),
                OwnedCell::Text("Bob".into()),
                OwnedCell::Text("line\nbreak".into())
            ]
        );
    }

    #[test]
    fn tsv_preview_without_header_generates_columns_and_nulls() {
        let preview = preview_delimited(
            "1\t\n2\ttrue\n".as_bytes(),
            DelimitedImportOptions::tsv().with_header(false),
        )
        .expect("preview");

        assert_eq!(
            preview
                .columns
                .iter()
                .map(|column| (&column.source_name, column.inferred_type))
                .collect::<Vec<_>>(),
            vec![
                (&"column_1".to_string(), InferredType::Integer),
                (&"column_2".to_string(), InferredType::Bool)
            ]
        );
        assert_eq!(
            preview.rows[0],
            vec![OwnedCell::Integer(1), OwnedCell::Null]
        );
    }

    #[test]
    #[cfg(feature = "avro")]
    fn avro_round_trip() {
        let mut out = Vec::new();
        let mut encoder = AvroEncoder::new(&mut out, &["id", "name"]).unwrap();
        encoder
            .write_row(&[Cell::Integer(1), Cell::Text("Alice")])
            .unwrap();
        encoder.finish().unwrap();
        assert!(!out.is_empty());
    }

    #[test]
    #[cfg(feature = "parquet")]
    fn parquet_round_trip() {
        let mut out = Vec::new();
        let mut encoder = ParquetEncoder::new(&mut out, &["id", "name"]);
        encoder
            .write_row(&[Cell::Integer(1), Cell::Text("Alice")])
            .unwrap();
        encoder.finish().unwrap();
        assert!(!out.is_empty());
    }

    #[test]
    fn test_csv_inference_and_generation() {
        let csv_data = "id,name,active\n1,Alice,true\n2,Bob,false\n3,Charlie,true\n";
        let cols = infer_csv_schema(csv_data.as_bytes(), b',', true).unwrap();
        assert_eq!(cols.len(), 3);
        assert_eq!(cols[0].name, "id");
        assert_eq!(cols[0].data_type, "integer");
        assert_eq!(cols[1].name, "name");
        assert_eq!(cols[1].data_type, "text");
        assert_eq!(cols[2].name, "active");
        assert_eq!(cols[2].data_type, "boolean");

        let mut sql_out = Vec::new();
        let dialect = irodori_sql::dialect::PostgresDialect;
        let count = generate_inserts_from_csv(
            csv_data.as_bytes(),
            b',',
            true,
            "users",
            &mut sql_out,
            &dialect,
        )
        .unwrap();
        assert_eq!(count, 3);
        let sql_str = String::from_utf8(sql_out).unwrap();
        assert!(sql_str.contains("INSERT INTO \"users\""));
    }
}
