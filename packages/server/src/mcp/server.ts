import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { SERVER_VERSION } from "../capabilities/serverManifest.ts";
import type { ServerConfig } from "../config.ts";
import type { Logger } from "../logger.ts";
import { readErrorLogs, readOutputLogs, type OutputLogPayload } from "../observation/logs.ts";
import type { AddonSession } from "../transport/addonSession.ts";

interface CreateMcpBridgeServerInput {
  config: ServerConfig;
  logger: Logger;
  getActiveSession: () => AddonSession | undefined;
}

export interface McpBridgeServerRuntime {
  connectStdio(): Promise<void>;
  close(): Promise<void>;
}

type JsonObject = Record<string, unknown>;
type LogKind = "output" | "errors";
type AddonPayloadResult =
  | {
      ok: true;
      payload: JsonObject;
    }
  | {
      ok: false;
      error: JsonObject;
    };

const EDITOR_CONSOLE_CAPTURE_CAPABILITY = "editor.console.capture";
const ADDON_OUTPUT_LOG_METHOD = "godot.logs.get_output";
const ADDON_ERROR_LOG_METHOD = "godot.logs.get_errors";
const ADDON_CLEAR_LOGS_METHOD = "godot.logs.clear";

export function createMcpBridgeServer({
  config,
  logger,
  getActiveSession
}: CreateMcpBridgeServerInput): McpBridgeServerRuntime {
  const server = new McpServer(
    {
      name: "godot-loop-mcp",
      version: SERVER_VERSION
    },
    {
      capabilities: {
        logging: {}
      }
    }
  );

  registerTools(server, config, logger, getActiveSession);
  registerResources(server, config, logger, getActiveSession);

  return {
    async connectStdio(): Promise<void> {
      const transport = new StdioServerTransport();
      await server.connect(transport);
      logger.info("MCP stdio transport connected.");
    },
    async close(): Promise<void> {
      await server.close();
    }
  };
}

function registerTools(
  server: McpServer,
  config: ServerConfig,
  logger: Logger,
  getActiveSession: () => AddonSession | undefined
): void {
  server.registerTool(
    "get_project_info",
    {
      description: "Return the active Godot project's metadata."
    },
    async () => callAddonTool(getActiveSession, logger, "godot.project.get_info")
  );

  server.registerTool(
    "get_editor_state",
    {
      description: "Return the current editor state, selection, and active scene/script."
    },
    async () => callAddonTool(getActiveSession, logger, "godot.editor.get_state")
  );

  server.registerTool(
    "get_scene_tree",
    {
      description: "Return the current edited scene tree.",
      inputSchema: {
        maxDepth: z.number().int().min(-1).max(32).optional()
      }
    },
    async ({ maxDepth }) =>
      callAddonTool(getActiveSession, logger, "godot.scene.get_tree", compactParams({ maxDepth }))
  );

  server.registerTool(
    "find_nodes",
    {
      description: "Find nodes in the current edited scene by name.",
      inputSchema: {
        query: z.string().min(1),
        searchMode: z.enum(["contains", "exact", "prefix"]).optional(),
        maxResults: z.number().int().min(1).max(200).optional()
      }
    },
    async ({ query, searchMode, maxResults }) =>
      callAddonTool(
        getActiveSession,
        logger,
        "godot.scene.find_nodes",
        compactParams({ query, searchMode, maxResults })
      )
  );

  server.registerTool(
    "get_open_scripts",
    {
      description: "List the scripts currently open in the Godot editor."
    },
    async () => callAddonTool(getActiveSession, logger, "godot.script.get_open_scripts")
  );

  server.registerTool(
    "view_script",
    {
      description: "Read the current script or a script by path.",
      inputSchema: {
        path: z.string().min(1).optional()
      }
    },
    async ({ path }) =>
      callAddonTool(getActiveSession, logger, "godot.script.view", compactParams({ path }))
  );

  server.registerTool(
    "create_scene",
    {
      description: "Create and open a new scene inside the workspace.",
      inputSchema: {
        path: z.string().min(1),
        rootType: z.string().min(1).optional(),
        rootName: z.string().min(1).optional()
      }
    },
    async ({ path, rootType, rootName }) =>
      callAddonTool(
        getActiveSession,
        logger,
        "godot.scene.create",
        compactParams({ path, rootType, rootName })
      )
  );

  server.registerTool(
    "open_scene",
    {
      description: "Open an existing scene by path.",
      inputSchema: {
        path: z.string().min(1)
      }
    },
    async ({ path }) => callAddonTool(getActiveSession, logger, "godot.scene.open", { path })
  );

  server.registerTool(
    "save_scene",
    {
      description: "Save the current edited scene.",
      inputSchema: {
        path: z.string().min(1).optional()
      }
    },
    async ({ path }) =>
      callAddonTool(getActiveSession, logger, "godot.scene.save", compactParams({ path }))
  );

  server.registerTool(
    "play_scene",
    {
      description: "Play the current edited scene or a specific saved scene.",
      inputSchema: {
        path: z.string().min(1).optional()
      }
    },
    async ({ path }) =>
      callAddonTool(getActiveSession, logger, "godot.scene.play", compactParams({ path }))
  );

  server.registerTool(
    "stop_scene",
    {
      description: "Stop the currently playing scene."
    },
    async () => callAddonTool(getActiveSession, logger, "godot.scene.stop")
  );

  server.registerTool(
    "add_node",
    {
      description: "Add a node to the current edited scene.",
      inputSchema: {
        parentPath: z.string().min(1).optional(),
        nodeType: z.string().min(1),
        nodeName: z.string().min(1).optional(),
        index: z.number().int().min(0).optional()
      }
    },
    async ({ parentPath, nodeType, nodeName, index }) =>
      callAddonTool(
        getActiveSession,
        logger,
        "godot.scene.add_node",
        compactParams({ parentPath, nodeType, nodeName, index })
      )
  );

  server.registerTool(
    "move_node",
    {
      description: "Move a node to a new parent or sibling index.",
      inputSchema: {
        nodePath: z.string().min(1),
        newParentPath: z.string().min(1).optional(),
        index: z.number().int().min(0).optional(),
        keepGlobalTransform: z.boolean().optional()
      }
    },
    async ({ nodePath, newParentPath, index, keepGlobalTransform }) =>
      callAddonTool(
        getActiveSession,
        logger,
        "godot.scene.move_node",
        compactParams({ nodePath, newParentPath, index, keepGlobalTransform })
      )
  );

  server.registerTool(
    "delete_node",
    {
      description: "Delete a node from the current edited scene.",
      inputSchema: {
        nodePath: z.string().min(1)
      }
    },
    async ({ nodePath }) =>
      callAddonTool(getActiveSession, logger, "godot.scene.delete_node", { nodePath })
  );

  server.registerTool(
    "update_property",
    {
      description: "Update a node property in the current edited scene.",
      inputSchema: {
        nodePath: z.string().min(1),
        propertyPath: z.string().min(1),
        value: z.unknown()
      }
    },
    async ({ nodePath, propertyPath, value }) =>
      callAddonTool(getActiveSession, logger, "godot.scene.update_property", {
        nodePath,
        propertyPath,
        value
      })
  );

  server.registerTool(
    "create_script",
    {
      description: "Create a new GDScript file in the workspace.",
      inputSchema: {
        path: z.string().min(1),
        baseType: z.string().min(1).optional(),
        className: z.string().min(1).optional(),
        source: z.string().min(1).optional(),
        readyMessage: z.string().min(1).optional(),
        openInEditor: z.boolean().optional()
      }
    },
    async ({ path, baseType, className, source, readyMessage, openInEditor }) =>
      callAddonTool(
        getActiveSession,
        logger,
        "godot.script.create",
        compactParams({ path, baseType, className, source, readyMessage, openInEditor })
      )
  );

  server.registerTool(
    "attach_script",
    {
      description: "Attach a script to a node in the current edited scene.",
      inputSchema: {
        nodePath: z.string().min(1),
        scriptPath: z.string().min(1),
        openInEditor: z.boolean().optional()
      }
    },
    async ({ nodePath, scriptPath, openInEditor }) =>
      callAddonTool(
        getActiveSession,
        logger,
        "godot.script.attach",
        compactParams({ nodePath, scriptPath, openInEditor })
      )
  );

  server.registerTool(
    "clear_output_logs",
    {
      description: "Clear addon console buffers and bridge log files."
    },
    async () => {
      const payload = await clearObservedLogs(config, logger, getActiveSession);
      return payload.isError ? formatToolError(payload.payload) : formatToolResult(payload.payload);
    }
  );

  server.registerTool(
    "get_output_logs",
    {
      description: "Read the latest editor console logs when available, otherwise fall back to .godot/mcp.",
      inputSchema: {
        limit: z.number().int().min(1).max(500).optional()
      }
    },
    async ({ limit }) =>
      formatToolResult(
        (await readObservedLogs(
          "output",
          config,
          logger,
          getActiveSession,
          limit ?? 100
        )) as unknown as JsonObject
      )
  );

  server.registerTool(
    "get_godot_errors",
    {
      description:
        "Read the latest editor console errors when available, otherwise fall back to .godot/mcp.",
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional()
      }
    },
    async ({ limit }) =>
      formatToolResult(
        (await readObservedLogs(
          "errors",
          config,
          logger,
          getActiveSession,
          limit ?? 100
        )) as unknown as JsonObject
      )
  );
}

function registerResources(
  server: McpServer,
  config: ServerConfig,
  logger: Logger,
  getActiveSession: () => AddonSession | undefined
): void {
  server.registerResource(
    "project-info",
    "godot://project/info",
    {
      description: "Project metadata for the active Godot workspace.",
      mimeType: "application/json"
    },
    async () => readAddonResource("godot://project/info", getActiveSession, logger, "godot.project.get_info")
  );

  server.registerResource(
    "scene-current",
    "godot://scene/current",
    {
      description: "Summary of the current edited scene.",
      mimeType: "application/json"
    },
    async () => {
      const payload = await readAddonPayload(getActiveSession, logger, "godot.editor.get_state");
      if (!payload.ok) {
        return formatResourceResult("godot://scene/current", payload.error);
      }

      const state = payload.payload;
      return formatResourceResult("godot://scene/current", {
        available: true,
        currentScenePath: state.currentScenePath ?? "",
        currentSceneRootName: state.currentSceneRootName ?? "",
        openScenePaths: state.openScenePaths ?? [],
        playingScenePath: state.playingScenePath ?? "",
        isPlayingScene: state.isPlayingScene ?? false
      });
    }
  );

  server.registerResource(
    "scene-tree",
    "godot://scene/tree",
    {
      description: "Serialized tree for the current edited scene.",
      mimeType: "application/json"
    },
    async () => readAddonResource("godot://scene/tree", getActiveSession, logger, "godot.scene.get_tree")
  );

  server.registerResource(
    "scripts-open",
    "godot://scripts/open",
    {
      description: "List of scripts currently open in the editor.",
      mimeType: "application/json"
    },
    async () =>
      readAddonResource("godot://scripts/open", getActiveSession, logger, "godot.script.get_open_scripts")
  );

  server.registerResource(
    "script-current",
    "godot://script/current",
    {
      description: "Source for the currently active script.",
      mimeType: "application/json"
    },
    async () => readAddonResource("godot://script/current", getActiveSession, logger, "godot.script.view")
  );

  server.registerResource(
    "errors-latest",
    "godot://errors/latest",
    {
      description: "Latest error-level editor console logs with bridge-log fallback.",
      mimeType: "application/json"
    },
    async () =>
      formatResourceResult(
        "godot://errors/latest",
        (await readObservedLogs(
          "errors",
          config,
          logger,
          getActiveSession,
          100
        )) as unknown as JsonObject
      )
  );
}

async function readObservedLogs(
  kind: LogKind,
  config: ServerConfig,
  logger: Logger,
  getActiveSession: () => AddonSession | undefined,
  limit: number
): Promise<OutputLogPayload> {
  const session = getActiveSession();
  const captureAvailable = session?.hasCapability(EDITOR_CONSOLE_CAPTURE_CAPABILITY) ?? false;

  if (!session) {
    return readLogFallback(kind, config.logDir, limit, {
      captureAvailable,
      fallbackReason: "No ready addon session."
    });
  }

  const result = await readAddonPayload(
    getActiveSession,
    logger,
    kind === "output" ? ADDON_OUTPUT_LOG_METHOD : ADDON_ERROR_LOG_METHOD,
    { limit }
  );
  if (!result.ok) {
    return readLogFallback(kind, config.logDir, limit, {
      captureAvailable,
      fallbackReason: typeof result.error.reason === "string" ? result.error.reason : "Addon log request failed."
    });
  }

  if (!Array.isArray(result.payload.entries)) {
    return readLogFallback(kind, config.logDir, limit, {
      captureAvailable,
      fallbackReason: "Addon log payload was malformed."
    });
  }

  return normalizeAddonLogPayload(result.payload);
}

async function clearObservedLogs(
  config: ServerConfig,
  logger: Logger,
  getActiveSession: () => AddonSession | undefined
): Promise<{ isError: boolean; payload: JsonObject }> {
  const result = await readAddonPayload(getActiveSession, logger, ADDON_CLEAR_LOGS_METHOD);
  if (!result.ok) {
    return {
      isError: true,
      payload: result.error
    };
  }

  return {
    isError: false,
    payload: {
      ...result.payload,
      ...clearLocalLogFiles(config.logDir)
    }
  };
}

async function callAddonTool(
  getActiveSession: () => AddonSession | undefined,
  logger: Logger,
  method: string,
  params: JsonObject = {}
): Promise<ReturnType<typeof formatToolResult>> {
  const result = await readAddonPayload(getActiveSession, logger, method, params);
  if (!result.ok) {
    return formatToolError(result.error);
  }

  return formatToolResult(result.payload);
}

async function readAddonResource(
  uri: string,
  getActiveSession: () => AddonSession | undefined,
  logger: Logger,
  method: string,
  params: JsonObject = {}
): Promise<ReturnType<typeof formatResourceResult>> {
  const result = await readAddonPayload(getActiveSession, logger, method, params);
  return formatResourceResult(uri, result.ok ? result.payload : result.error);
}

async function readAddonPayload(
  getActiveSession: () => AddonSession | undefined,
  logger: Logger,
  method: string,
  params: JsonObject = {}
): Promise<AddonPayloadResult> {
  const session = getActiveSession();
  if (!session) {
    return {
      ok: false,
      error: unavailablePayload("No ready addon session.")
    };
  }

  try {
    const result = await session.request<JsonObject>(method, params);
    return {
      ok: true,
      payload: isJsonObject(result) ? result : { value: result }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn("Addon observation request failed.", {
      sessionId: session.getSessionId(),
      method,
      error: message
    });

    return {
      ok: false,
      error: addonRequestErrorPayload(method, message)
    };
  }
}

function formatToolResult(payload: JsonObject): {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: JsonObject;
} {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2)
      }
    ],
    structuredContent: payload
  };
}

function formatToolError(payload: JsonObject): {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: JsonObject;
  isError: true;
} {
  return {
    ...formatToolResult(payload),
    isError: true
  };
}

function formatResourceResult(uri: string, payload: JsonObject): {
  contents: Array<{ uri: string; mimeType: "application/json"; text: string }>;
} {
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(payload, null, 2)
      }
    ]
  };
}

function unavailablePayload(reason: string): JsonObject {
  return {
    available: false,
    reason
  };
}

function addonRequestErrorPayload(method: string, message: string): JsonObject {
  return {
    available: false,
    source: "addon",
    method,
    reason: message
  };
}

function readLogFallback(
  kind: LogKind,
  logDir: string,
  limit: number,
  options: {
    captureAvailable: boolean;
    fallbackReason: string;
  }
): OutputLogPayload {
  return kind === "output"
    ? readOutputLogs(logDir, limit, {
        captureAvailable: options.captureAvailable,
        fallbackReason: options.fallbackReason,
        note: "Fell back to addon/server/runtime logs from .godot/mcp."
      })
    : readErrorLogs(logDir, limit, {
        captureAvailable: options.captureAvailable,
        fallbackReason: options.fallbackReason,
        note: "Fell back to error-level addon/server/runtime logs from .godot/mcp."
      });
}

function normalizeAddonLogPayload(payload: JsonObject): OutputLogPayload {
  const backend =
    payload.backend === "runtime-log-file" || payload.backend === "editor-console-buffer"
      ? payload.backend
      : "editor-console-buffer";
  return {
    note:
      typeof payload.note === "string"
        ? payload.note
        : backend === "runtime-log-file"
          ? "Reads runtime log entries from the addon-managed headless play log file."
          : "Reads editor console entries from the addon ring buffer.",
    backend,
    captureAvailable: payload.captureAvailable !== false,
    captureUsed:
      typeof payload.captureUsed === "boolean"
        ? payload.captureUsed
        : backend === "editor-console-buffer",
    fallbackReason:
      typeof payload.fallbackReason === "string" ? payload.fallbackReason : undefined,
    entries: payload.entries as OutputLogPayload["entries"]
  };
}

function clearLocalLogFiles(logDir: string): JsonObject {
  const clearedFiles: string[] = [];
  const failedFiles: Array<{ path: string; error: string }> = [];

  for (const fileName of ["server.log", "addon.log", "runtime.log"]) {
    const filePath = path.join(logDir, fileName);
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, "", "utf8");
      clearedFiles.push(filePath);
    } catch (error) {
      failedFiles.push({
        path: filePath,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return {
    clearedLogFiles: clearedFiles,
    failedLogFiles: failedFiles
  };
}

function compactParams(input: JsonObject): JsonObject {
  const output: JsonObject = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      output[key] = value;
    }
  }
  return output;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
