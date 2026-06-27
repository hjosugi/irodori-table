
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
    let mut encoder = DelimitedEncoder::new(&mut out, &["id", "name"], options).expect("encoder");

    encoder
        .write_row(&[Cell::Integer(7), Cell::Text("table")])
        .expect("row");

    assert_eq!(String::from_utf8(out).unwrap(), "7\ttable\n");
}

#[test]
fn escaping_quotes_delimiters_and_newlines_is_rfc4180_style() {
    let mut out = Vec::new();
    let options = DelimitedOptions::csv().with_header(false);
    let mut encoder = DelimitedEncoder::new(&mut out, &["a", "b", "c"], options).expect("encoder");

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
    let mut encoder = SqlScriptEncoder::new(&mut out, "users", &["id", "name"], &dialect, options)
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
    let mut encoder =
        SqlScriptEncoder::new(&mut out, "users", &["id", "name"], &pg, options).expect("encoder");
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
    let mut encoder = SqlScriptEncoder::new(&mut out, "users", &["id", "name"], &mysql, options)
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
        "User ID,Display Name,Notes\n1,Alice,\"hello, world\"\n2,Bob,\"line\nbreak\"\n".as_bytes(),
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
