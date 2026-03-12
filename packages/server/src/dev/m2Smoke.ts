import fs from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resumeProjectScanConflicts, suspendProjectScanConflicts } from "./projectScanQuarantine.ts";

const SMOKE_RELATIVE_DIR = ".codex-smoke/m2";
async function main(): Promise<void> {
  const packageRoot = path.resolve(import.meta.dirname, "..", "..");
  const repoRoot = path.resolve(packageRoot, "..", "..");
  const godotBinaryPath = process.env.GODOT_LOOP_MCP_GODOT_BIN ?? process.argv[2];

  if (!godotBinaryPath) {
    throw new Error("Set GODOT_LOOP_MCP_GODOT_BIN or pass the Godot binary path as argv[2].");
  }

  const smokeDir = path.join(repoRoot, SMOKE_RELATIVE_DIR);
  fs.rmSync(smokeDir, { recursive: true, force: true });

  const scenePath = `res://${SMOKE_RELATIVE_DIR.replace(/\\/gu, "/")}/m2_smoke_scene.tscn`;
  const scriptPath = `res://${SMOKE_RELATIVE_DIR.replace(/\\/gu, "/")}/m2_smoke_agent.gd`;
  const readyToken = `m2-smoke-ready-${Date.now()}`;
  const logDir = path.join(repoRoot, ".godot", "mcp");
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
    name: "godot-loop-mcp-m2-smoke",
    version: "0.1.0"
  });

  let godotProcess: ChildProcess | undefined;
  const scanQuarantineState = await suspendProjectScanConflicts(repoRoot);
  try {
    await client.connect(transport);
    godotProcess = spawn(
      godotBinaryPath,
      ["--headless", "--editor", "--path", repoRoot],
      {
        cwd: repoRoot,
        stdio: ["ignore", "inherit", "inherit"]
      }
    );

    const projectInfo = await waitForProjectInfo(client, 45_000);
    assertString(projectInfo.godotVersion, "godotVersion");
    const expectsEditorConsoleCapture = supportsEditorConsoleCapture(projectInfo.godotVersion);

    console.error("Clearing output logs...");
    const clearBefore = await callToolJson(client, "clear_output_logs");
    if (!Array.isArray(clearBefore.payload.clearedLogFiles)) {
      throw new Error("clear_output_logs.clearedLogFiles must be an array.");
    }

    console.error("Creating a scene...");
    await callToolJson(client, "create_scene", {
      path: scenePath,
      rootType: "Node2D",
      rootName: "M2SmokeRoot"
    });
    const rootPath = await waitForCurrentScene(client, scenePath, 20_000);

    console.error("Adding nodes...");
    const groupNode = await callToolJson(client, "add_node", {
      parentPath: rootPath,
      nodeType: "Node2D",
      nodeName: "Group"
    });
    const agentNode = await callToolJson(client, "add_node", {
      parentPath: rootPath,
      nodeType: "Node2D",
      nodeName: "Agent"
    });
    const trashNode = await callToolJson(client, "add_node", {
      parentPath: rootPath,
      nodeType: "Node",
      nodeName: "Trash"
    });
    assertString(groupNode.payload.path, "group node path");
    assertString(agentNode.payload.path, "agent node path");
    assertString(trashNode.payload.path, "trash node path");

    console.error("Moving and updating nodes...");
    await callToolJson(client, "move_node", {
      nodePath: agentNode.payload.path,
      newParentPath: groupNode.payload.path,
      index: 0
    });
    const movedAgentPath = await waitForNodePath(client, "Agent", `${groupNode.payload.path}/Agent`, 10_000);
    await callToolJson(client, "update_property", {
      nodePath: movedAgentPath,
      propertyPath: "position:x",
      value: 24
    });

    console.error("Creating and attaching a script...");
    const createdScript = await callToolJson(client, "create_script", {
      path: scriptPath,
      baseType: "Node2D",
      readyMessage: readyToken
    });
    assertString(createdScript.payload.path, "created script path");
    await callToolJson(client, "attach_script", {
      nodePath: movedAgentPath,
      scriptPath
    });

    console.error("Deleting the temporary node...");
    await callToolJson(client, "delete_node", {
      nodePath: trashNode.payload.path
    });

    console.error("Saving and reopening the scene...");
    await callToolJson(client, "save_scene", { path: scenePath });
    await callToolJson(client, "open_scene", { path: scenePath });
    await waitForCurrentScene(client, scenePath, 15_000);

    console.error("Validating the scene tree...");
    const tree = await callToolJson(client, "get_scene_tree");
    assertSceneContainsNode(tree.payload, "Group");
    assertSceneContainsNode(tree.payload, "Agent");
    assertSceneMissingNode(tree.payload, "Trash");

    console.error("Validating the saved scene file...");
    const sceneFile = fs.readFileSync(path.join(repoRoot, SMOKE_RELATIVE_DIR, "m2_smoke_scene.tscn"), "utf8");
    assertContains(sceneFile, 'name="Group"', "scene file");
    assertContains(sceneFile, 'name="Agent"', "scene file");
    assertNotContains(sceneFile, 'name="Trash"', "scene file");
    assertContains(sceneFile, scriptPath, "scene file");
    assertContains(sceneFile, "position = Vector2(24, 0)", "scene file");

    console.error("Clearing logs before play...");
    await callToolJson(client, "clear_output_logs");

    console.error("Playing the scene...");
    await callToolJson(client, "play_scene", { path: scenePath });
    await waitForPlayState(client, true, 20_000);
    await delay(1000);

    console.error("Stopping the scene...");
    await callToolJson(client, "stop_scene");
    await waitForPlayState(client, false, 20_000);

    console.error("Reading runtime logs after stop...");
    const logs = await waitForLogs(client, expectsEditorConsoleCapture, readyToken, 10_000);
    if (!Array.isArray(logs.entries)) {
      throw new Error("get_output_logs.entries must be an array.");
    }

    console.error("Reading error logs...");
    const errors = await callToolJson(client, "get_godot_errors", { limit: 20 });
    if (!Array.isArray(errors.payload.entries)) {
      throw new Error("get_godot_errors.entries must be an array.");
    }

    console.error("M2 edit/play smoke passed.");
  } finally {
    if (godotProcess && !godotProcess.killed) {
      godotProcess.kill();
    }
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
    await resumeProjectScanConflicts(scanQuarantineState).catch(() => undefined);
    fs.rmSync(smokeDir, { recursive: true, force: true });
  }
}

async function waitForProjectInfo(client: Client, timeoutMs: number): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  let lastReason = "Addon session did not become ready.";

  while (Date.now() < deadline) {
    const tools = await client.listTools();
    if (!tools.tools.some((tool) => tool.name === "get_project_info")) {
      await delay(500);
      continue;
    }

    const result = await callToolJson(client, "get_project_info", undefined, { allowToolError: true });
    if (!result.isError) {
      return result.payload;
    }

    lastReason = typeof result.payload.reason === "string" ? result.payload.reason : lastReason;
    await delay(1000);
  }

  throw new Error(lastReason);
}

async function waitForCurrentScene(client: Client, expectedScenePath: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const state = await callToolJson(client, "get_editor_state");
    if (state.payload.currentScenePath === expectedScenePath) {
      const tree = await callToolJson(client, "get_scene_tree");
      if (isRecord(tree.payload.root) && typeof tree.payload.root.path === "string") {
        return tree.payload.root.path;
      }
    }
    await delay(500);
  }

  throw new Error(`The current scene did not switch to ${expectedScenePath}.`);
}

async function waitForNodePath(
  client: Client,
  query: string,
  expectedPath: string,
  timeoutMs: number
): Promise<string> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await callToolJson(client, "find_nodes", {
      query,
      searchMode: "exact",
      maxResults: 10
    });
    const matches = Array.isArray(result.payload.matches) ? result.payload.matches : [];
    const match = matches.find(
      (entry) => isRecord(entry) && typeof entry.path === "string" && entry.path === expectedPath
    );
    if (match && isRecord(match) && typeof match.path === "string") {
      return match.path;
    }
    await delay(500);
  }

  throw new Error(`Node ${query} did not move to ${expectedPath}.`);
}

async function waitForPlayState(client: Client, expectedValue: boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await callToolJson(client, "get_editor_state");
    if (state.payload.isPlayingScene === expectedValue) {
      return;
    }
    await delay(500);
  }

  throw new Error(`Editor did not reach isPlayingScene=${expectedValue}.`);
}

async function waitForLogs(
  client: Client,
  expectsEditorConsoleCapture: boolean,
  readyToken: string,
  timeoutMs: number
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const logs = await callToolJson(client, "get_output_logs", { limit: 50 });
    assertLogBackend(logs.payload, expectsEditorConsoleCapture, "get_output_logs");
    const entries = Array.isArray(logs.payload.entries) ? logs.payload.entries : [];
    const found = entries.some(
      (entry) => isRecord(entry) && typeof entry.message === "string" && entry.message.includes(readyToken)
    );
    if (found) {
      return logs.payload;
    }

    await delay(500);
  }

  throw new Error(`Runtime output log did not contain ${readyToken}.`);
}

async function callToolJson(
  client: Client,
  name: string,
  args?: Record<string, unknown>,
  options: {
    allowToolError?: boolean;
  } = {}
): Promise<{ payload: Record<string, unknown>; isError: boolean }> {
  const result = await client.callTool({
    name,
    arguments: args ?? {}
  });

  const content = Array.isArray(result.content)
    ? (result.content as Array<{ type: string; text?: string }>)
    : [];
  const payload = isRecord(result.structuredContent)
    ? result.structuredContent
    : parseFirstTextBlock(content);

  if (result.isError && !options.allowToolError) {
    throw new Error(`${name} returned an MCP tool error: ${JSON.stringify(payload)}`);
  }

  return {
    payload,
    isError: !!result.isError
  };
}

function parseFirstTextBlock(content: Array<{ type: string; text?: string }>): Record<string, unknown> {
  const textBlock = content.find((item) => item.type === "text" && typeof item.text === "string");
  if (!textBlock?.text) {
    throw new Error("Tool result did not contain a text payload.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(textBlock.text) as unknown;
  } catch (error) {
    throw new Error(
      `Tool result text payload was not JSON. payload=${textBlock.text} error=${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  if (!isRecord(parsed)) {
    throw new Error("Tool result text payload was not a JSON object.");
  }

  return parsed;
}

function supportsEditorConsoleCapture(version: unknown): boolean {
  if (typeof version !== "string") {
    return false;
  }

  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/u);
  if (!match) {
    return false;
  }

  const major = Number.parseInt(match[1] ?? "0", 10);
  const minor = Number.parseInt(match[2] ?? "0", 10);
  return major > 4 || (major === 4 && minor >= 5);
}

function assertLogBackend(
  payload: Record<string, unknown>,
  expectsEditorConsoleCapture: boolean,
  label: string
): void {
  if (typeof payload.backend !== "string") {
    throw new Error(`${label}.backend must be a string.`);
  }

  const expectedBackends = expectsEditorConsoleCapture
    ? new Set(["editor-console-buffer", "runtime-log-file", "bridge-log-fallback"])
    : new Set(["runtime-log-file", "bridge-log-fallback"]);
  if (!expectedBackends.has(payload.backend)) {
    const fallbackReason =
      typeof payload.fallbackReason === "string" ? ` fallbackReason=${payload.fallbackReason}` : "";
    throw new Error(
      `${label}.backend must be one of ${Array.from(expectedBackends).join(", ")}, got ${payload.backend}.${fallbackReason}`
    );
  }
}

function assertSceneContainsNode(payload: Record<string, unknown>, nodeName: string): void {
  if (!containsNode(payload.root, nodeName)) {
    throw new Error(`Scene tree does not contain ${nodeName}.`);
  }
}

function assertSceneMissingNode(payload: Record<string, unknown>, nodeName: string): void {
  if (containsNode(payload.root, nodeName)) {
    throw new Error(`Scene tree unexpectedly contains ${nodeName}.`);
  }
}

function containsNode(node: unknown, nodeName: string): boolean {
  if (!isRecord(node)) {
    return false;
  }
  if (node.name === nodeName) {
    return true;
  }

  const children = Array.isArray(node.children) ? node.children : [];
  return children.some((child) => containsNode(child, nodeName));
}

function assertContains(value: string, expected: string, label: string): void {
  if (!value.includes(expected)) {
    throw new Error(`${label} does not contain ${expected}.`);
  }
}

function assertNotContains(value: string, unexpected: string, label: string): void {
  if (value.includes(unexpected)) {
    throw new Error(`${label} unexpectedly contains ${unexpected}.`);
  }
}

function assertString(value: unknown, label: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
