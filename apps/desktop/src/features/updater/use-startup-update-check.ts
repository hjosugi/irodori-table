import { useEffect } from "react";
import type { ShowActionNotice } from "@/app/ActionToast";
import { tauriRuntimeError } from "@/app/app-workbench-utils";
import { errorMessage } from "@/core";
import type { Translator } from "@/i18n";

export type AppUpdateInfo = {
  currentVersion: string;
  version: string;
};

let startupUpdateCheckStarted = false;

export async function checkForAppUpdate(): Promise<AppUpdateInfo | null> {
  if (tauriRuntimeError()) {
    return null;
  }
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (!update) {
    return null;
  }
  const info = {
    currentVersion: update.currentVersion,
    version: update.version,
  };
  await update.close().catch(() => undefined);
  return info;
}

export async function downloadAndInstallLatestUpdate(
  showActionNotice: ShowActionNotice,
  t: Translator["t"],
) {
  try {
    if (tauriRuntimeError()) {
      showActionNotice("error", t("notice.update.runtimeUnavailable"));
      return;
    }
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) {
      showActionNotice("info", t("notice.update.none"));
      return;
    }
    try {
      showActionNotice(
        "info",
        t("notice.update.installing"),
        t("notice.update.availableDetail", {
          current: update.currentVersion,
          next: update.version,
        }),
      );
      await update.downloadAndInstall();
    } finally {
      await update.close().catch(() => undefined);
    }
    showActionNotice(
      "success",
      t("notice.update.installed"),
      t("notice.update.restartRequired"),
    );
  } catch (error) {
    showActionNotice(
      "error",
      t("notice.update.installFailed"),
      errorMessage(error),
    );
  }
}

export async function checkAndOfferAppUpdate(
  showActionNotice: ShowActionNotice,
  t: Translator["t"],
) {
  try {
    const update = await checkForAppUpdate();
    if (!update) {
      showActionNotice("info", t("notice.update.none"));
      return;
    }
    showActionNotice(
      "info",
      t("notice.update.available"),
      t("notice.update.availableDetail", {
        current: update.currentVersion,
        next: update.version,
      }),
      {
        action: {
          label: t("notice.update.install"),
          run: () => void downloadAndInstallLatestUpdate(showActionNotice, t),
        },
      },
    );
  } catch (error) {
    showActionNotice(
      "error",
      t("notice.update.checkFailed"),
      errorMessage(error),
    );
  }
}

export function useStartupUpdateCheck({
  enabled,
  showActionNotice,
  t,
}: {
  enabled: boolean;
  showActionNotice: ShowActionNotice;
  t: Translator["t"];
}) {
  useEffect(() => {
    if (!enabled || startupUpdateCheckStarted) {
      return;
    }
    startupUpdateCheckStarted = true;
    let cancelled = false;

    void checkForAppUpdate()
      .then((update) => {
        if (cancelled || !update) {
          return;
        }
        showActionNotice(
          "info",
          t("notice.update.available"),
          t("notice.update.availableDetail", {
            current: update.currentVersion,
            next: update.version,
          }),
          {
            action: {
              label: t("notice.update.install"),
              run: () =>
                void downloadAndInstallLatestUpdate(showActionNotice, t),
            },
          },
        );
      })
      .catch((error) => {
        console.warn("Irodori update check failed", error);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, showActionNotice, t]);
}
