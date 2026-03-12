export type SecurityLevel = "ReadOnly" | "WorkspaceWrite" | "Dangerous";

export interface CapabilityEntry {
  id: string;
  surface: "transport" | "resource" | "tool" | "runtime" | "security";
  availability: "enabled" | "planned" | "disabled";
  description: string;
}

export interface CapabilityManifest {
  schemaVersion: string;
  securityLevel: SecurityLevel;
  capabilities: CapabilityEntry[];
}

export interface ReconnectPolicy {
  initialDelayMs: number;
  maxDelayMs: number;
  connectTimeoutMs: number;
  handshakeTimeoutMs: number;
  idleTimeoutMs: number;
}

export interface PeerHelloPayload {
  sessionId?: string;
  protocolVersion: string;
  role: "addon" | "server";
  product: {
    name: string;
    version: string;
  };
  securityLevel: SecurityLevel;
  capabilities: CapabilityManifest;
  workspaceRoot: string;
  reconnectPolicy: ReconnectPolicy;
  godot?: {
    version: string;
    editor: boolean;
  };
  bridge?: {
    heartbeatIntervalMs: number;
  };
  mcp?: {
    tools: string[];
    resources: string[];
    prompts: string[];
  };
}

export interface PingParams {
  nonce: string;
  sentAtMs: number;
  sessionId?: string;
  role: "addon" | "server";
}

export interface PingResult {
  nonce: string;
  receivedAtMs: number;
  sessionId?: string;
  role: "addon" | "server";
}

export interface HandshakeSyncParams {
  sessionId: string;
  acknowledgedAt: string;
  heartbeatIntervalMs: number;
}

export interface HandshakeSyncResult {
  sessionId: string;
  state: "ready";
  role: "addon" | "server";
}

export interface BridgeErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface BridgeRequest {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params?: unknown;
}

export interface BridgeNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface BridgeResponse {
  jsonrpc: "2.0";
  id: string;
  result?: unknown;
  error?: BridgeErrorObject;
}

export type BridgeMessage = BridgeRequest | BridgeNotification | BridgeResponse;
