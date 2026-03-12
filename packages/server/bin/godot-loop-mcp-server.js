#!/usr/bin/env node

import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const binDir = path.dirname(fileURLToPath(import.meta.url));
const entryPoint = path.resolve(binDir, "..", "src", "index.ts");

const child = spawn(process.execPath, ["--experimental-strip-types", entryPoint, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env
});

child.on("error", (error) => {
  console.error(`Failed to launch godot-loop-mcp-server: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
