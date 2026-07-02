#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statfsSync } from "node:fs";
import { arch } from "node:os";

import { fromRepoRoot, repoRoot } from "../lib/paths.mjs";

const issues = [];
const warnings = [];
const expectedNodeMajor = 24;
const expectedRust = readRustToolchainVersion();

console.log("Irodori development doctor\n");

section("Tools");
checkNodeVersion();
checkCommand("rustc", ["--version"], { required: true });
checkCommand("cargo", ["--version"], { required: true });
checkCommand("node", ["--version"], { required: true });
checkCommand("npm", ["--version"], { required: true });
checkRustVersion();
checkCommand("bun", ["--version"], {
  required: false,
  hint: "optional fast path: JS_PM=bun make test",
});
if (process.platform === "linux" && arch() === "x64") {
  checkCommand("mold", ["--version"], {
    required: true,
    hint: "required by .cargo/config.toml for x86_64 Linux linking",
  });
}
checkContainerEngine();

section("Repository setup");
checkPath("apps/desktop/node_modules", {
  required: true,
  hint: "run: make setup-desktop",
});
checkPath("../irodori-kit/packages/extension-sdk", {
  required: false,
  hint: "needed for extension SDK validation and kit co-development",
});
checkPath("../irodori-samples", {
  required: false,
  hint: "needed for sample database containers",
});
checkCargoPatchClean();
checkPlaywright();
checkTmpDir();

if (process.platform === "linux") {
  section("Linux desktop dependencies");
  checkCommand("pkg-config", ["--version"], {
    required: true,
    hint: "needed to detect WebKit/GTK/OpenSSL development packages",
  });
  checkPkgConfig("webkit2gtk-4.1", {
    required: true,
    hint: "needed for Tauri desktop builds",
  });
  checkPkgConfig("libsoup-3.0", {
    required: true,
    hint: "needed for Tauri desktop builds",
  });
  checkPkgConfig("openssl", {
    required: true,
    hint: "needed for Rust TLS/native builds",
  });
  checkPkgConfig("ayatana-appindicator3-0", {
    required: false,
    hint: "needed by Linux tray/AppIndicator integration on some distros",
  });
}

if (issues.length > 0) {
  console.log("\nFix the required items above, then rerun `make doctor`.");
  process.exit(1);
}

if (warnings.length > 0) {
  console.log("\nDoctor passed with warnings.");
} else {
  console.log("\nDoctor passed.");
}

function section(label) {
  console.log(label);
}

function checkCommand(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
  });
  if (result.status === 0) {
    const output = (result.stdout || result.stderr).trim().split("\n")[0];
    report(command, true, options, output);
    return;
  }
  if (result.error) {
    report(command, false, options);
    return;
  }
  const output = (result.stdout || result.stderr).trim().split("\n")[0];
  report(command, false, options, output);
}

function checkNodeVersion() {
  const major = Number(process.versions.node.split(".")[0]);
  report(
    `node ${expectedNodeMajor}.x`,
    major === expectedNodeMajor,
    {
      required: true,
      hint: "use `.nvmrc` or install Node 24",
    },
    process.versions.node,
  );
}

function checkRustVersion() {
  if (!expectedRust) {
    report("rust-toolchain.toml", false, {
      required: false,
      warn: true,
      hint: "rust-toolchain.toml should pin the compiler used by CI",
    });
    return;
  }
  const rustc = commandVersion("rustc", ["--version"]);
  if (!rustc.ok) {
    return;
  }
  report(
    `rustc ${expectedRust}`,
    rustc.output.includes(`rustc ${expectedRust} `),
    {
      required: true,
      hint: "install the pinned toolchain with `rustup toolchain install`",
    },
    rustc.output,
  );
}

function checkContainerEngine() {
  const podman = commandVersion("podman", ["--version"]);
  const docker = commandVersion("docker", ["--version"]);
  if (podman.ok) {
    report("container engine", true, { required: false }, podman.output);
    return;
  }
  if (docker.ok) {
    report("container engine", true, { required: false }, docker.output);
    return;
  }
  report("container engine", false, {
    required: false,
    hint: "needed only for sample database containers",
  });
}

function checkPkgConfig(packageName, options) {
  const result = spawnSync("pkg-config", ["--exists", packageName], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
  });
  if (result.status === 0) {
    report(`pkg-config ${packageName}`, true, options);
    return;
  }
  if (result.error) {
    report(`pkg-config ${packageName}`, false, {
      ...options,
      hint: `${options.hint}; pkg-config is not available`,
    });
    return;
  }
  report(`pkg-config ${packageName}`, false, options);
}

function checkPath(path, options) {
  report(path, existsSync(fromRepoRoot(path)), options);
}

function checkPlaywright() {
  const playwrightBin =
    process.platform === "win32"
      ? "apps/desktop/node_modules/.bin/playwright.cmd"
      : "apps/desktop/node_modules/.bin/playwright";
  report(playwrightBin, existsSync(fromRepoRoot(playwrightBin)), {
    required: false,
    warn: true,
    hint: "run `make setup`, then `cd apps/desktop && npx playwright install --with-deps chromium` for browser/e2e tests",
  });
}

function checkTmpDir() {
  const tmpDir = process.env.TMPDIR || "/tmp";
  try {
    const stats = statfsSync(tmpDir);
    const freeGiB = (Number(stats.bavail) * Number(stats.bsize)) / 1024 / 1024 / 1024;
    report(
      `TMPDIR free space (${tmpDir})`,
      freeGiB >= 8,
      {
        required: false,
        warn: true,
        hint: "large Rust/Tauri builds may fail on small tmpfs; try `mkdir -p .irodori-local/tmp && TMPDIR=$PWD/.irodori-local/tmp make desktop-build-verified`",
      },
      `${freeGiB.toFixed(1)} GiB available`,
    );
  } catch (error) {
    report(`TMPDIR readable (${tmpDir})`, false, {
      required: false,
      warn: true,
      hint: `cannot inspect temp directory: ${error.message}`,
    });
  }
}

function checkCargoPatchClean() {
  const cargoToml = readText("Cargo.toml");
  if (!cargoToml) {
    return;
  }
  const hasKitPatch = cargoToml.includes('[patch."https://github.com/hjosugi/irodori-kit"]');
  report("Cargo.toml has no local irodori-kit patch", !hasKitPatch, {
    required: false,
    warn: true,
    hint: "run `make kit-unlink` before committing release-bound changes",
  });
}

function readRustToolchainVersion() {
  const toolchain = readText("rust-toolchain.toml");
  const match = toolchain.match(/channel\s*=\s*"([^"]+)"/);
  return match?.[1] || "";
}

function readText(path) {
  try {
    return readFileSync(fromRepoRoot(path), "utf8");
  } catch {
    return "";
  }
}

function commandVersion(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) {
    return { ok: false, output: "" };
  }
  return {
    ok: true,
    output: (result.stdout || result.stderr).trim().split("\n")[0],
  };
}

function report(label, ok, options, detail = "") {
  const status = ok ? "ok" : options.required ? "missing" : options.warn ? "warn" : "optional";
  const suffix = detail ? ` - ${detail}` : !ok && options.hint ? ` - ${options.hint}` : "";
  console.log(`  ${status.padEnd(8)} ${label}${suffix}`);
  if (!ok && options.required) {
    issues.push(label);
  } else if (!ok && options.warn) {
    warnings.push(label);
  }
}
