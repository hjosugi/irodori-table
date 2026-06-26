#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const issues = [];

console.log("Irodori development doctor\n");

section("Tools");
checkCommand("rustc", ["--version"], { required: true });
checkCommand("cargo", ["--version"], { required: true });
checkCommand("node", ["--version"], { required: true });
checkCommand("npm", ["--version"], { required: true });
checkCommand("bun", ["--version"], {
  required: false,
  hint: "optional fast path: JS_PM=bun make test",
});
checkContainerEngine();

section("Repository setup");
checkPath("apps/desktop/node_modules", {
  required: true,
  hint: "run: make setup-desktop",
});

if (process.platform === "linux") {
  section("Linux desktop dependencies");
  checkPkgConfig("webkit2gtk-4.1", {
    required: false,
    hint: "needed for Tauri desktop builds",
  });
  checkPkgConfig("libsoup-3.0", {
    required: false,
    hint: "needed for Tauri desktop builds",
  });
  checkPkgConfig("openssl", {
    required: false,
    hint: "needed for Rust TLS/native builds",
  });
}

if (issues.length > 0) {
  console.log("\nFix the required items above, then rerun `make doctor`.");
  process.exit(1);
}

console.log("\nDoctor passed.");

function section(label) {
  console.log(label);
}

function checkCommand(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: root,
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
    cwd: root,
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
  report(path, existsSync(resolve(root, path)), options);
}

function commandVersion(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
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
  const status = ok ? "ok" : options.required ? "missing" : "optional";
  const suffix = detail ? ` - ${detail}` : !ok && options.hint ? ` - ${options.hint}` : "";
  console.log(`  ${status.padEnd(8)} ${label}${suffix}`);
  if (!ok && options.required) {
    issues.push(label);
  }
}
