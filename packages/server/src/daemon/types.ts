/**
 * Control protocol types for Daemon ↔ Proxy communication.
 *
 * The control channel reuses the same length-prefixed JSON-RPC 2.0 framing
 * as the bridge protocol (transport/protocol.ts).
 */

/** Control-plane request methods sent from Proxy → Daemon. */
export type ControlRequestMethod =
  | "control.session.info"
  | "control.addon.request"
  | "control.subscribe";

/** Control-plane notification methods pushed from Daemon → Proxy. */
export type ControlNotificationMethod =
  | "control.session.ready"
  | "control.session.closed";

/* ------------------------------------------------------------------ */
/*  Proxy → Daemon request params                                     */
/* ------------------------------------------------------------------ */

/** Empty params – query current addon session state. */
export interface SessionInfoParams {
  /* intentionally empty */
}

export interface SessionInfoResult {
  hasActiveSession: boolean;
  sessionId?: string;
  addonProduct?: { name: string; version: string };
  securityLevel?: string;
  capabilities?: string[];
}

/** Forward an addon bridge request through the daemon. */
export interface AddonRequestParams {
  method: string;
  params: Record<string, unknown>;
}

export interface AddonRequestResult {
  result: unknown;
}

/** Subscribe to session lifecycle notifications. */
export interface SubscribeParams {
  /* intentionally empty */
}

export interface SubscribeResult {
  subscribed: boolean;
}

/* ------------------------------------------------------------------ */
/*  Daemon → Proxy notifications                                       */
/* ------------------------------------------------------------------ */

export interface SessionReadyNotification {
  sessionId: string;
  addonProduct?: { name: string; version: string };
  securityLevel?: string;
  capabilities?: string[];
}

export interface SessionClosedNotification {
  sessionId?: string;
  reason: string;
}

/* ------------------------------------------------------------------ */
/*  Daemon lifecycle                                                   */
/* ------------------------------------------------------------------ */

export interface DaemonInfo {
  pid: number;
  controlPort: number;
  bridgePort: number;
  startedAt: string;
}
