import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import test from "node:test";
import { Logger } from "./logger.ts";

class CaptureStream extends Writable {
  data = "";

  override _write(
    chunk: string | Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    this.data += chunk.toString();
    callback();
  }
}

test("default logger keeps console output quiet while retaining detailed file logs", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "godot-loop-mcp-logger-"));
  try {
    const logFilePath = path.join(tempDir, "server.log");
    const output = new CaptureStream();
    const logger = new Logger(logFilePath, { output });

    logger.debug("Debug only message.", { source: "test" });
    logger.info("Info message.");

    const fileContents = fs.readFileSync(logFilePath, "utf8");

    assert.match(fileContents, /Debug only message\./);
    assert.match(fileContents, /Info message\./);
    assert.doesNotMatch(output.data, /Debug only message\./);
    assert.doesNotMatch(output.data, /Info message\./);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("logger thresholds are overridable for console and file outputs", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "godot-loop-mcp-logger-"));
  try {
    const logFilePath = path.join(tempDir, "server.log");
    const output = new CaptureStream();
    const logger = new Logger(logFilePath, {
      output,
      consoleLevel: "debug",
      fileLevel: "error",
    });

    logger.debug("Debug to console.");
    logger.info("Info to console.");
    logger.error("Error everywhere.");

    const fileContents = fs.readFileSync(logFilePath, "utf8");

    assert.match(output.data, /Debug to console\./);
    assert.match(output.data, /Info to console\./);
    assert.match(output.data, /Error everywhere\./);
    assert.doesNotMatch(fileContents, /Debug to console\./);
    assert.doesNotMatch(fileContents, /Info to console\./);
    assert.match(fileContents, /Error everywhere\./);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
