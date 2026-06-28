import { type RefObject, type UIEvent, useEffect, useRef } from "react";
import {
  useResultGridStore,
  type SelectedCell,
  type ResultCellRange,
} from "@/features/results";

type ValueUpdater<T> = T | ((current: T) => T);

type UseResultGridScrollParams = {
  gridRef: RefObject<HTMLDivElement | null>;
  /** Re-measures the viewport whenever the active result changes. */
  result: unknown;
  gridRowHeight: number;
  gridGutterWidth: number;
  gridColumnWidth: number;
  setSelectedRowKey: (value: ValueUpdater<string | null>) => void;
  setSelectedCell: (value: ValueUpdater<SelectedCell>) => void;
  setSelectedRange: (value: ValueUpdater<ResultCellRange>) => void;
};

/**
 * Owns the result grid's scroll/viewport wiring: the RAF-throttled scroll
 * handler, the viewport ResizeObserver, and the scroll helper functions. The
 * scroll/viewport state lives in `useResultGridStore`; this hook simply
 * relocates that wiring out of `AppWorkbench`.
 */
export function useResultGridScroll({
  gridRef,
  result,
  gridRowHeight,
  gridGutterWidth,
  gridColumnWidth,
  setSelectedRowKey,
  setSelectedCell,
  setSelectedRange,
}: UseResultGridScrollParams) {
  const gridScrollRaf = useRef<number | null>(null);
  const pendingGridScroll = useRef({ top: 0, left: 0 });
  const gridScrollTop = useResultGridStore((state) => state.gridScrollTop);
  const setGridScrollTop = useResultGridStore(
    (state) => state.setGridScrollTop,
  );
  const gridScrollLeft = useResultGridStore((state) => state.gridScrollLeft);
  const setGridScrollLeft = useResultGridStore(
    (state) => state.setGridScrollLeft,
  );
  const gridViewportHeight = useResultGridStore(
    (state) => state.gridViewportHeight,
  );
  const setGridViewportHeight = useResultGridStore(
    (state) => state.setGridViewportHeight,
  );
  const gridViewportWidth = useResultGridStore(
    (state) => state.gridViewportWidth,
  );
  const setGridViewportWidth = useResultGridStore(
    (state) => state.setGridViewportWidth,
  );

  // Track the result grid viewport so both row and column windows cover it.
  useEffect(() => {
    const element = gridRef.current;
    if (!element) {
      return;
    }
    const measure = () => {
      setGridViewportHeight(element.clientHeight);
      setGridViewportWidth(element.clientWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [result]);

  function onGridScroll(event: UIEvent<HTMLDivElement>) {
    pendingGridScroll.current = {
      top: event.currentTarget.scrollTop,
      left: event.currentTarget.scrollLeft,
    };
    if (gridScrollRaf.current != null) {
      return;
    }
    gridScrollRaf.current = requestAnimationFrame(() => {
      gridScrollRaf.current = null;
      setGridScrollTop(pendingGridScroll.current.top);
      setGridScrollLeft(pendingGridScroll.current.left);
    });
  }

  function resetGridScrollPosition(clearSelection = false) {
    if (gridRef.current) {
      gridRef.current.scrollTop = 0;
      gridRef.current.scrollLeft = 0;
    }
    setGridScrollTop(0);
    setGridScrollLeft(0);
    if (clearSelection) {
      setSelectedRowKey(null);
      setSelectedCell(null);
      setSelectedRange(null);
    }
  }

  function scrollGridCellIntoView(rowIndex: number, col: number) {
    const element = gridRef.current;
    if (!element) {
      return;
    }
    const targetTop = rowIndex * gridRowHeight;
    const targetBottom = targetTop + gridRowHeight;
    let nextTop = element.scrollTop;
    if (targetTop < element.scrollTop) {
      nextTop = targetTop;
    } else if (targetBottom > element.scrollTop + element.clientHeight) {
      nextTop = targetBottom - element.clientHeight;
    }

    const targetLeft = gridGutterWidth + col * gridColumnWidth;
    const targetRight = targetLeft + gridColumnWidth;
    let nextLeft = element.scrollLeft;
    if (targetLeft < element.scrollLeft) {
      nextLeft = targetLeft;
    } else if (targetRight > element.scrollLeft + element.clientWidth) {
      nextLeft = targetRight - element.clientWidth;
    }

    element.scrollTop = Math.max(0, nextTop);
    element.scrollLeft = Math.max(0, nextLeft);
    setGridScrollTop(element.scrollTop);
    setGridScrollLeft(element.scrollLeft);
  }

  return {
    gridScrollTop,
    gridScrollLeft,
    gridViewportHeight,
    gridViewportWidth,
    setGridScrollTop,
    setGridScrollLeft,
    onGridScroll,
    resetGridScrollPosition,
    scrollGridCellIntoView,
  };
}
