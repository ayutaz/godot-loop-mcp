# godot-loop-mcp

[日本語 README](README.md)

`godot-loop-mcp` is an MCP-oriented development loop for Godot 4.4+.

The project is intended to provide:

- a Godot Editor addon for live editor / runtime introspection
- an external MCP server for tools, resources, and prompts
- an AI development loop for inspect -> edit -> run -> verify workflows

## Status

This repository is still in the bootstrap phase, but `M0` is complete and `M5` CI/CD groundwork is in progress.

The current baseline is a minimal `Godot Editor Addon + External MCP Server + Local TCP Bridge` design inspired by Unity's uLoopMCP:

- Implemented: addon skeleton, TypeScript server skeleton, `handshake`, bidirectional `ping`, capability manifest, reconnect policy
- Implemented: GitHub Actions `ci`, `nightly-compat`, `release`, packaging scripts, and release-asset scaffolding
- Implemented: `M1` core read-only observation tools/resources, stdio MCP server, `typecheck`, `smoke:m1`
- Next target: `M1` hardening and the `M2` edit/play loop
- Roadmap: [docs/implementation-milestones.md](/C:/Users/yuta/Desktop/Private/godot-loop-mcp/docs/implementation-milestones.md)
- CI/CD plan: [docs/github-actions-cicd-plan.md](/C:/Users/yuta/Desktop/Private/godot-loop-mcp/docs/github-actions-cicd-plan.md)

## M0 Bootstrap

The initial M0 bridge scaffolding is implemented and smoke-tested.

- Contract: [docs/m0-bridge-contract.md](/C:/Users/yuta/Desktop/Private/godot-loop-mcp/docs/m0-bridge-contract.md)
- Local development: [docs/m0-local-development.md](/C:/Users/yuta/Desktop/Private/godot-loop-mcp/docs/m0-local-development.md)
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

As of 2026-03-12, GitHub Actions defines:

- PR / `main`: `server-check`, `bridge-smoke`
- nightly: `windows-latest`, `ubuntu-latest` x `4.4.1-stable`, `4.5.1-stable`
- release: smoke, addon ZIP, server tarball, `SHA256SUMS`, GitHub Release asset upload

## M1 Observation

The core M1 read-only observation surface is now implemented.

- Guide: [docs/m1-local-development.md](/C:/Users/yuta/Desktop/Private/godot-loop-mcp/docs/m1-local-development.md)
- tools: `get_project_info`, `get_editor_state`, `get_scene_tree`, `find_nodes`, `get_open_scripts`, `view_script`, `get_output_logs`, `get_godot_errors`
- resources: `godot://project/info`, `godot://scene/current`, `godot://scene/tree`, `godot://scripts/open`, `godot://script/current`, `godot://errors/latest`

Verified commands:

```powershell
npm --prefix packages/server run typecheck
$env:GODOT_LOOP_MCP_GODOT_BIN = (Get-Command godot_console.exe).Source
npm --prefix packages/server run smoke:m1
```

## License

This project is licensed under the Apache License, Version 2.0.  
Copyright 2026 ayutaz.
