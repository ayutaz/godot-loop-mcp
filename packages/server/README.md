# @godot-loop-mcp/server

TypeScript bridge server for `godot-loop-mcp`.

## Requirements

- Node.js `22.14.0+`

## Install / run

From a Godot project root:

```powershell
npx @godot-loop-mcp/server
```

If the current directory is not the Godot project root, set `GODOT_LOOP_MCP_REPO_ROOT`.

## Local development

```powershell
npm ci
npm run typecheck
npm run dev
```

To verify the published entry locally:

```powershell
npm run build
npm run start
```

The published CLI runs from compiled JS in `dist/`. The source repo still uses Node's `--experimental-strip-types` flow for local development, and `prepack` rebuilds `dist/` before `npm pack` / `npm publish`.

Publishability checks:

```powershell
npm run pack:dry-run
npm run publish:dry-run
```

For the M1 read-only observation smoke:

```powershell
$env:GODOT_LOOP_MCP_GODOT_BIN = (Get-Command godot_console.exe).Source
npm run smoke:m1
```

For the M2 edit/play smoke:

```powershell
$env:GODOT_LOOP_MCP_GODOT_BIN = (Get-Command godot_console.exe).Source
npm run smoke:m2
```

For the M3 search / UID / dynamic catalog smoke:

```powershell
$env:GODOT_LOOP_MCP_GODOT_BIN = (Get-Command godot_console.exe).Source
npm run smoke:m3
```

For the M4 verification / prompts / template smoke:

```powershell
$env:GODOT_LOOP_MCP_GODOT_BIN = (Get-Command godot_console.exe).Source
npm run smoke:m4
```

For the M4 adapter-detection smoke:

```powershell
$env:GODOT_LOOP_MCP_GODOT_BIN = (Get-Command godot_console.exe).Source
npm run smoke:m4:adapters
```

For the M4 GUI screenshot / runtime-debug smoke:

```powershell
$env:GODOT_LOOP_MCP_GODOT_GUI_BIN = (Get-Command godot.exe).Source
npm run smoke:m4:gui
```

For the M6 dangerous-mode smoke:

```powershell
$env:GODOT_LOOP_MCP_GODOT_BIN = (Get-Command godot_console.exe).Source
npm run smoke:m6
```

The MCP catalog is capability-aware and security-aware. Before the addon session becomes ready, the server only exposes the fallback log surface. After handshake, it enables tools/resources/prompts/resource templates according to the addon capability manifest and the effective security level, and emits list-changed notifications through the SDK.

On `Godot 4.5+`, `get_output_logs` / `get_godot_errors` prefer the addon-side editor console ring buffer via `OS.add_logger()`. In headless `play_scene`, the addon launches an external runtime and returns `runtime-log-file` entries from `.godot/mcp/runtime.log` once output is available. On `Godot 4.4`, the server falls back to `.godot/mcp` addon/server logs when editor/runtime capture is unavailable.

Security and audit notes:

- `GODOT_LOOP_MCP_SECURITY_LEVEL` controls the server-side maximum level
- `GODOT_LOOP_MCP_REPO_ROOT` overrides workspace detection when the server is not launched from a Godot project root
- `GODOT_LOOP_MCP_ENABLE_EDITOR_SCRIPT`, `GODOT_LOOP_MCP_ALLOWED_WRITE_PREFIXES`, and `GODOT_LOOP_MCP_ALLOWED_SHELL_COMMANDS` are enforced by the addon for dangerous-mode tools
- `.godot/mcp/audit.log` records tool/resource/prompt access with hashed arguments and duration
- dangerous tools stay hidden unless both server and addon opt into `Dangerous`

Relevant guides:

- [docs/implementation-milestones.md](/C:/Users/yuta/Desktop/Private/godot-loop-mcp/docs/implementation-milestones.md)
- [docs/github-actions-cicd-plan.md](/C:/Users/yuta/Desktop/Private/godot-loop-mcp/docs/github-actions-cicd-plan.md)
