<!-- i18n: language-switcher -->
[English](README.md) | [日本語](README.ja.md)

# ホットサーフェスレンダリングスパイク

このローカルスパイクは、Irodoriのエディターと結果グリッドのホットサーフェスにおける繰り返し作業を、他製品のレンダラーをコピーせずに比較します。設計上合成的であり、すべてのパスは同じ生成された行とSQLフィクスチャを使用し、その後、スクロールフレームごとのオブジェクト作成、テキストフォーマット、パックされたペイロードサイズ、およびヒープ移動を測定します。

実行方法:

```sh
make perf-hot-surfaces
node tools/perf/hot-surface-benchmark.mjs --json
node tools/perf/hot-surface-benchmark.mjs --rows 1000000 --columns 300 --steps 240
```

解釈:

- `dom-virtual-grid` は現在のアクセシブルなWebView DOMフォールバックを近似します。
- `canvas-batched-grid` は、アプリが表示されているテキストとペイント操作をバッチ処理するcanvas/WebGPU-in-WebViewパスを近似します。
- `webgl-rects-plus-text-grid` は、`WebGlResultGrid`における現在のWebGL矩形＋テキストキャンバスアプローチに一致します。
- `native-gpu-packed-ipc-grid` は、ネイティブRust GPUパスがWebView/ネイティブ境界にかけるペイロード圧力を測定します。
- エディター行は、CodeMirrorのDOMビューポートスタイルと仮想的なパックされたネイティブテキストペイロードを比較します。

このスパイクで得られた推奨事項:

- DOM結果グリッドをアクセシブルなフォールバックとして維持する。
- WebGL/canvasパスを、大きな結果セットに対して、フレームごとの作業が表示されている行と列に制限されている間は使用する。
- Tauri IPCプロファイルが、実際のユーザークエリでパックされたペイロードサイズと同期がフレーム予算内に収まることを証明するまでは、エディターやグリッドのレンダリングをネイティブRust GPUパスに移行しない。