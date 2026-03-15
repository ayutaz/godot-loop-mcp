# godot-loop-mcp

[日本語 README](README.md)

`godot-loop-mcp` is an MCP-oriented development loop for Godot 4.4+.

- Godot Editor addon
- external MCP server
- local TCP bridge

The goal is to make `inspect -> edit -> run -> verify` practical in Godot.

## Current status

- The implementation surface for `M0` through `M6` is in the repository
- GitHub Release `v0.1.3` is published
- npm package `@godot-loop-mcp/server@0.1.3` is published
- The release workflow now completes GitHub Release and npm publish from `v*` tag pushes

## Quick start

Addon:

- unpack `godot-loop-mcp-addon-*.zip` from GitHub Releases into `addons/godot_loop_mcp/`
- enable `Godot Loop MCP` in `Project Settings > Plugins`

Server:

```powershell
npm install --save-dev @godot-loop-mcp/server
npx @godot-loop-mcp/server
```

Minimal Godot-side check:

```powershell
godot_console.exe --headless --editor --quit-after 240 --path .
```

Expected signals:

- addon log contains `Bridge handshake completed`
- server log contains `Addon handshake completed`

## Local development

```powershell
npm ci --prefix packages/server
npm --prefix packages/server run typecheck
```

Main smoke commands:

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

## Documentation

- implementation status and quick reference: [docs/implementation-milestones.md](docs/implementation-milestones.md)
- CI/CD operations: [docs/github-actions-cicd-plan.md](docs/github-actions-cicd-plan.md)
- Asset Library handoff: [docs/asset-library-release-checklist.md](docs/asset-library-release-checklist.md)
- archived research rationale: [docs/godot-4.4-mcp-technical-research.md](docs/godot-4.4-mcp-technical-research.md)

## Current limitations

- `Godot 4.5+` prefers editor console capture, while `4.4` falls back to `.godot/mcp`
- screenshots and `runtime.debug` are capability-gated
- dangerous tools require explicit opt-in and allowlists
- Godot Asset Library publication is still a manual handoff

## License

Apache-2.0
