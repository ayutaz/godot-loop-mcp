import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resumeProjectScanConflicts, suspendProjectScanConflicts } from "./projectScanQuarantine.ts";
import { patchProjectFile, resolveBridgePort } from "./smokeUtils.ts";
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
const DEFAULT_BRIDGE_PORT = 6012;

async function main(): Promise<void> {
  const packageRoot = path.resolve(import.meta.dirname, "..", "..");
  const repoRoot = path.resolve(packageRoot, "..", "..");
  const godotGuiBinaryPath = resolveGodotGuiBinaryPath();
  if (!godotGuiBinaryPath) {
    throw new Error("Set GODOT_LOOP_MCP_GODOT_GUI_BIN or pass the GUI Godot binary path as argv[2].");
  }

  const smokeDir = path.join(repoRoot, SMOKE_RELATIVE_DIR);
  fs.rmSync(smokeDir, { recursive: true, force: true });
  const bridgePort = await resolveBridgePort(DEFAULT_BRIDGE_PORT, "the M4 GUI smoke");

  const scenePath = `res://${SMOKE_RELATIVE_DIR.replace(/\\/gu, "/")}/m4_gui_scene.tscn`;
  const logDir = path.join(repoRoot, ".godot", "mcp");
  const projectFilePath = path.join(repoRoot, "project.godot");
  const originalProjectFile = fs.readFileSync(projectFilePath, "utf8");
  fs.writeFileSync(projectFilePath, patchProjectFile(originalProjectFile, [
    {
      sectionName: "autoload",
      entryPrefix: `${AUTOLOAD_NAME}=`,
      entryValue: `${AUTOLOAD_NAME}=${AUTOLOAD_VALUE}`
    },
    {
      sectionName: "godot_loop_mcp",
      entryPrefix: "bridge/port=",
      entryValue: `bridge/port=${bridgePort}`
    }
  ]), "utf8");

  const transport = new StdioClientTransport({
    command: "node",
    args: ["--experimental-strip-types", "src/index.ts"],
    cwd: packageRoot,
    env: {
      ...process.env,
      GODOT_LOOP_MCP_LOG_DIR: logDir,
      GODOT_LOOP_MCP_PORT: String(bridgePort)
    },
    stderr: "inherit"
  });
  const client = new Client({
    name: "godot-loop-mcp-m4-gui-smoke",
    version: "0.1.3"
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
    await waitForToolVisibility(client, "get_running_scene_tree", true, 20_000);
    await waitForToolVisibility(client, "get_running_node_property", true, 20_000);
    await waitForToolVisibility(client, "wait_for_runtime_condition", true, 20_000);
    await waitForToolVisibility(client, "get_running_audio_players", true, 20_000);

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
      rootType: "Control",
      rootName: "M4GuiSmokeRoot"
    });
    const playButton = await callToolJson(client, "add_node", {
      parentPath: ".",
      nodeType: "Button",
      nodeName: "PlayButton"
    });
    const statusLabel = await callToolJson(client, "add_node", {
      parentPath: ".",
      nodeType: "Label",
      nodeName: "StatusLabel"
    });
    const audioPlayer = await callToolJson(client, "add_node", {
      parentPath: ".",
      nodeType: "AudioStreamPlayer",
      nodeName: "AudioPlayer"
    });

    await callToolJson(client, "update_property", {
      nodePath: String(playButton.payload.path ?? ""),
      propertyPath: "text",
      value: "Play Tone"
    });
    await callToolJson(client, "update_property", {
      nodePath: String(playButton.payload.path ?? ""),
      propertyPath: "position",
      value: vector2Value(40, 40)
    });
    await callToolJson(client, "update_property", {
      nodePath: String(playButton.payload.path ?? ""),
      propertyPath: "size",
      value: vector2Value(200, 80)
    });
    await callToolJson(client, "update_property", {
      nodePath: String(statusLabel.payload.path ?? ""),
      propertyPath: "text",
      value: "booting"
    });
    await callToolJson(client, "update_property", {
      nodePath: String(statusLabel.payload.path ?? ""),
      propertyPath: "position",
      value: vector2Value(40, 150)
    });

    const scriptPath = `res://${SMOKE_RELATIVE_DIR.replace(/\\/gu, "/")}/m4_gui_scene.gd`;
    await callToolJson(client, "create_script", {
      path: scriptPath,
      baseType: "Control",
      source: buildRuntimeVerificationScript()
    });
    const compileScript = await callToolJson(client, "compile_project", {
      paths: [scriptPath]
    });
    if (compileScript.payload.errorsCount !== 0) {
      throw new Error(`Runtime verification script did not compile cleanly: ${JSON.stringify(compileScript.payload)}`);
    }
    await callToolJson(client, "attach_script", {
      nodePath: ".",
      scriptPath
    });
    await callToolJson(client, "save_scene", { path: scenePath });
    await callToolJson(client, "play_scene", { path: scenePath });

    const runtimeState = await waitForSuccessfulToolCall(client, "get_editor_state", undefined, 10_000);
    if (runtimeState.runtimeMode !== "editor-play") {
      throw new Error(`Expected runtimeMode=editor-play, received ${JSON.stringify(runtimeState)}`);
    }

    const runtimeEvents = await waitForRuntimeEventsWithDiagnostics(client, 20_000);
    if (!Array.isArray(runtimeEvents.entries) || runtimeEvents.entries.length === 0) {
      throw new Error(`Runtime debug events payload was empty: ${JSON.stringify(runtimeEvents)}`);
    }

    const readyEvent = runtimeEvents.entries.find((entry) => isRecord(entry) && entry.event === "ready");
    if (!readyEvent) {
      throw new Error(`Runtime debug events did not include ready: ${JSON.stringify(runtimeEvents.entries)}`);
    }

    const runningSceneTree = await waitForSuccessfulToolCall(
      client,
      "get_running_scene_tree",
      undefined,
      20_000
    );
    const rootPath = assertString(runningSceneTree.rootPath, "running scene root path");
    if (!isRecord(runningSceneTree.tree) || runningSceneTree.tree.name !== "M4GuiSmokeRoot") {
      throw new Error(`Unexpected running scene tree payload: ${JSON.stringify(runningSceneTree)}`);
    }

    const playButtonPath = `${rootPath}/PlayButton`;
    const labelPath = `${rootPath}/StatusLabel`;
    const playerPath = `${rootPath}/AudioPlayer`;
    const initialLabel = await waitForSuccessfulToolCall(
      client,
      "get_running_node_property",
      { nodePath: labelPath, propertyPath: "text" },
      10_000
    );
    if (initialLabel.value !== "idle") {
      throw new Error(`Expected StatusLabel.text to start at idle, received ${JSON.stringify(initialLabel)}`);
    }

    const initialAudio = await waitForSuccessfulToolCall(
      client,
      "get_running_audio_players",
      undefined,
      10_000
    );
    if (!Array.isArray(initialAudio.players) || initialAudio.players.length < 1) {
      throw new Error(`Expected at least one audio player in runtime snapshot: ${JSON.stringify(initialAudio)}`);
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

    const playButtonNode = await waitForSuccessfulToolCall(
      client,
      "get_running_node",
      { nodePath: playButtonPath },
      10_000
    );
    if (!isRecord(playButtonNode.node) || !isRecord(playButtonNode.node.properties)) {
      throw new Error(`Running node payload for PlayButton was malformed: ${JSON.stringify(playButtonNode)}`);
    }
    const playButtonPosition = playButtonNode.node.properties.global_position;
    const playButtonSize = playButtonNode.node.properties.size;
    if (!isRecord(playButtonPosition) || !isRecord(playButtonSize)) {
      throw new Error(`PlayButton node snapshot did not include geometry: ${JSON.stringify(playButtonNode.node)}`);
    }

    const clickX = Number(playButtonPosition.x) + Number(playButtonSize.x) / 2;
    const clickY = Number(playButtonPosition.y) + Number(playButtonSize.y) / 2;

    await callToolJson(client, "simulate_mouse", {
      action: "click",
      x: clickX,
      y: clickY
    });

    const waitForLabel = await callToolJson(client, "wait_for_runtime_condition", {
      nodePath: labelPath,
      propertyPath: "text",
      predicate: "equals",
      value: "played",
      timeoutMs: 15_000,
      pollIntervalMs: 250
    });
    if (waitForLabel.isError || waitForLabel.payload.matched !== true) {
      throw new Error(`wait_for_runtime_condition did not observe StatusLabel.text=played: ${JSON.stringify(waitForLabel.payload)}`);
    }

    const waitForPlayback = await callToolJson(client, "wait_for_runtime_condition", {
      nodePath: playerPath,
      propertyPath: "playing",
      predicate: "equals",
      value: true,
      timeoutMs: 15_000,
      pollIntervalMs: 250
    });
    if (waitForPlayback.isError || waitForPlayback.payload.matched !== true) {
      throw new Error(`wait_for_runtime_condition did not observe AudioPlayer.playing=true: ${JSON.stringify(waitForPlayback.payload)}`);
    }

    const timeoutProbe = await callToolJson(client, "wait_for_runtime_condition", {
      nodePath: labelPath,
      propertyPath: "text",
      predicate: "equals",
      value: "never-matches",
      timeoutMs: 500,
      pollIntervalMs: 100
    }, {
      allowToolError: true
    });
    if (
      timeoutProbe.isError ||
      timeoutProbe.payload.matched !== false ||
      timeoutProbe.payload.timedOut !== true ||
      timeoutProbe.payload.code !== "timed_out"
    ) {
      throw new Error(`wait_for_runtime_condition timeout must return a non-error timed_out result: ${JSON.stringify(timeoutProbe.payload)}`);
    }

    const audioAfterClick = await waitForSuccessfulToolCall(
      client,
      "get_running_audio_players",
      { playingOnly: true },
      10_000
    );
    if (!Array.isArray(audioAfterClick.players) || audioAfterClick.players.length < 1) {
      throw new Error(`Expected a playing audio player after click: ${JSON.stringify(audioAfterClick)}`);
    }

    const activePlayer = audioAfterClick.players.find(
      (entry) => isRecord(entry) && entry.path === playerPath && entry.playing === true
    );
    if (!activePlayer || typeof activePlayer.playbackPosition !== "number" || activePlayer.playbackPosition <= 0) {
      throw new Error(`Expected playbackPosition to advance after click: ${JSON.stringify(audioAfterClick.players)}`);
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

function vector2Value(x: number, y: number): Record<string, unknown> {
  return {
    type: "Vector2",
    x,
    y
  };
}

function buildRuntimeVerificationScript(): string {
  return `extends Control

@onready var play_button: Button = $PlayButton
@onready var status_label: Label = $StatusLabel
@onready var audio_player: AudioStreamPlayer = $AudioPlayer

func _ready() -> void:
\tstatus_label.text = "idle"
\tplay_button.pressed.connect(_on_play_pressed)
\taudio_player.stream = _build_test_tone()
\tcall_deferred("_auto_play")

func _on_play_pressed() -> void:
\tstatus_label.text = "played"
\tif not audio_player.playing:
\t\taudio_player.play()

func _auto_play() -> void:
\tawait get_tree().create_timer(2.0).timeout
\t_on_play_pressed()

func _build_test_tone() -> AudioStreamWAV:
\tvar sample_rate := 22050
\tvar duration_sec := 1.0
\tvar frame_count := int(sample_rate * duration_sec)
\tvar pcm := PackedByteArray()
\tpcm.resize(frame_count * 2)
\tfor i in range(frame_count):
\t\tvar sample := int(sin(float(i) * 440.0 * TAU / float(sample_rate)) * 20000.0)
\t\tvar packed := sample & 0xFFFF
\t\tpcm[i * 2] = packed & 0xFF
\t\tpcm[i * 2 + 1] = (packed >> 8) & 0xFF
\tvar stream := AudioStreamWAV.new()
\tstream.format = AudioStreamWAV.FORMAT_16_BITS
\tstream.mix_rate = sample_rate
\tstream.stereo = false
\tstream.data = pcm
\treturn stream
`;
}

async function waitForRuntimeEventsWithDiagnostics(
  client: Client,
  timeoutMs: number
): Promise<Record<string, unknown>> {
  try {
    return await waitForRuntimeEvents(client, timeoutMs);
  } catch (error) {
    const [errors, output] = await Promise.all([
      callToolJson(client, "get_godot_errors", { limit: 50 }, { allowToolError: true }).catch(() => undefined),
      callToolJson(client, "get_output_logs", { limit: 50 }, { allowToolError: true }).catch(() => undefined)
    ]);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${message} errors=${JSON.stringify(errors?.payload ?? {})} output=${JSON.stringify(output?.payload ?? {})}`
    );
  }
}

await main();
