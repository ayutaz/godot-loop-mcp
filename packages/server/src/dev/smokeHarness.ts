import { setTimeout as delay } from "node:timers/promises";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";

export async function waitForProjectInfo(client: Client, timeoutMs: number): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tools = await client.listTools();
    if (!tools.tools.some((tool) => tool.name === "get_project_info")) {
      await delay(500);
      continue;
    }

    const result = await callToolJson(client, "get_project_info", undefined, { allowToolError: true });
    if (!result.isError) {
      return result.payload;
    }

    await delay(1_000);
  }

  throw new Error("Addon session did not become ready.");
}

export async function waitForToolVisibility(
  client: Client,
  toolName: string,
  expectedVisible: boolean,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tools = await client.listTools();
    const visible = tools.tools.some((tool) => tool.name === toolName);
    if (visible === expectedVisible) {
      return;
    }

    await delay(500);
  }

  throw new Error(`Tool visibility for ${toolName} did not become ${expectedVisible}.`);
}

export async function waitForSuccessfulToolCall(
  client: Client,
  name: string,
  args: Record<string, unknown> | undefined,
  timeoutMs: number
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  let lastErrorPayload: Record<string, unknown> | undefined;
  while (Date.now() < deadline) {
    const result = await callToolJson(client, name, args, { allowToolError: true });
    if (!result.isError) {
      return result.payload;
    }

    lastErrorPayload = result.payload;
    await delay(500);
  }

  throw new Error(`${name} did not succeed before timeout. lastError=${JSON.stringify(lastErrorPayload ?? {})}`);
}

export async function waitForRuntimeEvents(
  client: Client,
  timeoutMs: number
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await callToolJson(client, "get_runtime_debug_events", { limit: 20 }, { allowToolError: true });
    if (!result.isError && Array.isArray(result.payload.entries) && result.payload.entries.length > 0) {
      return result.payload;
    }

    await delay(500);
  }

  throw new Error("Runtime debug events did not arrive before timeout.");
}

export async function callToolJson(
  client: Client,
  name: string,
  args?: Record<string, unknown>,
  options: {
    allowToolError?: boolean;
  } = {}
): Promise<{ payload: Record<string, unknown>; isError: boolean }> {
  const result = await client.callTool({
    name,
    arguments: args ?? {}
  });
  const content = Array.isArray(result.content)
    ? (result.content as Array<{ type: string; text?: string }>)
    : [];
  const payload = isRecord(result.structuredContent)
    ? result.structuredContent
    : parseToolPayload(content);
  if (result.isError && !options.allowToolError) {
    throw new Error(`${name} returned an MCP tool error: ${JSON.stringify(payload)}`);
  }

  return {
    payload,
    isError: !!result.isError
  };
}

export async function readResourceJson(client: Client, uri: string): Promise<Record<string, unknown>> {
  const result = await client.readResource({ uri });
  const textResource = result.contents.find((content) => "text" in content && typeof content.text === "string");
  if (!textResource || !("text" in textResource)) {
    throw new Error(`Resource ${uri} did not return JSON text.`);
  }

  const parsed = JSON.parse(textResource.text) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`Resource ${uri} returned a non-object JSON payload.`);
  }

  return parsed;
}

export function parseToolPayload(content: Array<{ type: string; text?: string }>): Record<string, unknown> {
  const textBlock = content.find((item) => item.type === "text" && typeof item.text === "string");
  if (!textBlock?.text) {
    throw new Error("Tool result did not contain a text payload.");
  }

  const parsed = JSON.parse(textBlock.text) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`Tool result was not a JSON object: ${textBlock.text}`);
  }

  return parsed;
}

export function assertContains(values: string[], expected: string, label: string): void {
  if (!values.includes(expected)) {
    throw new Error(`${label} is missing ${expected}. actual=${JSON.stringify(values)}`);
  }
}

export function assertNotContains(values: string[], expected: string, label: string): void {
  if (values.includes(expected)) {
    throw new Error(`${label} should not include ${expected}. actual=${JSON.stringify(values)}`);
  }
}

export function assertString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string. actual=${JSON.stringify(value)}`);
  }

  return value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
