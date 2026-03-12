import { randomUUID } from "node:crypto";
import type { Socket } from "node:net";
import { buildServerHello } from "../capabilities/serverManifest.ts";
import type { ServerConfig } from "../config.ts";
import type { Logger } from "../logger.ts";
import {
  FrameDecoder,
  encodeMessage,
  isObject,
  isRequest,
  isResponse,
  makeError,
  makeRequest,
  makeResponse
} from "./protocol.ts";
import type {
  BridgeMessage,
  BridgeRequest,
  BridgeResponse,
  HandshakeSyncParams,
  PeerHelloPayload,
  PingParams,
  PingResult
} from "./types.ts";

interface PendingRequest {
  method: string;
  sentAtMs: number;
}

export class AddonSession {
  private readonly sessionId = randomUUID();
  private readonly decoder = new FrameDecoder();
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly handshakeDeadline: NodeJS.Timeout;
  private readonly socket: Socket;
  private readonly config: ServerConfig;
  private readonly logger: Logger;
  private readonly onClose: () => void;
  private heartbeatInterval?: NodeJS.Timeout;
  private lastSeenAt = Date.now();
  private ready = false;
  private closed = false;
  private addonHello?: PeerHelloPayload;

  constructor(
    socket: Socket,
    config: ServerConfig,
    logger: Logger,
    onClose: () => void
  ) {
    this.socket = socket;
    this.config = config;
    this.logger = logger;
    this.onClose = onClose;
    this.socket.setNoDelay(true);
    this.socket.on("data", (chunk) => this.handleData(chunk));
    this.socket.on("error", (error) => {
      this.logger.error("Addon socket error.", {
        sessionId: this.sessionId,
        error: error.message
      });
    });
    this.socket.on("close", () => this.close("Socket closed."));
    this.handshakeDeadline = setTimeout(() => {
      this.failHandshake("Timed out waiting for addon hello.");
    }, this.config.handshakeTimeoutMs);

    this.logger.info("Addon connected.", {
      sessionId: this.sessionId,
      remoteAddress: this.socket.remoteAddress,
      remotePort: this.socket.remotePort
    });
  }

  private handleData(chunk: Buffer): void {
    this.lastSeenAt = Date.now();

    let messages: BridgeMessage[];
    try {
      messages = this.decoder.push(chunk);
    } catch (error) {
      this.logger.error("Failed to decode bridge frame.", {
        sessionId: this.sessionId,
        error: error instanceof Error ? error.message : String(error)
      });
      this.socket.destroy();
      return;
    }

    for (const message of messages) {
      this.handleMessage(message);
    }
  }

  private handleMessage(message: BridgeMessage): void {
    if (isRequest(message)) {
      this.handleRequest(message);
      return;
    }

    if (isResponse(message)) {
      this.handleResponse(message);
      return;
    }

    this.logger.warn("Ignoring unsupported notification.", {
      sessionId: this.sessionId,
      message
    });
  }

  private handleRequest(message: BridgeRequest): void {
    switch (message.method) {
      case "bridge.handshake.hello":
        this.handleHello(message);
        return;
      case "bridge.ping":
        this.handlePing(message);
        return;
      default:
        this.send(
          makeError(message.id, {
            code: -32601,
            message: "Method not found.",
            data: {
              method: message.method
            }
          })
        );
    }
  }

  private handleHello(message: BridgeRequest): void {
    if (!isObject(message.params)) {
      this.send(
        makeError(message.id, {
          code: -32602,
          message: "Invalid hello payload."
        })
      );
      return;
    }

    this.addonHello = message.params as PeerHelloPayload;
    const reconnectPolicy = {
      initialDelayMs: this.config.reconnectInitialDelayMs,
      maxDelayMs: this.config.reconnectMaxDelayMs,
      connectTimeoutMs: this.config.connectTimeoutMs,
      handshakeTimeoutMs: this.config.handshakeTimeoutMs,
      idleTimeoutMs: this.config.idleTimeoutMs
    };
    const serverHello = buildServerHello({
      sessionId: this.sessionId,
      repoRoot: this.config.repoRoot,
      heartbeatIntervalMs: this.config.heartbeatIntervalMs,
      reconnectPolicy
    });

    this.send(makeResponse(message.id, serverHello));
    this.logAddonCapabilities(this.addonHello);
    this.logger.info("Addon hello accepted.", {
      sessionId: this.sessionId,
      addon: this.addonHello.product,
      securityLevel: this.addonHello.securityLevel,
      workspaceRoot: this.addonHello.workspaceRoot
    });

    const syncRequest = makeRequest("bridge.handshake.sync", {
      sessionId: this.sessionId,
      acknowledgedAt: new Date().toISOString(),
      heartbeatIntervalMs: this.config.heartbeatIntervalMs
    } as HandshakeSyncParams);
    this.pendingRequests.set(syncRequest.id, {
      method: syncRequest.method,
      sentAtMs: Date.now()
    });
    this.send(syncRequest);
  }

  private handlePing(message: BridgeRequest): void {
    const params = isObject(message.params) ? (message.params as PingParams) : undefined;
    this.send(
      makeResponse(message.id, {
        nonce: params?.nonce ?? "",
        receivedAtMs: Date.now(),
        sessionId: this.sessionId,
        role: "server"
      } as PingResult)
    );
  }

  private handleResponse(message: BridgeResponse): void {
    const pending = this.pendingRequests.get(message.id);
    if (!pending) {
      return;
    }

    this.pendingRequests.delete(message.id);
    if (message.error) {
      this.logger.warn("Addon returned bridge error.", {
        sessionId: this.sessionId,
        method: pending.method,
        error: message.error
      });
      return;
    }

    if (pending.method === "bridge.handshake.sync") {
      clearTimeout(this.handshakeDeadline);
      this.ready = true;
      this.logger.info("Addon handshake completed.", {
        sessionId: this.sessionId,
        result: message.result
      });
      this.startHeartbeat();
      return;
    }

    if (pending.method === "bridge.ping") {
      this.logger.debug("Addon ping acknowledged.", {
        sessionId: this.sessionId,
        rttMs: Date.now() - pending.sentAtMs
      });
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.heartbeatInterval = setInterval(() => {
      if (Date.now() - this.lastSeenAt > this.config.idleTimeoutMs) {
        this.logger.warn("Addon session timed out.", {
          sessionId: this.sessionId,
          idleMs: Date.now() - this.lastSeenAt
        });
        this.socket.destroy();
        return;
      }

      const pingRequest = makeRequest("bridge.ping", {
        nonce: randomUUID(),
        sentAtMs: Date.now(),
        sessionId: this.sessionId,
        role: "server"
      } as PingParams);
      this.pendingRequests.set(pingRequest.id, {
        method: pingRequest.method,
        sentAtMs: Date.now()
      });
      this.send(pingRequest);
    }, this.config.heartbeatIntervalMs);
  }

  private send(message: BridgeMessage): void {
    this.socket.write(encodeMessage(message));
  }

  private failHandshake(reason: string): void {
    if (this.ready || this.closed) {
      return;
    }

    this.logger.warn("Handshake failed.", {
      sessionId: this.sessionId,
      reason
    });
    this.socket.destroy();
  }

  private logAddonCapabilities(hello: PeerHelloPayload): void {
    for (const capability of hello.capabilities.capabilities) {
      this.logger.info("Addon capability registered.", {
        sessionId: this.sessionId,
        capabilityId: capability.id,
        surface: capability.surface,
        availability: capability.availability
      });
    }
  }

  private close(reason: string): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    clearTimeout(this.handshakeDeadline);
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    this.pendingRequests.clear();
    this.logger.info("Addon session closed.", {
      sessionId: this.sessionId,
      ready: this.ready,
      reason
    });
    this.onClose();
  }
}
