import { spawn } from "node:child_process";

import { desktopRoot } from "../../../tools/lib/paths.mjs";

const env = { ...process.env };
// Playwright enables FORCE_COLOR for its own output. If the parent shell also
// exports NO_COLOR, Node prints a warning before every e2e run.
delete env.NO_COLOR;

const child = spawn("playwright", ["test", ...process.argv.slice(2)], {
  cwd: desktopRoot,
  env,
  shell: process.platform === "win32",
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`playwright test terminated by ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
