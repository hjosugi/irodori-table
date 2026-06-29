import { spawn } from "node:child_process";

export function executable(name) {
  if (process.platform !== "win32") {
    return name;
  }
  if (name === "cargo") {
    return "cargo.exe";
  }
  return `${name}.cmd`;
}

export function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      ...options,
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

export function runCapture(command, args, options = {}) {
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

export function runWithTimeout(command, args, timeoutMs, options = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
    let output = "";
    const timer = setTimeout(() => {
      output += `\nTimed out after ${timeoutMs}ms`;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolvePromise({ code: 1, output: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ code: code ?? 1, output });
    });
  });
}

export function prefixStream(stream, id, target) {
  let pending = "";
  stream.on("data", (chunk) => {
    pending += chunk.toString();
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      target.write(`[${id}] ${line}\n`);
    }
  });
  stream.on("end", () => {
    if (pending) {
      target.write(`[${id}] ${pending}\n`);
    }
  });
}
