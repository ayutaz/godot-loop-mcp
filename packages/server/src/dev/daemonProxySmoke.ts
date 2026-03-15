/**
 * Smoke test for daemon + proxy mode.
 *
 * Verifies the daemon lifecycle and control protocol without requiring a
 * running Godot instance:
 *
 *   1. Daemon starts and writes daemon.json
 *   2. Proxy (DaemonClient) connects to the control port
 *   3. control.session.info returns hasActiveSession: false
 *   4. Client disconnects, a new client reconnects (proxy restart simulation)
 *   5. Daemon is still alive after proxy restart
 *   6. Daemon is killed and daemon.json is cleaned up
 *
 * Run with:
 *   node --experimental-strip-types src/dev/daemonProxySmoke.ts
 */

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import type { DaemonInfo } from "../daemon/types.ts";
import { DaemonClient } from "../proxy/daemonClient.ts";
import { Logger } from "../logger.ts";

const sourceDir = fileURLToPath(new URL(".", import.meta.url));
const packageRoot = path.resolve(sourceDir, "..", "..");
const daemonScript = path.resolve(sourceDir, "..", "daemon", "index.ts");

const TEST_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 200;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function step(message: string): void {
  console.error(`[daemon-proxy-smoke] ${message}`);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForFile(filePath: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) {
      return;
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(`File did not appear within ${timeoutMs}ms: ${filePath}`);
}

async function waitForFileRemoval(filePath: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!fs.existsSync(filePath)) {
      return;
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(`File was not cleaned up within ${timeoutMs}ms: ${filePath}`);
}

function readDaemonInfo(filePath: string): DaemonInfo {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as DaemonInfo;

  if (typeof parsed.pid !== "number" || parsed.pid <= 0) {
    throw new Error(`daemon.json has invalid pid: ${JSON.stringify(parsed)}`);
  }
  if (typeof parsed.controlPort !== "number" || parsed.controlPort <= 0) {
    throw new Error(`daemon.json has invalid controlPort: ${JSON.stringify(parsed)}`);
  }
  if (typeof parsed.bridgePort !== "number" || parsed.bridgePort <= 0) {
    throw new Error(`daemon.json has invalid bridgePort: ${JSON.stringify(parsed)}`);
  }
  if (typeof parsed.startedAt !== "string" || parsed.startedAt.length === 0) {
    throw new Error(`daemon.json has invalid startedAt: ${JSON.stringify(parsed)}`);
  }

  return parsed;
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "daemon-proxy-smoke-"));
  const daemonInfoPath = path.join(logDir, "daemon.json");
  const logger = new Logger(path.join(logDir, "smoke.log"));

  step(`Temporary log directory: ${logDir}`);

  // Use ephemeral ports (0 tells the OS to pick a free port, but the daemon
  // entry point reads env vars, so we pick high random ports to avoid clashes).
  const bridgePort = 40_000 + Math.floor(Math.random() * 10_000);
  const controlPort = bridgePort + 1;

  let daemon: ChildProcess | undefined;

  // Ensure cleanup on unexpected exit.
  const cleanup = (): void => {
    if (daemon && !daemon.killed) {
      daemon.kill();
    }
    fs.rmSync(logDir, { recursive: true, force: true });
  };
  process.on("exit", cleanup);

  const testDeadline = Date.now() + TEST_TIMEOUT_MS;

  function assertTime(label: string): void {
    if (Date.now() > testDeadline) {
      throw new Error(`Test timed out during step: ${label}`);
    }
  }

  try {
    // Step 1: Start the daemon process.
    step("Starting daemon process...");
    daemon = spawn(
      process.execPath,
      ["--experimental-strip-types", daemonScript],
      {
        stdio: ["ignore", "inherit", "inherit"],
        env: {
          ...process.env,
          GODOT_LOOP_MCP_HOST: "127.0.0.1",
          GODOT_LOOP_MCP_PORT: String(bridgePort),
          GODOT_LOOP_MCP_CONTROL_PORT: String(controlPort),
          GODOT_LOOP_MCP_LOG_DIR: logDir,
          GODOT_LOOP_MCP_REPO_ROOT: packageRoot,
        },
      },
    );

    daemon.on("exit", (code, signal) => {
      step(`Daemon exited: code=${code} signal=${signal}`);
    });

    // Step 2: Wait for daemon.json to appear.
    step("Waiting for daemon.json...");
    await waitForFile(daemonInfoPath, 5_000);
    assertTime("waitForFile daemon.json");
    step("daemon.json appeared.");

    // Step 3: Verify daemon.json contents.
    step("Validating daemon.json...");
    const info = readDaemonInfo(daemonInfoPath);
    if (info.controlPort !== controlPort) {
      throw new Error(`Expected controlPort ${controlPort}, got ${info.controlPort}.`);
    }
    if (info.bridgePort !== bridgePort) {
      throw new Error(`Expected bridgePort ${bridgePort}, got ${info.bridgePort}.`);
    }
    if (!isProcessAlive(info.pid)) {
      throw new Error(`Daemon PID ${info.pid} is not alive.`);
    }
    step(`daemon.json valid: pid=${info.pid} controlPort=${info.controlPort} bridgePort=${info.bridgePort}`);

    // Step 4: Connect a DaemonClient to the control port.
    step("Connecting DaemonClient (first)...");
    const client1 = new DaemonClient(logger);
    await client1.connect(controlPort, "127.0.0.1");
    assertTime("client1 connect");
    step("DaemonClient connected.");

    // Step 5: Query control.session.info.
    step("Querying control.session.info...");
    const sessionInfo = await client1.getSessionInfo();
    if (sessionInfo.hasActiveSession !== false) {
      throw new Error(
        `Expected hasActiveSession=false, got ${JSON.stringify(sessionInfo)}.`,
      );
    }
    step(`control.session.info returned: hasActiveSession=${sessionInfo.hasActiveSession}`);

    // Step 6: Disconnect the first client.
    step("Disconnecting first client...");
    client1.close();
    if (client1.isConnected()) {
      throw new Error("Client should report disconnected after close().");
    }
    step("First client disconnected.");

    // Small delay to let the daemon process the disconnection.
    await delay(200);

    // Step 7: Reconnect a new client (simulate proxy restart).
    step("Connecting DaemonClient (second, simulating proxy restart)...");
    assertTime("pre client2 connect");
    const client2 = new DaemonClient(logger);
    await client2.connect(controlPort, "127.0.0.1");
    assertTime("client2 connect");
    step("Second DaemonClient connected.");

    // Step 8: Verify daemon is still running.
    step("Verifying daemon is still alive after proxy restart...");
    if (!isProcessAlive(info.pid)) {
      throw new Error("Daemon died after proxy disconnect/reconnect.");
    }
    const sessionInfo2 = await client2.getSessionInfo();
    if (sessionInfo2.hasActiveSession !== false) {
      throw new Error(
        `Expected hasActiveSession=false on reconnect, got ${JSON.stringify(sessionInfo2)}.`,
      );
    }
    step("Daemon is alive and responding after proxy restart.");

    client2.close();

    // Step 9: Kill the daemon.
    step("Killing daemon...");
    daemon.kill();

    // Step 10: Verify daemon.json is cleaned up.
    step("Waiting for daemon.json cleanup...");
    await waitForFileRemoval(daemonInfoPath, 3_000);
    step("daemon.json cleaned up.");

    step("Daemon-proxy smoke test PASSED.");
  } finally {
    if (daemon && !daemon.killed) {
      daemon.kill();
    }
    // Give the daemon a moment to clean up before removing the log directory.
    await delay(200).catch(() => undefined);
    process.removeListener("exit", cleanup);
    fs.rmSync(logDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(
    `[daemon-proxy-smoke] FAILED: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
