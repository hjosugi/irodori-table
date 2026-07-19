import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  authenticatePasskeyCredential,
  checkPasskeyAvailability,
  registerPasskeyCredential,
  type PasskeyAvailability,
  type PasskeyCredentialRecord,
} from "@/features/security";
import { usePreferencesStore } from "@/features/preferences";
import type { BooleanUpdater, TranslateFn } from "./shared";
import { errorMessage } from "@/core";

export interface SecurityTabProps {
  t: TranslateFn;
  passkeyLockEnabled: boolean;
  setPasskeyLockEnabled: (value: BooleanUpdater) => void;
  passkeyCredential: PasskeyCredentialRecord | null;
  setPasskeyCredential: (value: PasskeyCredentialRecord | null) => void;
}

export function SecurityTab({
  t,
  passkeyLockEnabled,
  setPasskeyLockEnabled,
  passkeyCredential,
  setPasskeyCredential,
}: SecurityTabProps) {
  const [availability, setAvailability] = useState<PasskeyAvailability | null>(
    null,
  );
  const [busy, setBusy] = useState<"setup" | "verify" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const locale = usePreferencesStore((state) => state.locale);
  const passkeyReady = availability?.supported === true;
  const createdAt = passkeyCredential
    ? new Date(passkeyCredential.createdAt)
    : null;
  const createdLabel =
    createdAt && Number.isFinite(createdAt.getTime())
      ? createdAt.toLocaleString(locale)
      : null;

  useEffect(() => {
    let cancelled = false;
    void checkPasskeyAvailability().then((nextAvailability) => {
      if (!cancelled) {
        setAvailability(nextAvailability);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function setupPasskey() {
    setBusy("setup");
    setNotice(null);
    setError(null);
    try {
      const credential = await registerPasskeyCredential("Irodori Table");
      setPasskeyCredential(credential);
      setPasskeyLockEnabled(true);
      setNotice(t("settings.security.passkey.setupSuccess"));
    } catch (setupError) {
      setError(errorMessage(setupError));
    } finally {
      setBusy(null);
    }
  }

  async function verifyPasskey() {
    if (!passkeyCredential) {
      return;
    }
    setBusy("verify");
    setNotice(null);
    setError(null);
    try {
      await authenticatePasskeyCredential(passkeyCredential);
      setNotice(t("settings.security.passkey.verifySuccess"));
    } catch (verifyError) {
      setError(
        verifyError instanceof Error
          ? verifyError.message
          : String(verifyError),
      );
    } finally {
      setBusy(null);
    }
  }

  function removePasskey() {
    setPasskeyLockEnabled(false);
    setPasskeyCredential(null);
    setNotice(t("settings.security.passkey.removeSuccess"));
    setError(null);
  }

  return (
    <div className="settings-stack">
      <div className="settings-row">
        <span>
          <strong>{t("settings.security.passkey.status.title")}</strong>
          <small>
            {availability
              ? passkeyReady
                ? availability.platformAuthenticator
                  ? t("settings.security.passkey.status.platform")
                  : t("settings.security.passkey.status.available")
                : t("settings.security.passkey.status.unavailable")
              : t("settings.security.passkey.status.checking")}
          </small>
        </span>
        <span
          className={`security-status-pill ${passkeyReady ? "ready" : "muted"}`}
        >
          {passkeyReady ? (
            <CheckCircle2 size={14} />
          ) : (
            <AlertTriangle size={14} />
          )}
          {passkeyReady
            ? t("settings.security.passkey.status.ready")
            : t("settings.security.passkey.status.notReady")}
        </span>
      </div>
      <label className="settings-row">
        <span>
          <strong>{t("settings.security.passkey.lock.title")}</strong>
          <small>{t("settings.security.passkey.lock.description")}</small>
        </span>
        <input
          type="checkbox"
          checked={passkeyLockEnabled && Boolean(passkeyCredential)}
          disabled={!passkeyCredential}
          onChange={(event) =>
            setPasskeyLockEnabled(event.currentTarget.checked)
          }
        />
      </label>
      <div className="settings-row settings-row-wide">
        <span>
          <strong>{t("settings.security.passkey.credential.title")}</strong>
          <small>
            {passkeyCredential
              ? t("settings.security.passkey.credential.configured", {
                  label: passkeyCredential.label,
                  date: createdLabel ?? "-",
                })
              : t("settings.security.passkey.credential.empty")}
          </small>
        </span>
        <div className="settings-security-actions">
          <button
            className="primary-button"
            type="button"
            disabled={!passkeyReady || busy !== null}
            onClick={() => void setupPasskey()}
          >
            <KeyRound size={14} />
            <span>
              {busy === "setup"
                ? t("settings.security.passkey.setupBusy")
                : passkeyCredential
                  ? t("settings.security.passkey.replace")
                  : t("settings.security.passkey.setup")}
            </span>
          </button>
          <button
            className="text-button"
            type="button"
            disabled={!passkeyCredential || busy !== null}
            onClick={() => void verifyPasskey()}
          >
            <ShieldCheck size={14} />
            <span>
              {busy === "verify"
                ? t("settings.security.passkey.verifyBusy")
                : t("settings.security.passkey.verify")}
            </span>
          </button>
          <button
            className="icon-button danger"
            type="button"
            title={t("settings.security.passkey.remove")}
            aria-label={t("settings.security.passkey.remove")}
            disabled={!passkeyCredential || busy !== null}
            onClick={removePasskey}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      {error ? (
        <div className="inline-error settings-json-error">
          <AlertTriangle size={13} />
          <span>{error}</span>
        </div>
      ) : notice ? (
        <div className="inline-success settings-json-error">
          <CheckCircle2 size={13} />
          <span>{notice}</span>
        </div>
      ) : null}
    </div>
  );
}
