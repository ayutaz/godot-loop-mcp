import { randomUUID } from "node:crypto";
import type {
  BridgeErrorObject,
  BridgeMessage,
  BridgeRequest,
  BridgeResponse
} from "./types.ts";

const MAX_FRAME_BYTES = 1024 * 1024;

export class FrameDecoder {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer): BridgeMessage[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages: BridgeMessage[] = [];

    while (this.buffer.length >= 4) {
      const payloadLength = this.buffer.readUInt32BE(0);
      if (payloadLength > MAX_FRAME_BYTES) {
        throw new Error(`Frame too large: ${payloadLength} bytes`);
      }

      if (this.buffer.length < payloadLength + 4) {
        break;
      }

      const payload = this.buffer.subarray(4, 4 + payloadLength).toString("utf8");
      const parsed = JSON.parse(payload);
      if (!isObject(parsed)) {
        throw new Error("Bridge frame must decode to a JSON object.");
      }

      messages.push(parsed as unknown as BridgeMessage);
      this.buffer = this.buffer.subarray(4 + payloadLength);
    }

    return messages;
  }
}

export function encodeMessage(message: BridgeMessage): Buffer {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  if (payload.length > MAX_FRAME_BYTES) {
    throw new Error(`Frame too large: ${payload.length} bytes`);
  }

  const header = Buffer.alloc(4);
  header.writeUInt32BE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

export function makeRequest(
  method: string,
  params: unknown = {},
  id: string = randomUUID()
): BridgeRequest {
  return {
    jsonrpc: "2.0",
    id,
    method,
    params
  };
}

export function makeResponse(id: string, result: unknown = {}): BridgeResponse {
  return {
    jsonrpc: "2.0",
    id,
    result
  };
}

export function makeError(id: string, error: BridgeErrorObject): BridgeResponse {
  return {
    jsonrpc: "2.0",
    id,
    error
  };
}

export function isRequest(message: BridgeMessage): message is BridgeRequest {
  return "id" in message && "method" in message;
}

export function isResponse(message: BridgeMessage): message is BridgeResponse {
  return "id" in message && !("method" in message);
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
