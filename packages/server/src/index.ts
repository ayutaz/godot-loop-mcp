import path from "node:path";
import { createServer } from "node:net";
import { loadConfig } from "./config.ts";
import { Logger } from "./logger.ts";
import { buildMcpCatalog } from "./mcp/catalog.ts";
import { createMcpBridgeServer } from "./mcp/server.ts";
import { AddonSession } from "./transport/addonSession.ts";

const config = loadConfig();
const logger = new Logger(path.join(config.logDir, "server.log"));
const sessions = new Set<AddonSession>();
let activeSession: AddonSession | undefined;
const mcpServer = config.bridgeOnlyMode
  ? undefined
  : createMcpBridgeServer({
      config,
      logger,
      getActiveSession: () => activeSession
    });

const server = createServer((socket) => {
  const session = new AddonSession(
    socket,
    config,
    logger,
    (readySession) => {
      activeSession = readySession;
      mcpServer?.syncCatalogSession(activeSession);
      logger.info("Addon session promoted to active.", {
        sessionId: readySession.getSessionId()
      });
    },
    () => {
      sessions.delete(session);
      if (activeSession === session) {
        activeSession = selectLatestReadySession(sessions);
      }
      mcpServer?.syncCatalogSession(activeSession);
    }
  );
  sessions.add(session);
});

server.on("error", (error) => {
  logger.error("Bridge server failed.", { error: error.message });
  process.exitCode = 1;
});

server.listen(config.port, config.host, () => {
  logger.info("godot-loop-mcp bridge server listening.", {
    host: config.host,
    port: config.port,
    logDir: config.logDir,
    bridgeOnlyMode: config.bridgeOnlyMode,
    securityLevel: config.securityLevel,
    mcpCatalog: buildMcpCatalog({ securityLevel: config.securityLevel })
  });
  if (!config.bridgeOnlyMode) {
    logger.info(
      "Running in unified mode. For persistent connections across MCP client restarts, use daemon+proxy mode.",
      { hint: "godot-loop-mcp-daemon + godot-loop-mcp-proxy" }
    );
  }
  if (mcpServer) {
    void mcpServer.connectStdio().catch((error) => {
      logger.error("Failed to start MCP stdio transport.", {
        error: error instanceof Error ? error.message : String(error)
      });
      process.exitCode = 1;
      server.close();
    });
  }
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => shutdown(signal));
}

function shutdown(signal: string): void {
  logger.info("Shutting down bridge server.", {
    signal,
    activeSessions: sessions.size
  });
  Promise.allSettled([mcpServer?.close() ?? Promise.resolve()]).finally(() => {
    server.close(() => {
      process.exit(0);
    });
  });
}

function selectLatestReadySession(allSessions: Iterable<AddonSession>): AddonSession | undefined {
  const readySessions = Array.from(allSessions).filter((session) => session.isReady());
  return readySessions.at(-1);
}
