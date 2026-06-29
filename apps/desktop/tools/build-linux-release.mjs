import { createWriteStream } from "node:fs";
import { chmod, mkdir, rename, stat, unlink } from "node:fs/promises";
import { get } from "node:https";
import { resolve } from "node:path";

import { fromDesktopRoot, fromRepoRoot } from "../../../tools/lib/paths.mjs";
import { run } from "../../../tools/lib/process.mjs";

const cacheRoot = fromRepoRoot(".cache");
const configRoot = fromRepoRoot(".config");
const tauriCache = resolve(cacheRoot, "tauri");

const options = buildLinuxReleaseOptions(process.argv.slice(2), process.arch);
const runtimeFile = resolve(tauriCache, `runtime-${options.arch}`);
const runtimeUrl = appImageRuntimeUrl(options.arch);

if (process.platform !== "linux") {
  console.error("Linux release bundles must be built on Linux.");
  process.exit(1);
}

await mkdir(tauriCache, { recursive: true });
await ensureRuntime(runtimeUrl, runtimeFile);

await run("tauri", buildTauriArgs(options), {
  cwd: fromDesktopRoot(),
  env: buildTauriEnv(process.env, { cacheRoot, configRoot, runtimeFile }),
});

function buildLinuxReleaseOptions(argv, nodeArch) {
  const mode = argv[0] ?? "appimage";
  return {
    arch: runtimeArch(nodeArch),
    bundles: bundleMode(mode),
    passthroughArgs: argv.slice(1),
  };
}

function bundleMode(mode) {
  return mode === "linux" ? "deb,rpm,appimage" : mode;
}

function appImageRuntimeUrl(arch) {
  return `https://github.com/AppImage/type2-runtime/releases/download/continuous/runtime-${arch}`;
}

function buildTauriArgs(options) {
  return ["build", "--bundles", options.bundles, ...options.passthroughArgs];
}

function buildTauriEnv(env, paths) {
  return {
    ...env,
    NO_STRIP: env.NO_STRIP ?? "1",
    XDG_CACHE_HOME: env.XDG_CACHE_HOME ?? paths.cacheRoot,
    XDG_CONFIG_HOME: env.XDG_CONFIG_HOME ?? paths.configRoot,
    LDAI_RUNTIME_FILE: env.LDAI_RUNTIME_FILE ?? paths.runtimeFile,
  };
}

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
