export interface McpCatalog {
  tools: string[];
  resources: string[];
  prompts: string[];
}

export interface McpToolCatalogEntry {
  name: string;
  bridgeMethod?: string;
  description: string;
}

export interface McpResourceCatalogEntry {
  name: string;
  uri: string;
  description: string;
}

export const MCP_TOOLS: McpToolCatalogEntry[] = [
  {
    name: "get_project_info",
    bridgeMethod: "godot.project.get_info",
    description: "Return the active Godot project's metadata."
  },
  {
    name: "get_editor_state",
    bridgeMethod: "godot.editor.get_state",
    description: "Return the current editor state, selection, and active scene/script."
  },
  {
    name: "get_scene_tree",
    bridgeMethod: "godot.scene.get_tree",
    description: "Return the current edited scene tree."
  },
  {
    name: "find_nodes",
    bridgeMethod: "godot.scene.find_nodes",
    description: "Find nodes in the current edited scene by name."
  },
  {
    name: "get_open_scripts",
    bridgeMethod: "godot.script.get_open_scripts",
    description: "List the scripts currently open in the Godot editor."
  },
  {
    name: "view_script",
    bridgeMethod: "godot.script.view",
    description: "Read the current script or a script by path."
  },
  {
    name: "get_output_logs",
    description: "Read editor console logs when available, otherwise fall back to .godot/mcp."
  },
  {
    name: "get_godot_errors",
    description: "Read editor console errors when available, otherwise fall back to .godot/mcp."
  }
];

export const MCP_RESOURCES: McpResourceCatalogEntry[] = [
  {
    name: "project-info",
    uri: "godot://project/info",
    description: "Project metadata for the active Godot workspace."
  },
  {
    name: "scene-current",
    uri: "godot://scene/current",
    description: "Summary of the current edited scene."
  },
  {
    name: "scene-tree",
    uri: "godot://scene/tree",
    description: "Serialized tree for the current edited scene."
  },
  {
    name: "scripts-open",
    uri: "godot://scripts/open",
    description: "List of scripts currently open in the editor."
  },
  {
    name: "script-current",
    uri: "godot://script/current",
    description: "Source for the currently active script."
  },
  {
    name: "errors-latest",
    uri: "godot://errors/latest",
    description: "Latest error-level editor console logs with bridge-log fallback."
  }
];

export function buildMcpCatalog(): McpCatalog {
  return {
    tools: MCP_TOOLS.map((tool) => tool.name),
    resources: MCP_RESOURCES.map((resource) => resource.uri),
    prompts: []
  };
}
