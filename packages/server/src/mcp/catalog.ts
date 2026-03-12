export interface McpCatalog {
  tools: string[];
  resources: string[];
  prompts: string[];
}

export interface CapabilityLookup {
  hasCapability(capabilityId: string): boolean;
}

interface McpCatalogEntryBase {
  description: string;
  requiredCapabilities?: string[];
  exposeWhenNoSession?: boolean;
}

export interface McpToolCatalogEntry extends McpCatalogEntryBase {
  name: string;
  bridgeMethod?: string;
}

export interface McpResourceCatalogEntry extends McpCatalogEntryBase {
  name: string;
  uri: string;
}

const LOG_READ_CAPABILITIES = ["logs.read"];

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
    requiredCapabilities: ["resource.resave"]
  },
  {
    name: "get_editor_state",
    bridgeMethod: "godot.editor.get_state",
    description: "Return the current editor state, selection, and active scene/script.",
    requiredCapabilities: ["editor.state"]
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
    requiredCapabilities: ["editor.selection.write"]
  },
  {
    name: "focus_node",
    bridgeMethod: "godot.editor.focus_node",
    description: "Focus a node in the editor by selecting it and opening its inspector context.",
    requiredCapabilities: ["editor.focus"]
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
    requiredCapabilities: ["scene.write"]
  },
  {
    name: "open_scene",
    bridgeMethod: "godot.scene.open",
    description: "Open an existing scene by path.",
    requiredCapabilities: ["scene.write"]
  },
  {
    name: "save_scene",
    bridgeMethod: "godot.scene.save",
    description: "Save the current edited scene.",
    requiredCapabilities: ["scene.write"]
  },
  {
    name: "play_scene",
    bridgeMethod: "godot.scene.play",
    description: "Play the current edited scene or a specific saved scene.",
    requiredCapabilities: ["play.control"]
  },
  {
    name: "stop_scene",
    bridgeMethod: "godot.scene.stop",
    description: "Stop the currently playing scene.",
    requiredCapabilities: ["play.control"]
  },
  {
    name: "add_node",
    bridgeMethod: "godot.scene.add_node",
    description: "Add a node to the current edited scene.",
    requiredCapabilities: ["scene.write"]
  },
  {
    name: "move_node",
    bridgeMethod: "godot.scene.move_node",
    description: "Move a node to a new parent or sibling index.",
    requiredCapabilities: ["scene.write"]
  },
  {
    name: "delete_node",
    bridgeMethod: "godot.scene.delete_node",
    description: "Delete a node from the current edited scene.",
    requiredCapabilities: ["scene.write"]
  },
  {
    name: "update_property",
    bridgeMethod: "godot.scene.update_property",
    description: "Update a node property in the current edited scene.",
    requiredCapabilities: ["scene.write"]
  },
  {
    name: "create_script",
    bridgeMethod: "godot.script.create",
    description: "Create a new GDScript file in the workspace.",
    requiredCapabilities: ["script.write"]
  },
  {
    name: "attach_script",
    bridgeMethod: "godot.script.attach",
    description: "Attach a script to a node in the current edited scene.",
    requiredCapabilities: ["script.write"]
  },
  {
    name: "clear_output_logs",
    bridgeMethod: "godot.logs.clear",
    description: "Clear addon console buffers and bridge log files.",
    exposeWhenNoSession: true
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
    description: "Summary of the current edited scene.",
    requiredCapabilities: ["editor.state"]
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

export function buildMcpCatalog(options: { capabilities?: CapabilityLookup | undefined } = {}): McpCatalog {
  const tools = listEnabledToolEntries(options).map((tool) => tool.name);
  const resources = listEnabledResourceEntries(options).map((resource) => resource.uri);
  return {
    tools,
    resources,
    prompts: []
  };
}

export function listEnabledToolEntries(options: {
  capabilities?: CapabilityLookup | undefined;
} = {}): McpToolCatalogEntry[] {
  return MCP_TOOLS.filter((entry) => isCatalogEntryEnabled(entry, options.capabilities));
}

export function listEnabledResourceEntries(options: {
  capabilities?: CapabilityLookup | undefined;
} = {}): McpResourceCatalogEntry[] {
  return MCP_RESOURCES.filter((entry) => isCatalogEntryEnabled(entry, options.capabilities));
}

export function isToolEntryEnabled(
  entry: McpToolCatalogEntry,
  capabilities?: CapabilityLookup
): boolean {
  return isCatalogEntryEnabled(entry, capabilities);
}

export function isResourceEntryEnabled(
  entry: McpResourceCatalogEntry,
  capabilities?: CapabilityLookup
): boolean {
  return isCatalogEntryEnabled(entry, capabilities);
}

function isCatalogEntryEnabled(
  entry: McpCatalogEntryBase,
  capabilities?: CapabilityLookup
): boolean {
  if (!capabilities) {
    return entry.exposeWhenNoSession === true;
  }

  const requiredCapabilities = entry.requiredCapabilities ?? [];
  return requiredCapabilities.every((capabilityId) => capabilities.hasCapability(capabilityId));
}
