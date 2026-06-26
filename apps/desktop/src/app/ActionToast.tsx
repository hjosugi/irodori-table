import { X } from "lucide-react";

export type ActionNotice = {
  id: number;
  kind: "success" | "error" | "info";
  title: string;
  detail?: string;
};

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
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={onDismiss}
      >
        <X size={13} />
      </button>
    </div>
  );
}
