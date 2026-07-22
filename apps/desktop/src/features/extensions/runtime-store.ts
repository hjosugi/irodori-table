import { create } from "zustand";
import { extList, type InstalledExtension } from "@/generated/irodori-api";

export const hostFeatureIds = ["knowledge", "datalake"] as const;

export type HostFeatureId = (typeof hostFeatureIds)[number];

type ExtensionRuntimeState = {
  installedExtensions: InstalledExtension[];
  loaded: boolean;
  enabledHostFeatures: HostFeatureId[];
  setInstalledExtensions: (extensions: InstalledExtension[]) => void;
  refreshInstalledExtensions: () => Promise<InstalledExtension[]>;
};

export function deriveEnabledHostFeatures(
  extensions: readonly InstalledExtension[],
): HostFeatureId[] {
  const enabled = new Set<HostFeatureId>();
  for (const extension of extensions) {
    if (!extension.enabled || extension.runtime !== "declarative") {
      continue;
    }
    for (const feature of extension.hostFeatures) {
      if (hostFeatureIds.includes(feature as HostFeatureId)) {
        enabled.add(feature as HostFeatureId);
      }
    }
  }
  return hostFeatureIds.filter((feature) => enabled.has(feature));
}

export const useExtensionRuntimeStore = create<ExtensionRuntimeState>(
  (set) => ({
    installedExtensions: [],
    loaded: false,
    enabledHostFeatures: [],
    setInstalledExtensions: (installedExtensions) =>
      set({
        installedExtensions,
        loaded: true,
        enabledHostFeatures: deriveEnabledHostFeatures(installedExtensions),
      }),
    refreshInstalledExtensions: async () => {
      try {
        const installedExtensions = await extList();
        set({
          installedExtensions,
          loaded: true,
          enabledHostFeatures: deriveEnabledHostFeatures(installedExtensions),
        });
        return installedExtensions;
      } catch (error) {
        set({ installedExtensions: [], loaded: true, enabledHostFeatures: [] });
        throw error;
      }
    },
  }),
);

export function isHostFeatureEnabled(feature: HostFeatureId): boolean {
  return useExtensionRuntimeStore
    .getState()
    .enabledHostFeatures.includes(feature);
}
