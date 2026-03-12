import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { SecurityLevel } from "./transport/types.ts";

export interface AuditEntry {
  timestamp: string;
  kind: "tool" | "resource" | "prompt";
  name: string;
  status: "success" | "error" | "denied";
  durationMs: number;
  argHash: string;
  sessionId?: string;
  addonName?: string;
  addonVersion?: string;
  addonSecurityLevel?: SecurityLevel;
  serverSecurityLevel: SecurityLevel;
  details?: Record<string, unknown>;
}

export class AuditLogger {
  private readonly logFilePath: string;
  private enabled = true;

  constructor(logFilePath: string) {
    this.logFilePath = logFilePath;
    try {
      fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
    } catch {
      this.enabled = false;
    }
  }

  record(entry: AuditEntry): void {
    if (!this.enabled) {
      return;
    }

    try {
      fs.appendFileSync(this.logFilePath, `${JSON.stringify(entry)}\n`, "utf8");
    } catch {
      this.enabled = false;
    }
  }
}

export function hashAuditArgs(args: unknown): string {
  const canonical = stableStringify(args);
  return createHash("sha256").update(canonical).digest("hex");
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      result[key] = sortValue((value as Record<string, unknown>)[key]);
      return result;
    }, {});
}
