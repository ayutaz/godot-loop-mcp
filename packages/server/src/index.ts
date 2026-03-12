import path from "node:path";
import { createServer } from "node:net";
import { loadConfig } from "./config.ts";
import { Logger } from "./logger.ts";
import { buildMcpCatalog } from "./mcp/catalog.ts";
import { AddonSession } from "./transport/addonSession.ts";

const config = loadConfig();
const logger = new Logger(path.join(config.logDir, "server.log"));
const sessions = new Set<AddonSession>();

const server = createServer((socket) => {
  const session = new AddonSession(socket, config, logger, () => {
    sessions.delete(session);
  });
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
    mcpCatalog: buildMcpCatalog()
  });
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => shutdown(signal));
}

function shutdown(signal: string): void {
  logger.info("Shutting down bridge server.", {
    signal,
    activeSessions: sessions.size
  });
  server.close(() => {
    process.exit(0);
  });
}

