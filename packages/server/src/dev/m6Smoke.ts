import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resumeProjectScanConflicts, suspendProjectScanConflicts } from "./projectScanQuarantine.ts";
import { SERVER_VERSION } from "../version.ts";

const SMOKE_RELATIVE_DIR = "codex-smoke/danger";

async function main(): Promise<void> {
  const packageRoot = path.resolve(import.meta.dirname, "..", "..");
  const repoRoot = path.resolve(packageRoot, "..", "..");
  const godotBinaryPath = process.env.GODOT_LOOP_MCP_GODOT_BIN ?? process.argv[2];
  if (!godotBinaryPath) {
    throw new Error("Set GODOT_LOOP_MCP_GODOT_BIN or pass the Godot binary path as argv[2].");
  }

  const smokeDir = path.join(repoRoot, SMOKE_RELATIVE_DIR);
  fs.rmSync(smokeDir, { recursive: true, force: true });

  const logDir = path.join(repoRoot, ".godot", "mcp");
  const transport = new StdioClientTransport({
    command: "node",
    args: ["--experimental-strip-types", "src/index.ts"],
    cwd: packageRoot,
    env: {
      ...process.env,
      GODOT_LOOP_MCP_LOG_DIR: logDir,
      GODOT_LOOP_MCP_SECURITY_LEVEL: "Dangerous"
    },
    stderr: "inherit"
  });
  const client = new Client({
    name: "godot-loop-mcp-m6-smoke",
    version: SERVER_VERSION
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
          GODOT_LOOP_MCP_SECURITY_LEVEL: "Dangerous",
          GODOT_LOOP_MCP_ENABLE_EDITOR_SCRIPT: "true",
          GODOT_LOOP_MCP_ALLOWED_WRITE_PREFIXES: `res://${SMOKE_RELATIVE_DIR.replace(/\\/gu, "/")}`,
          GODOT_LOOP_MCP_ALLOWED_SHELL_COMMANDS: "node"
        }
      }
    );

    await waitForProjectInfo(client, 45_000);
    const tools = await client.listTools();
    const toolNames = tools.tools.map((tool) => tool.name);
    assertContains(toolNames, "execute_editor_script", "tool list");
    assertContains(toolNames, "filesystem_write_raw", "tool list");
    assertContains(toolNames, "os_shell", "tool list");

    const writePath = `res://${SMOKE_RELATIVE_DIR.replace(/\\/gu, "/")}/danger.txt`;
    const writeResult = await callToolJson(client, "filesystem_write_raw", {
      path: writePath,
      content: "danger-ok"
    });
    if (writeResult.payload.path !== writePath) {
      throw new Error(`filesystem_write_raw returned unexpected payload: ${JSON.stringify(writeResult.payload)}`);
    }
    const absoluteWritePath = path.join(repoRoot, SMOKE_RELATIVE_DIR, "danger.txt");
    if (fs.readFileSync(absoluteWritePath, "utf8") !== "danger-ok") {
      throw new Error("filesystem_write_raw did not write the expected content.");
    }

    const shellResult = await callToolJson(client, "os_shell", {
      executable: "node",
      args: ["-e", "console.log('danger-shell-ok')"]
    });
    if (typeof shellResult.payload.output !== "string" || !shellResult.payload.output.includes("danger-shell-ok")) {
      throw new Error(`os_shell output is unexpected: ${JSON.stringify(shellResult.payload)}`);
    }

    const scriptResult = await callToolJson(client, "execute_editor_script", {
      source: [
        "var scene_root = editor_interface.get_edited_scene_root()",
        "return {",
        "\t\"hasScene\": scene_root != null,",
        "\t\"projectName\": ProjectSettings.get_setting(\"application/config/name\", \"\")",
        "}"
      ].join("\n")
    });
    if (!isRecord(scriptResult.payload.result) || scriptResult.payload.result.projectName !== "godot-loop-mcp") {
      throw new Error(`execute_editor_script returned unexpected payload: ${JSON.stringify(scriptResult.payload)}`);
    }

    await delay(500);
    const auditLog = fs.readFileSync(path.join(logDir, "audit.log"), "utf8");
    if (!auditLog.includes("\"name\":\"filesystem_write_raw\"") || !auditLog.includes("\"name\":\"os_shell\"")) {
      throw new Error(`audit log is missing dangerous entries: ${auditLog}`);
    }

    console.error("M6 dangerous-mode smoke passed.");
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

async function waitForProjectInfo(client: Client, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tools = await client.listTools();
    if (!tools.tools.some((tool) => tool.name === "get_project_info")) {
      await delay(500);
      continue;
    }

    const result = await callToolJson(client, "get_project_info", undefined, { allowToolError: true });
    if (!result.isError) {
      return;
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

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

await main();
