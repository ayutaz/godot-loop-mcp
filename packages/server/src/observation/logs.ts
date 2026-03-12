import fs from "node:fs";
import path from "node:path";

export type LogSource = "addon" | "server" | "editor-console" | "runtime";
type LogBackend = "bridge-log-fallback" | "editor-console-buffer" | "runtime-log-file";

export interface OutputLogEntry {
  source: LogSource;
  timestamp: string;
  level: string;
  message: string;
  raw: string;
}

export interface OutputLogPayload {
  note: string;
  backend: LogBackend;
  captureAvailable: boolean;
  captureUsed: boolean;
  logDir?: string;
  fallbackReason?: string;
  entries: OutputLogEntry[];
}

interface FallbackLogOptions {
  note?: string;
  captureAvailable?: boolean;
  fallbackReason?: string;
}

const LOG_FILES: Array<{ source: LogSource; fileName: string }> = [
  { source: "addon", fileName: "addon.log" },
  { source: "server", fileName: "server.log" },
  { source: "runtime", fileName: "runtime.log" }
];

export function readOutputLogs(
  logDir: string,
  limit = 100,
  options: FallbackLogOptions = {}
): OutputLogPayload {
  const entries = readMergedEntries(logDir, limit);
  return {
    note: options.note ?? "Current implementation reads addon/server/runtime logs from .godot/mcp.",
    backend: "bridge-log-fallback",
    captureAvailable: options.captureAvailable ?? false,
    captureUsed: false,
    logDir,
    fallbackReason: options.fallbackReason,
    entries
  };
}

export function readErrorLogs(
  logDir: string,
  limit = 100,
  options: FallbackLogOptions = {}
): OutputLogPayload {
  const entries = readMergedEntries(logDir, limit * 2)
    .filter((entry) => entry.level === "ERROR")
    .slice(-limit);

  return {
    note:
      options.note ??
      "Current implementation filters error-level addon/server/runtime logs from .godot/mcp.",
    backend: "bridge-log-fallback",
    captureAvailable: options.captureAvailable ?? false,
    captureUsed: false,
    logDir,
    fallbackReason: options.fallbackReason,
    entries
  };
}

function readMergedEntries(logDir: string, limit: number): OutputLogEntry[] {
  const merged = LOG_FILES.flatMap(({ source, fileName }) =>
    readLogEntries(path.join(logDir, fileName), source, limit)
  );

  merged.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  return merged.slice(-limit);
}

function readLogEntries(filePath: string, source: LogSource, limit: number): OutputLogEntry[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, "utf8");
  return content
    .split(/\r?\n/u)
    .filter((line) => line.trim() !== "")
    .slice(-limit)
    .map((line) => parseLine(line, source));
}

function parseLine(line: string, source: LogSource): OutputLogEntry {
  const match = line.match(/^(\S+)\s+\[(\w+)\]\s+(.*)$/u);
  if (!match) {
    return {
      source,
      timestamp: "",
      level: inferLevel(line),
      message: line,
      raw: line
    };
  }

  const [, timestamp, level, message] = match;
  return {
    source,
    timestamp,
    level,
    message,
    raw: line
  };
}

function inferLevel(line: string): string {
  const lower = line.toLowerCase();
  if (lower.includes("error:") || lower.includes("script error") || lower.includes("user error")) {
    return "ERROR";
  }
  if (lower.includes("warning:")) {
    return "WARNING";
  }
  return "INFO";
}
