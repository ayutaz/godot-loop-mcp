/**
 * Daemon entry point.
 *
 * The daemon is a persistent process that:
 *   1. Runs the TCP bridge server for the Godot addon (port 6010 by default).
 *   2. Runs the control server for ephemeral proxy processes (port 6011).
 *   3. Manages addon session lifecycle and notifies proxies of changes.
 *   4. Writes a daemon.json info file so proxies can discover the running daemon.
 *   5. Cleans up the info file on graceful shutdown.
 */

import path from "node:path";
import fs from "node:fs";
import { createServer, type Server } from "node:net";
import { loadConfig } from "../config.ts";
import { Logger } from "../logger.ts";
import { AddonSession } from "../transport/addonSession.ts";
import { ControlServer } from "./controlServer.ts";
import type { DaemonInfo, SessionReadyNotification } from "./types.ts";

/* ------------------------------------------------------------------ */
/*  Configuration                                                      */
/* ------------------------------------------------------------------ */

const config = loadConfig();
const controlPort = numberFromEnv("GODOT_LOOP_MCP_CONTROL_PORT", (config as any).controlPort ?? 6011);
const logger = new Logger(path.join(config.logDir, "daemon.log"));
const daemonInfoPath = path.join(config.logDir, "daemon.json");

/* ------------------------------------------------------------------ */
/*  Session tracking                                                   */
/* ------------------------------------------------------------------ */

const sessions = new Set<AddonSession>();
let activeSession: AddonSession | undefined;

/* ------------------------------------------------------------------ */
/*  Control server                                                     */
/* ------------------------------------------------------------------ */

const controlServer = new ControlServer(logger, {
  getActiveSession: () => activeSession,
});

/* ------------------------------------------------------------------ */
/*  Bridge server for Godot addon                                      */
/* ------------------------------------------------------------------ */

const bridgeServer: Server = createServer((socket) => {
  const session = new AddonSession(
    socket,
    config,
    logger,
    (readySession) => {
      activeSession = readySession;

      const notification: SessionReadyNotification = {
        sessionId: readySession.getSessionId(),
        addonProduct: readySession.getAddonProduct(),
        securityLevel: readySession.getSecurityLevel(),
        capabilities: readySession
          .getAddonHello()
          ?.capabilities.capabilities.filter((c) => c.availability === "enabled")
          .map((c) => c.id),
      };
      controlServer.notifySessionReady(notification);

      logger.info("Addon session promoted to active.", {
        sessionId: readySession.getSessionId(),
      });
    },
    () => {
      sessions.delete(session);

      const wasActive = activeSession === session;
      const previousId = wasActive ? session.getSessionId() : undefined;

      if (wasActive) {
        activeSession = selectLatestReadySession(sessions);
      }

      if (previousId) {
        controlServer.notifySessionClosed({
          sessionId: previousId,
          reason: "Session closed.",
        });
      }
    },
  );
  sessions.add(session);
});

bridgeServer.on("error", (error) => {
  logger.error("Daemon bridge server failed.", { error: error.message });
  process.exitCode = 1;
});

/* ------------------------------------------------------------------ */
/*  Start listening                                                    */
/* ------------------------------------------------------------------ */

bridgeServer.listen(config.port, config.host, () => {
  logger.info("Daemon bridge server listening.", {
    host: config.host,
    port: config.port,
    logDir: config.logDir,
    securityLevel: config.securityLevel,
  });

  controlServer
    .listen(controlPort, config.host)
    .then(() => {
      logger.info("Daemon control server listening.", {
        host: config.host,
        port: controlPort,
      });
      writeDaemonInfo();
    })
    .catch((error) => {
      logger.error("Failed to start control server.", {
        error: error instanceof Error ? error.message : String(error),
      });
      process.exitCode = 1;
      bridgeServer.close();
    });
});

/* ------------------------------------------------------------------ */
/*  Daemon info file (proxy discovery)                                 */
/* ------------------------------------------------------------------ */

function writeDaemonInfo(): void {
  const info: DaemonInfo = {
    pid: process.pid,
    controlPort,
    bridgePort: config.port,
    startedAt: new Date().toISOString(),
  };

  try {
    fs.mkdirSync(path.dirname(daemonInfoPath), { recursive: true });
    fs.writeFileSync(daemonInfoPath, JSON.stringify(info, null, 2), "utf8");
    logger.info("Daemon info written.", { path: daemonInfoPath });
  } catch (error) {
    logger.error("Failed to write daemon info file.", {
      path: daemonInfoPath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function removeDaemonInfo(): void {
  try {
    fs.unlinkSync(daemonInfoPath);
    logger.info("Daemon info removed.", { path: daemonInfoPath });
  } catch {
    // File may already be gone -- not an error worth reporting.
  }
}

/* ------------------------------------------------------------------ */
/*  Graceful shutdown                                                  */
/* ------------------------------------------------------------------ */

let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  logger.info("Shutting down daemon.", {
    signal,
    activeSessions: sessions.size,
  });

  removeDaemonInfo();

  controlServer
    .close()
    .then(
      () => {
        bridgeServer.close(() => {
          logger.info("Daemon shutdown complete.");
          process.exit(0);
        });
      },
      (error) => {
        logger.error("Error closing control server during shutdown.", {
          error: error instanceof Error ? error.message : String(error),
        });
        bridgeServer.close(() => process.exit(1));
      },
    );
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => shutdown(signal));
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function selectLatestReadySession(
  allSessions: Iterable<AddonSession>,
): AddonSession | undefined {
  const readySessions = Array.from(allSessions).filter((s) => s.isReady());
  return readySessions.at(-1);
}

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
