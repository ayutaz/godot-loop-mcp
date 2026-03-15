/**
 * Proxy entry point.
 *
 * The proxy is an ephemeral MCP stdio process spawned by Codex/Claude. It:
 *   1. Ensures the persistent daemon is running (launches it if needed).
 *   2. Connects to the daemon's control port via TCP.
 *   3. Creates the MCP server with an stdio transport for the AI client.
 *   4. Forwards addon requests through the daemon's control channel.
 *   5. Exits when the MCP client closes -- the daemon keeps running.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.ts";
import { Logger } from "../logger.ts";
import { createMcpBridgeServer } from "../mcp/server.ts";
import type { McpBridgeServerRuntime } from "../mcp/server.ts";
import { DaemonClient } from "./daemonClient.ts";
import { RemoteAddonSession } from "./remoteAddonSession.ts";
import { ensureDaemon } from "./launcher.ts";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Resolve the daemon entry point script.
 *
 * In dist mode the compiled JS file exists next to the proxy build output;
 * in dev mode we fall back to the TypeScript source (run via
 * --experimental-strip-types or tsx).
 */
function resolveDaemonScript(): string {
  const sourceDir = fileURLToPath(new URL(".", import.meta.url));
  const distDaemon = path.resolve(sourceDir, "..", "daemon", "index.js");
  if (fs.existsSync(distDaemon)) {
    return distDaemon;
  }
  return path.resolve(sourceDir, "..", "daemon", "index.ts");
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  const config = loadConfig();
  const controlPort = numberFromEnv("GODOT_LOOP_MCP_CONTROL_PORT", 6011);
  const logger = new Logger(path.join(config.logDir, "proxy.log"));

  logger.info("Proxy starting.", {
    host: config.host,
    bridgePort: config.port,
    controlPort,
    repoRoot: config.repoRoot,
    securityLevel: config.securityLevel,
  });

  /* -------------------------------------------------------------- */
  /*  1. Ensure the daemon is running                                */
  /* -------------------------------------------------------------- */

  const daemonInfo = await ensureDaemon(
    {
      logDir: config.logDir,
      host: config.host,
      bridgePort: config.port,
      controlPort,
      repoRoot: config.repoRoot,
      securityLevel: config.securityLevel,
      daemonScript: resolveDaemonScript(),
    },
    logger,
  );

  /* -------------------------------------------------------------- */
  /*  2. Connect to the daemon control port                          */
  /* -------------------------------------------------------------- */

  // Mutable holders so the DaemonClient event callbacks (set once at
  // construction) can reference objects created after the client.
  let remoteSession: RemoteAddonSession | undefined;
  let mcpServer: McpBridgeServerRuntime | undefined;

  const daemonClient = new DaemonClient(logger, {
    onSessionReady(notification) {
      remoteSession?.syncFromReady(notification);
      mcpServer?.syncCatalogSession(
        remoteSession?.isReady() ? (remoteSession as any) : undefined,
      );
    },
    onSessionClosed(_notification) {
      remoteSession?.clearSession();
      mcpServer?.syncCatalogSession(undefined);
    },
    onDisconnect(reason) {
      logger.error("Lost connection to daemon.", { reason });
      process.exit(1);
    },
  });

  await daemonClient.connect(daemonInfo.controlPort, config.host);
  await daemonClient.subscribe();

  /* -------------------------------------------------------------- */
  /*  3. Create remote session adapter                               */
  /* -------------------------------------------------------------- */

  remoteSession = new RemoteAddonSession(daemonClient);

  const sessionInfo = await daemonClient.getSessionInfo();
  if (sessionInfo.hasActiveSession) {
    remoteSession.syncFromInfo(sessionInfo);
  }

  /* -------------------------------------------------------------- */
  /*  4. Create MCP server wired to the remote session               */
  /* -------------------------------------------------------------- */

  mcpServer = createMcpBridgeServer({
    config,
    logger,
    getActiveSession: () =>
      remoteSession?.isReady() ? (remoteSession as any) : undefined,
  });

  /* -------------------------------------------------------------- */
  /*  5. Start MCP stdio transport                                   */
  /* -------------------------------------------------------------- */

  logger.info("Proxy starting MCP stdio transport.");
  mcpServer.syncCatalogSession(
    remoteSession.isReady() ? (remoteSession as any) : undefined,
  );
  await mcpServer.connectStdio();

  /* -------------------------------------------------------------- */
  /*  6. Detect parent exit via stdin close                           */
  /* -------------------------------------------------------------- */

  process.stdin.on("end", () => {
    logger.info("Proxy stdin closed (parent exited). Shutting down.");
    shutdown("stdin-end");
  });

  process.stdin.on("error", () => {
    // On Windows, stdin errors (EPIPE / EOF) are expected when the
    // parent process dies.  Treat the same as a clean close.
    shutdown("stdin-error");
  });

  /* -------------------------------------------------------------- */
  /*  7. Graceful shutdown (proxy only -- daemon keeps running)      */
  /* -------------------------------------------------------------- */

  let shuttingDown = false;

  function shutdown(signal: string): void {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info("Proxy shutting down.", { signal });
    daemonClient.close();
    (mcpServer?.close() ?? Promise.resolve()).finally(() => {
      process.exit(0);
    });
  }

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => shutdown(signal));
  }
}

/* ------------------------------------------------------------------ */
/*  Top-level entry                                                    */
/* ------------------------------------------------------------------ */

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  process.stderr.write(
    `[godot-loop-mcp][FATAL] Proxy failed to start: ${message}\n`,
  );
  if (stack) {
    process.stderr.write(`${stack}\n`);
  }

  process.exit(1);
});
