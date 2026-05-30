#!/usr/bin/env node

const { spawn } = require("child_process");

const child = spawn(
  "npx.cmd",
  ["-y", "@agentdeskai/browser-tools-mcp@latest"],
  {
    stdio: ["pipe", "pipe", "pipe"],
    shell: true,
    windowsHide: true,
  }
);

process.stdin.pipe(child.stdin);
child.stderr.pipe(process.stderr);

let stdoutBuffer = "";

child.stdout.on("data", (chunk) => {
  stdoutBuffer += chunk.toString();

  const lines = stdoutBuffer.split(/\r?\n/);
  stdoutBuffer = lines.pop() || "";

  for (const line of lines) {
    if (line.trimStart().startsWith("{")) {
      process.stdout.write(`${line}\n`);
    } else if (line.trim()) {
      process.stderr.write(`${line}\n`);
    }
  }
});

child.on("exit", (code, signal) => {
  const trailing = stdoutBuffer.trim();
  if (trailing) {
    if (trailing.startsWith("{")) {
      process.stdout.write(`${stdoutBuffer}\n`);
    } else {
      process.stderr.write(`${stdoutBuffer}\n`);
    }
  }

  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code || 0);
});

process.on("SIGTERM", () => child.kill("SIGTERM"));
process.on("SIGINT", () => child.kill("SIGINT"));
