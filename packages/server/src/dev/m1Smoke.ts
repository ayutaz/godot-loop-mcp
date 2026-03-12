import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main(): Promise<void> {
  const packageRoot = path.resolve(import.meta.dirname, "..", "..");
  const repoRoot = path.resolve(packageRoot, "..", "..");
  const godotBinaryPath = process.env.GODOT_LOOP_MCP_GODOT_BIN ?? process.argv[2];

  if (!godotBinaryPath) {
    throw new Error("Set GODOT_LOOP_MCP_GODOT_BIN or pass the Godot binary path as argv[2].");
  }

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
    name: "godot-loop-mcp-m1-smoke",
    version: "0.1.0"
  });

  let godotProcess: ChildProcess | undefined;
  try {
    await client.connect(transport);
    godotProcess = spawn(
      godotBinaryPath,
      ["--headless", "--editor", "--quit-after", "120", "--path", repoRoot],
      {
        cwd: repoRoot,
        stdio: ["ignore", "inherit", "inherit"]
      }
    );

    const projectInfo = await waitForProjectInfo(client, 45_000);
    assertString(projectInfo.projectName, "projectName");

    console.error("Checking tool catalog...");
    const tools = await client.listTools();
    assertContains(tools.tools.map((tool) => tool.name), "get_project_info", "tool list");
    assertContains(tools.tools.map((tool) => tool.name), "get_scene_tree", "tool list");
    assertContains(tools.tools.map((tool) => tool.name), "get_output_logs", "tool list");

    console.error("Checking resource catalog...");
    const resources = await client.listResources();
    assertContains(resources.resources.map((resource) => resource.uri), "godot://project/info", "resource list");
    assertContains(resources.resources.map((resource) => resource.uri), "godot://scene/current", "resource list");

    console.error("Calling get_editor_state...");
    const editorState = await callToolJson(client, "get_editor_state");
    if (!Array.isArray(editorState.openScenePaths)) {
      throw new Error("get_editor_state.openScenePaths must be an array.");
    }

    console.error("Calling get_scene_tree...");
    const sceneTree = await callToolJson(client, "get_scene_tree");
    if (typeof sceneTree.sceneAvailable !== "boolean") {
      throw new Error("get_scene_tree.sceneAvailable must be a boolean.");
    }

    console.error("Calling get_open_scripts...");
    const openScripts = await callToolJson(client, "get_open_scripts");
    if (!Array.isArray(openScripts.scripts)) {
      throw new Error("get_open_scripts.scripts must be an array.");
    }

    console.error("Calling get_output_logs...");
    const logs = await callToolJson(client, "get_output_logs", { limit: 20 });
    if (!Array.isArray(logs.entries)) {
      throw new Error("get_output_logs.entries must be an array.");
    }

    console.error("Reading godot://project/info...");
    const projectResource = await readResourceJson(client, "godot://project/info");
    assertString(projectResource.projectName, "project resource projectName");

    console.error("Reading godot://scene/current...");
    const sceneResource = await readResourceJson(client, "godot://scene/current");
    if (!Array.isArray(sceneResource.openScenePaths)) {
      throw new Error("scene current resource must contain openScenePaths array.");
    }

    console.error("Reading godot://scene/tree...");
    const treeResource = await readResourceJson(client, "godot://scene/tree");
    if (typeof treeResource.sceneAvailable !== "boolean") {
      throw new Error("scene tree resource must contain sceneAvailable.");
    }

    console.error("M1 observation smoke passed.");
  } finally {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
    if (godotProcess && !godotProcess.killed) {
      godotProcess.kill();
    }
  }
}

async function waitForProjectInfo(client: Client, timeoutMs: number): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  let lastReason = "Addon session did not become ready.";

  while (Date.now() < deadline) {
    const payload = await callToolJson(client, "get_project_info", undefined, false);
    if (payload.available !== false) {
      return payload;
    }

    lastReason = typeof payload.reason === "string" ? payload.reason : lastReason;
    await delay(1000);
  }

  throw new Error(lastReason);
}

async function callToolJson(
  client: Client,
  name: string,
  args?: Record<string, unknown>,
  throwOnToolError = true
): Promise<Record<string, unknown>> {
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

  if (result.isError && throwOnToolError) {
    throw new Error(`${name} returned an MCP tool error: ${JSON.stringify(payload)}`);
  }

  return payload;
}

async function readResourceJson(client: Client, uri: string): Promise<Record<string, unknown>> {
  const result = await client.readResource({ uri });
  const textResource = result.contents.find((content) => "text" in content && typeof content.text === "string");
  if (!textResource || !("text" in textResource)) {
    throw new Error(`Resource ${uri} did not return JSON text.`);
  }

  const parsed = JSON.parse(textResource.text) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`Resource ${uri} returned a non-object JSON payload.`);
  }

  return parsed;
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

function assertContains(values: string[], expected: string, label: string): void {
  if (!values.includes(expected)) {
    throw new Error(`${label} does not contain ${expected}.`);
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
