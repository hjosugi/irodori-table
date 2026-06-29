import { useEffect } from "react";
import type { ActionNotice } from "@/app/ActionToast";
import { queryService } from "@/features/workbench";
import type { WindowedRows } from "@/features/results";

function isPrimaryRefreshShortcut(event: KeyboardEvent) {
  const isRKey = event.key.toLowerCase() === "r" || event.code === "KeyR";
  if (!isRKey || event.altKey || event.shiftKey) {
    return false;
  }
  const mac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  return mac
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
}

export type PendingResultChangesGuardDeps = {
  pendingCount: number;
  resetEdits: () => void;
  showActionNotice: (
    kind: ActionNotice["kind"],
    title: string,
    detail?: string,
  ) => void;
};

export function usePendingResultChangesGuard({
  pendingCount,
  resetEdits,
  showActionNotice,
}: PendingResultChangesGuardDeps) {
  useEffect(() => {
    if (pendingCount === 0) {
      return;
    }
    const preventUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const interceptRefresh = (event: KeyboardEvent) => {
      if (!isPrimaryRefreshShortcut(event)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const discard = window.confirm(
        `Discard ${pendingCount} unsaved result change${pendingCount === 1 ? "" : "s"} and reload?`,
      );
      if (!discard) {
        showActionNotice(
          "info",
          "Reload cancelled",
          "Use Save Changes or Discard before refreshing.",
        );
        return;
      }
      resetEdits();
      window.location.reload();
    };
    window.addEventListener("beforeunload", preventUnload);
    window.addEventListener("keydown", interceptRefresh, { capture: true });
    return () => {
      window.removeEventListener("beforeunload", preventUnload);
      window.removeEventListener("keydown", interceptRefresh, {
        capture: true,
      });
    };
  }, [pendingCount, resetEdits, showActionNotice]);
}

export type ResultGridSpillPagingDeps = {
  spillInfo: { handle: string; total: number } | null;
  spillRef: { current: { handle: string; source: WindowedRows } | null };
  firstVisible: number;
  lastVisible: number;
  gridWindowVersion: number;
  beginPendingPage: (pageIndex: number, requestId: string) => boolean;
  endPendingPage: (pageIndex: number, requestId: string) => void;
  clearPendingPages: () => void;
  bumpGridWindowVersion: () => void;
};

export function useResultGridSpillPaging({
  spillInfo,
  spillRef,
  firstVisible,
  lastVisible,
  gridWindowVersion,
  beginPendingPage,
  endPendingPage,
  clearPendingPages,
  bumpGridWindowVersion,
}: ResultGridSpillPagingDeps) {
  useEffect(() => {
    const spill = spillRef.current;
    if (!spill || !spillInfo || spillInfo.handle !== spill.handle) {
      return;
    }
    const requests = spill.source.missingPages(firstVisible, lastVisible);
    if (requests.length === 0) {
      return;
    }
    const controller = new AbortController();
    const requestId =
      window.crypto?.randomUUID?.() ??
      `${spill.handle}:${firstVisible}:${lastVisible}:${performance.now()}`;
    void (async () => {
      for (const request of requests) {
        if (
          controller.signal.aborted ||
          !beginPendingPage(request.pageIndex, requestId)
        ) {
          continue;
        }
        try {
          const page = await queryService.resultWindow(
            spill.handle,
            request.offset,
            request.limit,
          );
          if (controller.signal.aborted) {
            return;
          }
          spill.source.ingest(Number(page.offset), page.rows);
          bumpGridWindowVersion();
        } catch {
          // Leave the rows as placeholders; a later scroll retries the page.
        } finally {
          endPendingPage(request.pageIndex, requestId);
        }
      }
    })();
    return () => {
      controller.abort();
      clearPendingPages();
    };
  }, [
    beginPendingPage,
    bumpGridWindowVersion,
    clearPendingPages,
    endPendingPage,
    spillInfo,
    spillRef,
    firstVisible,
    lastVisible,
    gridWindowVersion,
  ]);
}
