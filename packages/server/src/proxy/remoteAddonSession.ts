import type { DaemonClient } from "./daemonClient.ts";
import type { SessionInfoResult, SessionReadyNotification } from "../daemon/types.ts";
import type { PeerHelloPayload, SecurityLevel } from "../transport/types.ts";

/**
 * Adapter that presents an AddonSession-compatible interface to the MCP server
 * while delegating all calls through the DaemonClient control connection.
 *
 * Cached fields are populated via {@link syncFromInfo} (initial query) and
 * {@link syncFromReady} (live notification), and cleared via
 * {@link clearSession} when the daemon reports the addon session has closed.
 */
export class RemoteAddonSession {
  private readonly daemonClient: DaemonClient;

  private _hasActiveSession = false;
  private _sessionId = "";
  private _capabilities: string[] = [];
  private _securityLevel: SecurityLevel = "ReadOnly";
  private _addonProduct: { name: string; version: string } | undefined;

  constructor(daemonClient: DaemonClient) {
    this.daemonClient = daemonClient;
  }

  /* ------------------------------------------------------------------ */
  /*  Cache synchronisation                                              */
  /* ------------------------------------------------------------------ */

  /** Populate cached state from a `control.session.info` response. */
  syncFromInfo(info: SessionInfoResult): void {
    this._hasActiveSession = info.hasActiveSession;
    this._sessionId = info.sessionId ?? "";
    this._capabilities = info.capabilities ?? [];
    this._securityLevel = parseSecurityLevel(info.securityLevel);
    this._addonProduct = info.addonProduct;
  }

  /** Populate cached state when the daemon pushes a session-ready notification. */
  syncFromReady(notification: SessionReadyNotification): void {
    this._hasActiveSession = true;
    this._sessionId = notification.sessionId;
    this._capabilities = notification.capabilities ?? [];
    this._securityLevel = parseSecurityLevel(notification.securityLevel);
    this._addonProduct = notification.addonProduct;
  }

  /** Clear all cached state (e.g. when the addon session closes). */
  clearSession(): void {
    this._hasActiveSession = false;
    this._sessionId = "";
    this._capabilities = [];
    this._securityLevel = "ReadOnly";
    this._addonProduct = undefined;
  }

  /* ------------------------------------------------------------------ */
  /*  AddonSession-compatible interface                                  */
  /* ------------------------------------------------------------------ */

  getSessionId(): string {
    return this._sessionId;
  }

  isReady(): boolean {
    return this.daemonClient.isConnected() && this._hasActiveSession;
  }

  getAddonHello(): PeerHelloPayload | undefined {
    if (!this._hasActiveSession) {
      return undefined;
    }

    return {
      sessionId: this._sessionId,
      protocolVersion: "1.0",
      role: "addon",
      product: this._addonProduct ?? { name: "unknown", version: "0.0.0" },
      securityLevel: this._securityLevel,
      capabilities: {
        schemaVersion: "1",
        securityLevel: this._securityLevel,
        capabilities: this._capabilities.map((id) => ({
          id,
          surface: "runtime" as const,
          availability: "enabled" as const,
          description: ""
        }))
      },
      workspaceRoot: "",
      reconnectPolicy: {
        initialDelayMs: 1000,
        maxDelayMs: 30000,
        connectTimeoutMs: 5000,
        handshakeTimeoutMs: 5000,
        idleTimeoutMs: 60000
      }
    };
  }

  hasCapability(capabilityId: string): boolean {
    return this._capabilities.includes(capabilityId);
  }

  getSecurityLevel(): SecurityLevel {
    return this._securityLevel;
  }

  getAddonProduct(): { name: string; version: string } | undefined {
    return this._addonProduct;
  }

  request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return this.daemonClient.addonRequest<T>(method, params);
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const VALID_SECURITY_LEVELS: SecurityLevel[] = ["ReadOnly", "WorkspaceWrite", "Dangerous"];

function parseSecurityLevel(raw: string | undefined): SecurityLevel {
  if (raw && (VALID_SECURITY_LEVELS as string[]).includes(raw)) {
    return raw as SecurityLevel;
  }
  return "ReadOnly";
}
