import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resumeProjectScanConflicts, suspendProjectScanConflicts } from "./projectScanQuarantine.ts";
import {
  assertString,
  callToolJson,
  isRecord,
  waitForProjectInfo,
  waitForRuntimeEvents,
  waitForSuccessfulToolCall,
  waitForToolVisibility
} from "./smokeHarness.ts";

const SMOKE_RELATIVE_DIR = "codex-smoke/m4-gui";
const AUTOLOAD_NAME = "GodotLoopMcpRuntimeTelemetry";
const AUTOLOAD_VALUE = "\"*res://addons/godot_loop_mcp/runtime/runtime_telemetry.gd\"";

async function main(): Promise<void> {
  const packageRoot = path.resolve(import.meta.dirname, "..", "..");
  const repoRoot = path.resolve(packageRoot, "..", "..");
  const godotGuiBinaryPath = resolveGodotGuiBinaryPath();
  if (!godotGuiBinaryPath) {
    throw new Error("Set GODOT_LOOP_MCP_GODOT_GUI_BIN or pass the GUI Godot binary path as argv[2].");
  }

  const smokeDir = path.join(repoRoot, SMOKE_RELATIVE_DIR);
  fs.rmSync(smokeDir, { recursive: true, force: true });

  const scenePath = `res://${SMOKE_RELATIVE_DIR.replace(/\\/gu, "/")}/m4_gui_scene.tscn`;
  const logDir = path.join(repoRoot, ".godot", "mcp");
  const projectFilePath = path.join(repoRoot, "project.godot");
  const originalProjectFile = fs.readFileSync(projectFilePath, "utf8");
  fs.writeFileSync(projectFilePath, upsertAutoload(originalProjectFile), "utf8");

  const transport = new StdioClientTransport({
    command: "node",
    args: ["--experimental-strip-types", "src/index.ts"],
    cwd: packageRoot,
    env: {
      ...process.env,
      GODOT_LOOP_MCP_LOG_DIR: logDir
    },
    stderr: "inherit"
  });
  const client = new Client({
    name: "godot-loop-mcp-m4-gui-smoke",
    version: "0.1.0"
  });

  let godotProcess: ChildProcess | undefined;
  const scanQuarantineState = await suspendProjectScanConflicts(repoRoot);
  try {
    await client.connect(transport);

    godotProcess = spawn(
      godotGuiBinaryPath,
      ["--editor", "--path", repoRoot],
      {
        cwd: repoRoot,
        stdio: ["ignore", "ignore", "inherit"],
        env: {
          ...process.env
        }
      }
    );

    await waitForProjectInfo(client, 60_000);
    await waitForToolVisibility(client, "get_editor_screenshot", true, 20_000);
    await waitForToolVisibility(client, "get_running_scene_screenshot", true, 20_000);
    await waitForToolVisibility(client, "get_runtime_debug_events", true, 20_000);

    const editorScreenshot = await waitForSuccessfulToolCall(
      client,
      "get_editor_screenshot",
      { includeImage: false },
      20_000
    );
    const editorScreenshotPath = assertString(editorScreenshot.path, "editor screenshot path");
    if (!fs.existsSync(editorScreenshotPath)) {
      throw new Error(`Editor screenshot was not created at ${editorScreenshotPath}.`);
    }

    await callToolJson(client, "create_scene", {
      path: scenePath,
      rootType: "Node2D",
      rootName: "M4GuiSmokeRoot"
    });
    await callToolJson(client, "save_scene", { path: scenePath });
    await callToolJson(client, "play_scene", { path: scenePath });

    const runtimeEvents = await waitForRuntimeEvents(client, 20_000);
    if (!Array.isArray(runtimeEvents.entries) || runtimeEvents.entries.length === 0) {
      throw new Error(`Runtime debug events payload was empty: ${JSON.stringify(runtimeEvents)}`);
    }

    const readyEvent = runtimeEvents.entries.find((entry) => isRecord(entry) && entry.event === "ready");
    if (!readyEvent) {
      throw new Error(`Runtime debug events did not include ready: ${JSON.stringify(runtimeEvents.entries)}`);
    }

    const runtimeState = await waitForSuccessfulToolCall(client, "get_editor_state", undefined, 10_000);
    if (runtimeState.runtimeMode !== "editor-play") {
      throw new Error(`Expected runtimeMode=editor-play, received ${JSON.stringify(runtimeState)}`);
    }

    const runtimeScreenshot = await waitForSuccessfulToolCall(
      client,
      "get_running_scene_screenshot",
      { includeImage: false },
      20_000
    );
    const runtimeScreenshotPath = assertString(runtimeScreenshot.path, "runtime screenshot path");
    if (!fs.existsSync(runtimeScreenshotPath)) {
      throw new Error(`Runtime screenshot was not created at ${runtimeScreenshotPath}.`);
    }

    const clearEvents = await callToolJson(client, "clear_runtime_debug_events");
    if (typeof clearEvents.payload.clearedCount !== "number" || clearEvents.payload.clearedCount < 1) {
      throw new Error(`clear_runtime_debug_events returned unexpected payload: ${JSON.stringify(clearEvents.payload)}`);
    }

    await callToolJson(client, "stop_scene");
    await delay(500);

    console.error("M4 GUI screenshot/runtime-debug smoke passed.");
  } finally {
    if (godotProcess && !godotProcess.killed) {
      godotProcess.kill();
    }
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
    await resumeProjectScanConflicts(scanQuarantineState).catch(() => undefined);
    fs.writeFileSync(projectFilePath, originalProjectFile, "utf8");
    fs.rmSync(smokeDir, { recursive: true, force: true });
  }
}

function resolveGodotGuiBinaryPath(): string {
  const explicitGuiPath = process.env.GODOT_LOOP_MCP_GODOT_GUI_BIN ?? process.argv[2];
  if (explicitGuiPath) {
    return explicitGuiPath;
  }

  const consolePath = process.env.GODOT_LOOP_MCP_GODOT_BIN ?? "";
  if (consolePath.toLowerCase().endsWith("godot_console.exe")) {
    return consolePath.slice(0, -("godot_console.exe".length)) + "godot.exe";
  }

  return "";
}

function upsertAutoload(projectFile: string): string {
  const newline = projectFile.includes("\r\n") ? "\r\n" : "\n";
  const lines = projectFile.split(/\r?\n/u);
  const autoloadHeaderIndex = lines.findIndex((line) => line.trim() === "[autoload]");
  const autoloadEntry = `${AUTOLOAD_NAME}=${AUTOLOAD_VALUE}`;

  if (autoloadHeaderIndex >= 0) {
    const existingEntryIndex = lines.findIndex((line) => line.startsWith(`${AUTOLOAD_NAME}=`));
    if (existingEntryIndex >= 0) {
      lines[existingEntryIndex] = autoloadEntry;
      return lines.join(newline);
    }

    let insertIndex = autoloadHeaderIndex + 1;
    while (insertIndex < lines.length && !lines[insertIndex].startsWith("[")) {
      insertIndex += 1;
    }
    lines.splice(insertIndex, 0, autoloadEntry);
    return lines.join(newline);
  }

  const trimmed = projectFile.endsWith(newline) ? projectFile.slice(0, -newline.length) : projectFile;
  return `${trimmed}${newline}${newline}[autoload]${newline}${autoloadEntry}${newline}`;
}

await main();
