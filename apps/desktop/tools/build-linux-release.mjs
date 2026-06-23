import { createWriteStream } from "node:fs";
import { chmod, mkdir, rename, stat, unlink } from "node:fs/promises";
import { get } from "node:https";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../..");
const cacheRoot = resolve(repoRoot, ".cache");
const configRoot = resolve(repoRoot, ".config");
const tauriCache = resolve(cacheRoot, "tauri");

const arch = runtimeArch(process.arch);
const runtimeFile = resolve(tauriCache, `runtime-${arch}`);
const runtimeUrl = `https://github.com/AppImage/type2-runtime/releases/download/continuous/runtime-${arch}`;

const mode = process.argv[2] ?? "appimage";
const bundles = mode === "linux" ? "deb,rpm,appimage" : mode;
const passthroughArgs = process.argv.slice(3);

if (process.platform !== "linux") {
  console.error("Linux release bundles must be built on Linux.");
  process.exit(1);
}

await mkdir(tauriCache, { recursive: true });
await ensureRuntime(runtimeUrl, runtimeFile);

const child = spawn("tauri", ["build", "--bundles", bundles, ...passthroughArgs], {
  cwd: resolve(repoRoot, "apps/desktop"),
  stdio: "inherit",
  env: {
    ...process.env,
    NO_STRIP: process.env.NO_STRIP ?? "1",
    XDG_CACHE_HOME: process.env.XDG_CACHE_HOME ?? cacheRoot,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME ?? configRoot,
    LDAI_RUNTIME_FILE: process.env.LDAI_RUNTIME_FILE ?? runtimeFile,
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`tauri build terminated by ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});

function runtimeArch(nodeArch) {
  switch (nodeArch) {
    case "x64":
      return "x86_64";
    case "arm64":
      return "aarch64";
    default:
      throw new Error(`Unsupported AppImage runtime architecture: ${nodeArch}`);
  }
}

async function ensureRuntime(url, destination) {
  try {
    const existing = await stat(destination);
    if (existing.size > 0) {
      await chmod(destination, 0o755);
      return;
    }
  } catch {
    // Missing cache entry; download below.
  }

  console.log(`Downloading AppImage runtime: ${url}`);
  await download(url, destination);
  await chmod(destination, 0o755);
}

async function download(url, destination, redirects = 0) {
  if (redirects > 5) {
    throw new Error(`Too many redirects while downloading ${url}`);
  }

  const tmp = `${destination}.tmp-${process.pid}`;

  await new Promise((resolvePromise, reject) => {
    const request = get(
      url,
      { headers: { "User-Agent": "irodori-table-release-script" } },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          const nextUrl = new URL(response.headers.location, url).toString();
          download(nextUrl, destination, redirects + 1)
            .then(resolvePromise)
            .catch(reject);
          return;
        }

        if (status !== 200) {
          response.resume();
          reject(new Error(`Download failed with HTTP ${status}: ${url}`));
          return;
        }

        const file = createWriteStream(tmp, { mode: 0o755 });
        response.pipe(file);
        file.on("finish", () => {
          file.close((error) => {
            if (error) {
              reject(error);
            } else {
              rename(tmp, destination).then(resolvePromise).catch(reject);
            }
          });
        });
        file.on("error", reject);
      },
    );

    request.on("error", reject);
  }).catch(async (error) => {
    await unlink(tmp).catch(() => {});
    throw error;
  });
}
