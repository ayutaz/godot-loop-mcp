# godot-loop-mcp

[日本語 README](README.md)

`godot-loop-mcp` is an MCP-based development toolchain for Godot 4.4+.  
It connects a Godot Editor addon and an external MCP server over a local TCP bridge so AI agents and external clients can observe, edit, run, and verify a Godot project.

## Features

- editor / runtime observation
- scene / node / script editing
- `play_scene` / `stop_scene` run loop
- project search, UID, selection, and focus tools
- tests, prompts, and resource templates
- capability-gated screenshot / runtime debug surface
- running scene tree / node / audio playback inspection
- security levels, audit log, and dangerous tool gating
- distribution through GitHub Releases and npm

## Supported stack

- Godot: `4.4+`
- Node.js: `22.14.0+`
- npm package: `@godot-loop-mcp/server`
- CI coverage: `4.4.1-stable` + the current latest stable `4.x` on Windows, with nightly coverage on Ubuntu as well
- Latest published version:
  - GitHub Release: `v0.3.0`
  - npm: `@godot-loop-mcp/server@0.3.0`

## Installation

### 1. Addon

Unpack `godot-loop-mcp-addon-*.zip` from GitHub Releases into `addons/godot_loop_mcp/` in your Godot project.

Then enable `Godot Loop MCP` in `Project Settings > Plugins`.

### 2. Server

```powershell
npm install --save-dev @godot-loop-mcp/server
```

If you launch from the Godot project root:

```powershell
npx @godot-loop-mcp/server
```

If not, set `GODOT_LOOP_MCP_REPO_ROOT` explicitly.

## Logging

- By default, CLI / editor-console output is limited to `Warn` and above, while detailed logs remain in `.godot/mcp/*.log`
- Override server / proxy / daemon thresholds with `GODOT_LOOP_MCP_CONSOLE_LOG_LEVEL` and `GODOT_LOOP_MCP_FILE_LOG_LEVEL`
- Override addon thresholds with `Project Settings > godot_loop_mcp/log/console_level` and `godot_loop_mcp/log/file_level`, or the same env vars

## Quick start

server:

```powershell
npx @godot-loop-mcp/server
```

Godot:

```powershell
godot_console.exe --headless --editor --quit-after 240 --path .
```

Expected signals:

- addon log contains `Bridge handshake completed`
- server log contains `Addon handshake completed`

## Repository layout

```text
addons/godot_loop_mcp/   Godot Editor addon
packages/server/         MCP bridge server
docs/                    operations, research, and release docs
.github/workflows/       CI/CD
```

## Development

```powershell
npm ci --prefix packages/server
npm --prefix packages/server run typecheck
```

Representative smoke commands:

```powershell
$env:GODOT_LOOP_MCP_GODOT_BIN = (Get-Command godot_console.exe).Source
npm --prefix packages/server run smoke:m1
npm --prefix packages/server run smoke:m2
npm --prefix packages/server run smoke:m3
npm --prefix packages/server run smoke:m4
npm --prefix packages/server run smoke:m6
```

GUI-only validation:

```powershell
$env:GODOT_LOOP_MCP_GODOT_GUI_BIN = (Get-Command godot.exe).Source
npm --prefix packages/server run smoke:m4:gui
```

## Runtime verification

- When you use `play_scene` in a GUI editor and configure `autoload/GodotLoopMcpRuntimeTelemetry`, you can use `get_running_scene_tree`, `get_running_node`, `get_running_node_property`, `wait_for_runtime_condition`, and `get_running_audio_players`
- Runtime inspection surfaces including `get_running_scene_screenshot`, `get_runtime_debug_events`, and `simulate_mouse` require a GUI editor session
- In a headless editor, `play_scene` launches an external runtime process, so MCP can primarily observe `.godot/mcp/runtime.log`
- Godot processes started directly from the shell do not auto-attach to MCP runtime capture

## Documentation

- implementation status and quick reference: [docs/implementation-milestones.md](docs/implementation-milestones.md)
- CI/CD operations: [docs/github-actions-cicd-plan.md](docs/github-actions-cicd-plan.md)
- Asset Library handoff: [docs/asset-library-release-checklist.md](docs/asset-library-release-checklist.md)
- archived design rationale: [docs/godot-4.4-mcp-technical-research.md](docs/godot-4.4-mcp-technical-research.md)
- server package details: [packages/server/README.md](packages/server/README.md)

## Current limitations

- `Godot 4.5+` prefers editor console capture, while `4.4` falls back to `.godot/mcp`
- screenshots and `runtime.debug` are capability-gated
- dangerous tools require explicit opt-in and allowlists
- Godot Asset Library publication is still a manual handoff

## License

Apache-2.0
