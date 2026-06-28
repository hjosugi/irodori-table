import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

type DialogShellProps = {
  children: ReactNode;
  /** Called for ESC, overlay click, and (optionally) the rendered close button. */
  onClose: () => void;
  /** Classes for the dialog box itself (e.g. "data-dialog import-dialog"). */
  className?: string;
  /** Classes for the backdrop. Defaults to the shared modal overlay. */
  overlayClassName?: string;
  /** Accessible name when there's no visible heading to point at. */
  label?: string;
  /** id of the heading element that names the dialog. */
  labelledBy?: string;
  closeOnOverlayClick?: boolean;
  closeOnEscape?: boolean;
  /** Whether to move focus into the dialog on mount. Default true. */
  autoFocus?: boolean;
};

/**
 * Shared modal chrome: scrim overlay, ESC-to-close, click-outside, focus trap,
 * focus restoration, and dialog ARIA. Dialogs supply their own
 * header/body/footer via children so existing markup ports over unchanged.
 */
export function DialogShell({
  children,
  onClose,
  className,
  overlayClassName = "modal-overlay",
  label,
  labelledBy,
  closeOnOverlayClick = true,
  closeOnEscape = true,
  autoFocus = true,
}: DialogShellProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const fallbackLabelId = useId();

  // Restore focus to the element that was active before the dialog opened.
  useEffect(() => {
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    return () => {
      restoreFocusRef.current?.focus?.();
    };
  }, []);

  // Move focus into the dialog on mount.
  useEffect(() => {
    if (!autoFocus) return;
    const node = dialogRef.current;
    if (!node) return;
    const first = node.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (first ?? node).focus();
  }, [autoFocus]);

  // ESC closes; document-level so it works regardless of focus location.
  useEffect(() => {
    if (!closeOnEscape) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [closeOnEscape]);

  const handleKeyDown = useCallback((event: ReactKeyboardEvent) => {
    if (event.key !== "Tab") return;
    const node = dialogRef.current;
    if (!node) return;
    const focusable = Array.from(
      node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ).filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (focusable.length === 0) {
      event.preventDefault();
      node.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  const labelProps = labelledBy
    ? { "aria-labelledby": labelledBy }
    : label
      ? { "aria-label": label }
      : { "aria-labelledby": fallbackLabelId };

  return (
    <div
      className={overlayClassName}
      role="presentation"
      onClick={closeOnOverlayClick ? onClose : undefined}
    >
      <div
        ref={dialogRef}
        className={className}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
        {...labelProps}
      >
        {children}
      </div>
    </div>
  );
}
