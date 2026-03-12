import fs from "node:fs";
import path from "node:path";

type LogSource = "addon" | "server";

export interface OutputLogEntry {
  source: LogSource;
  timestamp: string;
  level: string;
  message: string;
  raw: string;
}

export interface OutputLogPayload {
  note: string;
  logDir: string;
  entries: OutputLogEntry[];
}

const LOG_FILES: Array<{ source: LogSource; fileName: string }> = [
  { source: "addon", fileName: "addon.log" },
  { source: "server", fileName: "server.log" }
];

export function readOutputLogs(logDir: string, limit = 100): OutputLogPayload {
  const entries = readMergedEntries(logDir, limit);
  return {
    note: "Current implementation reads addon/server bridge logs from .godot/mcp.",
    logDir,
    entries
  };
}

export function readErrorLogs(logDir: string, limit = 100): OutputLogPayload {
  const entries = readMergedEntries(logDir, limit * 2)
    .filter((entry) => entry.level === "ERROR")
    .slice(-limit);

  return {
    note: "Current implementation filters error-level addon/server bridge logs from .godot/mcp.",
    logDir,
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
      level: "UNKNOWN",
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
