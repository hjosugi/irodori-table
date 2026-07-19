import { useEffect } from "react";
import type { ActionNotice } from "@/app/ActionToast";
import { isMac } from "@/core/platform";
import type { ConfirmOptions } from "@/components/ConfirmDialog";
import { queryService } from "@/features/workbench";
import type { WindowedRows } from "@/features/results";
import type { Translator } from "@/i18n";

function isPrimaryRefreshShortcut(event: KeyboardEvent) {
  const isRKey = event.key.toLowerCase() === "r" || event.code === "KeyR";
  if (!isRKey || event.altKey || event.shiftKey) {
    return false;
  }
  return isMac
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
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  t: Translator["t"];
};

export function usePendingResultChangesGuard({
  pendingCount,
  resetEdits,
  showActionNotice,
  confirm,
  t,
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
      void (async () => {
        const discard = await confirm({
          title: t("grid.confirmDiscardReload.title", { count: pendingCount }),
          confirmLabel: t("grid.confirmDiscardReload.confirm"),
          tone: "danger",
        });
        if (!discard) {
          showActionNotice(
            "info",
            t("notice.grid.reloadCancelled"),
            t("notice.grid.reloadCancelledDetail"),
          );
          return;
        }
        resetEdits();
        window.location.reload();
      })();
    };
    window.addEventListener("beforeunload", preventUnload);
    window.addEventListener("keydown", interceptRefresh, { capture: true });
    return () => {
      window.removeEventListener("beforeunload", preventUnload);
      window.removeEventListener("keydown", interceptRefresh, {
        capture: true,
      });
    };
  }, [confirm, pendingCount, resetEdits, showActionNotice, t]);
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
