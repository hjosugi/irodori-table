# Hot Surface Rendering Spike

This local spike compares the repeated work on Irodori's editor and result-grid
hot surfaces without copying another product's renderer. It is synthetic by
design: every path uses the same generated row and SQL fixtures, then measures
per-scroll-frame object creation, text formatting, packed payload size, and heap
movement.

Run:

```sh
make perf-hot-surfaces
node tools/perf/hot-surface-benchmark.mjs --json
node tools/perf/hot-surface-benchmark.mjs --rows 1000000 --columns 300 --steps 240
```

Interpretation:

- `dom-virtual-grid` approximates the current accessible WebView DOM fallback.
- `canvas-batched-grid` approximates a canvas/WebGPU-in-WebView path where the
  app batches visible text and paint operations.
- `webgl-rects-plus-text-grid` matches the current WebGL rectangle plus text
  canvas approach in `WebGlResultGrid`.
- `native-gpu-packed-ipc-grid` measures the payload pressure a native Rust GPU
  path would put on the WebView/native boundary.
- The editor rows compare CodeMirror's DOM viewport style with a hypothetical
  packed native text payload.

Recommendation captured by this spike:

- Keep the DOM result grid as the accessible fallback.
- Use the WebGL/canvas path for large result sets while it keeps per-frame work
  bounded by visible rows and columns.
- Do not move editor or grid rendering to a native Rust GPU path until a Tauri
  IPC profile proves packed payload size and synchronization can stay inside the
  frame budget on real user queries.
