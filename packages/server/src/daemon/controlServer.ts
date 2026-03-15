import { randomUUID } from "node:crypto";
import { createServer, type Server, type Socket } from "node:net";
import { Logger } from "../logger.ts";
import {
  FrameDecoder,
  encodeMessage,
  makeResponse,
  makeError,
  isRequest
} from "../transport/protocol.ts";
import type { BridgeMessage, BridgeRequest, BridgeNotification } from "../transport/types.ts";
import type { AddonSession } from "../transport/addonSession.ts";
import type {
  SessionInfoResult,
  AddonRequestParams,
  AddonRequestResult,
  SessionReadyNotification,
  SessionClosedNotification
} from "./types.ts";

export interface ControlServerCallbacks {
  getActiveSession: () => AddonSession | undefined;
}

interface ProxyConnection {
  id: string;
  socket: Socket;
  decoder: FrameDecoder;
  subscribed: boolean;
}

export class ControlServer {
  private readonly logger: Logger;
  private readonly callbacks: ControlServerCallbacks;
  private readonly proxies = new Map<string, ProxyConnection>();
  private server?: Server;

  constructor(logger: Logger, callbacks: ControlServerCallbacks) {
    this.logger = logger;
    this.callbacks = callbacks;
  }

  listen(port: number, host: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.server = createServer((socket) => this.handleConnection(socket));

      this.server.on("error", (error) => {
        this.logger.error("Control server error.", { error: error.message });
        reject(error);
      });

      this.server.listen(port, host, () => {
        this.logger.info("Control server listening.", { host, port });
        resolve();
      });
    });
  }

  close(): Promise<void> {
    return new Promise<void>((resolve) => {
      for (const proxy of this.proxies.values()) {
        proxy.socket.destroy();
      }
      this.proxies.clear();

      if (!this.server) {
        resolve();
        return;
      }

      this.server.close(() => {
        this.logger.info("Control server closed.");
        resolve();
      });
    });
  }

  notifySessionReady(notification: SessionReadyNotification): void {
    this.broadcast({
      jsonrpc: "2.0",
      method: "control.session.ready",
      params: notification
    });
  }

  notifySessionClosed(notification: SessionClosedNotification): void {
    this.broadcast({
      jsonrpc: "2.0",
      method: "control.session.closed",
      params: notification
    });
  }

  private handleConnection(socket: Socket): void {
    const proxyId = randomUUID();
    const decoder = new FrameDecoder();
    const proxy: ProxyConnection = {
      id: proxyId,
      socket,
      decoder,
      subscribed: false
    };

    this.proxies.set(proxyId, proxy);
    socket.setNoDelay(true);

    this.logger.info("Proxy connected.", {
      proxyId,
      remoteAddress: socket.remoteAddress,
      remotePort: socket.remotePort
    });

    socket.on("data", (chunk) => {
      this.handleData(proxy, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    socket.on("error", (error) => {
      this.logger.error("Proxy socket error.", {
        proxyId,
        error: error.message
      });
    });

    socket.on("close", () => {
      this.proxies.delete(proxyId);
      this.logger.info("Proxy disconnected.", { proxyId });
    });
  }

  private handleData(proxy: ProxyConnection, chunk: Buffer): void {
    let messages: BridgeMessage[];
    try {
      messages = proxy.decoder.push(chunk);
    } catch (error) {
      this.logger.error("Failed to decode control frame.", {
        proxyId: proxy.id,
        error: error instanceof Error ? error.message : String(error)
      });
      proxy.socket.destroy();
      return;
    }

    for (const message of messages) {
      if (isRequest(message)) {
        void this.handleRequest(proxy, message);
      } else {
        this.logger.warn("Ignoring non-request message from proxy.", {
          proxyId: proxy.id,
          message
        });
      }
    }
  }

  private async handleRequest(proxy: ProxyConnection, message: BridgeRequest): Promise<void> {
    switch (message.method) {
      case "control.session.info":
        this.handleSessionInfo(proxy, message);
        return;
      case "control.addon.request":
        await this.handleAddonRequest(proxy, message);
        return;
      case "control.subscribe":
        this.handleSubscribe(proxy, message);
        return;
      default:
        this.send(proxy, makeError(message.id, {
          code: -32601,
          message: "Method not found.",
          data: { method: message.method }
        }));
    }
  }

  private handleSessionInfo(proxy: ProxyConnection, message: BridgeRequest): void {
    const session = this.callbacks.getActiveSession();
    const result: SessionInfoResult = session
      ? {
          hasActiveSession: true,
          sessionId: session.getSessionId(),
          addonProduct: session.getAddonProduct(),
          securityLevel: session.getSecurityLevel(),
          capabilities: session.getAddonHello()?.capabilities.capabilities
            .filter((c) => c.availability === "enabled")
            .map((c) => c.id)
        }
      : { hasActiveSession: false };

    this.send(proxy, makeResponse(message.id, result));
  }

  private async handleAddonRequest(proxy: ProxyConnection, message: BridgeRequest): Promise<void> {
    const session = this.callbacks.getActiveSession();
    if (!session) {
      this.send(proxy, makeError(message.id, {
        code: -32002,
        message: "No active addon session."
      }));
      return;
    }

    const params = message.params as AddonRequestParams | undefined;
    if (!params?.method) {
      this.send(proxy, makeError(message.id, {
        code: -32602,
        message: "Missing required field: method."
      }));
      return;
    }

    try {
      const result = await session.request(params.method, params.params ?? {});
      const response: AddonRequestResult = { result };
      this.send(proxy, makeResponse(message.id, response));
    } catch (error) {
      this.send(proxy, makeError(message.id, {
        code: -32003,
        message: error instanceof Error ? error.message : String(error)
      }));
    }
  }

  private handleSubscribe(proxy: ProxyConnection, message: BridgeRequest): void {
    proxy.subscribed = true;
    this.logger.info("Proxy subscribed to session notifications.", {
      proxyId: proxy.id
    });
    this.send(proxy, makeResponse(message.id, { subscribed: true }));
  }

  private broadcast(notification: BridgeNotification): void {
    for (const proxy of this.proxies.values()) {
      if (!proxy.subscribed) {
        continue;
      }

      try {
        proxy.socket.write(encodeMessage(notification));
      } catch (error) {
        this.logger.error("Failed to send notification to proxy.", {
          proxyId: proxy.id,
          method: notification.method,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  private send(proxy: ProxyConnection, message: BridgeMessage): void {
    try {
      proxy.socket.write(encodeMessage(message));
    } catch (error) {
      this.logger.error("Failed to send message to proxy.", {
        proxyId: proxy.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}
