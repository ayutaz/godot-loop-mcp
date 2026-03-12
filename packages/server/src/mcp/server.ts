import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { SERVER_VERSION } from "../capabilities/serverManifest.ts";
import type { ServerConfig } from "../config.ts";
import type { Logger } from "../logger.ts";
import { readErrorLogs, readOutputLogs } from "../observation/logs.ts";
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
    "get_output_logs",
    {
      description: "Read the latest bridge/addon log lines from .godot/mcp.",
      inputSchema: {
        limit: z.number().int().min(1).max(500).optional()
      }
    },
    async ({ limit }) =>
      formatToolResult(readOutputLogs(config.logDir, limit ?? 100) as unknown as JsonObject)
  );

  server.registerTool(
    "get_godot_errors",
    {
      description: "Read the latest error-level bridge/addon log lines from .godot/mcp.",
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional()
      }
    },
    async ({ limit }) =>
      formatToolResult(readErrorLogs(config.logDir, limit ?? 100) as unknown as JsonObject)
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
      const state = payload ?? unavailablePayload("No ready addon session.");
      return formatResourceResult("godot://scene/current", {
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
      description: "Latest error-level bridge/addon logs.",
      mimeType: "application/json"
    },
    async () =>
      formatResourceResult(
        "godot://errors/latest",
        readErrorLogs(config.logDir, 100) as unknown as JsonObject
      )
  );
}

async function callAddonTool(
  getActiveSession: () => AddonSession | undefined,
  logger: Logger,
  method: string,
  params: JsonObject = {}
): Promise<ReturnType<typeof formatToolResult>> {
  const payload = await readAddonPayload(getActiveSession, logger, method, params);
  if (!payload) {
    return formatToolError(unavailablePayload("No ready addon session."));
  }

  return formatToolResult(payload);
}

async function readAddonResource(
  uri: string,
  getActiveSession: () => AddonSession | undefined,
  logger: Logger,
  method: string,
  params: JsonObject = {}
): Promise<ReturnType<typeof formatResourceResult>> {
  const payload = await readAddonPayload(getActiveSession, logger, method, params);
  return formatResourceResult(uri, payload ?? unavailablePayload("No ready addon session."));
}

async function readAddonPayload(
  getActiveSession: () => AddonSession | undefined,
  logger: Logger,
  method: string,
  params: JsonObject = {}
): Promise<JsonObject | undefined> {
  const session = getActiveSession();
  if (!session) {
    return undefined;
  }

  try {
    const result = await session.request<JsonObject>(method, params);
    return isJsonObject(result) ? result : { value: result };
  } catch (error) {
    logger.warn("Addon observation request failed.", {
      sessionId: session.getSessionId(),
      method,
      error: error instanceof Error ? error.message : String(error)
    });
    return {
      available: false,
      reason: error instanceof Error ? error.message : String(error),
      method
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
