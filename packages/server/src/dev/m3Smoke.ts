import fs from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resumeProjectScanConflicts, suspendProjectScanConflicts } from "./projectScanQuarantine.ts";

const SMOKE_RELATIVE_DIR = "codex-smoke/m3";

async function main(): Promise<void> {
  const packageRoot = path.resolve(import.meta.dirname, "..", "..");
  const repoRoot = path.resolve(packageRoot, "..", "..");
  const godotBinaryPath = process.env.GODOT_LOOP_MCP_GODOT_BIN ?? process.argv[2];

  if (!godotBinaryPath) {
    throw new Error("Set GODOT_LOOP_MCP_GODOT_BIN or pass the Godot binary path as argv[2].");
  }

  const smokeDir = path.join(repoRoot, SMOKE_RELATIVE_DIR);
  fs.rmSync(smokeDir, { recursive: true, force: true });

  const scenePath = `res://${SMOKE_RELATIVE_DIR.replace(/\\/gu, "/")}/m3_smoke_scene.tscn`;
  const scriptPath = `res://${SMOKE_RELATIVE_DIR.replace(/\\/gu, "/")}/m3_smoke_agent.gd`;
  const uniqueToken = `m3-search-token-${Date.now()}`;
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
    name: "godot-loop-mcp-m3-smoke",
    version: "0.1.2"
  });

  let godotProcess: ChildProcess | undefined;
  const scanQuarantineState = await suspendProjectScanConflicts(repoRoot);
  try {
    await client.connect(transport);

    console.error("Checking pre-session dynamic catalog...");
    const initialTools = await client.listTools();
    assertContains(initialTools.tools.map((tool) => tool.name), "get_output_logs", "initial tool list");
    assertNotContains(initialTools.tools.map((tool) => tool.name), "get_project_info", "initial tool list");
    assertNotContains(initialTools.tools.map((tool) => tool.name), "search_project", "initial tool list");

    const initialResources = await client.listResources();
    assertContains(initialResources.resources.map((resource) => resource.uri), "godot://errors/latest", "initial resource list");
    assertNotContains(initialResources.resources.map((resource) => resource.uri), "godot://project/info", "initial resource list");

    godotProcess = spawn(
      godotBinaryPath,
      ["--headless", "--editor", "--path", repoRoot],
      {
        cwd: repoRoot,
        stdio: ["ignore", "inherit", "inherit"]
      }
    );

    const projectInfo = await waitForProjectInfo(client, 45_000);
    assertString(projectInfo.projectName, "projectName");
    assertString(projectInfo.godotVersion, "godotVersion");

    console.error("Checking post-session dynamic catalog...");
    await waitForToolVisibility(client, "search_project", true, 15_000);
    const readyTools = await client.listTools();
    assertContains(readyTools.tools.map((tool) => tool.name), "search_project", "ready tool list");
    assertContains(readyTools.tools.map((tool) => tool.name), "get_uid", "ready tool list");
    assertContains(readyTools.tools.map((tool) => tool.name), "resolve_uid", "ready tool list");
    assertContains(readyTools.tools.map((tool) => tool.name), "resave_resources", "ready tool list");
    assertContains(readyTools.tools.map((tool) => tool.name), "get_selection", "ready tool list");
    assertContains(readyTools.tools.map((tool) => tool.name), "set_selection", "ready tool list");
    assertContains(readyTools.tools.map((tool) => tool.name), "focus_node", "ready tool list");

    const readyResources = await client.listResources();
    assertContains(readyResources.resources.map((resource) => resource.uri), "godot://project/info", "ready resource list");
    assertContains(readyResources.resources.map((resource) => resource.uri), "godot://selection/current", "ready resource list");

    console.error("Creating scene and script fixtures...");
    await callToolJson(client, "create_scene", {
      path: scenePath,
      rootType: "Node2D",
      rootName: "M3SmokeRoot"
    });
    const rootPath = await waitForCurrentScene(client, scenePath, 15_000);

    const targetNode = await callToolJson(client, "add_node", {
      parentPath: rootPath,
      nodeType: "Node2D",
      nodeName: "FocusTarget"
    });
    assertString(targetNode.payload.path, "target node path");

    const createdScript = await callToolJson(client, "create_script", {
      path: scriptPath,
      baseType: "Node2D",
      readyMessage: uniqueToken
    });
    assertString(createdScript.payload.path, "created script path");

    await callToolJson(client, "save_scene", { path: scenePath });

    console.error("Searching by path...");
    const pathSearch = await waitForSearchContainsPath(client, {
      query: "m3_smoke_scene",
      mode: "path",
      maxResults: 20
    }, scenePath, 15_000);
    assertSearchContainsPath(pathSearch.payload, scenePath, "path search");

    console.error("Searching by type...");
    const typeSearch = await waitForSearchContainsPath(client, {
      query: "scene",
      mode: "type",
      maxResults: 20
    }, scenePath, 15_000);
    assertSearchContainsPath(typeSearch.payload, scenePath, "type search");

    console.error("Searching by text...");
    const textSearch = await waitForSearchContainsPath(client, {
      query: uniqueToken,
      mode: "text",
      maxResults: 20,
      fileExtensions: ["gd"]
    }, scriptPath, 15_000);
    assertSearchContainsPath(textSearch.payload, scriptPath, "text search");

    console.error("Checking ResourceUID round-trip...");
    const uidResult = await callToolJson(client, "get_uid", { path: scenePath });
    assertString(uidResult.payload.uid, "scene uid");
    const resolvedUid = await callToolJson(client, "resolve_uid", { uid: uidResult.payload.uid });
    if (resolvedUid.payload.path !== scenePath || resolvedUid.payload.found !== true) {
      throw new Error(`resolve_uid did not return ${scenePath}. payload=${JSON.stringify(resolvedUid.payload)}`);
    }

    console.error("Re-saving resources...");
    const resave = await callToolJson(client, "resave_resources", { paths: [scenePath, scriptPath] });
    if (resave.payload.savedCount !== 2 || resave.payload.failedCount !== 0) {
      throw new Error(`resave_resources returned unexpected counts. payload=${JSON.stringify(resave.payload)}`);
    }

    console.error("Checking selection APIs...");
    const initialSelection = await callToolJson(client, "get_selection");
    if (typeof initialSelection.payload.count !== "number") {
      throw new Error("get_selection.count must be a number.");
    }

    await callToolJson(client, "set_selection", {
      scenePath,
      nodePaths: [targetNode.payload.path]
    });
    const selection = await callToolJson(client, "get_selection");
    assertContains(selection.payload.selectedNodePaths as string[], targetNode.payload.path as string, "selection payload");

    const focus = await callToolJson(client, "focus_node", {
      scenePath,
      nodePath: targetNode.payload.path
    });
    if (!isRecord(focus.payload.focusedNode) || focus.payload.focusedNode.path !== targetNode.payload.path) {
      throw new Error(`focus_node did not focus ${targetNode.payload.path}. payload=${JSON.stringify(focus.payload)}`);
    }

    console.error("Reading selection resource...");
    const selectionResource = await readResourceJson(client, "godot://selection/current");
    assertContains(selectionResource.selectedNodePaths as string[], targetNode.payload.path as string, "selection resource");

    console.error("M3 search/UID/catalog smoke passed.");
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

async function waitForToolVisibility(
  client: Client,
  toolName: string,
  expectedVisible: boolean,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tools = await client.listTools();
    const visible = tools.tools.some((tool) => tool.name === toolName);
    if (visible === expectedVisible) {
      return;
    }
    await delay(500);
  }

  throw new Error(`Tool visibility did not reach ${expectedVisible} for ${toolName}.`);
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

async function waitForSearchContainsPath(
  client: Client,
  args: Record<string, unknown>,
  expectedPath: string,
  timeoutMs: number
): Promise<{ payload: Record<string, unknown>; isError: boolean }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await callToolJson(client, "search_project", args);
    const results = Array.isArray(result.payload.results) ? result.payload.results : [];
    const found = results.some((entry) => isRecord(entry) && entry.path === expectedPath);
    if (found) {
      return result;
    }
    await delay(500);
  }

  throw new Error(`search_project did not return ${expectedPath}. args=${JSON.stringify(args)}`);
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
    : parseToolPayload(content, options.allowToolError === true);

  if (result.isError && !options.allowToolError) {
    throw new Error(`${name} returned an MCP tool error: ${JSON.stringify(payload)}`);
  }

  return {
    payload,
    isError: !!result.isError
  };
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

function parseToolPayload(
  content: Array<{ type: string; text?: string }>,
  allowPlainTextError: boolean
): Record<string, unknown> {
  const textBlock = content.find((item) => item.type === "text" && typeof item.text === "string");
  if (!textBlock?.text) {
    throw new Error("Tool result did not contain a text payload.");
  }

  try {
    const parsed = JSON.parse(textBlock.text) as unknown;
    if (!isRecord(parsed)) {
      throw new Error("Tool result text payload was not a JSON object.");
    }
    return parsed;
  } catch (error) {
    if (allowPlainTextError) {
      return {
        available: false,
        reason: textBlock.text
      };
    }

    throw new Error(
      `Tool result text payload was not JSON. payload=${textBlock.text} error=${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

function assertSearchContainsPath(
  payload: Record<string, unknown>,
  expectedPath: string,
  label: string
): void {
  const results = Array.isArray(payload.results) ? payload.results : [];
  const found = results.some((result) => isRecord(result) && result.path === expectedPath);
  if (!found) {
    throw new Error(`${label} does not contain ${expectedPath}. payload=${JSON.stringify(payload)}`);
  }
}

function assertContains(values: string[], expected: string, label: string): void {
  if (!values.includes(expected)) {
    throw new Error(`${label} does not contain ${expected}.`);
  }
}

function assertNotContains(values: string[], unexpected: string, label: string): void {
  if (values.includes(unexpected)) {
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
