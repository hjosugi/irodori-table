import { resolve } from "node:path";

import { normalizeGeneratedFiles } from "../../../tools/lib/generated.mjs";
import { repoRoot } from "../../../tools/lib/paths.mjs";
import { run, runCapture } from "../../../tools/lib/process.mjs";

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
  await normalizeGeneratedFiles(generatedFiles, { root: repoRoot });

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

  console.log("Generated desktop TypeScript bindings.");
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
      if (value !== "desktop") {
        console.error("--only must be: desktop");
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
      "Usage: node tools/typegen.mjs [--check] [--only desktop]",
      "",
      "Regenerates the desktop TypeScript bindings.",
      "Extension SDK bindings live in ../irodori-kit/packages/extension-sdk.",
      "",
      "Options:",
      "  --check, -c   Regenerate, then fail if generated files differ from git.",
      "  --only <id>   Generate only one binding set: desktop.",
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
