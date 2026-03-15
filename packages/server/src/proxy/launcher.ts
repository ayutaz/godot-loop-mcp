import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { Logger } from "../logger.ts";
import type { DaemonInfo } from "../daemon/types.ts";

export interface LaunchOptions {
  logDir: string;
  host: string;
  bridgePort: number;
  controlPort: number;
  repoRoot: string;
  securityLevel: string;
  /** Path to the daemon entry point script. */
  daemonScript: string;
}

const READY_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 200;

/**
 * Ensure a daemon process is running and return its connection info.
 *
 * 1. Check for an existing `daemon.json` in the log directory.
 * 2. If the recorded PID is still alive, return immediately.
 * 3. Otherwise clean up the stale file, spawn a new daemon, and poll
 *    until `daemon.json` appears with a live PID.
 */
export async function ensureDaemon(options: LaunchOptions, logger: Logger): Promise<DaemonInfo> {
  const infoPath = path.join(options.logDir, "daemon.json");

  const existing = readDaemonInfo(infoPath);
  if (existing && isProcessAlive(existing.pid)) {
    logger.info("Existing daemon is alive.", {
      pid: existing.pid,
      controlPort: existing.controlPort,
      bridgePort: existing.bridgePort
    });
    return existing;
  }

  if (existing) {
    logger.warn("Found stale daemon.json; removing.", { stalePid: existing.pid });
    removeSafe(infoPath, logger);
  }

  spawnDaemon(options, logger);
  return waitForDaemonReady(infoPath, READY_TIMEOUT_MS, logger);
}

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                   */
/* ------------------------------------------------------------------ */

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readDaemonInfo(infoPath: string): DaemonInfo | undefined {
  try {
    if (!fs.existsSync(infoPath)) {
      return undefined;
    }
    const raw = fs.readFileSync(infoPath, "utf8");
    return JSON.parse(raw) as DaemonInfo;
  } catch {
    return undefined;
  }
}

function removeSafe(filePath: string, logger: Logger): void {
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    logger.warn("Failed to remove stale daemon.json.", {
      path: filePath,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function spawnDaemon(options: LaunchOptions, logger: Logger): void {
  logger.info("Spawning daemon process.", {
    script: options.daemonScript,
    host: options.host,
    bridgePort: options.bridgePort,
    controlPort: options.controlPort
  });

  const child = spawn(process.execPath, [options.daemonScript], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      GODOT_LOOP_MCP_HOST: options.host,
      GODOT_LOOP_MCP_PORT: String(options.bridgePort),
      GODOT_LOOP_MCP_CONTROL_PORT: String(options.controlPort),
      GODOT_LOOP_MCP_REPO_ROOT: options.repoRoot,
      GODOT_LOOP_MCP_LOG_DIR: options.logDir,
      GODOT_LOOP_MCP_SECURITY_LEVEL: options.securityLevel
    }
  });

  child.unref();
  logger.info("Daemon process spawned.", { childPid: child.pid });
}

async function waitForDaemonReady(
  infoPath: string,
  timeoutMs: number,
  logger: Logger
): Promise<DaemonInfo> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const info = readDaemonInfo(infoPath);
    if (info && isProcessAlive(info.pid)) {
      logger.info("Daemon is ready.", {
        pid: info.pid,
        controlPort: info.controlPort,
        bridgePort: info.bridgePort
      });
      return info;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(
    `Daemon failed to start within ${timeoutMs}ms. Check logs in ${path.dirname(infoPath)}.`
  );
}
