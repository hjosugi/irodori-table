<!-- i18n: language-switcher -->
[English](README.md) | [日本語](README.ja.md)

# `src/app` — ワークベンチのアーキテクチャ

ワークベンチは3つのレイヤーから構成され、1つのルールがあります：**配線は正確に1つのチェーンで行うこと**。これだけは覚えておいてください：状態はストアとコントローラーにあり、コントローラーは合成ルート（`AppWorkbench.tsx` とそこから呼ばれる3つのパートファイル）でのみ組み合わされ、ビューはコンテキストから与えられたものだけをレンダリングします。

```
feature stores (zustand)          src/features/*/…-store.ts
        │  subscribed by
        ▼
domain controllers (hooks)        src/app/controllers/use-<domain>.ts
        │  wired together by
        ▼
composition root                  AppWorkbench.tsx
                                    ├─ use-workbench-layout.ts    (ドックの寸法 + リサイズ)
                                    ├─ use-query-workspace.ts     (グリッド + ランナー + エディターコマンド + 履歴)
                                    └─ use-workbench-actions.ts   (ワークスペースアクション + runCommand + ペイン)
        │  distributed via
        ▼
WorkbenchProvider (context)       src/app/workbench-context.tsx
        │  consumed by
        ▼
views                             WorkbenchRoot / WorkbenchSidebar / WorkbenchDialogs
```

## エントリーポイント

`AppWorkbench.tsx` は合成ルートです。`useWorkbench()` は依存関係の順に各パートを呼び出します — 独立したドメインから始まり、次にクエリパイプライン、最後にアクションサーフェス — そしてコンポーネントは結果をビューに渡します：

```tsx
const workbench = useWorkbench(); // すべてをパートごとに構築
return (
  <WorkbenchProvider workbench={workbench}>
    <WorkbenchRoot /> // すべてをレンダリング
  </WorkbenchProvider>
);
```

長いコントローラー間の受け渡し（結果グリッドの数十のセッターがクエリランナーに渡すなど）はパートファイル内に隠されているため、ルートは目次のように読めます。

## ファイルマップ

| ファイル                                   | 役割                                                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `AppWorkbench.tsx`                     | 合成ルート：依存関係の順にすべてのパートを作成し、`Workbench` 型をエクスポートし、プロバイダーとルートビューをレンダリング。                 |
| `workbench-context.tsx`                | `WorkbenchProvider` / `useWorkbenchContext()`。                                                                                        |
| `WorkbenchRoot.tsx`                    | 唯一のトップレベルビュー：シェルのクローム、ドックレイアウト、中央ペイン、サイドバー、ダイアログ、トースト。                                           |
| `WorkbenchSidebar.tsx`                 | 片側（左/右）：ビューのレール + ドッカブルパネル。                                                                                   |
| `WorkbenchDialogs.tsx`                 | すべてのモーダル/オーバーレイサーフェス。                                                                                                          |
| `controllers/use-query-workspace.ts`   | パート：クエリ実行パイプライン — グリッド、ランナー、エディターコマンド、履歴アクション、プラン/エラー状態、およびそれらの間のセッターの受け渡し。 |
| `controllers/use-workbench-actions.ts` | パート：ワークスペースアクション、`runCommand` サーフェス、一時メニューのEscape処理、中央ペインの2つのプロップバンドル。             |
| `controllers/use-workbench-layout.ts`  | パート：ドックの寸法 + パネルリサイズコントローラー。                                                                                  |
| `controllers/use-<domain>.ts`          | ドメインごとに1つのフック（以下参照）。                                                                                                          |
| `app-config.ts`                        | コマンドカタログ、メニューバーセクション、アプリ定数。                                                                                    |
| `app-workbench-utils.ts`               | 純粋なヘルパー（フックなし）。                                                                                                              |

## ドメインコントローラー

各コントローラーは1つの関心事を所有し、依存関係を引数オブジェクトとして受け取り、プレーンな状態 + アクションを返します。どのコントローラーもビューや他のコントローラーの内部をインポートしません — それらは合成ルートのパートファイル内でのみ出会います。

| コントローラー                  | 所有                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| `use-workbench-connections` | 接続プロファイル、アクティブ接続情報、メタデータ、接続マネージャーダイアログコントローラー。 |
| `use-editor-workspace`      | エディターのタブ/グループ/分割、アクティブエディターアクセサー、`QueryEditorPane` プロップバンドル。             |
| `use-result-grid-workspace` | 結果グリッドの状態（選択、編集、フィルター、エクスポート）、`ResultsPane` プロップバンドル。           |
| `use-query-runner`          | SQLの実行、キャンセル、パラメータプロンプト、EXPLAIN。                                          |
| `use-editor-commands`       | エディタースコープのコマンド（実行/フォーマット/クリーンアップ/インデントなど）。                                              |
| `use-workbench-commands`    | すべてのコマンドID → 所有コントローラーのマッピング（パレット、メニュー、キー）。                                  |
| `use-workbench-overlays`    | アプリレベルのオーバーレイの開閉状態（パレット、アバウト、ターミナルなど）。                               |
| `use-sidebar-views`         | どのドッカブルビューがどちらの側にあるか、トグル/開閉のフロー。                                 |
| `use-keybinding-manager`    | キーマップのオーバーライド、コード解決、再バインドの記録。                                             |
| `use-workspace-actions`     | 保存/インポート/エクスポート、スキーマデザイナーの連携、アプリレベルのアクション。                                      |
| `use-history-actions`       | クエリ履歴の読み込み/実行/復元。                                                                   |
| `use-erd-diagram`           | ERDダイアログの状態とエクスポート。                                                                     |
| `use-settings-controller`   | 設定ダイアログの状態、設定JSON、ジョブ。                                                       |
| `use-theme-manager`         | テーマの選択と切り替え。                                                                    |

## ルール

1. **ビューは決して配線しない。** ビューは `useWorkbenchContext()`（およびビュー固有の関心事のためのfeature stores）を読み取り、レンダリングします。ビューが2つのコントローラー間の通信を必要とする場合、その会話は合成ルートのパートファイルに属します。
2. **コントローラーはビューをインポートしない**し、他のコントローラーに直接アクセスしません — 依存関係は引数オブジェクトを通じて渡されます。
3. **コマンドサーフェスは1つだけ。** ユーザーがトリガーできるもの（メニュー、パレット、ショートカット）はすべてコマンドIDです：`app-config.ts` で宣言され、`use-workbench-commands.ts` でマッピングされます。
4. **ストアの状態はストアに留まる。** コントローラー内の `useState` は一時的なUI状態に適しています。永続化または機能間で共有されるものはすべて `src/features/*` のzustandストアに属します。
5. **長い依存関係リストはパートファイルに置く。** コントローラーの配線に画面いっぱいのプロパティが必要な場合、その呼び出しは `use-query-workspace.ts` / `use-workbench-actions.ts` / `use-workbench-layout.ts` に置き、`AppWorkbench.tsx` には置きません。

## レシピ

**コマンドを追加する** — `app-config.ts` のカタログにIDを宣言し、`use-workbench-commands.ts` でコントローラーアクションにマッピングします。デフォルトショートカットは `use-keybinding-manager` が使用するキーマップを参照してください。

**ダイアログを追加する** — 開閉状態を `use-workbench-overlays.ts`（または所有するfeature store）に置き、`WorkbenchDialogs.tsx` でレンダリングし、コマンド経由で開きます。

**サイドバーパネルを追加する** — ビューID/配置を `src/features/workbench`（`workbenchViewIds` を参照）に登録し、`WorkbenchSidebar.tsx` でパネルをレンダリングし、トグルコマンドを追加します。

**ドメインコントローラーを追加する** — `controllers/use-<name>.ts` を作成し、依存オブジェクトを受け取り、合成ルートでインスタンス化します（呼び出しが短ければ直接 `AppWorkbench.tsx`、依存リストが長ければ対応するパートファイル内で）、返される `Workbench` オブジェクトで公開します。

**新しいコンポーネントでワークベンチ状態を利用する** — `WorkbenchRoot` の下にレンダリングし、`useWorkbenchContext()` を呼び出します。コントローラープロップを中間コンポーネントに通すことはしません。