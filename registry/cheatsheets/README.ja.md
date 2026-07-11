<!-- i18n: language-switcher -->
[English](README.md) | [日本語](README.ja.md)

# エンジン チートシート

各データベースごとに1ページで、素早く答えます：**Irodoriからどう接続するか、クエリモデルは何か、そしてエンジンごとの注意点は何か。** これらは、より詳細な
<https://hjosugi.github.io/irodori-docs/engine-syntax-reference.html>
（ドライバー／デコードの内部仕様）や
[`registry/data-source-support-status.md`](../data-source-support-status.md)
（対応状況）の人間向け、コピー＆ペースト可能な補助資料です。

各チートシートは、ローカルの知識ベース
(`knowledge/irodori-knowledge.sqlite`)から**生成**されることを想定しています。ジェネレーターが完成するまでは、ページが手動で種付けされている場合があります（`<!-- seed -->`でマーク）。生成の契約とそれを支える自動データ収集は
<https://hjosugi.github.io/irodori-docs/knowledge-base.html>
に記載されています。

## インデックス

| チートシート | 対応エンジン | ステータス |
|---|---|---|
| [neo4j.md](neo4j.md) | Neo4j（グラフ、Bolt/Cypher）；Memgraph拡張ノート | シード（旗艦グラフ/Boltページ） |
| [postgres.md](postgres.md) | PostgreSQL（+ Cockroach/Yugabyte/Redshift/Timescale/Neon；H2ワイヤーノート） | 生成済み（`knowledge/cheatsheets/postgres.json`） |
| _mysql.md_ | MySQL / MariaDB / TiDB | 計画中 |
| _sqlite.md_ | SQLite | 計画中 |
| _oracle.md_ | Oracle | 計画中 |
| _sqlserver.md_ | SQL Server | 計画中 |
| _duckdb.md_ | DuckDB / MotherDuck | 計画中 |
| _mongodb.md_ | MongoDB | 計画中 |
| _redis.md_ | Redis | 計画中 |
| _cassandra.md_ | Cassandra / ScyllaDB | 計画中 |
| _clickhouse.md_ | ClickHouse | 計画中 |
| _snowflake.md_ | Snowflake | 計画中 |
| _bigquery.md_ | BigQuery | 計画中 |
| _bigtable.md_ | Bigtable | 計画中 |
| _influxdb.md_ | InfluxDB | 計画中 |
| _questdb.md_ | QuestDB | 計画中 |

新しいチートシートは、`registry/data-source-support-status.md`で少なくとも**Wired**となっているエンジンのみ追加されます。「認識済みだがコネクターなし」や「未登録」のエンジンは、実際に接続可能になるまではサポート状況ドキュメントに行が追加されるだけで、チートシートは作成されません。

## メンテナンスキュー

次に種付けするページは、サポート状況テーブルと同じ順序で、検証済みまたはWiredのクエリパスがあり、`knowledge/sources.json`で十分なソースカバレッジがあるエンジンを優先します：`duckdb.md`、`mongodb.md`、`redis.md`、`cassandra.md`、`clickhouse.md`、`snowflake.md`、`bigquery.md`、`bigtable.md`、`influxdb.md`。

一部の兄弟コネクター実装はルートレジストリより先行して動作可能です。`knowledge/engines.json`と`registry/data-source-support-status.md`がエンジンをWired/Extensionに昇格させるまでは、これらの詳細は最寄りのWiredチートシートの関連ノートとして保持し、単独ページとして公開しないでください。

## ページフォーマット（すべてのチートシートが従うテンプレート）

ジェネレーターが決定的に生成でき、読者が慣れるように、以下の順序でセクションを保持してください：

1. **一目でわかる情報** — ワイヤー／ドライバー、デフォルトポート、クエリ言語、Irodori対応状況、そして「このエンジンの特徴」を一行で。
2. **接続** — Irodori接続フィールドと生のURL/DSN形式、最小限の動作例付き。
3. **クエリモデル** — 入力するもの、返ってくるもの、行数制限の挙動。
4. **必須ステートメント** — 80%のケースをカバーする厳選された実行可能なクエリセット。
5. **イントロスペクション** — Irodoriのオブジェクトブラウザーが行うようなオブジェクト一覧の方法。
6. **Irodori固有の挙動** — *このアプリ*がエンジンを扱う際のマッピングや特異点（デコード、オブジェクトブラウザーのマッピング、未実装のもの）。
7. **注意点** — 実際に問題になる少数のポイント。
8. **ソース** — ページ生成に使われた`knowledge/sources.json`のID。

**ソース**のフッターは重要です：各ページを知識レジストリの公式ドキュメントに結びつけ、ページの陳腐化を検知できるようにします。

人間向けのmdBookページで、テーブルリポジトリのジェネレーターのスナップショットとして不要なものは、`hjosugi/irodori-docs`の`src/cheatsheets/`以下にあります。