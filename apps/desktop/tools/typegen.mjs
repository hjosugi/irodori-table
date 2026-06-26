import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptDir, "..");
const repoRoot = resolve(desktopRoot, "../..");

const generatedFiles = [
  "apps/desktop/src/generated/irodori-api.ts",
  "packages/extension-sdk/src/generated/irodori-extension-api.ts",
];

const generators = [
  {
    label: "desktop Tauri bindings",
    command: "cargo",
    args: [
      "test",
      "--manifest-path",
      "apps/desktop/src-tauri/Cargo.toml",
      "export_typescript_bindings",
    ],
  },
  {
    label: "extension SDK bindings",
    command: "cargo",
    args: ["test", "-p", "irodori-extension", "export_typescript_bindings"],
  },
];

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printHelp();
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main() {
  for (const generator of generators) {
    console.log(`Generating ${generator.label}...`);
    await run(generator.command, generator.args, {
      cwd: repoRoot,
      env: generatorEnv(process.env),
    });
  }

  if (options.check) {
    const diff = await runCapture("git", [
      "diff",
      "--no-ext-diff",
      "HEAD",
      "--",
      ...generatedFiles,
    ], { cwd: repoRoot });

    if (diff.code === 0 && diff.stdout.trim().length === 0) {
      console.log("Generated TypeScript bindings are up to date.");
      return;
    }

    if (diff.code !== 0 && diff.code !== 1) {
      process.stderr.write(diff.stderr);
      throw new Error(`git diff failed with exit code ${diff.code}.`);
    }

    console.error(
      [
        "Generated TypeScript bindings are out of date.",
        "",
        "Run `npm run typegen` from apps/desktop and commit the generated files:",
        ...generatedFiles.map((file) => `  - ${file}`),
        "",
        "Diff:",
      ].join("\n"),
    );
    process.stderr.write(diff.stdout);
    process.stderr.write(diff.stderr);
    process.exit(1);
  }

  console.log("Generated desktop and extension TypeScript bindings.");
}

function parseArgs(argv) {
  const parsed = {
    check: false,
    help: false,
  };

  for (const arg of argv) {
    if (arg === "--check" || arg === "-c") {
      parsed.check = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }

    console.error(`Unknown argument: ${arg}`);
    printHelp();
    process.exit(1);
  }

  return parsed;
}

function printHelp() {
  console.log(
    [
      "Usage: node tools/typegen.mjs [--check]",
      "",
      "Regenerates the desktop and extension SDK TypeScript bindings.",
      "",
      "Options:",
      "  --check, -c   Regenerate, then fail if generated files differ from git.",
      "  --help, -h    Show this help.",
    ].join("\n"),
  );
}

function generatorEnv(env) {
  const next = { ...env };
  delete next.CI;
  next.CARGO_TARGET_DIR = resolve(repoRoot, ".irodori-local/target");
  return next;
}

function run(command, args, options) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${command} terminated by ${signal}`));
        return;
      }

      if (code === 0) {
        resolvePromise();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`));
    });
  });
}

function runCapture(command, args, options) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];

    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${command} terminated by ${signal}`));
        return;
      }

      resolvePromise({
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}
