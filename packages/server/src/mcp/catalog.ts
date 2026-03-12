export interface McpCatalog {
  tools: string[];
  resources: string[];
  prompts: string[];
}

export function buildMcpCatalog(): McpCatalog {
  return {
    tools: [
      "ping"
    ],
    resources: [
      "godot://project/info",
      "godot://scene/current"
    ],
    prompts: []
  };
}

