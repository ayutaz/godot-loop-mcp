import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resumeProjectScanConflicts, suspendProjectScanConflicts } from "./projectScanQuarantine.ts";
import { patchProjectFile, resolveBridgePort } from "./smokeUtils.ts";

const SMOKE_RELATIVE_DIR = "codex-smoke/m4";
const DEFAULT_BRIDGE_PORT = 6010;

async function main(): Promise<void> {
  const packageRoot = path.resolve(import.meta.dirname, "..", "..");
  const repoRoot = path.resolve(packageRoot, "..", "..");
  const godotBinaryPath = process.env.GODOT_LOOP_MCP_GODOT_BIN ?? process.argv[2];
  if (!godotBinaryPath) {
    throw new Error("Set GODOT_LOOP_MCP_GODOT_BIN or pass the Godot binary path as argv[2].");
  }

  const smokeDir = path.join(repoRoot, SMOKE_RELATIVE_DIR);
  fs.rmSync(smokeDir, { recursive: true, force: true });

  const scenePath = `res://${SMOKE_RELATIVE_DIR.replace(/\\/gu, "/")}/m4_smoke_scene.tscn`;
  const scriptPath = `res://${SMOKE_RELATIVE_DIR.replace(/\\/gu, "/")}/m4_smoke_agent.gd`;
  const logDir = path.join(repoRoot, ".godot", "mcp");
  const mockRunnerPath = path.join(repoRoot, "packages", "server", "src", "dev", "mockTestRunner.mjs");
  const projectFilePath = path.join(repoRoot, "project.godot");
  const originalProjectFile = fs.readFileSync(projectFilePath, "utf8");
  const bridgePort = await resolveBridgePort(DEFAULT_BRIDGE_PORT, "the M4 smoke");
  fs.writeFileSync(projectFilePath, patchProjectFile(originalProjectFile, [
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
    name: "godot-loop-mcp-m4-smoke",
    version: "0.3.0"
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
        stdio: ["ignore", "inherit", "inherit"],
        env: {
          ...process.env,
          GODOT_LOOP_MCP_TEST_COMMAND: "node",
          GODOT_LOOP_MCP_TEST_ARGS: JSON.stringify([mockRunnerPath])
        }
      }
    );

    await waitForProjectInfo(client, 45_000);
    const tools = await client.listTools();
    const toolNames = tools.tools.map((tool) => tool.name);
    assertContains(toolNames, "run_tests", "tool list");
    assertNotContains(toolNames, "execute_editor_script", "tool list");
    assertNotContains(toolNames, "filesystem_write_raw", "tool list");
    assertNotContains(toolNames, "os_shell", "tool list");
    assertContains(toolNames, "get_editor_screenshot", "tool list");
    assertContains(toolNames, "get_running_scene_screenshot", "tool list");
    assertContains(toolNames, "get_runtime_debug_events", "tool list");

    const headlessScreenshot = await callToolJson(client, "get_editor_screenshot", undefined, { allowToolError: true });
    if (!headlessScreenshot.isError || headlessScreenshot.payload.available !== false) {
      throw new Error(`get_editor_screenshot must stay visible but reject headless sessions: ${JSON.stringify(headlessScreenshot.payload)}`);
    }

    const headlessRuntimeEvents = await callToolJson(
      client,
      "get_runtime_debug_events",
      { limit: 5 },
      { allowToolError: true }
    );
    if (!headlessRuntimeEvents.isError || headlessRuntimeEvents.payload.available !== false) {
      throw new Error(`get_runtime_debug_events must stay visible but reject unavailable runtime capture: ${JSON.stringify(headlessRuntimeEvents.payload)}`);
    }

    const prompts = await client.listPrompts();
    const promptNames = prompts.prompts.map((prompt) => prompt.name);
    assertContains(promptNames, "godot_editor_strategy", "prompt list");
    assertContains(promptNames, "godot_ui_layout_strategy", "prompt list");
    assertContains(promptNames, "godot_debug_loop", "prompt list");
    assertContains(promptNames, "godot_scene_edit_safety", "prompt list");

    const templates = await client.listResourceTemplates();
    const templateUris = templates.resourceTemplates.map((template) => template.uriTemplate);
    assertContains(templateUris, "godot://scene/{path}", "resource template list");
    assertContains(templateUris, "godot://script/{path}", "resource template list");
    assertContains(templateUris, "godot://node/{scenePath}/{nodePath}", "resource template list");
    assertContains(templateUris, "godot://resource/{uid}", "resource template list");

    await callToolJson(client, "create_scene", {
      path: scenePath,
      rootType: "Node2D",
      rootName: "M4SmokeRoot"
    });
    await callToolJson(client, "create_script", {
      path: scriptPath,
      baseType: "Node2D",
      readyMessage: "m4 smoke"
    });
    await callToolJson(client, "save_scene", { path: scenePath });

    const scriptResource = await readResourceJson(client, `godot://script/${encodeURIComponent(scriptPath)}`);
    if (scriptResource.path !== scriptPath || typeof scriptResource.source !== "string") {
      throw new Error(`script template returned unexpected payload: ${JSON.stringify(scriptResource)}`);
    }

    const sceneResource = await readResourceJson(client, `godot://scene/${encodeURIComponent(scenePath)}`);
    if (sceneResource.path !== scenePath || typeof sceneResource.source !== "string") {
      throw new Error(`scene template returned unexpected payload: ${JSON.stringify(sceneResource)}`);
    }

    const uidResult = await callToolJson(client, "get_uid", { path: scenePath });
    const uidValue = assertString(uidResult.payload.uid, "uid");
    const resolvedResource = await readResourceJson(client, `godot://resource/${encodeURIComponent(uidValue)}`);
    if (resolvedResource.resolvedPath !== scenePath) {
      throw new Error(`resource template did not resolve ${scenePath}: ${JSON.stringify(resolvedResource)}`);
    }

    const nodeResource = await readResourceJson(
      client,
      `godot://node/${encodeURIComponent(scenePath)}/${encodeURIComponent("/M4SmokeRoot")}`
    );
    if (!isRecord(nodeResource.node)) {
      throw new Error(`node template did not return a node payload: ${JSON.stringify(nodeResource)}`);
    }

    const testResult = await callToolJson(client, "run_tests");
    if (testResult.payload.success !== true) {
      throw new Error(`run_tests did not succeed: ${JSON.stringify(testResult.payload)}`);
    }
    const summary = testResult.payload.summary;
    if (!isRecord(summary) || summary.total !== 3 || summary.failed !== 0) {
      throw new Error(`run_tests summary is unexpected: ${JSON.stringify(testResult.payload)}`);
    }

    await delay(500);
    const auditLogPath = path.join(logDir, "audit.log");
    const auditLog = fs.readFileSync(auditLogPath, "utf8");
    if (!auditLog.includes("\"name\":\"run_tests\"") || !auditLog.includes("\"name\":\"script-by-path\"")) {
      throw new Error(`audit log is missing expected entries: ${auditLog}`);
    }

    console.error("M4 prompts/templates/tests smoke passed.");
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

async function waitForProjectInfo(client: Client, timeoutMs: number): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
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

    await delay(1000);
  }

  throw new Error("Addon session did not become ready.");
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
    : parseToolPayload(content);
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

function parseToolPayload(content: Array<{ type: string; text?: string }>): Record<string, unknown> {
  const textBlock = content.find((item) => item.type === "text" && typeof item.text === "string");
  if (!textBlock?.text) {
    throw new Error("Tool result did not contain a text payload.");
  }

  const parsed = JSON.parse(textBlock.text) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`Tool result was not a JSON object: ${textBlock.text}`);
  }
  return parsed;
}

function assertContains(values: string[], expected: string, label: string): void {
  if (!values.includes(expected)) {
    throw new Error(`${label} is missing ${expected}. actual=${JSON.stringify(values)}`);
  }
}

function assertNotContains(values: string[], expected: string, label: string): void {
  if (values.includes(expected)) {
    throw new Error(`${label} should not include ${expected}. actual=${JSON.stringify(values)}`);
  }
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string. actual=${JSON.stringify(value)}`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

await main();
