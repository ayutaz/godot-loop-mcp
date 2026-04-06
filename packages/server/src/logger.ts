import fs from "node:fs";
import path from "node:path";

export type LoggerLevel = "DEBUG" | "INFO" | "WARN" | "ERROR" | "SILENT";

export interface LoggerOptions {
  output?: NodeJS.WritableStream;
  consoleLevel?: string;
  fileLevel?: string;
}

const LOG_LEVEL_PRIORITY: Record<LoggerLevel, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
  SILENT: 50,
};

const DEFAULT_CONSOLE_LEVEL: LoggerLevel = "WARN";
const DEFAULT_FILE_LEVEL: LoggerLevel = "DEBUG";

export class Logger {
  private readonly logFilePath: string;
  private readonly output: NodeJS.WritableStream;
  private readonly consoleLevel: LoggerLevel;
  private readonly fileLevel: LoggerLevel;
  private fileLoggingAvailable = true;

  constructor(
    logFilePath: string,
    outputOrOptions: NodeJS.WritableStream | LoggerOptions = process.stderr,
  ) {
    const options = isWritableStream(outputOrOptions)
      ? ({ output: outputOrOptions } satisfies LoggerOptions)
      : outputOrOptions;

    this.logFilePath = logFilePath;
    this.output = options.output ?? process.stderr;
    this.consoleLevel = normalizeLevel(
      options.consoleLevel ?? process.env.GODOT_LOOP_MCP_CONSOLE_LOG_LEVEL,
      DEFAULT_CONSOLE_LEVEL,
    );
    this.fileLevel = normalizeLevel(
      options.fileLevel ?? process.env.GODOT_LOOP_MCP_FILE_LOG_LEVEL,
      DEFAULT_FILE_LEVEL,
    );

    try {
      fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
    } catch (error) {
      this.fileLoggingAvailable = false;
      this.emitConsole(
        "WARN",
        `[godot-loop-mcp][WARN] File logging disabled: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  info(message: string, context: Record<string, unknown> = {}): void {
    this.write("INFO", message, context);
  }

  warn(message: string, context: Record<string, unknown> = {}): void {
    this.write("WARN", message, context);
  }

  error(message: string, context: Record<string, unknown> = {}): void {
    this.write("ERROR", message, context);
  }

  debug(message: string, context: Record<string, unknown> = {}): void {
    this.write("DEBUG", message, context);
  }

  private write(level: LoggerLevel, message: string, context: Record<string, unknown>): void {
    const line = formatLine(level, message, context);
    this.emitConsole(level, line);
    if (!this.fileLoggingAvailable || !shouldEmit(level, this.fileLevel)) {
      return;
    }

    try {
      fs.appendFileSync(this.logFilePath, `${line}\n`, "utf8");
    } catch (error) {
      this.fileLoggingAvailable = false;
      this.emitConsole(
        "WARN",
        `[godot-loop-mcp][WARN] File logging disabled: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private emitConsole(level: LoggerLevel, line: string): void {
    if (!shouldEmit(level, this.consoleLevel)) {
      return;
    }
    this.output.write(`${line}\n`);
  }
}

function formatLine(level: LoggerLevel, message: string, context: Record<string, unknown>): string {
  const timestamp = new Date().toISOString();
  const suffix = Object.keys(context).length > 0 ? ` ${JSON.stringify(context)}` : "";
  return `${timestamp} [${level}] ${message}${suffix}`;
}

function normalizeLevel(rawValue: string | undefined, fallback: LoggerLevel): LoggerLevel {
  const normalized = rawValue?.trim().toUpperCase() ?? "";
  switch (normalized) {
    case "DEBUG":
      return "DEBUG";
    case "INFO":
    case "INFORMATION":
      return "INFO";
    case "WARN":
    case "WARNING":
      return "WARN";
    case "ERROR":
      return "ERROR";
    case "SILENT":
    case "OFF":
    case "NONE":
      return "SILENT";
    default:
      return fallback;
  }
}

function shouldEmit(level: LoggerLevel, threshold: LoggerLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[threshold];
}

function isWritableStream(
  value: NodeJS.WritableStream | LoggerOptions,
): value is NodeJS.WritableStream {
  return typeof (value as NodeJS.WritableStream).write === "function";
}
