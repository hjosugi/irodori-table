import { useCallback, useState, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { usePreferencesStore } from "@/features/preferences";
import { createTranslator } from "@/i18n";
import { DialogShell } from "./DialogShell";

export type ConfirmTone = "danger" | "default";

export type ConfirmOptions = {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
  // Acknowledgement-only dialogs (alert replacement): no cancel button.
  hideCancel?: boolean;
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
  confirmLabel,
  cancelLabel,
  tone = "default",
  hideCancel = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  // Resolve default button labels through i18n so callers that omit labels
  // don't show English buttons in other locales.
  const locale = usePreferencesStore((state) => state.locale);
  const { t } = createTranslator(locale);
  if (!open) {
    return null;
  }
  const resolvedConfirmLabel = confirmLabel ?? t("common.confirm");
  const resolvedCancelLabel = cancelLabel ?? t("common.cancel");
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
        {hideCancel ? null : (
          <button
            type="button"
            className="text-button"
            onClick={onCancel}
            disabled={busy}
          >
            {resolvedCancelLabel}
          </button>
        )}
        <button
          type="button"
          className={
            tone === "danger" ? "text-button danger" : "text-button primary"
          }
          onClick={onConfirm}
          disabled={busy}
        >
          {resolvedConfirmLabel}
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
      hideCancel={state.hideCancel}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  ) : null;

  return { confirm, confirmElement };
}
