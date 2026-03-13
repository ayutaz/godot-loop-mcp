import { buildMcpCatalog, type CapabilityLookup } from "../mcp/catalog.ts";
import type {
  CapabilityManifest,
  PeerHelloPayload,
  ReconnectPolicy,
  SecurityLevel
} from "../transport/types.ts";

export const PROTOCOL_VERSION = "0.1.0";
export const SERVER_VERSION = "0.1.1";

export function buildServerCapabilityManifest(securityLevel: SecurityLevel): CapabilityManifest {
  return {
    schemaVersion: PROTOCOL_VERSION,
    securityLevel,
    capabilities: [
      {
        id: "bridge.handshake",
        surface: "transport",
        availability: "enabled",
        description: "Negotiates addon and server identity."
      },
      {
        id: "bridge.ping",
        surface: "transport",
        availability: "enabled",
        description: "Verifies bridge liveness in both directions."
      },
      {
        id: "mcp.tools",
        surface: "tool",
        availability: "enabled",
        description: "WorkspaceWrite MCP tool exposure is enabled and filtered by addon capabilities."
      },
      {
        id: "mcp.resources",
        surface: "resource",
        availability: "enabled",
        description: "Core Godot resources are exposed dynamically for the current editor workspace."
      },
      {
        id: "mcp.prompts",
        surface: "resource",
        availability: "enabled",
        description: "User-controlled prompts and resource templates are exposed when addon capabilities allow them."
      }
    ]
  };
}

export function buildServerHello(input: {
  sessionId: string;
  repoRoot: string;
  heartbeatIntervalMs: number;
  reconnectPolicy: ReconnectPolicy;
  securityLevel: SecurityLevel;
  addonCapabilities?: CapabilityManifest;
}): PeerHelloPayload {
  const capabilityLookup = createCapabilityLookup(input.addonCapabilities);
  return {
    sessionId: input.sessionId,
    protocolVersion: PROTOCOL_VERSION,
    role: "server",
    product: {
      name: "godot-loop-mcp-server",
      version: SERVER_VERSION
    },
    securityLevel: input.securityLevel,
    capabilities: buildServerCapabilityManifest(input.securityLevel),
    workspaceRoot: input.repoRoot,
    reconnectPolicy: input.reconnectPolicy,
    bridge: {
      heartbeatIntervalMs: input.heartbeatIntervalMs
    },
    mcp: buildMcpCatalog({ capabilities: capabilityLookup, securityLevel: input.securityLevel })
  };
}

function createCapabilityLookup(
  manifest?: CapabilityManifest
): CapabilityLookup | undefined {
  if (!manifest) {
    return undefined;
  }

  const enabledCapabilities = new Set(
    manifest.capabilities
      .filter((capability) => capability.availability === "enabled")
      .map((capability) => capability.id)
  );
  return {
    hasCapability(capabilityId: string): boolean {
      return enabledCapabilities.has(capabilityId);
    }
  };
}
