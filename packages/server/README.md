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

The MCP tool/resource catalog is now capability-aware. Before the addon session becomes ready, the server only exposes the fallback log surface. After handshake, it enables tools/resources according to the addon capability manifest and emits list-changed notifications through the SDK.

On `Godot 4.5+`, `get_output_logs` / `get_godot_errors` prefer the addon-side editor console ring buffer via `OS.add_logger()`. In headless `play_scene`, the addon launches an external runtime and returns `runtime-log-file` entries from `.godot/mcp/runtime.log` once output is available. On `Godot 4.4`, the server falls back to `.godot/mcp` addon/server logs when editor/runtime capture is unavailable.
