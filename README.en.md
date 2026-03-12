# godot-loop-mcp

[日本語 README](README.md)

`godot-loop-mcp` is an MCP-oriented development loop for Godot 4.4+.

The project is intended to provide:

- a Godot Editor addon for live editor / runtime introspection
- an external MCP server for tools, resources, and prompts
- an AI development loop for inspect -> edit -> run -> verify workflows

## Status

This repository now has the implementation surface for `M0` through `M6`, and the remaining repo-side work is effectively closed. The last open item is the npm-side trusted publisher registration.

The current baseline is a minimal `Godot Editor Addon + External MCP Server + Local TCP Bridge` design inspired by Unity's uLoopMCP:

- Implemented: addon skeleton, TypeScript server skeleton, `handshake`, bidirectional `ping`, capability manifest, reconnect policy
- Implemented: GitHub Actions `ci`, `nightly-compat`, `release`, reusable workflows, packaging scripts, and release assets
- Implemented: `M1` read-only observation tools/resources, stdio MCP server, `typecheck`, `smoke:m1`, and MCP tool error hardening
- Implemented: `M2` scene/node/script write tools, `play_scene` / `stop_scene`, `clear_output_logs`, and `smoke:m2`
- Implemented: `M3` `search_project`, `get_uid`, `resolve_uid`, `resave_resources`, `get_selection`, `set_selection`, `focus_node`, and `smoke:m3`
- Implemented: `M4` `run_tests`, dynamic prompts, resource templates, capability-gated screenshot/runtime debug surface, and `smoke:m4`
- Implemented: `M5` security level enforcement and `.godot/mcp/audit.log`
- Implemented: `M6` `execute_editor_script`, `filesystem_write_raw`, `os_shell`, allowlist/opt-in gating, and `smoke:m6`
- Implemented: capability-aware dynamic MCP tool/resource exposure; when no addon session is ready, only the fallback log surface remains visible
- Implemented: `Godot 4.5+` editor console capture via `OS.add_logger()`, headless play output via `.godot/mcp/runtime.log`, and `.godot/mcp` fallback on `4.4`
- Implemented: GitHub Actions `run_tests` smoke and `test-reports` artifacts, plus a publishable `packages/server` contract
- External setup pending: npm-side trusted publisher registration
- Roadmap: [docs/implementation-milestones.md](/C:/Users/yuta/Desktop/Private/godot-loop-mcp/docs/implementation-milestones.md)
- CI/CD plan: [docs/github-actions-cicd-plan.md](/C:/Users/yuta/Desktop/Private/godot-loop-mcp/docs/github-actions-cicd-plan.md)

## M0 Bootstrap

The initial M0 bridge scaffolding is implemented and smoke-tested.

- Details: [docs/implementation-milestones.md](/C:/Users/yuta/Desktop/Private/godot-loop-mcp/docs/implementation-milestones.md) `M0`
- Milestones: [docs/implementation-milestones.md](/C:/Users/yuta/Desktop/Private/godot-loop-mcp/docs/implementation-milestones.md)
- Asset Library checklist: [docs/asset-library-release-checklist.md](/C:/Users/yuta/Desktop/Private/godot-loop-mcp/docs/asset-library-release-checklist.md)

Verified minimal smoke test:

```powershell
npm --prefix packages/server run start
godot_console.exe --headless --editor --quit-after 240 --path .
```

Locally verified CI-parity commands:

```powershell
npm ci --prefix packages/server
./scripts/actions/run-server-bootstrap.ps1 -RepoRoot $PWD.Path
./scripts/actions/run-bridge-smoke.ps1 -RepoRoot $PWD.Path -GodotBinaryPath (Get-Command godot_console.exe).Source
```

As of 2026-03-13, GitHub Actions defines:

- PR / `main`: `server-check`, `bridge-smoke`, `verification-smoke`
- nightly: `windows-latest`, `ubuntu-latest` x `4.4.1-stable`, `4.5.1-stable`
- release: smoke, `test-reports`, addon ZIP, server tarball, `SHA256SUMS`, GitHub Release asset upload, and manual `publish-npm`

## M1 Observation

The M1 read-only observation surface and hardening pass are now implemented.

- Details: [docs/implementation-milestones.md](/C:/Users/yuta/Desktop/Private/godot-loop-mcp/docs/implementation-milestones.md) `M1`
- tools: `get_project_info`, `get_editor_state`, `get_scene_tree`, `find_nodes`, `get_open_scripts`, `view_script`, `get_output_logs`, `get_godot_errors`
- resources: `godot://project/info`, `godot://scene/current`, `godot://scene/tree`, `godot://scripts/open`, `godot://script/current`, `godot://errors/latest`
- logs: `Godot 4.5+` prefers the addon ring buffer, while `Godot 4.4` falls back to `.godot/mcp` addon/server logs

Verified commands:

```powershell
npm --prefix packages/server run typecheck
$env:GODOT_LOOP_MCP_GODOT_BIN = (Get-Command godot_console.exe).Source
npm --prefix packages/server run smoke:m1
```

## M2 Edit/Play

The M2 edit/play loop is now implemented.

- Details: [docs/implementation-milestones.md](/C:/Users/yuta/Desktop/Private/godot-loop-mcp/docs/implementation-milestones.md) `M2`
- tools: `create_scene`, `open_scene`, `save_scene`, `play_scene`, `stop_scene`, `add_node`, `move_node`, `delete_node`, `update_property`, `create_script`, `attach_script`, `clear_output_logs`
- security level: `WorkspaceWrite`
- headless play: launches a separate Godot runtime process and writes runtime output to `.godot/mcp/runtime.log`
- logs: when external play output exists, `get_output_logs` / `get_godot_errors` return the `runtime-log-file` backend

Verified commands:

```powershell
npm --prefix packages/server run typecheck
$env:GODOT_LOOP_MCP_GODOT_BIN = (Get-Command godot_console.exe).Source
npm --prefix packages/server run smoke:m2
```

## M3 Search/UID

The M3 search / UID / dynamic capability surface is now implemented.

- Details: [docs/implementation-milestones.md](/C:/Users/yuta/Desktop/Private/godot-loop-mcp/docs/implementation-milestones.md) `M3`
- tools: `search_project`, `get_uid`, `resolve_uid`, `resave_resources`, `get_selection`, `set_selection`, `focus_node`
- resources: `godot://selection/current`
- dynamic catalog: before the addon session becomes ready, only `clear_output_logs`, `get_output_logs`, `get_godot_errors`, and `godot://errors/latest` remain exposed; after handshake, tools/resources expand based on enabled capabilities
- search modes: `path`, `type`, `text`

Verified commands:

```powershell
npm --prefix packages/server run typecheck
$env:GODOT_LOOP_MCP_GODOT_BIN = (Get-Command godot_console.exe).Source
npm --prefix packages/server run smoke:m3
```

## M4 Verification

The M4 verification loop hardening is implemented.

- Details: [docs/implementation-milestones.md](/C:/Users/yuta/Desktop/Private/godot-loop-mcp/docs/implementation-milestones.md) `M4`
- tools: `run_tests`, `get_editor_screenshot`, `get_running_scene_screenshot`, `get_runtime_debug_events`, `clear_runtime_debug_events`
- prompts: `godot_editor_strategy`, `godot_ui_layout_strategy`, `godot_debug_loop`, `godot_scene_edit_safety`
- resource templates: `godot://scene/{path}`, `godot://script/{path}`, `godot://node/{scenePath}/{nodePath}`, `godot://resource/{uid}`
- note: screenshot is only enabled in a GUI editor session. `runtime.debug` also requires the `runtime_telemetry.gd` autoload to be registered, and both stay hidden in headless mode

Verified commands:

```powershell
npm --prefix packages/server run typecheck
$env:GODOT_LOOP_MCP_GODOT_BIN = (Get-Command godot_console.exe).Source
npm --prefix packages/server run smoke:m4
```

## M5/M6 Security

Security enforcement and the initial dangerous mode implementation are in place.

- Details: [docs/implementation-milestones.md](/C:/Users/yuta/Desktop/Private/godot-loop-mcp/docs/implementation-milestones.md) `M5` and `M6`
- security levels: `ReadOnly`, `WorkspaceWrite`, `Dangerous`
- audit: `.godot/mcp/audit.log`
- dangerous tools: `execute_editor_script`, `filesystem_write_raw`, `os_shell`
- gating: both server and addon must opt into `Dangerous`, plus write prefixes / shell allowlists / editor script opt-in
- status: security enforcement, audit, release workflows, and the publishable package contract are implemented. The remaining item is the npm-side trusted publisher registration

Verified commands:

```powershell
npm --prefix packages/server run typecheck
$env:GODOT_LOOP_MCP_GODOT_BIN = (Get-Command godot_console.exe).Source
npm --prefix packages/server run smoke:m6
```

## License

This project is licensed under the Apache License, Version 2.0.  
Copyright 2026 ayutaz.
