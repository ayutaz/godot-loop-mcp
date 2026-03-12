# @godot-loop-mcp/server

TypeScript bridge server for `godot-loop-mcp`.

## Requirements

- Node.js `22.14.0+`

## Local development

```powershell
npm ci
npm run typecheck
npm run start
```

The server uses Node's `--experimental-strip-types` support and currently ships the source `.ts` files directly.

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

For the M6 dangerous-mode smoke:

```powershell
$env:GODOT_LOOP_MCP_GODOT_BIN = (Get-Command godot_console.exe).Source
npm run smoke:m6
```

The MCP catalog is capability-aware and security-aware. Before the addon session becomes ready, the server only exposes the fallback log surface. After handshake, it enables tools/resources/prompts/resource templates according to the addon capability manifest and the effective security level, and emits list-changed notifications through the SDK.

On `Godot 4.5+`, `get_output_logs` / `get_godot_errors` prefer the addon-side editor console ring buffer via `OS.add_logger()`. In headless `play_scene`, the addon launches an external runtime and returns `runtime-log-file` entries from `.godot/mcp/runtime.log` once output is available. On `Godot 4.4`, the server falls back to `.godot/mcp` addon/server logs when editor/runtime capture is unavailable.

Security and audit notes:

- `GODOT_LOOP_MCP_SECURITY_LEVEL` controls the server-side maximum level
- `GODOT_LOOP_MCP_ENABLE_EDITOR_SCRIPT`, `GODOT_LOOP_MCP_ALLOWED_WRITE_PREFIXES`, and `GODOT_LOOP_MCP_ALLOWED_SHELL_COMMANDS` are enforced by the addon for dangerous-mode tools
- `.godot/mcp/audit.log` records tool/resource/prompt access with hashed arguments and duration
- dangerous tools stay hidden unless both server and addon opt into `Dangerous`

Relevant guides:

- [docs/m4-local-development.md](/C:/Users/yuta/Desktop/Private/godot-loop-mcp/docs/m4-local-development.md)
- [docs/m5-local-development.md](/C:/Users/yuta/Desktop/Private/godot-loop-mcp/docs/m5-local-development.md)
- [docs/m6-local-development.md](/C:/Users/yuta/Desktop/Private/godot-loop-mcp/docs/m6-local-development.md)
