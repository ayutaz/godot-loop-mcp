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

On `Godot 4.5+`, `get_output_logs` / `get_godot_errors` prefer the addon-side editor console ring buffer via `OS.add_logger()`. On `Godot 4.4`, they fall back to `.godot/mcp` addon/server logs.
