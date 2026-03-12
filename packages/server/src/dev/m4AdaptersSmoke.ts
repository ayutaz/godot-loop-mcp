import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resumeProjectScanConflicts, suspendProjectScanConflicts } from "./projectScanQuarantine.ts";
import {
  callToolJson,
  waitForProjectInfo
} from "./smokeHarness.ts";

type StagedFile = {
  absolutePath: string;
  existed: boolean;
  originalContent: string;
  uidAbsolutePath: string;
  uidExisted: boolean;
  uidOriginalContent: string;
};

const ADAPTER_STUBS = [
  {
    adapter: "GdUnit4",
    relativePath: path.join("addons", "gdUnit4", "bin", "GdUnitCmdTool.gd"),
    total: 2
  },
  {
    adapter: "GUT",
    relativePath: path.join("addons", "gut", "gut_cmdln.gd"),
    total: 3
  }
] as const;

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
    name: "godot-loop-mcp-m4-adapter-smoke",
    version: "0.1.0"
  });

  let godotProcess: ChildProcess | undefined;
  const stagedFiles = ADAPTER_STUBS.map((entry) =>
    stageFile(path.join(repoRoot, entry.relativePath), buildAdapterStubSource(entry.total))
  );
  const scanQuarantineState = await suspendProjectScanConflicts(repoRoot);
  try {
    await client.connect(transport);

    const godotEnv = {
      ...process.env
    };
    delete godotEnv.GODOT_LOOP_MCP_TEST_COMMAND;
    delete godotEnv.GODOT_LOOP_MCP_TEST_ARGS;
    delete godotEnv.GODOT_LOOP_MCP_TEST_ADAPTER;

    godotProcess = spawn(
      godotBinaryPath,
      ["--headless", "--editor", "--path", repoRoot],
      {
        cwd: repoRoot,
        stdio: ["ignore", "inherit", "inherit"],
        env: godotEnv
      }
    );

    await waitForProjectInfo(client, 45_000);

    for (const entry of ADAPTER_STUBS) {
      const result = await callToolJson(client, "run_tests", {
        adapter: entry.adapter,
        testDir: "res://test"
      });
      const adapter = result.payload.adapter;
      const framework = result.payload.framework;
      if (adapter !== entry.adapter) {
        throw new Error(`run_tests adapter mismatch for ${entry.adapter}: ${JSON.stringify(result.payload)}`);
      }

      if (typeof framework !== "string" || framework.length === 0) {
        throw new Error(`run_tests framework was not set for ${entry.adapter}: ${JSON.stringify(result.payload)}`);
      }

      const summary = result.payload.summary;
      if (!summary || typeof summary !== "object") {
        throw new Error(`run_tests summary was missing for ${entry.adapter}: ${JSON.stringify(result.payload)}`);
      }

      const total = (summary as Record<string, unknown>).total;
      const failed = (summary as Record<string, unknown>).failed;
      if (total !== entry.total || failed !== 0) {
        throw new Error(`run_tests summary was unexpected for ${entry.adapter}: ${JSON.stringify(result.payload)}`);
      }
    }

    console.error("M4 adapter-detection smoke passed.");
  } finally {
    if (godotProcess && !godotProcess.killed) {
      godotProcess.kill();
    }
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
    await resumeProjectScanConflicts(scanQuarantineState).catch(() => undefined);
    for (const stagedFile of stagedFiles.reverse()) {
      restoreStagedFile(stagedFile);
    }
  }
}

function buildAdapterStubSource(total: number): string {
  return [
    "extends SceneTree",
    "",
    "func _initialize() -> void:",
    `\tprint(\"passed: ${total}\")`,
    "\tprint(\"failed: 0\")",
    "\tprint(\"skipped: 0\")",
    `\tprint(\"total: ${total}\")`,
    "\tquit(0)"
  ].join("\n");
}

function stageFile(absolutePath: string, content: string): StagedFile {
  const existed = fs.existsSync(absolutePath);
  const originalContent = existed ? fs.readFileSync(absolutePath, "utf8") : "";
  const uidAbsolutePath = `${absolutePath}.uid`;
  const uidExisted = fs.existsSync(uidAbsolutePath);
  const uidOriginalContent = uidExisted ? fs.readFileSync(uidAbsolutePath, "utf8") : "";
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content, "utf8");
  return {
    absolutePath,
    existed,
    originalContent,
    uidAbsolutePath,
    uidExisted,
    uidOriginalContent
  };
}

function restoreStagedFile(stagedFile: StagedFile): void {
  if (stagedFile.existed) {
    fs.writeFileSync(stagedFile.absolutePath, stagedFile.originalContent, "utf8");
  } else {
    fs.rmSync(stagedFile.absolutePath, { force: true });
  }

  if (stagedFile.uidExisted) {
    fs.writeFileSync(stagedFile.uidAbsolutePath, stagedFile.uidOriginalContent, "utf8");
  } else {
    fs.rmSync(stagedFile.uidAbsolutePath, { force: true });
  }
  removeEmptyParentDirectories(path.dirname(stagedFile.absolutePath));
}

function removeEmptyParentDirectories(directoryPath: string): void {
  let currentPath = directoryPath;
  while (currentPath.length > 0 && fs.existsSync(currentPath)) {
    if (fs.readdirSync(currentPath).length > 0) {
      return;
    }

    fs.rmdirSync(currentPath);
    currentPath = path.dirname(currentPath);
  }
}

await main();
