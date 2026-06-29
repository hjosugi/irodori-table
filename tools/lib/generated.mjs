import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { repoRoot } from "./paths.mjs";

export async function normalizeGeneratedFiles(files, options = {}) {
  const root = options.root ?? repoRoot;
  await Promise.all(
    files.map(async (file) => {
      await normalizeTextFile(resolve(root, file));
    }),
  );
}

export async function normalizeTextFile(path) {
  const source = await readFile(path, "utf8");
  let normalized = source.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "");
  if (!normalized.endsWith("\n")) {
    normalized += "\n";
  }
  if (normalized !== source) {
    await writeFile(path, normalized);
  }
}
