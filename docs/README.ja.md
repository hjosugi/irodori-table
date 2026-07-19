<!-- i18n: language-switcher -->
[English](README.md) | [日本語](README.ja.md)

# Irodori Table ユーザーガイド

アプリの実際の使い方を、機能領域ごとに1ページでまとめます。各ページは**現在の
ビルドの挙動**を記述しており、意図された仕様ではありません。機能が未完成の場合
は、その旨を明記し、今日時点で何ができるかを示します。

インストール手順、プラットフォーム別セットアップ、ポリシーページ、機能マトリクス
といった恒久的な公開ドキュメントは <https://hjosugi.github.io/irodori-docs/>
にあります。本ガイドはアプリに付属する補助資料であり、このリポジトリのコードを
追跡し、同じプルリクエストで更新されます。

個別ページは英語のみです。これはリポジトリの慣例に従っています。ディレクトリの
インデックス（`README.md`）は日英併記、その他のドキュメントは英語のみです。

## インストールから最初のクエリまで

1. **インストール。** インストールガイドからデスクトップ版を入手します：
   <https://hjosugi.github.io/irodori-docs/install-guide.html>。リリース
   アセットは <https://github.com/hjosugi/irodori-table/releases> で公開されて
   います。ソースから実行する場合は[ルートREADME](../README.ja.md)の
   クイックスタートを参照してください。

2. **接続マネージャーを開く。** **File ▸ Open Connection Manager**。既定の
   ショートカットはありません。コマンドパレット（`Mod+Shift+P`）にも **Open
   Connection Manager** があります。`Mod` はmacOSではCmd、それ以外ではCtrlです。

3. **プロファイルを追加。** プロファイル一覧上部の **+** ボタンを押し、名前を
   付けてエンジンを選択します。フォームはエンジンごとにラベルが変わります。
   SQLiteはファイル、Athenaはリージョン、Icebergはカタログを尋ねます。
   [Connections](connections.md) を参照してください。

   エンジンがコネクター拡張を必要とする場合（レイクハウス、ベクトル、検索系は
   すべて必要です）、先に拡張をインストールします。手順は
   [Lakehouse connections](lakehouse.md) にあります。

4. **テストして接続。** **Test** はセッションを開かずにプロファイルを検証し、
   **Connect** は接続してオブジェクトブラウザーを読み込みます。

5. **クエリを実行。** `Mod+T` で新しいSQLタブを開きます。文を入力して
   `Mod+Enter` を押すと、選択範囲、または選択がなければカーソル位置の文を実行
   します。結果は下部に表示されます。[Query editor](query-editor.md) と
   [Results](results.md) を参照してください。

接続先がまだない場合は、組み込みの `sqlite-memory` プロファイルがサンプルデータ
入りのインメモリSQLiteデータベースを開くので、手順2〜4を省略して試せます。

## ページ一覧

| ページ | 内容 |
| --- | --- |
| [Connections](connections.md) | プロファイル、エンジン、トランスポート、秘密情報、インポート／エクスポート |
| [Lakehouse connections](lakehouse.md) | Iceberg、Delta Lake、Hudi、Hive、Athena、S3 Tables — 拡張が先 |
| [Query editor](query-editor.md) | SQL実行、補完、スニペット、クエリマジック、パラメータ、Vimモード |
| [Results](results.md) | グリッド、フィルタ、ソート、エクスポートとコピー形式、行詳細、構造、チャート、編集 |
| [Query history](query-history.md) | 記録内容、保持件数、再実行、結果の復元 |
| [Search and replace](search-and-replace.md) | 2つの独立した検索機能と、どちらが起動するか |
| [ERD](erd.md) | 生成されるER図、エクスポート、テーブル仕様 |
| [Schema designer](schema-designer.md) | フォームによるCREATE／ALTER SQL生成 |
| [Schema diagram designer](schema-diagram.md) | 自由配置キャンバスでのモデリング、JSON往復 |
| [Import](import.md) | CSV／TSV／JSON／JSONLからINSERT SQLを生成 |
| [Migration Studio](migration-studio.md) | エンジン間マイグレーションの計画と差分SQL |
| [AI chat and SQL generation](ai-chat.md) | プロバイダー、エージェントモード、モデルが見えるもの・見えないもの |
| [Knowledge panel](knowledge.md) | 同梱ファクトパックとその用途 |
| [Git](git.md) | コミットグラフ、変更、ブランチ — **およびリポジトリパスの問題** |
| [Terminal](terminal.md) | 組み込みシェル |
| [Extensions](extensions.md) | コネクターなど拡張のインストール |
| [Security](security.md) | パスキーロック、秘密情報の保存先、読み取り専用接続 |
| [Preferences](preferences.md) | 設定ダイアログ、テーマ、言語、エディター設定 |
| [Updater](updater.md) | 更新確認と、更新可能なビルド |
| [Keyboard shortcuts](keyboard-shortcuts.md) | 既定のキーマップ一覧と再割り当て方法 |

## 各ページの表記について

- `Mod` はmacOSではCmd、WindowsとLinuxではCtrlを意味します。アプリ自身が同じ
  方式でキーを解決するため、1つのショートカット一覧で全プラットフォームを
  カバーできます。
- **太字**は実際に画面に表示される文字列（ボタン、メニュー項目、フィールド名）
  です。英語ロケール（`apps/desktop/src/i18n/locales/en.ts`）から引用しています。
  日本語UIでは同ファイルの `ja` 文字列が表示されますが、翻訳されていない画面に
  ついては各ページに明記しています。
- ショートカットは `apps/desktop/src/core/keybindings.ts` から引用しています。
  既定キーマップの唯一の情報源です。
- 各ページ末尾の **Gaps** セクションに、その領域で未実装・スタブ・誤解を招く点を
  列挙しています。本文に見当たらない機能は、まずそちらを確認してください。
