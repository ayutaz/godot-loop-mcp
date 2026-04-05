import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  McpServer,
  ResourceTemplate,
  type RegisteredPrompt,
  type RegisteredResource,
  type RegisteredResourceTemplate,
  type RegisteredTool
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { isDeepStrictEqual } from "node:util";
import * as z from "zod/v4";
import { AuditLogger, hashAuditArgs } from "../auditLogger.ts";
import { SERVER_VERSION } from "../capabilities/serverManifest.ts";
import type { ServerConfig } from "../config.ts";
import type { Logger } from "../logger.ts";
import { readErrorLogs, readOutputLogs, type OutputLogPayload } from "../observation/logs.ts";
import type { AddonSession } from "../transport/addonSession.ts";
import type { SecurityLevel } from "../transport/types.ts";
import {
  MCP_PROMPTS,
  MCP_RESOURCES,
  MCP_RESOURCE_TEMPLATES,
  MCP_TOOLS
} from "./catalog.ts";

interface CreateMcpBridgeServerInput {
  config: ServerConfig;
  logger: Logger;
  getActiveSession: () => AddonSession | undefined;
}

export interface McpBridgeServerRuntime {
  connectStdio(): Promise<void>;
  close(): Promise<void>;
  syncCatalogSession(session?: AddonSession): void;
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

interface CatalogRegistry {
  tools: Map<string, RegisteredTool>;
  resources: Map<string, RegisteredResource>;
  prompts: Map<string, RegisteredPrompt>;
  resourceTemplates: Map<string, RegisteredResourceTemplate>;
}

const EDITOR_CONSOLE_CAPTURE_CAPABILITY = "editor.console.capture";
const ADDON_OUTPUT_LOG_METHOD = "godot.logs.get_output";
const ADDON_ERROR_LOG_METHOD = "godot.logs.get_errors";
const ADDON_CLEAR_LOGS_METHOD = "godot.logs.clear";
const RUNTIME_CONDITION_PREDICATES = [
  "equals",
  "not_equals",
  "contains",
  "truthy",
  "falsy",
  "exists",
  "greater_than",
  "greater_or_equal",
  "less_than",
  "less_or_equal"
] as const;
type RuntimeConditionPredicate = (typeof RUNTIME_CONDITION_PREDICATES)[number];

const waitForRuntimeConditionArgsSchema = z.object({
  nodePath: z.string().min(1),
  propertyPath: z.string().min(1),
  predicate: z.enum(RUNTIME_CONDITION_PREDICATES).optional(),
  value: z.unknown().optional(),
  timeoutMs: z.number().int().min(100).max(120000).optional(),
  pollIntervalMs: z.number().int().min(50).max(5000).optional()
});

export function createMcpBridgeServer({
  config,
  logger,
  getActiveSession
}: CreateMcpBridgeServerInput): McpBridgeServerRuntime {
  const auditLogger = new AuditLogger(path.join(config.logDir, "audit.log"));
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

  const registry: CatalogRegistry = {
    tools: new Map(),
    resources: new Map(),
    prompts: new Map(),
    resourceTemplates: new Map()
  };

  registerTools(server, registry, config, logger, auditLogger, getActiveSession);
  registerResources(server, registry, config, logger, auditLogger, getActiveSession);
  registerPrompts(server, registry, config, auditLogger, getActiveSession);
  registerResourceTemplates(server, registry, config, logger, auditLogger, getActiveSession);
  syncCatalogExposure(registry, config.securityLevel, undefined);

  return {
    async connectStdio(): Promise<void> {
      const transport = new StdioServerTransport();
      await server.connect(transport);
      logger.info("MCP stdio transport connected.");
    },
    async close(): Promise<void> {
      await server.close();
    },
    syncCatalogSession(session?: AddonSession): void {
      syncCatalogExposure(registry, config.securityLevel, session);
    }
  };
}

function registerTools(
  server: McpServer,
  registry: CatalogRegistry,
  config: ServerConfig,
  logger: Logger,
  auditLogger: AuditLogger,
  getActiveSession: () => AddonSession | undefined
): void {
  registerBridgeTool(registry, server, config, auditLogger, getActiveSession, "get_project_info", {
    description: "Return the active Godot project's metadata."
  }, "godot.project.get_info");

  registerBridgeTool(registry, server, config, auditLogger, getActiveSession, "search_project", {
    description: "Search project resources by path, type, or text.",
    inputSchema: {
      query: z.string().min(1),
      mode: z.enum(["path", "type", "text"]).optional(),
      maxResults: z.number().int().min(1).max(200).optional(),
      pathPrefix: z.string().min(1).optional(),
      fileExtensions: z.array(z.string().min(1)).max(32).optional()
    }
  }, "godot.project.search");

  registerBridgeTool(registry, server, config, auditLogger, getActiveSession, "get_uid", {
    description: "Return the ResourceUID assigned to a project resource path.",
    inputSchema: {
      path: z.string().min(1)
    }
  }, "godot.resource.get_uid");

  registerBridgeTool(registry, server, config, auditLogger, getActiveSession, "resolve_uid", {
    description: "Resolve a ResourceUID string or numeric ID back to a project resource path.",
    inputSchema: {
      uid: z.string().min(1).optional(),
      uidId: z.number().int().min(0).optional()
    }
  }, "godot.resource.resolve_uid");

  registerBridgeTool(registry, server, config, auditLogger, getActiveSession, "resave_resources", {
    description: "Re-save project resources to refresh serialized metadata such as UIDs.",
    inputSchema: {
      paths: z.array(z.string().min(1)).min(1).max(100)
    }
  }, "godot.resource.resave");

  registerBridgeTool(registry, server, config, auditLogger, getActiveSession, "get_editor_state", {
    description: "Return the current editor state, selection, and active scene/script."
  }, "godot.editor.get_state");

  registerBridgeTool(registry, server, config, auditLogger, getActiveSession, "get_selection", {
    description: "Return the current node selection in the Godot editor."
  }, "godot.editor.get_selection");

  registerBridgeTool(registry, server, config, auditLogger, getActiveSession, "set_selection", {
    description: "Update the current node selection in the Godot editor.",
    inputSchema: {
      nodePaths: z.array(z.string()).max(100),
      scenePath: z.string().min(1).optional(),
      focusInInspector: z.boolean().optional()
    }
  }, "godot.editor.set_selection");

  registerBridgeTool(registry, server, config, auditLogger, getActiveSession, "focus_node", {
    description: "Focus a node in the editor by selecting it and showing its inspector context.",
    inputSchema: {
      nodePath: z.string().min(1),
      scenePath: z.string().min(1).optional()
    }
  }, "godot.editor.focus_node");

  registerBridgeTool(registry, server, config, auditLogger, getActiveSession, "get_menu_items", {
    description: "List available editor menu items.",
    inputSchema: {
      menuPath: z.string().optional(),
      filterText: z.string().optional()
    }
  }, "godot.editor.get_menu_items");

  registerBridgeTool(registry, server, config, auditLogger, getActiveSession, "execute_menu_item", {
    description: "Execute an editor menu item by its path.",
    inputSchema: {
      menuPath: z.string().min(1).max(512)
    }
  }, "godot.editor.execute_menu_item");

  registerBridgeTool(registry, server, config, auditLogger, getActiveSession, "get_scene_tree", {
    description: "Return the current edited scene tree.",
    inputSchema: {
      maxDepth: z.number().int().min(-1).max(64).optional()
    }
  }, "godot.scene.get_tree");

  registerBridgeTool(registry, server, config, auditLogger, getActiveSession, "find_nodes", {
    description: "Find nodes in the current edited scene by name.",
    inputSchema: {
      query: z.string().min(1),
      searchMode: z.enum(["contains", "exact", "prefix"]).optional(),
      maxResults: z.number().int().min(1).max(200).optional()
    }
  }, "godot.scene.find_nodes");

  registerBridgeTool(registry, server, config, auditLogger, getActiveSession, "get_open_scripts", {
    description: "List the scripts currently open in the Godot editor."
  }, "godot.script.get_open_scripts");

  registerBridgeTool(registry, server, config, auditLogger, getActiveSession, "view_script", {
    description: "Read the current script or a script by path.",
    inputSchema: {
      path: z.string().min(1).optional()
    }
  }, "godot.script.view");

  registerBridgeTool(registry, server, config, auditLogger, getActiveSession, "create_scene", {
    description: "Create and open a new scene inside the workspace.",
    inputSchema: {
      path: z.string().min(1),
      rootType: z.string().min(1).optional(),
      rootName: z.string().min(1).optional()
    }
  }, "godot.scene.create");

  registerBridgeTool(registry, server, config, auditLogger, getActiveSession, "open_scene", {
    description: "Open an existing scene by path.",
    inputSchema: {
      path: z.string().min(1)
    }
  }, "godot.scene.open");

  registerBridgeTool(registry, server, config, auditLogger, getActiveSession, "save_scene", {
    description: "Save the current edited scene.",
    inputSchema: {
      path: z.string().min(1).optional()
    }
  }, "godot.scene.save");

  registerBridgeTool(registry, server, config, auditLogger, getActiveSession, "play_scene", {
    description: "Play the current edited scene or a specific saved scene.",
    inputSchema: {
      path: z.string().min(1).optional()
    }
  }, "godot.scene.play");

  registerBridgeTool(registry, server, config, auditLogger, getActiveSession, "stop_scene", {
    description: "Stop the currently playing scene."
  }, "godot.scene.stop");

  registerBridgeTool(registry, server, config, auditLogger, getActiveSession, "pause_scene", {
    description: "Pause or unpause the currently playing scene.",
    inputSchema: {
      paused: z.boolean().optional()
    }
  }, "godot.scene.pause");

  registerBridgeTool(registry, server, config, auditLogger, getActiveSession, "add_node", {
    description: "Add a node to the current edited scene.",
    inputSchema: {
      parentPath: z.string().min(1).optional(),
      nodeType: z.string().min(1),
      nodeName: z.string().min(1).optional(),
      index: z.number().int().min(0).optional()
    }
  }, "godot.scene.add_node");

  registerBridgeTool(registry, server, config, auditLogger, getActiveSession, "move_node", {
    description: "Move a node to a new parent or sibling index.",
    inputSchema: {
      nodePath: z.string().min(1),
      newParentPath: z.string().min(1).optional(),
      index: z.number().int().min(0).optional(),
      keepGlobalTransform: z.boolean().optional()
    }
  }, "godot.scene.move_node");

  registerBridgeTool(registry, server, config, auditLogger, getActiveSession, "delete_node", {
    description: "Delete a node from the current edited scene.",
    inputSchema: {
      nodePath: z.string().min(1)
    }
  }, "godot.scene.delete_node");

  registerBridgeTool(registry, server, config, auditLogger, getActiveSession, "update_property", {
    description: "Update a node property in the current edited scene.",
    inputSchema: {
      nodePath: z.string().min(1),
      propertyPath: z.string().min(1),
      value: z.unknown()
    }
  }, "godot.scene.update_property");

  registerBridgeTool(registry, server, config, auditLogger, getActiveSession, "create_script", {
    description: "Create a new GDScript file in the workspace.",
    inputSchema: {
      path: z.string().min(1),
      baseType: z.string().min(1).optional(),
      className: z.string().min(1).optional(),
      source: z.string().min(1).optional(),
      readyMessage: z.string().min(1).optional(),
      openInEditor: z.boolean().optional()
    }
  }, "godot.script.create");

  registerBridgeTool(registry, server, config, auditLogger, getActiveSession, "attach_script", {
    description: "Attach a script to a node in the current edited scene.",
    inputSchema: {
      nodePath: z.string().min(1),
      scriptPath: z.string().min(1),
      openInEditor: z.boolean().optional()
    }
  }, "godot.script.attach");

  registerBridgeTool(registry, server, config, auditLogger, getActiveSession, "run_tests", {
    description: "Run the detected Godot test adapter or a configured custom runner.",
    inputSchema: {
      adapter: z.enum(["Auto", "Custom", "GdUnit4", "GUT"]).optional(),
      command: z.string().min(1).optional(),
      args: z.array(z.string()).optional(),
      testDir: z.string().min(1).optional(),
      readStderr: z.boolean().optional(),
      openConsole: z.boolean().optional()
    }
  }, "godot.tests.run");

  registerBridgeTool(registry, server, config, auditLogger, getActiveSession, "compile_project", {
    description: "Check GDScript files in the project for compilation errors.",
    inputSchema: {
      paths: z.array(z.string().min(1)).max(200).optional()
    }
  }, "godot.compile.check");

  registerScreenshotTool(registry, server, config, auditLogger, getActiveSession, "get_editor_screenshot", {
    description: "Capture the current editor window as a PNG screenshot.",
    inputSchema: {
      includeImage: z.boolean().optional()
    }
  }, "godot.screenshot.editor");

  registerScreenshotTool(
    registry,
    server,
    config,
    auditLogger,
    getActiveSession,
    "get_running_scene_screenshot",
    {
      description: "Capture the current editor window while a scene is running.",
      inputSchema: {
        includeImage: z.boolean().optional()
      }
    },
    "godot.screenshot.runtime"
  );

  registerScreenshotTool(
    registry,
    server,
    config,
    auditLogger,
    getActiveSession,
    "get_annotated_screenshot",
    {
      description: "Capture a screenshot of the running scene with interactive UI elements labeled and their coordinates returned.",
      inputSchema: {
        includeImage: z.boolean().optional()
      }
    },
    "godot.screenshot.annotated"
  );

  registerBridgeTool(registry, server, config, auditLogger, getActiveSession, "get_runtime_debug_events", {
    description: "Read buffered runtime telemetry captured by EditorDebuggerPlugin.",
    inputSchema: {
      limit: z.number().int().min(1).max(500).optional()
    }
  }, "godot.runtime.get_events");

  registerBridgeTool(registry, server, config, auditLogger, getActiveSession, "get_running_scene_tree", {
    description: "Return the latest captured tree for the currently running scene."
  }, "godot.runtime.get_tree");

  registerBridgeTool(registry, server, config, auditLogger, getActiveSession, "get_running_node", {
    description: "Read a node snapshot from the currently running scene by node path.",
    inputSchema: {
      nodePath: z.string().min(1)
    }
  }, "godot.runtime.get_node");

  registerBridgeTool(registry, server, config, auditLogger, getActiveSession, "get_running_node_property", {
    description: "Read a property value from the latest running-scene node snapshot.",
    inputSchema: {
      nodePath: z.string().min(1),
      propertyPath: z.string().min(1)
    }
  }, "godot.runtime.get_node_property");

  registerTool(
    registry,
    server,
    "wait_for_runtime_condition",
    {
      description: "Poll a running-scene node property until a predicate matches or times out.",
      inputSchema: waitForRuntimeConditionArgsSchema.shape
    },
    async (args: JsonObject = {}) =>
      auditedCall("tool", "wait_for_runtime_condition", args, config, auditLogger, getActiveSession, async () => {
        const denial = toolAccessDenied("wait_for_runtime_condition", config, getActiveSession);
        if (denial) {
          return denial;
        }

        const parsedArgs = waitForRuntimeConditionArgsSchema.safeParse(args);
        if (!parsedArgs.success) {
          return formatToolError({
            available: false,
            reason: "Invalid arguments for wait_for_runtime_condition",
            code: "invalid_arguments",
            details: parsedArgs.error.flatten()
          });
        }

        return waitForRuntimeCondition(
          getActiveSession,
          {
            nodePath: parsedArgs.data.nodePath,
            propertyPath: parsedArgs.data.propertyPath,
            predicate: parsedArgs.data.predicate ?? "equals",
            value: parsedArgs.data.value,
            timeoutMs: parsedArgs.data.timeoutMs ?? 10_000,
            pollIntervalMs: parsedArgs.data.pollIntervalMs ?? 250
          }
        );
      })
  );

  registerBridgeTool(registry, server, config, auditLogger, getActiveSession, "get_running_audio_players", {
    description: "Return the latest captured AudioStreamPlayer playback state from the running scene.",
    inputSchema: {
      playingOnly: z.boolean().optional()
    }
  }, "godot.runtime.get_audio_players");

  registerBridgeTool(registry, server, config, auditLogger, getActiveSession, "clear_runtime_debug_events", {
    description: "Clear buffered runtime telemetry events."
  }, "godot.runtime.clear_events");

  registerBridgeTool(registry, server, config, auditLogger, getActiveSession, "simulate_mouse", {
    description: "Simulate mouse input (click, drag, long-press) on a running scene.",
    inputSchema: {
      action: z.enum(["click", "drag", "long_press"]),
      x: z.number(),
      y: z.number(),
      endX: z.number().optional(),
      endY: z.number().optional(),
      durationMs: z.number().int().min(100).max(10000).optional(),
      button: z.enum(["left", "right", "middle"]).optional()
    }
  }, "godot.runtime.simulate_mouse");

  registerBridgeTool(registry, server, config, auditLogger, getActiveSession, "execute_editor_script", {
    description: "Execute editor-side GDScript in Dangerous mode.",
    inputSchema: {
      source: z.string().min(1),
      args: z.record(z.string(), z.unknown()).optional()
    }
  }, "godot.danger.execute_editor_script");

  registerBridgeTool(registry, server, config, auditLogger, getActiveSession, "filesystem_write_raw", {
    description: "Write raw files inside an allowlisted workspace prefix.",
    inputSchema: {
      path: z.string().min(1),
      content: z.string(),
      overwrite: z.boolean().optional()
    }
  }, "godot.danger.filesystem_write_raw");

  registerBridgeTool(registry, server, config, auditLogger, getActiveSession, "os_shell", {
    description: "Execute an allowlisted shell command.",
    inputSchema: {
      executable: z.string().min(1),
      args: z.array(z.string()).optional(),
      readStderr: z.boolean().optional(),
      openConsole: z.boolean().optional()
    }
  }, "godot.danger.os_shell");

  registerTool(
    registry,
    server,
    "clear_output_logs",
    {
      description: "Clear addon console buffers and bridge log files."
    },
    async () =>
      auditedCall("tool", "clear_output_logs", {}, config, auditLogger, getActiveSession, async () => {
        const denial = toolAccessDenied("clear_output_logs", config, getActiveSession);
        if (denial) {
          return denial;
        }
        const payload = await clearObservedLogs(config, logger, getActiveSession);
        return payload.isError ? formatToolError(payload.payload) : formatToolResult(payload.payload);
      })
  );

  registerTool(
    registry,
    server,
    "get_output_logs",
    {
      description: "Read the latest editor console logs when available, otherwise fall back to .godot/mcp.",
      inputSchema: {
        limit: z.number().int().min(1).max(500).optional()
      }
    },
    async ({ limit }: any) =>
      auditedCall("tool", "get_output_logs", { limit }, config, auditLogger, getActiveSession, async () =>
        formatToolResult(
          (await readObservedLogs("output", config, logger, getActiveSession, limit ?? 100)) as unknown as JsonObject
        ))
  );

  registerTool(
    registry,
    server,
    "get_godot_errors",
    {
      description: "Read the latest editor console errors when available, otherwise fall back to .godot/mcp.",
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional()
      }
    },
    async ({ limit }: any) =>
      auditedCall("tool", "get_godot_errors", { limit }, config, auditLogger, getActiveSession, async () =>
        formatToolResult(
          (await readObservedLogs("errors", config, logger, getActiveSession, limit ?? 100)) as unknown as JsonObject
        ))
  );
}

function registerResources(
  server: McpServer,
  registry: CatalogRegistry,
  config: ServerConfig,
  logger: Logger,
  auditLogger: AuditLogger,
  getActiveSession: () => AddonSession | undefined
): void {
  registerResource(
    registry,
    server,
    "project-info",
    "godot://project/info",
    {
      description: "Project metadata for the active Godot workspace.",
      mimeType: "application/json"
    },
    async () =>
      auditedCall("resource", "project-info", {}, config, auditLogger, getActiveSession, async () =>
        readAddonResource("godot://project/info", getActiveSession, logger, "godot.project.get_info"))
  );

  registerResource(
    registry,
    server,
    "scene-current",
    "godot://scene/current",
    {
      description: "Summary of the current edited scene.",
      mimeType: "application/json"
    },
    async () =>
      auditedCall("resource", "scene-current", {}, config, auditLogger, getActiveSession, async () => {
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
      })
  );

  registerResource(
    registry,
    server,
    "scene-tree",
    "godot://scene/tree",
    {
      description: "Serialized tree for the current edited scene.",
      mimeType: "application/json"
    },
    async () =>
      auditedCall("resource", "scene-tree", {}, config, auditLogger, getActiveSession, async () =>
        readAddonResource("godot://scene/tree", getActiveSession, logger, "godot.scene.get_tree"))
  );

  registerResource(
    registry,
    server,
    "selection-current",
    "godot://selection/current",
    {
      description: "Current node selection in the editor.",
      mimeType: "application/json"
    },
    async () =>
      auditedCall("resource", "selection-current", {}, config, auditLogger, getActiveSession, async () =>
        readAddonResource("godot://selection/current", getActiveSession, logger, "godot.editor.get_selection"))
  );

  registerResource(
    registry,
    server,
    "scripts-open",
    "godot://scripts/open",
    {
      description: "List of scripts currently open in the editor.",
      mimeType: "application/json"
    },
    async () =>
      auditedCall("resource", "scripts-open", {}, config, auditLogger, getActiveSession, async () =>
        readAddonResource("godot://scripts/open", getActiveSession, logger, "godot.script.get_open_scripts"))
  );

  registerResource(
    registry,
    server,
    "script-current",
    "godot://script/current",
    {
      description: "Source for the currently active script.",
      mimeType: "application/json"
    },
    async () =>
      auditedCall("resource", "script-current", {}, config, auditLogger, getActiveSession, async () =>
        readAddonResource("godot://script/current", getActiveSession, logger, "godot.script.view"))
  );

  registerResource(
    registry,
    server,
    "errors-latest",
    "godot://errors/latest",
    {
      description: "Latest error-level editor console logs with bridge-log fallback.",
      mimeType: "application/json"
    },
    async () =>
      auditedCall("resource", "errors-latest", {}, config, auditLogger, getActiveSession, async () =>
        formatResourceResult(
          "godot://errors/latest",
          (await readObservedLogs("errors", config, logger, getActiveSession, 100)) as unknown as JsonObject
        ))
  );
}

function registerPrompts(
  server: McpServer,
  registry: CatalogRegistry,
  config: ServerConfig,
  auditLogger: AuditLogger,
  getActiveSession: () => AddonSession | undefined
): void {
  registerPrompt(
    registry,
    server,
    "godot_editor_strategy",
    {
      description: "Guide the model to plan safe Godot editor operations for the current task.",
      argsSchema: {
        task: z.string().optional(),
        targetScene: z.string().optional()
      }
    },
    async ({ task, targetScene }: any) =>
      auditedCall("prompt", "godot_editor_strategy", { task, targetScene }, config, auditLogger, getActiveSession, async () => ({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                "Plan Godot editor work conservatively.",
                buildPromptEnvironmentSummary(getActiveSession(), config.securityLevel),
                `Task: ${task ?? "Inspect first, then propose the minimal safe sequence."}`,
                `Target scene: ${targetScene ?? "Use get_editor_state and get_scene_tree before editing."}`,
                "Prefer read tools first, then use write tools only when the state is verified."
              ].join("\n")
            }
          }
        ]
      }))
  );

  registerPrompt(
    registry,
    server,
    "godot_ui_layout_strategy",
    {
      description: "Guide the model to propose an intentional Godot UI layout approach.",
      argsSchema: {
        goal: z.string().optional(),
        constraints: z.string().optional()
      }
    },
    async ({ goal, constraints }: any) =>
      auditedCall("prompt", "godot_ui_layout_strategy", { goal, constraints }, config, auditLogger, getActiveSession, async () => ({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                "Propose a Godot UI layout strategy that feels deliberate rather than boilerplate.",
                `Goal: ${goal ?? "Deliver the requested UI outcome."}`,
                `Constraints: ${constraints ?? "Respect the current project's visual language and mobile/desktop responsiveness."}`,
                "Use scene inspection, script inspection, and project search before suggesting large changes."
              ].join("\n")
            }
          }
        ]
      }))
  );

  registerPrompt(
    registry,
    server,
    "godot_debug_loop",
    {
      description: "Guide the model through a fix-test-observe loop using the exposed Godot tools.",
      argsSchema: {
        failureSummary: z.string().optional()
      }
    },
    async ({ failureSummary }: any) =>
      auditedCall("prompt", "godot_debug_loop", { failureSummary }, config, auditLogger, getActiveSession, async () => ({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                "Run a Godot debug loop with explicit observation checkpoints.",
                `Failure summary: ${failureSummary ?? "Unknown failure. Start by reading logs, editor state, and the current scene."}`,
                "Sequence: inspect -> hypothesize -> mutate minimally -> run tests or play scene -> re-read logs and runtime events."
              ].join("\n")
            }
          }
        ]
      }))
  );

  registerPrompt(
    registry,
    server,
    "godot_scene_edit_safety",
    {
      description: "Summarize safety checks before applying scene or file mutations.",
      argsSchema: {
        plannedChanges: z.string().optional()
      }
    },
    async ({ plannedChanges }: any) =>
      auditedCall("prompt", "godot_scene_edit_safety", { plannedChanges }, config, auditLogger, getActiveSession, async () => ({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                "Before applying scene or file mutations, list the safety checks and rollback points.",
                `Planned changes: ${plannedChanges ?? "Unknown. Clarify targets and current scene state first."}`,
                "Verify security level, current scene path, selection, resource existence, and whether dangerous tools are actually required."
              ].join("\n")
            }
          }
        ]
      }))
  );
}

function registerResourceTemplates(
  server: McpServer,
  registry: CatalogRegistry,
  config: ServerConfig,
  logger: Logger,
  auditLogger: AuditLogger,
  getActiveSession: () => AddonSession | undefined
): void {
  registerResourceTemplate(
    registry,
    server,
    "scene-by-path",
    new ResourceTemplate("godot://scene/{path}", { list: undefined }),
    {
      description: "Read a saved scene resource by encoded path.",
      mimeType: "application/json"
    },
    async (uri: URL, variables: Record<string, unknown>) =>
      auditedCall("resource", "scene-by-path", { uri: uri.toString(), variables }, config, auditLogger, getActiveSession, async () =>
        formatResourceResult(
          uri.toString(),
          await readWorkspaceTextPayload(config.repoRoot, decodeTemplateValue(variables.path), "scene")
        ))
  );

  registerResourceTemplate(
    registry,
    server,
    "script-by-path",
    new ResourceTemplate("godot://script/{path}", { list: undefined }),
    {
      description: "Read a saved script resource by encoded path.",
      mimeType: "application/json"
    },
    async (uri: URL, variables: Record<string, unknown>) =>
      auditedCall("resource", "script-by-path", { uri: uri.toString(), variables }, config, auditLogger, getActiveSession, async () => {
        const payload = await readAddonPayload(getActiveSession, logger, "godot.script.read_file", {
          path: decodeTemplateValue(variables.path)
        });
        return formatResourceResult(uri.toString(), payload.ok ? payload.payload : payload.error);
      })
  );

  registerResourceTemplate(
    registry,
    server,
    "node-by-path",
    new ResourceTemplate("godot://node/{scenePath}/{nodePath}", { list: undefined }),
    {
      description: "Inspect a saved scene node by encoded scene path and node path.",
      mimeType: "application/json"
    },
    async (uri: URL, variables: Record<string, unknown>) =>
      auditedCall("resource", "node-by-path", { uri: uri.toString(), variables }, config, auditLogger, getActiveSession, async () => {
        const payload = await readAddonPayload(getActiveSession, logger, "godot.scene.inspect_node_file", {
          scenePath: decodeTemplateValue(variables.scenePath),
          nodePath: decodeTemplateValue(variables.nodePath),
          maxDepth: 2
        });
        return formatResourceResult(uri.toString(), payload.ok ? payload.payload : payload.error);
      })
  );

  registerResourceTemplate(
    registry,
    server,
    "resource-by-uid",
    new ResourceTemplate("godot://resource/{uid}", { list: undefined }),
    {
      description: "Resolve a ResourceUID and read its backing resource when text-readable.",
      mimeType: "application/json"
    },
    async (uri: URL, variables: Record<string, unknown>) =>
      auditedCall("resource", "resource-by-uid", { uri: uri.toString(), variables }, config, auditLogger, getActiveSession, async () => {
        const uid = decodeTemplateValue(variables.uid);
        const resolved = await readAddonPayload(getActiveSession, logger, "godot.resource.resolve_uid", { uid });
        if (!resolved.ok) {
          return formatResourceResult(uri.toString(), resolved.error);
        }

        const resourcePath = typeof resolved.payload.path === "string" ? resolved.payload.path : "";
        if (!resourcePath) {
          return formatResourceResult(uri.toString(), {
            uid,
            found: false,
            reason: "The uid did not resolve to a workspace resource."
          });
        }

        return formatResourceResult(uri.toString(), {
          ...(await readWorkspaceTextPayload(config.repoRoot, resourcePath, "resource")),
          uid,
          resolvedPath: resourcePath
        });
      })
  );
}

function registerBridgeTool(
  registry: CatalogRegistry,
  server: McpServer,
  config: ServerConfig,
  auditLogger: AuditLogger,
  getActiveSession: () => AddonSession | undefined,
  name: string,
  toolConfig: any,
  method: string
): void {
  registerTool(registry, server, name, toolConfig, async (args: JsonObject = {}) =>
    auditedCall("tool", name, args, config, auditLogger, getActiveSession, async () => {
      const denial = toolAccessDenied(name, config, getActiveSession);
      if (denial) {
        return denial;
      }
      return callAddonTool(getActiveSession, method, args);
    })
  );
}

function registerScreenshotTool(
  registry: CatalogRegistry,
  server: McpServer,
  config: ServerConfig,
  auditLogger: AuditLogger,
  getActiveSession: () => AddonSession | undefined,
  name: string,
  toolConfig: any,
  method: string
): void {
  registerTool(registry, server, name, toolConfig, async (args: JsonObject = {}) =>
    auditedCall("tool", name, args, config, auditLogger, getActiveSession, async () => {
      const denial = toolAccessDenied(name, config, getActiveSession);
      if (denial) {
        return denial;
      }

      const result = await callAddonPayload(getActiveSession, method, args);
      if (!result.ok) {
        return formatToolError(result.error);
      }

      return formatToolResultWithImage(result.payload);
    })
  );
}

function registerTool(
  registry: CatalogRegistry,
  server: McpServer,
  name: string,
  config: any,
  handler: any
): void {
  registry.tools.set(name, server.registerTool(name, config, handler));
}

function registerResource(
  registry: CatalogRegistry,
  server: McpServer,
  name: string,
  uri: string,
  config: any,
  handler: any
): void {
  registry.resources.set(name, server.registerResource(name, uri, config, handler));
}

function registerPrompt(
  registry: CatalogRegistry,
  server: McpServer,
  name: string,
  config: any,
  handler: any
): void {
  registry.prompts.set(name, server.registerPrompt(name, config, handler));
}

function registerResourceTemplate(
  registry: CatalogRegistry,
  server: McpServer,
  name: string,
  template: ResourceTemplate,
  config: any,
  handler: any
): void {
  registry.resourceTemplates.set(name, server.registerResource(name, template, config, handler));
}

function syncCatalogExposure(
  registry: CatalogRegistry,
  serverSecurityLevel: SecurityLevel,
  _session?: AddonSession
): void {
  for (const toolEntry of MCP_TOOLS) {
    const registeredTool = registry.tools.get(toolEntry.name);
    if (!registeredTool) {
      continue;
    }

    const shouldEnable = shouldAdvertiseEntry(toolEntry, serverSecurityLevel);
    if (registeredTool.enabled !== shouldEnable) {
      shouldEnable ? registeredTool.enable() : registeredTool.disable();
    }
  }

  for (const resourceEntry of MCP_RESOURCES) {
    const registeredResource = registry.resources.get(resourceEntry.name);
    if (!registeredResource) {
      continue;
    }

    const shouldEnable = shouldAdvertiseEntry(resourceEntry, serverSecurityLevel);
    if (registeredResource.enabled !== shouldEnable) {
      shouldEnable ? registeredResource.enable() : registeredResource.disable();
    }
  }

  for (const promptEntry of MCP_PROMPTS) {
    const registeredPrompt = registry.prompts.get(promptEntry.name);
    if (!registeredPrompt) {
      continue;
    }

    const shouldEnable = shouldAdvertiseEntry(promptEntry, serverSecurityLevel);
    if (registeredPrompt.enabled !== shouldEnable) {
      shouldEnable ? registeredPrompt.enable() : registeredPrompt.disable();
    }
  }

  for (const templateEntry of MCP_RESOURCE_TEMPLATES) {
    const registeredTemplate = registry.resourceTemplates.get(templateEntry.name);
    if (!registeredTemplate) {
      continue;
    }

    const shouldEnable = shouldAdvertiseEntry(templateEntry, serverSecurityLevel);
    if (registeredTemplate.enabled !== shouldEnable) {
      shouldEnable ? registeredTemplate.enable() : registeredTemplate.disable();
    }
  }
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
  method: string,
  params: JsonObject = {}
): Promise<ReturnType<typeof formatToolResult>> {
  const result = await callAddonPayload(getActiveSession, method, params);
  if (!result.ok) {
    return formatToolError(result.error);
  }

  return formatToolResult(result.payload);
}

async function callAddonPayload(
  getActiveSession: () => AddonSession | undefined,
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
    return {
      ok: false,
      error: addonRequestErrorPayload(method, message)
    };
  }
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
  const result = await callAddonPayload(getActiveSession, method, params);
  if (!result.ok) {
    const session = getActiveSession();
    logger.warn("Addon observation request failed.", {
      sessionId: session?.getSessionId(),
      method,
      error: result.error.reason ?? "Addon request failed."
    });
  }
  return result;
}

async function waitForRuntimeCondition(
  getActiveSession: () => AddonSession | undefined,
  options: {
    nodePath: string;
    propertyPath: string;
    predicate: RuntimeConditionPredicate | string;
    value: unknown;
    timeoutMs: number;
    pollIntervalMs: number;
  }
): Promise<ReturnType<typeof formatToolResult> | ReturnType<typeof formatToolError>> {
  const predicate = normalizeRuntimePredicate(options.predicate);
  const timeoutMs = clampNumber(options.timeoutMs, 100, 120_000, 10_000);
  const pollIntervalMs = clampNumber(options.pollIntervalMs, 50, 5_000, 250);
  const startedAt = Date.now();
  let attempts = 0;
  let lastObservation: JsonObject | undefined;

  while (Date.now() - startedAt <= timeoutMs) {
    attempts += 1;
    const observation = await callAddonPayload(getActiveSession, "godot.runtime.get_node_property", {
      nodePath: options.nodePath,
      propertyPath: options.propertyPath
    });

    if (observation.ok) {
      lastObservation = observation.payload;
      const value = observation.payload.value;
      if (matchesRuntimeCondition(value, predicate, options.value)) {
        return formatToolResult({
          matched: true,
          nodePath: options.nodePath,
          propertyPath: options.propertyPath,
          predicate,
          expected: options.value,
          value,
          attempts,
          elapsedMs: Date.now() - startedAt,
          capturedAt: observation.payload.capturedAt
        });
      }
    } else {
      return formatToolError({
        available: false,
        code:
          typeof observation.error.code === "string"
            ? observation.error.code
            : "runtime_observation_failed",
        reason:
          typeof observation.error.reason === "string"
            ? observation.error.reason
            : "Failed to observe the runtime node property.",
        nodePath: options.nodePath,
        propertyPath: options.propertyPath,
        predicate,
        expected: options.value,
        attempts,
        elapsedMs: Date.now() - startedAt,
        lastObservation: observation.error
      });
    }

    await delay(pollIntervalMs);
  }

  return formatToolResult({
    matched: false,
    timedOut: true,
    code: "timed_out",
    nodePath: options.nodePath,
    propertyPath: options.propertyPath,
    predicate,
    expected: options.value,
    attempts,
    timeoutMs,
    elapsedMs: Date.now() - startedAt,
    lastObservation
  });
}

function normalizeRuntimePredicate(predicate: string): RuntimeConditionPredicate {
  switch (predicate) {
    case "not_equals":
    case "contains":
    case "truthy":
    case "falsy":
    case "exists":
    case "greater_than":
    case "greater_or_equal":
    case "less_than":
    case "less_or_equal":
      return predicate;
    case "equals":
    default:
      return "equals";
  }
}

function matchesRuntimeCondition(
  actualValue: unknown,
  predicate: RuntimeConditionPredicate,
  expectedValue: unknown
): boolean {
  switch (predicate) {
    case "equals":
      return isDeepStrictEqual(actualValue, expectedValue);
    case "not_equals":
      return !isDeepStrictEqual(actualValue, expectedValue);
    case "contains":
      return String(actualValue ?? "").includes(String(expectedValue ?? ""));
    case "truthy":
      return Boolean(actualValue);
    case "falsy":
      return !Boolean(actualValue);
    case "exists":
      return actualValue !== undefined && actualValue !== null;
    case "greater_than":
      return compareNumbers(actualValue, expectedValue, (left, right) => left > right);
    case "greater_or_equal":
      return compareNumbers(actualValue, expectedValue, (left, right) => left >= right);
    case "less_than":
      return compareNumbers(actualValue, expectedValue, (left, right) => left < right);
    case "less_or_equal":
      return compareNumbers(actualValue, expectedValue, (left, right) => left <= right);
    default:
      return false;
  }
}

function compareNumbers(
  leftValue: unknown,
  rightValue: unknown,
  comparator: (left: number, right: number) => boolean
): boolean {
  const left = typeof leftValue === "number" ? leftValue : Number(leftValue);
  const right = typeof rightValue === "number" ? rightValue : Number(rightValue);
  return Number.isFinite(left) && Number.isFinite(right) && comparator(left, right);
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(Math.max(value, min), max);
}

async function auditedCall<T>(
  kind: "tool" | "resource" | "prompt",
  name: string,
  args: unknown,
  config: ServerConfig,
  auditLogger: AuditLogger,
  getActiveSession: () => AddonSession | undefined,
  handler: () => Promise<T> | T
): Promise<T> {
  const startedAt = Date.now();
  const session = getActiveSession();
  try {
    const result = await handler();
    auditLogger.record({
      timestamp: new Date().toISOString(),
      kind,
      name,
      status: extractAuditStatus(result),
      durationMs: Date.now() - startedAt,
      argHash: hashAuditArgs(args),
      sessionId: session?.getSessionId(),
      addonName: session?.getAddonProduct()?.name,
      addonVersion: session?.getAddonProduct()?.version,
      addonSecurityLevel: session?.getSecurityLevel(),
      serverSecurityLevel: config.securityLevel,
      details: extractAuditDetails(result)
    });
    return result;
  } catch (error) {
    auditLogger.record({
      timestamp: new Date().toISOString(),
      kind,
      name,
      status: "error",
      durationMs: Date.now() - startedAt,
      argHash: hashAuditArgs(args),
      sessionId: session?.getSessionId(),
      addonName: session?.getAddonProduct()?.name,
      addonVersion: session?.getAddonProduct()?.version,
      addonSecurityLevel: session?.getSecurityLevel(),
      serverSecurityLevel: config.securityLevel,
      details: {
        error: error instanceof Error ? error.message : String(error)
      }
    });
    throw error;
  }
}

function toolAccessDenied(
  toolName: string,
  config: ServerConfig,
  getActiveSession: () => AddonSession | undefined
): ReturnType<typeof formatToolError> | undefined {
  const entry = MCP_TOOLS.find((candidate) => candidate.name === toolName);
  if (!entry) {
    return undefined;
  }

  const session = getActiveSession();
  if (isEntryUsable(entry, config.securityLevel, session)) {
    return undefined;
  }

  return formatToolError({
    available: false,
    code:
      !session && entry.exposeWhenNoSession !== true
        ? "no_ready_session"
        : "tool_not_enabled",
    reason:
      !session && entry.exposeWhenNoSession !== true
        ? "No ready addon session."
        : "The tool is not enabled for the current addon capabilities or security level.",
    tool: toolName,
    serverSecurityLevel: config.securityLevel,
    addonSecurityLevel: session?.getSecurityLevel() ?? "ReadOnly"
  });
}

function shouldAdvertiseEntry(
  entry: {
    minimumSecurityLevel?: SecurityLevel;
  },
  serverSecurityLevel: SecurityLevel
): boolean {
  const requiredSecurityLevel = entry.minimumSecurityLevel ?? "ReadOnly";
  return hasRequiredSecurity(requiredSecurityLevel, serverSecurityLevel);
}

function isEntryUsable(
  entry: {
    exposeWhenNoSession?: boolean;
    requiredCapabilities?: string[];
    minimumSecurityLevel?: SecurityLevel;
  },
  serverSecurityLevel: SecurityLevel,
  session?: AddonSession
): boolean {
  const effectiveSecurityLevel = session
    ? minSecurityLevel(serverSecurityLevel, session.getSecurityLevel())
    : serverSecurityLevel;
  const requiredSecurityLevel = entry.minimumSecurityLevel ?? "ReadOnly";
  if (!hasRequiredSecurity(requiredSecurityLevel, effectiveSecurityLevel)) {
    return false;
  }

  if (!session) {
    return entry.exposeWhenNoSession === true;
  }

  return (entry.requiredCapabilities ?? []).every((capabilityId) => session.hasCapability(capabilityId));
}

function minSecurityLevel(left: SecurityLevel, right: SecurityLevel): SecurityLevel {
  const order: SecurityLevel[] = ["ReadOnly", "WorkspaceWrite", "Dangerous"];
  return order[Math.min(order.indexOf(left), order.indexOf(right))] ?? "ReadOnly";
}

function hasRequiredSecurity(requiredLevel: SecurityLevel, actualLevel: SecurityLevel): boolean {
  const order: SecurityLevel[] = ["ReadOnly", "WorkspaceWrite", "Dangerous"];
  return order.indexOf(actualLevel) >= order.indexOf(requiredLevel);
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

function formatToolResultWithImage(payload: JsonObject): {
  content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: "image/png" }>;
  structuredContent: JsonObject;
} {
  const content: Array<
    { type: "text"; text: string } | { type: "image"; data: string; mimeType: "image/png" }
  > = [
    {
      type: "text",
      text: JSON.stringify(payload, null, 2)
    }
  ];

  const imagePath = typeof payload.path === "string" ? payload.path : "";
  const includeImage = payload.includeImage !== false;
  if (includeImage && imagePath && fs.existsSync(imagePath)) {
    content.push({
      type: "image",
      data: fs.readFileSync(imagePath).toString("base64"),
      mimeType: "image/png"
    });
  }

  return {
    content,
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
    code: "no_ready_session",
    reason
  };
}

function addonRequestErrorPayload(method: string, message: string): JsonObject {
  return {
    available: false,
    code: "addon_request_failed",
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
    ? readOutputLogs(logDir, limit, options)
    : readErrorLogs(logDir, limit, options);
}

function normalizeAddonLogPayload(payload: JsonObject): OutputLogPayload {
  return {
    note: typeof payload.note === "string" ? payload.note : "Addon-provided log payload.",
    backend:
      typeof payload.backend === "string"
        ? (payload.backend as OutputLogPayload["backend"])
        : "bridge-log-fallback",
    captureAvailable: payload.captureAvailable === true,
    captureUsed: payload.captureUsed === true,
    logDir: typeof payload.logDir === "string" ? payload.logDir : undefined,
    fallbackReason:
      typeof payload.fallbackReason === "string" ? payload.fallbackReason : undefined,
    entries: Array.isArray(payload.entries) ? (payload.entries as OutputLogPayload["entries"]) : []
  };
}

function clearLocalLogFiles(logDir: string): JsonObject {
  const files = ["server.log", "runtime.log"];
  const clearedFiles: string[] = [];
  for (const fileName of files) {
    const filePath = path.join(logDir, fileName);
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, "", "utf8");
      clearedFiles.push(filePath);
    } catch {
      // ignore file cleanup failures
    }
  }

  return {
    clearedLocalFiles: clearedFiles,
    clearedLogFiles: clearedFiles
  };
}

function isJsonObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function decodeTemplateValue(value: unknown): string {
  if (Array.isArray(value)) {
    return decodeTemplateValue(value[0]);
  }
  return decodeURIComponent(typeof value === "string" ? value : "");
}

async function readWorkspaceTextPayload(
  repoRoot: string,
  resourcePath: string,
  kind: "scene" | "resource"
): Promise<JsonObject> {
  const normalizedPath = normalizeResourcePath(resourcePath);
  if (!normalizedPath) {
    return {
      available: false,
      reason: "The requested path is outside the workspace.",
      path: resourcePath
    };
  }

  const absolutePath = path.join(
    repoRoot,
    normalizedPath.replace(/^res:\/\//u, "").replaceAll("/", path.sep)
  );
  if (!fs.existsSync(absolutePath)) {
    return {
      available: false,
      reason: "The requested file does not exist.",
      path: normalizedPath
    };
  }

  const text = fs.readFileSync(absolutePath, "utf8");
  return {
    available: true,
    kind,
    path: normalizedPath,
    lineCount: text.length === 0 ? 0 : text.split(/\r?\n/u).length,
    source: text
  };
}

function normalizeResourcePath(rawPath: string): string {
  const trimmed = rawPath.trim().replaceAll("\\", "/");
  if (!trimmed) {
    return "";
  }

  if (trimmed.startsWith("res://")) {
    return trimmed;
  }

  return `res://${trimmed.replace(/^\/+/u, "")}`;
}

function extractAuditStatus(result: unknown): "success" | "error" | "denied" {
  if (isJsonObject(result) && result.isError === true) {
    const structured = isJsonObject(result.structuredContent) ? result.structuredContent : undefined;
    if (structured?.code === "tool_not_enabled") {
      return "denied";
    }
    return "error";
  }
  return "success";
}

function extractAuditDetails(result: unknown): Record<string, unknown> | undefined {
  if (isJsonObject(result) && isJsonObject(result.structuredContent)) {
    return result.structuredContent;
  }
  return undefined;
}

function buildPromptEnvironmentSummary(
  session: AddonSession | undefined,
  serverSecurityLevel: SecurityLevel
): string {
  const addonSecurity = session?.getSecurityLevel() ?? "ReadOnly";
  return `Security: server=${serverSecurityLevel}, addon=${addonSecurity}.`;
}
