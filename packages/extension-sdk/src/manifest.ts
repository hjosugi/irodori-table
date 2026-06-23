import type { ExtensionManifest } from "./generated/irodori-extension-api";

export function defineManifest<const TManifest extends ExtensionManifest>(
  manifest: TManifest,
): TManifest {
  return manifest;
}
