import { useCallback, useState, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { DialogShell } from "./DialogShell";

export type ConfirmTone = "danger" | "default";

export type ConfirmOptions = {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
};

type ConfirmDialogProps = ConfirmOptions & {
  open: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Shared confirmation modal for destructive or irreversible actions. Cancel is
 * the first focusable control (DialogShell autofocuses it), so a stray Enter
 * never confirms a delete. Pair with {@link useConfirm} for ad-hoc prompts.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) {
    return null;
  }
  return (
    <DialogShell
      onClose={onCancel}
      className="data-dialog confirm-dialog"
      label={title}
      closeOnOverlayClick={!busy}
      closeOnEscape={!busy}
    >
      <div className="dialog-header">
        {tone === "danger" ? (
          <AlertTriangle
            size={16}
            className="confirm-danger-icon"
            aria-hidden="true"
          />
        ) : null}
        <strong>{title}</strong>
      </div>
      {message != null ? (
        <div className="dialog-body confirm-body">{message}</div>
      ) : null}
      <div className="dialog-footer">
        <button
          type="button"
          className="text-button"
          onClick={onCancel}
          disabled={busy}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          className={
            tone === "danger" ? "text-button danger" : "text-button primary"
          }
          onClick={onConfirm}
          disabled={busy}
        >
          {confirmLabel}
        </button>
      </div>
    </DialogShell>
  );
}

type ConfirmState = ConfirmOptions & {
  resolve: (confirmed: boolean) => void;
};

/**
 * Imperative confirmation prompt. Returns `confirm(options) => Promise<boolean>`
 * and the `confirmElement` to render once near the owner. Lets any handler gate
 * a destructive action with `if (!(await confirm({...}))) return;` without
 * threading per-action dialog state.
 */
export function useConfirm() {
  const [state, setState] = useState<ConfirmState | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setState({ ...options, resolve });
      }),
    [],
  );

  const settle = useCallback((confirmed: boolean) => {
    setState((current) => {
      current?.resolve(confirmed);
      return null;
    });
  }, []);

  const confirmElement = state ? (
    <ConfirmDialog
      open
      title={state.title}
      message={state.message}
      confirmLabel={state.confirmLabel}
      cancelLabel={state.cancelLabel}
      tone={state.tone}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  ) : null;

  return { confirm, confirmElement };
}
