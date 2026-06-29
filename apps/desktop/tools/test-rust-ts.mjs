import { spawn } from "node:child_process";

import {
  fromRepoRoot,
  desktopRoot,
  repoRoot,
} from "../../../tools/lib/paths.mjs";
import { executable, prefixStream } from "../../../tools/lib/process.mjs";

const options = parseArgs(process.argv.slice(2));
const jsRunner = resolveJsRunner();
const allTasks = [
  {
    id: "ts",
    label: "TypeScript/Vitest",
    command: jsRunner.command,
    args: jsRunner.args,
    cwd: desktopRoot,
  },
  {
    id: "rust",
    label: "Rust/Cargo",
    command: executable("cargo"),
    args: ["test", "--workspace", "--no-default-features"],
    cwd: repoRoot,
    env: cargoEnv(),
  },
];
const tasks = allTasks.filter(
  (task) => options.only === "all" || task.id === options.only,
);

const children = new Set();
let interrupted = false;

process.on("SIGINT", () => {
  interrupted = true;
  for (const child of children) {
    child.kill("SIGINT");
  }
});

const results = await Promise.all(tasks.map(runTask));
const failed = results.filter((result) => result.code !== 0 || result.signal);

if (interrupted) {
  process.exit(130);
}

if (failed.length > 0) {
  for (const result of failed) {
    const status = result.signal
      ? `terminated by ${result.signal}`
      : `exited with code ${result.code}`;
    console.error(`[${result.id}] ${result.label} ${status}.`);
  }
  process.exit(1);
}

console.log(
  tasks.length === 1
    ? `${tasks[0].label} tests passed.`
    : "Rust and TypeScript tests passed.",
);

function runTask(task) {
  console.log(
    `[${task.id}] Running ${task.label}: ${task.command} ${task.args.join(" ")}`,
  );

  return new Promise((resolvePromise) => {
    const child = spawn(task.command, task.args, {
      cwd: task.cwd,
      env: task.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.add(child);
    prefixStream(child.stdout, task.id, process.stdout);
    prefixStream(child.stderr, task.id, process.stderr);
    child.on("error", (error) => {
      children.delete(child);
      console.error(`[${task.id}] ${error.message}`);
      resolvePromise({ ...task, code: 1, signal: null });
    });
    child.on("exit", (code, signal) => {
      children.delete(child);
      resolvePromise({ ...task, code: code ?? 1, signal });
    });
  });
}

function resolveJsRunner() {
  const agent = process.env.npm_config_user_agent ?? "";
  if (agent.startsWith("bun/")) {
    return { command: executable("bun"), args: ["run", "test"] };
  }
  return { command: executable("npm"), args: ["test"] };
}

function parseArgs(argv) {
  const parsed = { only: "all" };
  for (const arg of argv) {
    if (arg === "--rust-only") {
      parsed.only = "rust";
      continue;
    }
    if (arg === "--ts-only") {
      parsed.only = "ts";
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(
        [
          "Usage: node tools/test-rust-ts.mjs [--rust-only|--ts-only]",
          "",
          "Runs desktop Vitest and Rust workspace tests in parallel by default.",
          "Rust uses .irodori-local/cargo-home and .irodori-local/test-target unless overridden.",
          "CARGO_BUILD_JOBS defaults to 2 to avoid starving Vitest on shared machines.",
        ].join("\n"),
      );
      process.exit(0);
    }
    console.error(`Unknown argument: ${arg}`);
    process.exit(1);
  }
  return parsed;
}

function cargoEnv() {
  return {
    ...process.env,
    CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS ?? "2",
    CARGO_HOME:
      process.env.CARGO_HOME ?? fromRepoRoot(".irodori-local/cargo-home"),
    CARGO_TARGET_DIR:
      process.env.CARGO_TARGET_DIR ??
      fromRepoRoot(".irodori-local/test-target"),
  };
}
