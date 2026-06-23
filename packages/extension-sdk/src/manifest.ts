import type {
  ExtensionCapabilities,
  ExtensionContributions,
  ExtensionDevConfig,
  ExtensionManifest,
} from "./generated/irodori-extension-api";

export type ExtensionContributionsInput = Partial<ExtensionContributions>;
export type ExtensionCapabilitiesInput = Partial<ExtensionCapabilities>;
export type ExtensionDevConfigInput = Partial<ExtensionDevConfig>;

export type ExtensionManifestInput = Omit<
  ExtensionManifest,
  "contributes" | "capabilities" | "dev"
> & {
  contributes?: ExtensionContributionsInput;
  capabilities?: ExtensionCapabilitiesInput;
  dev?: ExtensionDevConfigInput;
};

export function defineManifest<const TManifest extends ExtensionManifestInput>(
  manifest: TManifest,
): TManifest {
  return manifest;
}
