import net from "node:net";

interface ProjectSettingEntry {
  sectionName: string;
  entryPrefix: string;
  entryValue: string;
}

export async function resolveBridgePort(
  defaultPort: number,
  smokeLabel: string
): Promise<number> {
  const explicitPort = process.env.GODOT_LOOP_MCP_SMOKE_BRIDGE_PORT ?? process.env.GODOT_LOOP_MCP_PORT;
  if (explicitPort) {
    const parsed = Number(explicitPort);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      throw new Error(`Invalid bridge port override for ${smokeLabel}: ${explicitPort}`);
    }
    return parsed;
  }

  const preferredPort = await tryListenOnPort(defaultPort);
  if (preferredPort !== undefined) {
    return preferredPort;
  }

  const ephemeralPort = await tryListenOnPort(0);
  if (ephemeralPort === undefined) {
    throw new Error(`Failed to allocate an available bridge port for ${smokeLabel}.`);
  }
  return ephemeralPort;
}

export function patchProjectFile(
  projectFile: string,
  entries: ProjectSettingEntry[]
): string {
  const newline = projectFile.includes("\r\n") ? "\r\n" : "\n";
  const lines = projectFile.split(/\r?\n/u);
  for (const entry of entries) {
    upsertSectionEntry(lines, entry.sectionName, entry.entryPrefix, entry.entryValue);
  }
  return lines.join(newline);
}

function tryListenOnPort(port: number): Promise<number | undefined> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => {
      resolve(undefined);
    });
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const resolvedPort = typeof address === "object" && address ? address.port : undefined;
      server.close(() => resolve(resolvedPort));
    });
  });
}

function upsertSectionEntry(
  lines: string[],
  sectionName: string,
  entryPrefix: string,
  entryValue: string
): void {
  const header = `[${sectionName}]`;
  const sectionIndex = lines.findIndex((line) => line.trim() === header);
  if (sectionIndex >= 0) {
    let cursor = sectionIndex + 1;
    while (cursor < lines.length && !lines[cursor].startsWith("[")) {
      if (lines[cursor].startsWith(entryPrefix)) {
        lines[cursor] = entryValue;
        return;
      }
      cursor += 1;
    }
    lines.splice(cursor, 0, entryValue);
    return;
  }

  const needsTrailingNewline = lines.length > 0 && lines[lines.length - 1] !== "";
  if (needsTrailingNewline) {
    lines.push("");
  }
  lines.push(header, entryValue);
}
