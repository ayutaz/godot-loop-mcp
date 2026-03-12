import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

interface QuarantineEntry {
  originalPath: string;
  quarantinedPath: string;
}

export interface ProjectScanQuarantineState {
  quarantineRoot?: string;
  entries: QuarantineEntry[];
}

export async function suspendProjectScanConflicts(
  repoRoot: string
): Promise<ProjectScanQuarantineState> {
  const distRoot = path.join(repoRoot, "dist");
  try {
    const stat = await fs.stat(distRoot);
    if (!stat.isDirectory()) {
      return { entries: [] };
    }
  } catch {
    return { entries: [] };
  }

  const quarantineRoot = await fs.mkdtemp(path.join(os.tmpdir(), "godot-loop-mcp-scan-shield-"));
  const entries: QuarantineEntry[] = [];
  const distChildren = await fs.readdir(distRoot, { withFileTypes: true });

  for (const child of distChildren) {
    if (!child.isDirectory()) {
      continue;
    }

    const stagingPath = path.join(distRoot, child.name, "addon-staging");
    try {
      await fs.access(stagingPath);
    } catch {
      continue;
    }

    const quarantinedPath = path.join(quarantineRoot, `${child.name}-addon-staging`);
    await fs.rename(stagingPath, quarantinedPath);
    entries.push({
      originalPath: stagingPath,
      quarantinedPath
    });
  }

  return {
    quarantineRoot,
    entries
  };
}

export async function resumeProjectScanConflicts(
  state: ProjectScanQuarantineState
): Promise<void> {
  for (const entry of state.entries) {
    try {
      await fs.mkdir(path.dirname(entry.originalPath), { recursive: true });
      await fs.rename(entry.quarantinedPath, entry.originalPath);
    } catch {
      continue;
    }
  }

  if (state.quarantineRoot) {
    await fs.rm(state.quarantineRoot, { recursive: true, force: true });
  }
}
