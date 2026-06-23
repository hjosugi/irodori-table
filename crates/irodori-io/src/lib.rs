//! Export, import, dump, and restore encoders for tabular data.

use std::io::{self, Write};

pub const CRATE_NAME: &str = "irodori-io";

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
}
