import { buildMcpCatalog } from "../mcp/catalog.ts";
import type {
  CapabilityManifest,
  PeerHelloPayload,
  ReconnectPolicy,
  SecurityLevel
} from "../transport/types.ts";

export const PROTOCOL_VERSION = "0.1.0";
export const SERVER_VERSION = "0.1.0";
export const SERVER_SECURITY_LEVEL: SecurityLevel = "ReadOnly";

export function buildServerCapabilityManifest(): CapabilityManifest {
  return {
    schemaVersion: PROTOCOL_VERSION,
    securityLevel: SERVER_SECURITY_LEVEL,
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
        description: "Read-only MCP tool exposure is enabled."
      },
      {
        id: "mcp.resources",
        surface: "resource",
        availability: "enabled",
        description: "Core Godot resources are exposed in M1."
      }
    ]
  };
}

export function buildServerHello(input: {
  sessionId: string;
  repoRoot: string;
  heartbeatIntervalMs: number;
  reconnectPolicy: ReconnectPolicy;
}): PeerHelloPayload {
  return {
    sessionId: input.sessionId,
    protocolVersion: PROTOCOL_VERSION,
    role: "server",
    product: {
      name: "godot-loop-mcp-server",
      version: SERVER_VERSION
    },
    securityLevel: SERVER_SECURITY_LEVEL,
    capabilities: buildServerCapabilityManifest(),
    workspaceRoot: input.repoRoot,
    reconnectPolicy: input.reconnectPolicy,
    bridge: {
      heartbeatIntervalMs: input.heartbeatIntervalMs
    },
    mcp: buildMcpCatalog()
  };
}
