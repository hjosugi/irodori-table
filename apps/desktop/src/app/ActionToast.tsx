import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

export type ActionNoticeAction = {
  label: string;
  run: () => void;
};

export type ActionNotice = {
  id: number;
  kind: "success" | "error" | "info";
  title: string;
  detail?: string;
  action?: ActionNoticeAction;
};

export type ShowActionNotice = (
  kind: ActionNotice["kind"],
  title: string,
  detail?: string,
  options?: { action?: ActionNoticeAction },
) => void;

const MAX_VISIBLE_NOTICES = 4;
// Errors stay until dismissed so a failure can't silently scroll away while
// the user is looking elsewhere; success/info auto-dismiss.
const DISMISS_DELAY_MS: Record<ActionNotice["kind"], number | null> = {
  success: 3200,
  info: 3200,
  error: null,
};

/**
 * Queue of workbench notifications. Notices stack (newest at the bottom)
 * instead of overwriting each other; the queue is capped so rapid failures
 * drop the oldest entry rather than growing without bound.
 */
export function useActionNotices() {
  const [notices, setNotices] = useState<ActionNotice[]>([]);
  const timersRef = useRef(new Map<number, number>());
  const nextIdRef = useRef(1);

  const clearTimer = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const dismissNotice = useCallback(
    (id: number) => {
      clearTimer(id);
      setNotices((current) => current.filter((notice) => notice.id !== id));
    },
    [clearTimer],
  );

  const showActionNotice = useCallback<ShowActionNotice>(
    (kind, title, detail, options) => {
      const id = nextIdRef.current++;
      setNotices((current) => {
        const next = [
          ...current,
          { id, kind, title, detail, action: options?.action },
        ];
        const overflow = next.length - MAX_VISIBLE_NOTICES;
        if (overflow <= 0) {
          return next;
        }
        for (const dropped of next.slice(0, overflow)) {
          clearTimer(dropped.id);
        }
        return next.slice(overflow);
      });
      const delay = DISMISS_DELAY_MS[kind];
      if (delay !== null) {
        timersRef.current.set(
          id,
          window.setTimeout(() => dismissNotice(id), delay),
        );
      }
    },
    [clearTimer, dismissNotice],
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) {
        window.clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

  return { notices, showActionNotice, dismissNotice };
}

export function ActionToast({
  notice,
  onDismiss,
}: {
  notice: ActionNotice;
  onDismiss: () => void;
}) {
  return (
    <div
      className={`action-toast ${notice.kind}`}
      role={notice.kind === "error" ? "alert" : "status"}
      aria-live={notice.kind === "error" ? "assertive" : "polite"}
    >
      <span className="action-toast-mark" aria-hidden="true" />
      <span>
        <strong>{notice.title}</strong>
        {notice.detail ? <small>{notice.detail}</small> : null}
      </span>
      <span className="action-toast-controls">
        {notice.action ? (
          <button
            type="button"
            className="action-toast-action"
            onClick={() => {
              notice.action?.run();
              onDismiss();
            }}
          >
            {notice.action.label}
          </button>
        ) : null}
        <button
          type="button"
          aria-label="Dismiss notification"
          onClick={onDismiss}
        >
          <X size={13} />
        </button>
      </span>
    </div>
  );
}

export function ActionToastStack({
  notices,
  onDismiss,
}: {
  notices: readonly ActionNotice[];
  onDismiss: (id: number) => void;
}) {
  if (notices.length === 0) {
    return null;
  }
  return (
    <div className="action-toast-stack">
      {notices.map((notice) => (
        <ActionToast
          key={notice.id}
          notice={notice}
          onDismiss={() => onDismiss(notice.id)}
        />
      ))}
    </div>
  );
}
