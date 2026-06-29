import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export async function newestFileByExtension(dir, extension) {
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }

  const candidates = entries.filter((name) => name.endsWith(extension));
  let newest = null;
  let newestMtime = -Infinity;
  for (const name of candidates) {
    const full = join(dir, name);
    const info = await stat(full);
    if (info.mtimeMs > newestMtime) {
      newestMtime = info.mtimeMs;
      newest = full;
    }
  }
  return newest;
}
