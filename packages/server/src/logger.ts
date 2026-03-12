import fs from "node:fs";
import path from "node:path";

export class Logger {
  private readonly logFilePath: string;
  private readonly output: NodeJS.WritableStream;
  private fileLoggingAvailable = true;

  constructor(logFilePath: string, output: NodeJS.WritableStream = process.stderr) {
    this.logFilePath = logFilePath;
    this.output = output;
    try {
      fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
    } catch (error) {
      this.fileLoggingAvailable = false;
      this.output.write(
        `[godot-loop-mcp][WARN] File logging disabled: ${
          error instanceof Error ? error.message : String(error)
        }\n`
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

  private write(level: string, message: string, context: Record<string, unknown>): void {
    const timestamp = new Date().toISOString();
    const suffix = Object.keys(context).length > 0 ? ` ${JSON.stringify(context)}` : "";
    const line = `${timestamp} [${level}] ${message}${suffix}`;
    this.output.write(`${line}\n`);
    if (!this.fileLoggingAvailable) {
      return;
    }

    try {
      fs.appendFileSync(this.logFilePath, `${line}\n`, "utf8");
    } catch (error) {
      this.fileLoggingAvailable = false;
      this.output.write(
        `[godot-loop-mcp][WARN] File logging disabled: ${
          error instanceof Error ? error.message : String(error)
        }\n`
      );
    }
  }
}
