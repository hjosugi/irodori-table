#!/usr/bin/env node
import { performance } from "node:perf_hooks";

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}

const fixture = {
  rows: options.rows,
  columns: options.columns,
  viewportRows: options.viewportRows,
  viewportColumns: options.viewportColumns,
  steps: options.steps,
  editorLines: options.editorLines,
  editorViewportLines: options.editorViewportLines,
};

const benchmarks = [
  ["dom-virtual-grid", benchDomVirtualGrid],
  ["canvas-batched-grid", benchCanvasBatchedGrid],
  ["webgl-rects-plus-text-grid", benchWebGlGrid],
  ["native-gpu-packed-ipc-grid", benchNativeGpuPackedIpcGrid],
  ["codemirror-dom-editor", benchEditorDomViewport],
  ["native-gpu-packed-ipc-editor", benchEditorPackedIpc],
];

const results = benchmarks.map(([name, run]) => measure(name, () => run(fixture)));

if (options.json) {
  console.log(JSON.stringify({ fixture, results }, null, 2));
} else {
  printMarkdown(fixture, results);
}

function measure(name, run) {
  if (global.gc) {
    global.gc();
  }
  const before = process.memoryUsage().heapUsed;
  const startedAt = performance.now();
  const detail = run();
  const elapsedMs = performance.now() - startedAt;
  const after = process.memoryUsage().heapUsed;
  return {
    name,
    elapsedMs,
    msPerStep: elapsedMs / detail.steps,
    heapDeltaMb: (after - before) / 1024 / 1024,
    ...detail,
  };
}

function benchDomVirtualGrid(input) {
  let renderedCells = 0;
  let textBytes = 0;
  let checksum = 0;
  for (let step = 0; step < input.steps; step += 1) {
    const rowStart = scrollStart(step, input.rows, input.viewportRows);
    const columnStart = scrollStart(step * 3, input.columns, input.viewportColumns);
    const nodes = [];
    for (let row = rowStart; row < rowStart + input.viewportRows; row += 1) {
      for (
        let column = columnStart;
        column < columnStart + input.viewportColumns;
        column += 1
      ) {
        const text = cellText(row, column);
        nodes.push({
          key: `${row}:${column}`,
          role: "cell",
          className: row % 2 === 0 ? "grid-cell" : "grid-cell alt",
          text,
        });
        renderedCells += 1;
        textBytes += text.length;
        checksum += text.charCodeAt(0);
      }
    }
    checksum += nodes.length;
  }
  return {
    steps: input.steps,
    renderedCells,
    textBytes,
    estimatedIpcBytes: 0,
    checksum,
  };
}

function benchCanvasBatchedGrid(input) {
  let renderedCells = 0;
  let textBytes = 0;
  let checksum = 0;
  for (let step = 0; step < input.steps; step += 1) {
    const rowStart = scrollStart(step, input.rows, input.viewportRows);
    const columnStart = scrollStart(step * 3, input.columns, input.viewportColumns);
    const textOps = [];
    for (let row = rowStart; row < rowStart + input.viewportRows; row += 1) {
      for (
        let column = columnStart;
        column < columnStart + input.viewportColumns;
        column += 1
      ) {
        const text = cellText(row, column);
        textOps.push([column * 144, row * 24, text]);
        renderedCells += 1;
        textBytes += text.length;
        checksum += text.length;
      }
    }
    checksum += textOps.length;
  }
  return {
    steps: input.steps,
    renderedCells,
    textBytes,
    estimatedIpcBytes: 0,
    checksum,
  };
}

function benchWebGlGrid(input) {
  let renderedCells = 0;
  let rects = 0;
  let textBytes = 0;
  let checksum = 0;
  for (let step = 0; step < input.steps; step += 1) {
    const rowStart = scrollStart(step, input.rows, input.viewportRows);
    const columnStart = scrollStart(step * 3, input.columns, input.viewportColumns);
    const rowRects = [];
    const textOps = [];
    for (let row = rowStart; row < rowStart + input.viewportRows; row += 1) {
      rowRects.push([0, row * 24, input.viewportColumns * 144, 24]);
      for (
        let column = columnStart;
        column < columnStart + input.viewportColumns;
        column += 1
      ) {
        const text = cellText(row, column);
        textOps.push(text);
        renderedCells += 1;
        textBytes += text.length;
        checksum += text.charCodeAt(text.length - 1);
      }
    }
    rects += rowRects.length;
    checksum += textOps.length;
  }
  return {
    steps: input.steps,
    renderedCells,
    rects,
    textBytes,
    estimatedIpcBytes: 0,
    checksum,
  };
}

function benchNativeGpuPackedIpcGrid(input) {
  const encoder = new TextEncoder();
  let renderedCells = 0;
  let estimatedIpcBytes = 0;
  let checksum = 0;
  for (let step = 0; step < input.steps; step += 1) {
    const rowStart = scrollStart(step, input.rows, input.viewportRows);
    const columnStart = scrollStart(step * 3, input.columns, input.viewportColumns);
    const offsets = new Uint32Array(input.viewportRows * input.viewportColumns + 1);
    const chunks = [];
    let cursor = 0;
    for (let row = rowStart; row < rowStart + input.viewportRows; row += 1) {
      for (
        let column = columnStart;
        column < columnStart + input.viewportColumns;
        column += 1
      ) {
        const bytes = encoder.encode(cellText(row, column));
        chunks.push(bytes);
        cursor += bytes.byteLength;
        offsets[chunks.length] = cursor;
        renderedCells += 1;
      }
    }
    const payload = new Uint8Array(cursor);
    let writeAt = 0;
    for (const chunk of chunks) {
      payload.set(chunk, writeAt);
      writeAt += chunk.byteLength;
    }
    estimatedIpcBytes += payload.byteLength + offsets.byteLength;
    checksum += payload[0] ?? 0;
  }
  return {
    steps: input.steps,
    renderedCells,
    textBytes: estimatedIpcBytes,
    estimatedIpcBytes,
    checksum,
  };
}

function benchEditorDomViewport(input) {
  let renderedLines = 0;
  let tokenCount = 0;
  let checksum = 0;
  for (let step = 0; step < input.steps; step += 1) {
    const lineStart = scrollStart(
      step * 7,
      input.editorLines,
      input.editorViewportLines,
    );
    const lineNodes = [];
    for (
      let line = lineStart;
      line < lineStart + input.editorViewportLines;
      line += 1
    ) {
      const tokens = sqlLine(line).split(/(\s+|[(),.*=])/).filter(Boolean);
      lineNodes.push(tokens.map((token) => ({ token, className: tokenClass(token) })));
      renderedLines += 1;
      tokenCount += tokens.length;
      checksum += tokens.length;
    }
    checksum += lineNodes.length;
  }
  return {
    steps: input.steps,
    renderedLines,
    tokenCount,
    textBytes: tokenCount * 8,
    estimatedIpcBytes: 0,
    checksum,
  };
}

function benchEditorPackedIpc(input) {
  const encoder = new TextEncoder();
  let renderedLines = 0;
  let estimatedIpcBytes = 0;
  let checksum = 0;
  for (let step = 0; step < input.steps; step += 1) {
    const lineStart = scrollStart(
      step * 7,
      input.editorLines,
      input.editorViewportLines,
    );
    const lines = [];
    for (
      let line = lineStart;
      line < lineStart + input.editorViewportLines;
      line += 1
    ) {
      lines.push(sqlLine(line));
      renderedLines += 1;
    }
    const payload = encoder.encode(lines.join("\n"));
    estimatedIpcBytes += payload.byteLength;
    checksum += payload[0] ?? 0;
  }
  return {
    steps: input.steps,
    renderedLines,
    textBytes: estimatedIpcBytes,
    estimatedIpcBytes,
    checksum,
  };
}

function cellText(row, column) {
  return `row_${row}_col_${column}_${(row * 2654435761 + column * 97 >>> 0).toString(16)}`;
}

function sqlLine(line) {
  return `select customer_id, sum(amount) as total_${line} from orders_${line % 32} where status = 'paid' and created_at >= :start_${line % 8} group by customer_id order by total_${line} desc;`;
}

function tokenClass(token) {
  if (/^(select|from|where|and|group|by|order|desc|as)$/i.test(token)) {
    return "keyword";
  }
  if (/^'.*'$/.test(token)) {
    return "string";
  }
  if (/^[(),.*=]$/.test(token)) {
    return "punctuation";
  }
  return "name";
}

function scrollStart(step, total, viewport) {
  return Math.min(Math.max(0, total - viewport), Math.floor((step * 997) % total));
}

function printMarkdown(input, results) {
  console.log("# Hot Surface Benchmark");
  console.log("");
  console.log(
    `Fixture: ${input.rows} rows x ${input.columns} columns, ${input.viewportRows}x${input.viewportColumns} grid viewport, ${input.editorLines} editor lines, ${input.steps} scroll steps.`,
  );
  console.log("");
  console.log("| Path | Total ms | ms/step | Heap delta MB | Rendered units | IPC MB |");
  console.log("|---|---:|---:|---:|---:|---:|");
  for (const result of results) {
    const units = result.renderedCells ?? result.renderedLines ?? 0;
    console.log(
      `| ${result.name} | ${result.elapsedMs.toFixed(2)} | ${result.msPerStep.toFixed(3)} | ${result.heapDeltaMb.toFixed(2)} | ${units} | ${((result.estimatedIpcBytes ?? 0) / 1024 / 1024).toFixed(2)} |`,
    );
  }
  console.log("");
  console.log("Recommendation:");
  console.log(
    "- Keep the DOM result grid as the accessible fallback and use the WebGL/canvas path for wide or very tall result sets.",
  );
  console.log(
    "- Treat native GPU as blocked on packed IPC: move only if payload measurements stay below the frame budget after real Tauri IPC profiling.",
  );
  console.log(
    "- Keep CodeMirror on its DOM viewport path until profiling shows editor layout, not query/result rendering, is the bottleneck.",
  );
}

function parseArgs(args) {
  const parsed = {
    columns: 200,
    editorLines: 100_000,
    editorViewportLines: 80,
    help: false,
    json: false,
    rows: 1_000_000,
    steps: 120,
    viewportColumns: 12,
    viewportRows: 42,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg.startsWith("--")) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${arg} requires a value`);
      }
      index += 1;
      const key = arg.slice(2).replace(/-([a-z])/g, (_, char) =>
        char.toUpperCase(),
      );
      if (!(key in parsed) || typeof parsed[key] !== "number") {
        throw new Error(`Unknown option: ${arg}`);
      }
      parsed[key] = positiveInteger(value, arg);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage: node tools/perf/hot-surface-benchmark.mjs [options]

Options:
  --rows N                  Synthetic result rows (default: 1000000)
  --columns N               Synthetic result columns (default: 200)
  --viewport-rows N         Visible result rows per frame (default: 42)
  --viewport-columns N      Visible result columns per frame (default: 12)
  --editor-lines N          Synthetic SQL document lines (default: 100000)
  --editor-viewport-lines N Visible editor lines per frame (default: 80)
  --steps N                 Scroll frames to simulate (default: 120)
  --json                    Emit JSON instead of Markdown
`);
}
