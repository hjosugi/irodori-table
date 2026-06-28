import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(scriptDir, "..");
const repoRoot = resolve(desktopRoot, "../..");

const generators = [
  {
    id: "desktop",
    label: "desktop Tauri bindings",
    generatedFiles: ["apps/desktop/src/generated/irodori-api.ts"],
    command: "cargo",
    args: [
      "test",
      "--manifest-path",
      "apps/desktop/src-tauri/Cargo.toml",
      "--no-default-features",
      "export_typescript_bindings",
    ],
  },
  {
    id: "extension",
    label: "extension SDK bindings",
    generatedFiles: [
      "packages/extension-sdk/src/generated/irodori-extension-api.ts",
    ],
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
  const selectedGenerators = generators.filter(
    (generator) => options.only === "all" || generator.id === options.only,
  );

  for (const generator of selectedGenerators) {
    console.log(`Generating ${generator.label}...`);
    await run(generator.command, generator.args, {
      cwd: repoRoot,
      env: generatorEnv(process.env),
    });
  }

  const generatedFiles = selectedGenerators.flatMap(
    (generator) => generator.generatedFiles,
  );
  await normalizeGeneratedFiles(generatedFiles);

  if (options.check) {
    const diff = await runCapture(
      "git",
      ["diff", "--no-ext-diff", "HEAD", "--", ...generatedFiles],
      { cwd: repoRoot },
    );

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

async function normalizeGeneratedFiles(files) {
  await Promise.all(
    files.map(async (file) => {
      const path = resolve(repoRoot, file);
      const source = await readFile(path, "utf8");
      let normalized = source.replace(/[ \t]+$/gm, "");
      if (!normalized.endsWith("\n")) {
        normalized += "\n";
      }
      if (normalized !== source) {
        await writeFile(path, normalized);
      }
    }),
  );
}

function parseArgs(argv) {
  const parsed = {
    check: false,
    help: false,
    only: "all",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--check" || arg === "-c") {
      parsed.check = true;
      continue;
    }

    if (arg === "--only") {
      const value = argv[i + 1];
      if (!["desktop", "extension"].includes(value)) {
        console.error("--only must be one of: desktop, extension");
        printHelp();
        process.exit(1);
      }
      parsed.only = value;
      i += 1;
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
      "Usage: node tools/typegen.mjs [--check] [--only desktop|extension]",
      "",
      "Regenerates the desktop and extension SDK TypeScript bindings.",
      "",
      "Options:",
      "  --check, -c   Regenerate, then fail if generated files differ from git.",
      "  --only <id>   Generate only one binding set: desktop or extension.",
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

      reject(
        new Error(`${command} ${args.join(" ")} failed with exit code ${code}`),
      );
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
