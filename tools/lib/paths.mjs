import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const toolsLibDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(toolsLibDir, "../..");
export const desktopRoot = resolve(repoRoot, "apps/desktop");

export function fromRepoRoot(...segments) {
  return resolve(repoRoot, ...segments);
}

export function fromDesktopRoot(...segments) {
  return resolve(desktopRoot, ...segments);
}

export function scriptDir(metaUrl) {
  return dirname(fileURLToPath(metaUrl));
}
