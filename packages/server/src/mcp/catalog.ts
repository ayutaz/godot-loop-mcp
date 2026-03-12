import type { SecurityLevel } from "../transport/types.ts";

export interface McpCatalog {
  tools: string[];
  resources: string[];
  prompts: string[];
}

export interface CapabilityLookup {
  hasCapability(capabilityId: string): boolean;
}

export interface CatalogExposureContext extends CapabilityLookup {
  getSecurityLevel(): SecurityLevel;
}

interface McpCatalogEntryBase {
  description: string;
  requiredCapabilities?: string[];
  exposeWhenNoSession?: boolean;
  minimumSecurityLevel?: SecurityLevel;
}

export interface McpToolCatalogEntry extends McpCatalogEntryBase {
  name: string;
  bridgeMethod?: string;
}

export interface McpResourceCatalogEntry extends McpCatalogEntryBase {
  name: string;
  uri: string;
}

export interface McpPromptCatalogEntry extends McpCatalogEntryBase {
  name: string;
}

export interface McpResourceTemplateCatalogEntry extends McpCatalogEntryBase {
  name: string;
  uriTemplate: string;
}

const LOG_READ_CAPABILITIES = ["logs.read"];
const READ_ONLY: SecurityLevel = "ReadOnly";
const WORKSPACE_WRITE: SecurityLevel = "WorkspaceWrite";
const DANGEROUS: SecurityLevel = "Dangerous";
const SECURITY_ORDER: SecurityLevel[] = [READ_ONLY, WORKSPACE_WRITE, DANGEROUS];

export const MCP_TOOLS: McpToolCatalogEntry[] = [
  {
    name: "get_project_info",
    bridgeMethod: "godot.project.get_info",
    description: "Return the active Godot project's metadata.",
    requiredCapabilities: ["project.info"]
  },
  {
    name: "search_project",
    bridgeMethod: "godot.project.search",
    description: "Search project resources by path, type, or text.",
    requiredCapabilities: ["project.search"]
  },
  {
    name: "get_uid",
    bridgeMethod: "godot.resource.get_uid",
    description: "Return the ResourceUID assigned to a project resource path.",
    requiredCapabilities: ["resource.uid"]
  },
  {
    name: "resolve_uid",
    bridgeMethod: "godot.resource.resolve_uid",
    description: "Resolve a ResourceUID string or numeric ID back to a project resource path.",
    requiredCapabilities: ["resource.uid"]
  },
  {
    name: "resave_resources",
    bridgeMethod: "godot.resource.resave",
    description: "Re-save project resources to refresh serialized metadata such as UIDs.",
    requiredCapabilities: ["resource.resave"],
    minimumSecurityLevel: WORKSPACE_WRITE
  },
  {
    name: "get_editor_state",
    bridgeMethod: "godot.editor.get_state",
    description: "Return the current editor state, selection, and active scene/script."
  },
  {
    name: "get_selection",
    bridgeMethod: "godot.editor.get_selection",
    description: "Return the current node selection in the Godot editor.",
    requiredCapabilities: ["editor.selection.read"]
  },
  {
    name: "set_selection",
    bridgeMethod: "godot.editor.set_selection",
    description: "Update the current node selection in the Godot editor.",
    requiredCapabilities: ["editor.selection.write"],
    minimumSecurityLevel: WORKSPACE_WRITE
  },
  {
    name: "focus_node",
    bridgeMethod: "godot.editor.focus_node",
    description: "Focus a node in the editor by selecting it and showing its inspector context.",
    requiredCapabilities: ["editor.focus"],
    minimumSecurityLevel: WORKSPACE_WRITE
  },
  {
    name: "get_scene_tree",
    bridgeMethod: "godot.scene.get_tree",
    description: "Return the current edited scene tree.",
    requiredCapabilities: ["scene.read"]
  },
  {
    name: "find_nodes",
    bridgeMethod: "godot.scene.find_nodes",
    description: "Find nodes in the current edited scene by name.",
    requiredCapabilities: ["scene.read"]
  },
  {
    name: "get_open_scripts",
    bridgeMethod: "godot.script.get_open_scripts",
    description: "List the scripts currently open in the Godot editor.",
    requiredCapabilities: ["script.read"]
  },
  {
    name: "view_script",
    bridgeMethod: "godot.script.view",
    description: "Read the current script or a script by path.",
    requiredCapabilities: ["script.read"]
  },
  {
    name: "create_scene",
    bridgeMethod: "godot.scene.create",
    description: "Create and open a new scene inside the workspace.",
    requiredCapabilities: ["scene.write"],
    minimumSecurityLevel: WORKSPACE_WRITE
  },
  {
    name: "open_scene",
    bridgeMethod: "godot.scene.open",
    description: "Open an existing scene by path.",
    requiredCapabilities: ["scene.write"],
    minimumSecurityLevel: WORKSPACE_WRITE
  },
  {
    name: "save_scene",
    bridgeMethod: "godot.scene.save",
    description: "Save the current edited scene.",
    requiredCapabilities: ["scene.write"],
    minimumSecurityLevel: WORKSPACE_WRITE
  },
  {
    name: "play_scene",
    bridgeMethod: "godot.scene.play",
    description: "Play the current edited scene or a specific saved scene.",
    requiredCapabilities: ["play.control"],
    minimumSecurityLevel: WORKSPACE_WRITE
  },
  {
    name: "stop_scene",
    bridgeMethod: "godot.scene.stop",
    description: "Stop the currently playing scene.",
    requiredCapabilities: ["play.control"],
    minimumSecurityLevel: WORKSPACE_WRITE
  },
  {
    name: "add_node",
    bridgeMethod: "godot.scene.add_node",
    description: "Add a node to the current edited scene.",
    requiredCapabilities: ["scene.write"],
    minimumSecurityLevel: WORKSPACE_WRITE
  },
  {
    name: "move_node",
    bridgeMethod: "godot.scene.move_node",
    description: "Move a node to a new parent or sibling index.",
    requiredCapabilities: ["scene.write"],
    minimumSecurityLevel: WORKSPACE_WRITE
  },
  {
    name: "delete_node",
    bridgeMethod: "godot.scene.delete_node",
    description: "Delete a node from the current edited scene.",
    requiredCapabilities: ["scene.write"],
    minimumSecurityLevel: WORKSPACE_WRITE
  },
  {
    name: "update_property",
    bridgeMethod: "godot.scene.update_property",
    description: "Update a node property in the current edited scene.",
    requiredCapabilities: ["scene.write"],
    minimumSecurityLevel: WORKSPACE_WRITE
  },
  {
    name: "create_script",
    bridgeMethod: "godot.script.create",
    description: "Create a new GDScript file in the workspace.",
    requiredCapabilities: ["script.write"],
    minimumSecurityLevel: WORKSPACE_WRITE
  },
  {
    name: "attach_script",
    bridgeMethod: "godot.script.attach",
    description: "Attach a script to a node in the current edited scene.",
    requiredCapabilities: ["script.write"],
    minimumSecurityLevel: WORKSPACE_WRITE
  },
  {
    name: "run_tests",
    bridgeMethod: "godot.tests.run",
    description: "Run the detected Godot test adapter or a configured custom runner.",
    requiredCapabilities: ["tests.run"],
    minimumSecurityLevel: WORKSPACE_WRITE
  },
  {
    name: "get_editor_screenshot",
    bridgeMethod: "godot.screenshot.editor",
    description: "Capture the current editor window as a PNG screenshot.",
    requiredCapabilities: ["screenshot.editor"]
  },
  {
    name: "get_running_scene_screenshot",
    bridgeMethod: "godot.screenshot.runtime",
    description: "Capture the current editor window while a scene is running.",
    requiredCapabilities: ["screenshot.runtime"]
  },
  {
    name: "get_runtime_debug_events",
    bridgeMethod: "godot.runtime.get_events",
    description: "Read buffered runtime telemetry captured by EditorDebuggerPlugin.",
    requiredCapabilities: ["runtime.debug"]
  },
  {
    name: "clear_runtime_debug_events",
    bridgeMethod: "godot.runtime.clear_events",
    description: "Clear buffered runtime telemetry events.",
    requiredCapabilities: ["runtime.debug"],
    minimumSecurityLevel: WORKSPACE_WRITE
  },
  {
    name: "clear_output_logs",
    bridgeMethod: "godot.logs.clear",
    description: "Clear addon console buffers and bridge log files.",
    requiredCapabilities: ["logs.clear"],
    exposeWhenNoSession: true,
    minimumSecurityLevel: WORKSPACE_WRITE
  },
  {
    name: "get_output_logs",
    description: "Read editor console logs when available, otherwise fall back to .godot/mcp.",
    requiredCapabilities: LOG_READ_CAPABILITIES,
    exposeWhenNoSession: true
  },
  {
    name: "get_godot_errors",
    description: "Read editor console errors when available, otherwise fall back to .godot/mcp.",
    requiredCapabilities: LOG_READ_CAPABILITIES,
    exposeWhenNoSession: true
  },
  {
    name: "execute_editor_script",
    bridgeMethod: "godot.danger.execute_editor_script",
    description: "Execute editor-side GDScript in Dangerous mode.",
    requiredCapabilities: ["danger.execute_editor_script"],
    minimumSecurityLevel: DANGEROUS
  },
  {
    name: "filesystem_write_raw",
    bridgeMethod: "godot.danger.filesystem_write_raw",
    description: "Write raw files inside an allowlisted workspace prefix.",
    requiredCapabilities: ["danger.filesystem_write_raw"],
    minimumSecurityLevel: DANGEROUS
  },
  {
    name: "os_shell",
    bridgeMethod: "godot.danger.os_shell",
    description: "Execute an allowlisted shell command.",
    requiredCapabilities: ["danger.os_shell"],
    minimumSecurityLevel: DANGEROUS
  }
];

export const MCP_RESOURCES: McpResourceCatalogEntry[] = [
  {
    name: "project-info",
    uri: "godot://project/info",
    description: "Project metadata for the active Godot workspace.",
    requiredCapabilities: ["project.info"]
  },
  {
    name: "scene-current",
    uri: "godot://scene/current",
    description: "Summary of the current edited scene."
  },
  {
    name: "scene-tree",
    uri: "godot://scene/tree",
    description: "Serialized tree for the current edited scene.",
    requiredCapabilities: ["scene.read"]
  },
  {
    name: "selection-current",
    uri: "godot://selection/current",
    description: "Current node selection in the editor.",
    requiredCapabilities: ["editor.selection.read"]
  },
  {
    name: "scripts-open",
    uri: "godot://scripts/open",
    description: "List of scripts currently open in the editor.",
    requiredCapabilities: ["script.read"]
  },
  {
    name: "script-current",
    uri: "godot://script/current",
    description: "Source for the currently active script.",
    requiredCapabilities: ["script.read"]
  },
  {
    name: "errors-latest",
    uri: "godot://errors/latest",
    description: "Latest error-level editor console logs with bridge-log fallback.",
    requiredCapabilities: LOG_READ_CAPABILITIES,
    exposeWhenNoSession: true
  }
];

export const MCP_PROMPTS: McpPromptCatalogEntry[] = [
  {
    name: "godot_editor_strategy",
    description: "Guide the model to plan safe Godot editor operations for the current task."
  },
  {
    name: "godot_ui_layout_strategy",
    description: "Guide the model to propose an intentional Godot UI layout approach."
  },
  {
    name: "godot_debug_loop",
    description: "Guide the model through a fix-test-observe loop using the exposed Godot tools."
  },
  {
    name: "godot_scene_edit_safety",
    description: "Summarize safety checks before applying scene or file mutations.",
    minimumSecurityLevel: WORKSPACE_WRITE
  }
];

export const MCP_RESOURCE_TEMPLATES: McpResourceTemplateCatalogEntry[] = [
  {
    name: "scene-by-path",
    uriTemplate: "godot://scene/{path}",
    description: "Read a saved scene resource by encoded path.",
    requiredCapabilities: ["scene.read"]
  },
  {
    name: "script-by-path",
    uriTemplate: "godot://script/{path}",
    description: "Read a saved script resource by encoded path.",
    requiredCapabilities: ["script.read"]
  },
  {
    name: "node-by-path",
    uriTemplate: "godot://node/{scenePath}/{nodePath}",
    description: "Inspect a saved scene node by encoded scene path and node path.",
    requiredCapabilities: ["scene.read"]
  },
  {
    name: "resource-by-uid",
    uriTemplate: "godot://resource/{uid}",
    description: "Resolve a ResourceUID and read its backing resource when text-readable.",
    requiredCapabilities: ["resource.uid"]
  }
];

export function buildMcpCatalog(options: {
  capabilities?: CapabilityLookup | undefined;
  securityLevel?: SecurityLevel | undefined;
} = {}): McpCatalog {
  const context = createStaticExposureContext(options.capabilities, options.securityLevel);
  return {
    tools: listEnabledToolEntries({ context }).map((tool) => tool.name),
    resources: listEnabledResourceEntries({ context }).map((resource) => resource.uri),
    prompts: listEnabledPromptEntries({ context }).map((prompt) => prompt.name)
  };
}

export function listEnabledToolEntries(options: {
  context?: CatalogExposureContext | undefined;
} = {}): McpToolCatalogEntry[] {
  return MCP_TOOLS.filter((entry) => isCatalogEntryEnabled(entry, options.context));
}

export function listEnabledResourceEntries(options: {
  context?: CatalogExposureContext | undefined;
} = {}): McpResourceCatalogEntry[] {
  return MCP_RESOURCES.filter((entry) => isCatalogEntryEnabled(entry, options.context));
}

export function listEnabledPromptEntries(options: {
  context?: CatalogExposureContext | undefined;
} = {}): McpPromptCatalogEntry[] {
  return MCP_PROMPTS.filter((entry) => isCatalogEntryEnabled(entry, options.context));
}

export function listEnabledResourceTemplateEntries(options: {
  context?: CatalogExposureContext | undefined;
} = {}): McpResourceTemplateCatalogEntry[] {
  return MCP_RESOURCE_TEMPLATES.filter((entry) => isCatalogEntryEnabled(entry, options.context));
}

export function isToolEntryEnabled(
  entry: McpToolCatalogEntry,
  context?: CatalogExposureContext
): boolean {
  return isCatalogEntryEnabled(entry, context);
}

export function isResourceEntryEnabled(
  entry: McpResourceCatalogEntry,
  context?: CatalogExposureContext
): boolean {
  return isCatalogEntryEnabled(entry, context);
}

export function isPromptEntryEnabled(
  entry: McpPromptCatalogEntry,
  context?: CatalogExposureContext
): boolean {
  return isCatalogEntryEnabled(entry, context);
}

export function isResourceTemplateEntryEnabled(
  entry: McpResourceTemplateCatalogEntry,
  context?: CatalogExposureContext
): boolean {
  return isCatalogEntryEnabled(entry, context);
}

function isCatalogEntryEnabled(
  entry: McpCatalogEntryBase,
  context?: CatalogExposureContext
): boolean {
  if (!hasRequiredSecurity(entry.minimumSecurityLevel ?? READ_ONLY, context?.getSecurityLevel() ?? READ_ONLY)) {
    return false;
  }

  if (!context) {
    return entry.exposeWhenNoSession === true;
  }

  const requiredCapabilities = entry.requiredCapabilities ?? [];
  return requiredCapabilities.every((capabilityId) => context.hasCapability(capabilityId));
}

function hasRequiredSecurity(requiredLevel: SecurityLevel, actualLevel: SecurityLevel): boolean {
  return SECURITY_ORDER.indexOf(actualLevel) >= SECURITY_ORDER.indexOf(requiredLevel);
}

function createStaticExposureContext(
  capabilities?: CapabilityLookup,
  securityLevel: SecurityLevel = READ_ONLY
): CatalogExposureContext | undefined {
  if (!capabilities) {
    return undefined;
  }

  return {
    hasCapability(capabilityId: string): boolean {
      return capabilities.hasCapability(capabilityId);
    },
    getSecurityLevel(): SecurityLevel {
      return securityLevel;
    }
  };
}
