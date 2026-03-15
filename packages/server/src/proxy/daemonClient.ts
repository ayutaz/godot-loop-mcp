import net from "node:net";
import type { Logger } from "../logger.ts";
import type {
  SessionInfoResult,
  AddonRequestParams,
  AddonRequestResult,
  SessionReadyNotification,
  SessionClosedNotification
} from "../daemon/types.ts";
import {
  FrameDecoder,
  encodeMessage,
  makeRequest,
  isResponse
} from "../transport/protocol.ts";
import type {
  BridgeMessage,
  BridgeResponse,
  BridgeNotification
} from "../transport/types.ts";

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export interface DaemonClientEvents {
  onSessionReady?: (notification: SessionReadyNotification) => void;
  onSessionClosed?: (notification: SessionClosedNotification) => void;
  onDisconnect?: (reason: string) => void;
}

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export class DaemonClient {
  private readonly logger: Logger;
  private readonly events: DaemonClientEvents;
  private readonly decoder = new FrameDecoder();
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private socket: net.Socket | null = null;
  private connected = false;

  constructor(logger: Logger, events: DaemonClientEvents = {}) {
    this.logger = logger;
    this.events = events;
  }

  connect(port: number, host: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.socket) {
        reject(new Error("DaemonClient is already connected."));
        return;
      }

      const socket = net.createConnection({ port, host });
      socket.setNoDelay(true);

      socket.on("connect", () => {
        this.socket = socket;
        this.connected = true;
        this.logger.info("Connected to daemon control port.", { port, host });
        resolve();
      });

      socket.on("data", (chunk) => {
        this.handleData(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });

      socket.on("error", (error) => {
        if (!this.connected) {
          reject(new Error(`Failed to connect to daemon: ${error.message}`));
          return;
        }

        this.logger.error("Daemon control socket error.", {
          error: error.message
        });
      });

      socket.on("close", () => {
        const wasConnected = this.connected;
        this.connected = false;
        this.socket = null;
        this.rejectAllPending("Daemon control connection closed.");

        if (wasConnected) {
          this.logger.info("Disconnected from daemon control port.");
          this.events.onDisconnect?.("Daemon control connection closed.");
        }
      });
    });
  }

  getSessionInfo(): Promise<SessionInfoResult> {
    return this.sendRequest<SessionInfoResult>("control.session.info");
  }

  addonRequest<T = unknown>(method: string, params: Record<string, unknown>): Promise<T> {
    const controlParams: AddonRequestParams = { method, params };
    return this.sendRequest<AddonRequestResult>("control.addon.request", controlParams as unknown as Record<string, unknown>).then(
      (result) => result.result as T
    );
  }

  subscribe(): Promise<void> {
    return this.sendRequest<{ subscribed: boolean }>("control.subscribe").then(() => {
      this.logger.info("Subscribed to daemon session notifications.");
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  close(): void {
    if (!this.socket) {
      return;
    }

    this.rejectAllPending("DaemonClient closed.");
    this.socket.destroy();
    this.socket = null;
    this.connected = false;
  }

  private sendRequest<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.connected || !this.socket) {
      return Promise.reject(new Error("DaemonClient is not connected."));
    }

    const request = makeRequest(method, params);
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(request.id);
        reject(new Error(`Daemon request timed out: ${method}`));
      }, DEFAULT_REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(request.id, {
        resolve: (result) => resolve(result as T),
        reject,
        timeout
      });

      this.socket!.write(encodeMessage(request));
    });
  }

  private handleData(chunk: Buffer): void {
    let messages: BridgeMessage[];
    try {
      messages = this.decoder.push(chunk);
    } catch (error) {
      this.logger.error("Failed to decode daemon control frame.", {
        error: error instanceof Error ? error.message : String(error)
      });
      this.socket?.destroy();
      return;
    }

    for (const message of messages) {
      this.handleMessage(message);
    }
  }

  private handleMessage(message: BridgeMessage): void {
    if (isResponse(message)) {
      this.handleResponse(message);
      return;
    }

    if (this.isNotification(message)) {
      this.handleNotification(message);
      return;
    }

    this.logger.warn("Ignoring unexpected message from daemon.", { message });
  }

  private handleResponse(message: BridgeResponse): void {
    const pending = this.pendingRequests.get(message.id);
    if (!pending) {
      this.logger.warn("Received response for unknown request.", { id: message.id });
      return;
    }

    this.pendingRequests.delete(message.id);
    clearTimeout(pending.timeout);

    if (message.error) {
      pending.reject(
        new Error(
          `Daemon error: ${message.error.message}${
            message.error.data ? ` ${JSON.stringify(message.error.data)}` : ""
          }`
        )
      );
      return;
    }

    pending.resolve(message.result);
  }

  private handleNotification(message: BridgeNotification): void {
    switch (message.method) {
      case "control.session.ready":
        this.logger.info("Daemon reports session ready.", { params: message.params });
        this.events.onSessionReady?.(message.params as SessionReadyNotification);
        return;
      case "control.session.closed":
        this.logger.info("Daemon reports session closed.", { params: message.params });
        this.events.onSessionClosed?.(message.params as SessionClosedNotification);
        return;
      default:
        this.logger.warn("Unknown daemon notification.", { method: message.method });
    }
  }

  private isNotification(message: BridgeMessage): message is BridgeNotification {
    return "method" in message && !("id" in message);
  }

  private rejectAllPending(reason: string): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(reason));
    }
    this.pendingRequests.clear();
  }
}
