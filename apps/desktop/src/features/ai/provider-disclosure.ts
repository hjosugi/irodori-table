import type { AiProviderConfig } from "@/generated/irodori-api";

export const cloudProviderConsentStorageKey =
  "irodori.ai.cloudProviderConsent.v1";
export const cloudProviderPrivacyUrl =
  "https://hjosugi.github.io/irodori-docs/privacy.html";

const consentValue = "accepted";
const localHosts = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

function storage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

export function hasCloudProviderConsent(): boolean {
  return storage()?.getItem(cloudProviderConsentStorageKey) === consentValue;
}

export function rememberCloudProviderConsent(): void {
  storage()?.setItem(cloudProviderConsentStorageKey, consentValue);
}

function endpointHost(endpoint: string | undefined): string | null {
  const trimmed = endpoint?.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return new URL(trimmed).host;
  } catch {
    return trimmed;
  }
}

function endpointHostname(endpoint: string | undefined): string | null {
  const trimmed = endpoint?.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return new URL(trimmed).hostname;
  } catch {
    const hostPart = trimmed.split(/[/?#]/)[0] ?? trimmed;
    if (hostPart.startsWith("[") && hostPart.includes("]")) {
      return hostPart.slice(1, hostPart.indexOf("]"));
    }
    return hostPart.split(":")[0] || hostPart;
  }
}

export function providerHostLabel(
  config: AiProviderConfig,
  fallback: string,
): string {
  return endpointHost(config.endpoint) ?? fallback;
}

export function isCloudProvider(config: AiProviderConfig): boolean {
  if (config.kind === "openaiCompat") {
    return true;
  }
  if (config.kind !== "ollama") {
    return false;
  }
  const hostname = endpointHostname(config.endpoint);
  return Boolean(hostname && !localHosts.has(hostname.toLowerCase()));
}
