import {
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type UIEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ResultSortRule } from "@/features/results/result-grid";
import type {
  ResultGridDisplayRow,
  ResultGridSortRuleView,
} from "@/features/results/result-view-model";
import { resultCellInRange } from "../result-selection";
import type { ResultCellRangeBounds, SelectedCell } from "../types";
import {
  hitTestWebGlResultGrid,
  parseWebGlColor,
  webGlResultGridScrollSize,
  type WebGlRgba,
} from "../webgl-grid";

type WebGlResultGridProps = {
  columns: readonly string[];
  totalRows: number;
  visibleRows: readonly ResultGridDisplayRow[];
  visibleColumnIndexes: readonly number[];
  firstVisible: number;
  rowHeight: number;
  columnWidth: number;
  gridRef: RefObject<HTMLDivElement | null>;
  selectedRowKey: string | null;
  selectedCell: SelectedCell;
  selectedRangeBounds: ResultCellRangeBounds;
  sortRuleByColumn: ReadonlyMap<number, ResultGridSortRuleView>;
  sortRules: readonly ResultSortRule[];
  running: boolean;
  filtersActive: boolean;
  unfilteredRowCount: number;
  onGridScroll: (event: UIEvent<HTMLDivElement>) => void;
  onGridKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onGridPaste: (event: ReactClipboardEvent<HTMLDivElement>) => void;
  onGridCopy: (event: ReactClipboardEvent<HTMLDivElement>) => void;
  onToggleSort: (col: number, additive?: boolean) => void;
  onSelectGridRow: (rowKey: string, focusGrid?: boolean) => void;
  onSelectGridCell: (rowKey: string, col: number, extendRange?: boolean) => void;
};

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type WebGlRectPainter = {
  clear: (color: WebGlRgba, width: number, height: number) => void;
  rects: (rects: readonly Rect[], color: WebGlRgba) => void;
};

type DrawColors = {
  activeText: string;
  amber: string;
  border: string;
  editorBg: string;
  focus: string;
  gridHeader: string;
  gridRowAlt: string;
  green: string;
  muted: string;
  selectedStrong: string;
  text: string;
  warningBg: string;
};

const canvasFont =
  '12px "SFMono-Regular", Consolas, "Liberation Mono", monospace';

export function WebGlResultGrid({
  columns,
  totalRows,
  visibleRows,
  visibleColumnIndexes,
  firstVisible,
  rowHeight,
  columnWidth,
  gridRef,
  selectedRowKey,
  selectedCell,
  selectedRangeBounds,
  sortRuleByColumn,
  sortRules,
  running,
  filtersActive,
  unfilteredRowCount,
  onGridScroll,
  onGridKeyDown,
  onGridPaste,
  onGridCopy,
  onToggleSort,
  onSelectGridRow,
  onSelectGridCell,
}: WebGlResultGridProps) {
  const glCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const textCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const painterRef = useRef<WebGlRectPainter | null>(null);
  const [webGlAvailable, setWebGlAvailable] = useState<boolean | null>(null);
  const [viewport, setViewport] = useState({ width: 900, height: 360 });

  const scrollSize = webGlResultGridScrollSize({
    columnCount: columns.length,
    columnWidth,
    headerHeight: rowHeight,
    rowCount: totalRows,
    rowHeight,
  });
  const scrollTop = gridRef.current?.scrollTop ?? 0;
  const scrollLeft = gridRef.current?.scrollLeft ?? 0;

  useLayoutEffect(() => {
    const element = gridRef.current;
    if (!element) {
      return;
    }
    const updateViewport = () => {
      setViewport({
        width: Math.max(1, element.clientWidth),
        height: Math.max(1, element.clientHeight),
      });
    };
    updateViewport();
    const observer = new ResizeObserver(updateViewport);
    observer.observe(element);
    return () => observer.disconnect();
  }, [gridRef]);

  useLayoutEffect(() => {
    const canvas = glCanvasRef.current;
    if (!canvas) {
      return;
    }
    if (!painterRef.current) {
      painterRef.current = createWebGlRectPainter(canvas);
      setWebGlAvailable(painterRef.current !== null);
    }
  }, []);

  useLayoutEffect(() => {
    const element = gridRef.current;
    const glCanvas = glCanvasRef.current;
    const textCanvas = textCanvasRef.current;
    const painter = painterRef.current;
    if (!element || !glCanvas || !textCanvas || !painter) {
      return;
    }

    const style = getComputedStyle(element);
    const colors = readGridColors(style);
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    resizeCanvas(glCanvas, viewport.width, viewport.height, dpr);
    resizeCanvas(textCanvas, viewport.width, viewport.height, dpr);
    drawWebGlLayer({
      columnWidth,
      colors,
      columns,
      firstVisible,
      painter,
      rowHeight,
      scrollLeft,
      scrollTop,
      selectedCell,
      selectedRangeBounds,
      selectedRowKey,
      totalRows,
      viewport,
      visibleColumnIndexes,
      visibleRows,
    });
    drawTextLayer({
      canvas: textCanvas,
      columnWidth,
      colors,
      columns,
      dpr,
      firstVisible,
      rowHeight,
      scrollLeft,
      scrollTop,
      selectedCell,
      selectedRangeBounds,
      sortRuleByColumn,
      sortRules,
      viewport,
      visibleColumnIndexes,
      visibleRows,
    });
  }, [
    columnWidth,
    columns,
    firstVisible,
    gridRef,
    rowHeight,
    scrollLeft,
    scrollTop,
    selectedCell,
    selectedRangeBounds,
    selectedRowKey,
    sortRuleByColumn,
    sortRules,
    totalRows,
    viewport,
    visibleColumnIndexes,
    visibleRows,
  ]);

  if (running && totalRows === 0) {
    return (
      <GridState
        gridRef={gridRef}
        label="Running query..."
        onGridCopy={onGridCopy}
        onGridKeyDown={onGridKeyDown}
        onGridPaste={onGridPaste}
        onGridScroll={onGridScroll}
      />
    );
  }

  if (!running && totalRows === 0) {
    return (
      <GridState
        gridRef={gridRef}
        label={
          filtersActive && unfilteredRowCount > 0
            ? "No rows match filters"
            : "No rows returned"
        }
        onGridCopy={onGridCopy}
        onGridKeyDown={onGridKeyDown}
        onGridPaste={onGridPaste}
        onGridScroll={onGridScroll}
      />
    );
  }

  if (webGlAvailable === false) {
    return (
      <GridState
        gridRef={gridRef}
        label="WebGL unavailable"
        onGridCopy={onGridCopy}
        onGridKeyDown={onGridKeyDown}
        onGridPaste={onGridPaste}
        onGridScroll={onGridScroll}
      />
    );
  }

  return (
    <div
      className="webgl-result-grid"
      role="table"
      aria-label="Query result WebGL preview"
      aria-rowcount={totalRows + 1}
      aria-colcount={columns.length}
      ref={gridRef}
      tabIndex={0}
      onScroll={onGridScroll}
      onKeyDown={onGridKeyDown}
      onPaste={onGridPaste}
      onCopy={onGridCopy}
    >
      <div
        className="webgl-result-space"
        style={{
          width: scrollSize.width,
          height: scrollSize.height,
        }}
        aria-hidden="true"
      />
      <div
        className="webgl-result-layer"
        style={{
          width: viewport.width,
          height: viewport.height,
          transform: `translate(${scrollLeft}px, ${scrollTop}px)`,
        }}
        onPointerDown={() => gridRef.current?.focus()}
        onClick={(event) => {
          const hit = hitFromPointerEvent(event, {
            columnCount: columns.length,
            columnWidth,
            gridRef,
            rowHeight,
            totalRows,
          });
          if (!hit) {
            return;
          }
          if (hit.kind === "header") {
            onToggleSort(hit.columnIndex, event.shiftKey);
            return;
          }
          const row = visibleRows[hit.rowIndex - firstVisible];
          if (!row) {
            return;
          }
          onSelectGridRow(row.key, true);
          onSelectGridCell(row.key, hit.columnIndex, event.shiftKey);
        }}
      >
        <canvas ref={glCanvasRef} aria-hidden="true" />
        <canvas ref={textCanvasRef} aria-hidden="true" />
      </div>
    </div>
  );
}

function GridState({
  gridRef,
  label,
  onGridCopy,
  onGridKeyDown,
  onGridPaste,
  onGridScroll,
}: {
  gridRef: RefObject<HTMLDivElement | null>;
  label: string;
  onGridScroll: (event: UIEvent<HTMLDivElement>) => void;
  onGridKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onGridPaste: (event: ReactClipboardEvent<HTMLDivElement>) => void;
  onGridCopy: (event: ReactClipboardEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      className="result-grid"
      role="table"
      aria-label="Query result WebGL preview"
      ref={gridRef}
      tabIndex={0}
      onScroll={onGridScroll}
      onKeyDown={onGridKeyDown}
      onPaste={onGridPaste}
      onCopy={onGridCopy}
    >
      <div className="grid-state" role="status">
        {label}
      </div>
    </div>
  );
}

function hitFromPointerEvent(
  event:
    | ReactPointerEvent<HTMLDivElement>
    | ReactMouseEvent<HTMLDivElement>,
  {
    columnCount,
    columnWidth,
    gridRef,
    rowHeight,
    totalRows,
  }: {
    columnCount: number;
    columnWidth: number;
    gridRef: RefObject<HTMLDivElement | null>;
    rowHeight: number;
    totalRows: number;
  },
) {
  const rect = event.currentTarget.getBoundingClientRect();
  return hitTestWebGlResultGrid({
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    scrollLeft: gridRef.current?.scrollLeft ?? 0,
    scrollTop: gridRef.current?.scrollTop ?? 0,
    headerHeight: rowHeight,
    rowHeight,
    columnWidth,
    rowCount: totalRows,
    columnCount,
  });
}

function readGridColors(style: CSSStyleDeclaration): DrawColors {
  return {
    activeText: cssVar(style, "--accent-text", "#ffffff"),
    amber: cssVar(style, "--amber", "#d7ba7d"),
    border: cssVar(style, "--cell-border", "#2d2d30"),
    editorBg: cssVar(style, "--editor-bg", "#1e1e1e"),
    focus: cssVar(style, "--focus", "#007fd4"),
    gridHeader: cssVar(style, "--grid-header", "#252526"),
    gridRowAlt: cssVar(style, "--grid-row-alt", "#1b1b1b"),
    green: cssVar(style, "--green", "#89d185"),
    muted: cssVar(style, "--muted", "#858585"),
    selectedStrong: cssVar(style, "--selected-strong", "#094771"),
    text: cssVar(style, "--text", "#cccccc"),
    warningBg: cssVar(style, "--warning-bg", "#3a3219"),
  };
}

function cssVar(style: CSSStyleDeclaration, name: string, fallback: string) {
  return style.getPropertyValue(name).trim() || fallback;
}

function drawWebGlLayer({
  columnWidth,
  colors,
  columns,
  firstVisible,
  painter,
  rowHeight,
  scrollLeft,
  scrollTop,
  selectedCell,
  selectedRangeBounds,
  selectedRowKey,
  totalRows,
  viewport,
  visibleColumnIndexes,
  visibleRows,
}: {
  columnWidth: number;
  colors: DrawColors;
  columns: readonly string[];
  firstVisible: number;
  painter: WebGlRectPainter;
  rowHeight: number;
  scrollLeft: number;
  scrollTop: number;
  selectedCell: SelectedCell;
  selectedRangeBounds: ResultCellRangeBounds;
  selectedRowKey: string | null;
  totalRows: number;
  viewport: { width: number; height: number };
  visibleColumnIndexes: readonly number[];
  visibleRows: readonly ResultGridDisplayRow[];
}) {
  const editorBg = parseWebGlColor(colors.editorBg, [0.1, 0.1, 0.1, 1]);
  painter.clear(editorBg, viewport.width, viewport.height);
  painter.rects(
    [{ x: 0, y: 0, width: viewport.width, height: rowHeight }],
    parseWebGlColor(colors.gridHeader, editorBg),
  );

  const altRects: Rect[] = [];
  const selectedRects: Rect[] = [];
  const rangeRects: Rect[] = [];
  const editedRects: Rect[] = [];
  const newRects: Rect[] = [];
  for (const [visibleIndex, row] of visibleRows.entries()) {
    const rowIndex = firstVisible + visibleIndex;
    const y = rowHeight + rowIndex * rowHeight - scrollTop;
    if (y > viewport.height || y + rowHeight < rowHeight) {
      continue;
    }
    const rect = { x: 0, y, width: viewport.width, height: rowHeight };
    if (row.key === selectedRowKey) {
      selectedRects.push(rect);
    } else if (row.state === "edited") {
      editedRects.push(rect);
    } else if (row.state === "new") {
      newRects.push(rect);
    } else if (rowIndex % 2 === 1) {
      altRects.push(rect);
    }
    if (
      selectedRangeBounds &&
      rowIndex >= selectedRangeBounds.rowStart &&
      rowIndex <= selectedRangeBounds.rowEnd
    ) {
      for (const columnIndex of visibleColumnIndexes) {
        if (
          columnIndex < selectedRangeBounds.colStart ||
          columnIndex > selectedRangeBounds.colEnd
        ) {
          continue;
        }
        rangeRects.push({
          x: columnIndex * columnWidth - scrollLeft,
          y,
          width: columnWidth,
          height: rowHeight,
        });
      }
    }
  }
  painter.rects(altRects, parseWebGlColor(colors.gridRowAlt, editorBg));
  painter.rects(editedRects, parseWebGlColor(colors.warningBg, editorBg));
  painter.rects(newRects, parseWebGlColor(colors.green, editorBg));
  painter.rects(rangeRects, parseWebGlColor(colors.selectedStrong, editorBg));
  painter.rects(
    selectedRects,
    parseWebGlColor(colors.selectedStrong, editorBg),
  );

  if (selectedCell) {
    const rowIndex = visibleRows.findIndex((row) => row.key === selectedCell.key);
    const selectedColumnVisible = visibleColumnIndexes.includes(selectedCell.col);
    if (rowIndex >= 0 && selectedColumnVisible) {
      const logicalRowIndex = firstVisible + rowIndex;
      painter.rects(
        [
          {
            x: selectedCell.col * columnWidth - scrollLeft,
            y: rowHeight + logicalRowIndex * rowHeight - scrollTop,
            width: columnWidth,
            height: rowHeight,
          },
        ],
        parseWebGlColor(colors.focus, [0, 0.5, 1, 1]),
      );
    }
  }

  const gridLineRects: Rect[] = [];
  for (const columnIndex of visibleColumnIndexes) {
    const x = columnIndex * columnWidth - scrollLeft;
    gridLineRects.push({ x, y: 0, width: 1, height: viewport.height });
    gridLineRects.push({
      x: x + columnWidth - 1,
      y: 0,
      width: 1,
      height: viewport.height,
    });
  }
  gridLineRects.push({ x: 0, y: rowHeight - 1, width: viewport.width, height: 1 });
  const firstLine = Math.max(0, Math.floor(scrollTop / rowHeight) - 1);
  const lastLine = Math.min(
    totalRows,
    firstLine + Math.ceil(viewport.height / rowHeight) + 4,
  );
  for (let rowIndex = firstLine; rowIndex <= lastLine; rowIndex += 1) {
    const y = rowHeight + rowIndex * rowHeight - scrollTop - 1;
    if (y >= rowHeight && y <= viewport.height) {
      gridLineRects.push({ x: 0, y, width: viewport.width, height: 1 });
    }
  }
  if (columns.length > 0) {
    painter.rects(gridLineRects, parseWebGlColor(colors.border, editorBg));
  }
}

function drawTextLayer({
  canvas,
  columnWidth,
  colors,
  columns,
  dpr,
  firstVisible,
  rowHeight,
  scrollLeft,
  scrollTop,
  selectedCell,
  selectedRangeBounds,
  sortRuleByColumn,
  sortRules,
  viewport,
  visibleColumnIndexes,
  visibleRows,
}: {
  canvas: HTMLCanvasElement;
  columnWidth: number;
  colors: DrawColors;
  columns: readonly string[];
  dpr: number;
  firstVisible: number;
  rowHeight: number;
  scrollLeft: number;
  scrollTop: number;
  selectedCell: SelectedCell;
  selectedRangeBounds: ResultCellRangeBounds;
  sortRuleByColumn: ReadonlyMap<number, ResultGridSortRuleView>;
  sortRules: readonly ResultSortRule[];
  viewport: { width: number; height: number };
  visibleColumnIndexes: readonly number[];
  visibleRows: readonly ResultGridDisplayRow[];
}) {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, viewport.width, viewport.height);
  ctx.font = canvasFont;
  ctx.textBaseline = "middle";

  for (const columnIndex of visibleColumnIndexes) {
    const x = columnIndex * columnWidth - scrollLeft;
    const sortRule = sortRuleByColumn.get(columnIndex);
    const suffix = sortRule
      ? ` ${sortRule.direction === "asc" ? "^" : "v"}${
          sortRules.length > 1 ? sortRule.priority : ""
        }`
      : "";
    drawClippedText(ctx, `${columns[columnIndex] ?? ""}${suffix}`, {
      color: sortRule ? colors.text : colors.muted,
      maxWidth: columnWidth - 16,
      textStyle: "700",
      x: x + 8,
      y: rowHeight / 2,
    });
  }

  for (const [visibleIndex, row] of visibleRows.entries()) {
    const rowIndex = firstVisible + visibleIndex;
    const y = rowHeight + rowIndex * rowHeight - scrollTop;
    if (y > viewport.height || y + rowHeight < rowHeight) {
      continue;
    }
    for (const columnIndex of visibleColumnIndexes) {
      const x = columnIndex * columnWidth - scrollLeft;
      const cell = row.cells[columnIndex] ?? "";
      const isSelected =
        selectedCell?.key === row.key && selectedCell.col === columnIndex;
      const isRangeSelected = resultCellInRange(
        rowIndex,
        columnIndex,
        selectedRangeBounds,
      );
      const isNullish = cell === "NULL" || cell === "";
      drawClippedText(ctx, cell === "" ? "EMPTY" : cell, {
        color: isSelected
          ? colors.activeText
          : isNullish && !isRangeSelected
            ? colors.muted
            : row.state === "edited"
              ? colors.amber
              : colors.text,
        maxWidth: columnWidth - 16,
        textStyle: isNullish ? "italic" : "400",
        x: x + 8,
        y: y + rowHeight / 2,
      });
    }
  }
}

function drawClippedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  {
    color,
    maxWidth,
    textStyle,
    x,
    y,
  }: {
    color: string;
    maxWidth: number;
    textStyle: string;
    x: number;
    y: number;
  },
) {
  if (maxWidth <= 4) {
    return;
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y - 11, maxWidth, 22);
  ctx.clip();
  ctx.fillStyle = color;
  ctx.font = `${textStyle} ${canvasFont}`;
  ctx.fillText(ellipsizeText(ctx, text, maxWidth), x, y);
  ctx.restore();
}

function ellipsizeText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
) {
  if (ctx.measureText(text).width <= maxWidth) {
    return text;
  }
  const ellipsis = "...";
  let left = 0;
  let right = text.length;
  while (left < right) {
    const mid = Math.ceil((left + right) / 2);
    if (ctx.measureText(`${text.slice(0, mid)}${ellipsis}`).width <= maxWidth) {
      left = mid;
    } else {
      right = mid - 1;
    }
  }
  return `${text.slice(0, left)}${ellipsis}`;
}

function resizeCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  dpr: number,
) {
  const pixelWidth = Math.max(1, Math.floor(width * dpr));
  const pixelHeight = Math.max(1, Math.floor(height * dpr));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
}

function createWebGlRectPainter(
  canvas: HTMLCanvasElement,
): WebGlRectPainter | null {
  const attrs = { alpha: false, antialias: false, depth: false, stencil: false };
  const gl = (canvas.getContext("webgl2", attrs) ??
    canvas.getContext("webgl", attrs)) as
    | WebGLRenderingContext
    | WebGL2RenderingContext
    | null;
  if (!gl) {
    return null;
  }
  const program = createProgram(gl);
  if (!program) {
    return null;
  }
  const positionLocation = gl.getAttribLocation(program, "a_position");
  const resolutionLocation = gl.getUniformLocation(program, "u_resolution");
  const colorLocation = gl.getUniformLocation(program, "u_color");
  const buffer = gl.createBuffer();
  if (positionLocation < 0 || !resolutionLocation || !colorLocation || !buffer) {
    return null;
  }

  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  return {
    clear: (color, width, height) => {
      gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
      gl.useProgram(program);
      gl.uniform2f(resolutionLocation, width, height);
      gl.clearColor(color[0], color[1], color[2], color[3]);
      gl.clear(gl.COLOR_BUFFER_BIT);
    },
    rects: (rects, color) => {
      if (rects.length === 0) {
        return;
      }
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.uniform4f(colorLocation, color[0], color[1], color[2], color[3]);
      gl.bufferData(gl.ARRAY_BUFFER, rectVertexData(rects), gl.STREAM_DRAW);
      gl.drawArrays(gl.TRIANGLES, 0, rects.length * 6);
    },
  };
}

function rectVertexData(rects: readonly Rect[]) {
  const data = new Float32Array(rects.length * 12);
  let offset = 0;
  for (const rect of rects) {
    const x1 = rect.x;
    const y1 = rect.y;
    const x2 = rect.x + rect.width;
    const y2 = rect.y + rect.height;
    data.set([x1, y1, x2, y1, x1, y2, x1, y2, x2, y1, x2, y2], offset);
    offset += 12;
  }
  return data;
}

function createProgram(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
): WebGLProgram | null {
  const vertexShader = compileShader(
    gl,
    gl.VERTEX_SHADER,
    `
      attribute vec2 a_position;
      uniform vec2 u_resolution;
      void main() {
        vec2 zeroToOne = a_position / u_resolution;
        vec2 clipSpace = zeroToOne * 2.0 - 1.0;
        gl_Position = vec4(clipSpace * vec2(1.0, -1.0), 0.0, 1.0);
      }
    `,
  );
  const fragmentShader = compileShader(
    gl,
    gl.FRAGMENT_SHADER,
    `
      precision mediump float;
      uniform vec4 u_color;
      void main() {
        gl_FragColor = u_color;
      }
    `,
  );
  if (!vertexShader || !fragmentShader) {
    return null;
  }
  const program = gl.createProgram();
  if (!program) {
    return null;
  }
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    return null;
  }
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  return program;
}

function compileShader(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  type: number,
  source: string,
) {
  const shader = gl.createShader(type);
  if (!shader) {
    return null;
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}
