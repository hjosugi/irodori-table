<!-- i18n: language-switcher -->
[English](README.md) | [日本語](README.ja.md)

# デスクトップテスト

このツリーはテストコードを本番の機能フォルダーから分離しています。

- `unit/`：純粋なロジックや小さな機能モデルのための Vitest ユニットテスト。
- `unit/features/`：機能名ごとにグループ化された機能固有のユニット。
- `unit/sql/`、`unit/results/`、`unit/erd/`：共有モジュールのドメインレベルユニット。

テストでは長い相対パスの代わりに `@/...` インポートを使用してください。ブラウザおよびワークフローテストは `apps/desktop/e2e` に配置します。