import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SecurityLevel } from "./transport/types.ts";

export interface ServerConfig {
  host: string;
  port: number;
  controlPort: number;
  heartbeatIntervalMs: number;
  connectTimeoutMs: number;
  handshakeTimeoutMs: number;
  requestTimeoutMs: number;
  idleTimeoutMs: number;
  reconnectInitialDelayMs: number;
  reconnectMaxDelayMs: number;
  repoRoot: string;
  logDir: string;
  bridgeOnlyMode: boolean;
  securityLevel: SecurityLevel;
}

const sourceDir = fileURLToPath(new URL(".", import.meta.url));
const packageRoot = path.resolve(sourceDir, "..");

export function loadConfig(): ServerConfig {
  const repoRoot = resolveRepoRoot();
  return {
    host: process.env.GODOT_LOOP_MCP_HOST ?? "127.0.0.1",
    port: numberFromEnv("GODOT_LOOP_MCP_PORT", 6010),
    controlPort: numberFromEnv("GODOT_LOOP_MCP_CONTROL_PORT", 6011),
    heartbeatIntervalMs: numberFromEnv("GODOT_LOOP_MCP_HEARTBEAT_MS", 15_000),
    connectTimeoutMs: numberFromEnv("GODOT_LOOP_MCP_CONNECT_TIMEOUT_MS", 5_000),
    handshakeTimeoutMs: numberFromEnv("GODOT_LOOP_MCP_HANDSHAKE_TIMEOUT_MS", 5_000),
    requestTimeoutMs: numberFromEnv("GODOT_LOOP_MCP_REQUEST_TIMEOUT_MS", 10_000),
    idleTimeoutMs: numberFromEnv("GODOT_LOOP_MCP_IDLE_TIMEOUT_MS", 30_000),
    reconnectInitialDelayMs: numberFromEnv("GODOT_LOOP_MCP_RECONNECT_INITIAL_DELAY_MS", 2_000),
    reconnectMaxDelayMs: numberFromEnv("GODOT_LOOP_MCP_RECONNECT_MAX_DELAY_MS", 10_000),
    repoRoot,
    logDir: process.env.GODOT_LOOP_MCP_LOG_DIR ?? path.join(repoRoot, ".godot", "mcp"),
    bridgeOnlyMode: booleanFromEnv("GODOT_LOOP_MCP_BRIDGE_ONLY", false),
    securityLevel: securityLevelFromEnv("GODOT_LOOP_MCP_SECURITY_LEVEL", "WorkspaceWrite")
  };
}

function resolveRepoRoot(): string {
  const explicitRoot = process.env.GODOT_LOOP_MCP_REPO_ROOT?.trim();
  if (explicitRoot) {
    return path.resolve(explicitRoot);
  }

  const cwdRoot = findProjectRoot(process.cwd());
  if (cwdRoot) {
    return cwdRoot;
  }

  const sourceLayoutRoot = findProjectRoot(path.resolve(packageRoot, "..", ".."));
  if (sourceLayoutRoot) {
    return sourceLayoutRoot;
  }

  return process.cwd();
}

function findProjectRoot(startDir: string): string | undefined {
  let currentDir = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(currentDir, "project.godot"))) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return undefined;
    }
    currentDir = parentDir;
  }
}

function numberFromEnv(name: string, fallback: number): number {
  const rawValue = process.env[name];
  if (!rawValue) {
    return fallback;
  }

  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function booleanFromEnv(name: string, fallback: boolean): boolean {
  const rawValue = process.env[name];
  if (!rawValue) {
    return fallback;
  }

  return rawValue === "1" || rawValue.toLowerCase() === "true";
}

function securityLevelFromEnv(name: string, fallback: SecurityLevel): SecurityLevel {
  const rawValue = process.env[name]?.trim().toLowerCase();
  switch (rawValue) {
    case "readonly":
      return "ReadOnly";
    case "dangerous":
      return "Dangerous";
    case "workspacewrite":
      return "WorkspaceWrite";
    default:
      return fallback;
  }
}
