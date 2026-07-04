import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, LockKeyhole, ShieldCheck } from "lucide-react";
import { usePreferencesStore } from "@/features/preferences";
import {
  authenticatePasskeyCredential,
  checkPasskeyAvailability,
} from "@/features/security/passkey-lock";
import { createTranslator } from "@/i18n";

export function PasskeyGate({ children }: { children: ReactNode }) {
  const locale = usePreferencesStore((state) => state.locale);
  const themeKind = usePreferencesStore((state) => state.themeKind);
  const passkeyLockEnabled = usePreferencesStore(
    (state) => state.passkeyLockEnabled,
  );
  const passkeyCredential = usePreferencesStore(
    (state) => state.passkeyCredential,
  );
  const [unlocked, setUnlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"checking" | "ready" | "unavailable">(
    "checking",
  );
  const [error, setError] = useState<string | null>(null);
  const { t } = createTranslator(locale);

  useEffect(() => {
    setUnlocked(false);
    setError(null);
  }, [passkeyLockEnabled, passkeyCredential?.id]);

  useEffect(() => {
    if (!passkeyLockEnabled || !passkeyCredential) {
      return;
    }
    let cancelled = false;
    setStatus("checking");
    void checkPasskeyAvailability().then((availability) => {
      if (!cancelled) {
        setStatus(availability.supported ? "ready" : "unavailable");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [passkeyLockEnabled, passkeyCredential]);

  if (!passkeyLockEnabled || !passkeyCredential || unlocked) {
    return <>{children}</>;
  }

  async function unlock() {
    if (!passkeyCredential) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await authenticatePasskeyCredential(passkeyCredential);
      setUnlocked(true);
    } catch (unlockError) {
      setError(
        unlockError instanceof Error
          ? unlockError.message
          : String(unlockError),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="app-shell passkey-lock-screen"
      data-theme={themeKind}
      role="dialog"
      aria-label={t("passkey.lock.title")}
    >
      <div className="passkey-lock-panel">
        <div className="passkey-lock-icon" aria-hidden="true">
          {status === "ready" ? (
            <ShieldCheck size={28} />
          ) : (
            <LockKeyhole size={28} />
          )}
        </div>
        <strong>{t("passkey.lock.title")}</strong>
        <span>{t("passkey.lock.subtitle")}</span>
        {status === "unavailable" ? (
          <div className="inline-error passkey-lock-error">
            <AlertTriangle size={14} />
            <span>{t("passkey.lock.unavailable")}</span>
          </div>
        ) : error ? (
          <div className="inline-error passkey-lock-error">
            <AlertTriangle size={14} />
            <span>{error}</span>
          </div>
        ) : null}
        <button
          className="primary-button"
          type="button"
          disabled={busy}
          onClick={() => void unlock()}
        >
          <LockKeyhole size={15} />
          <span>
            {busy ? t("passkey.lock.unlocking") : t("passkey.lock.unlock")}
          </span>
        </button>
      </div>
    </div>
  );
}
