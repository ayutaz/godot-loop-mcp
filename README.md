# godot-loop-mcp

[English README](README.en.md)

`godot-loop-mcp` は Godot 4.4+ 向けの MCP ベース開発ループです。

このプロジェクトでは、次の構成を目指します。

- Godot Editor Addon による editor / runtime のライブ観測
- tools / resources / prompts を提供する外部 MCP Server
- inspect -> edit -> run -> verify を回せる AI 開発ループ

## ステータス

このリポジトリは立ち上げ初期段階ですが、`M0` は完了し、`M5` の CI/CD 基盤にも着手済みです。

現在の到達点は、Unity の uLoopMCP に着想を得た `Godot Editor Addon + External MCP Server + Local TCP Bridge` の最小実装です。

- 実装済み: addon skeleton, TypeScript server skeleton, `handshake`, 双方向 `ping`, capability manifest, reconnect policy
- 実装済み: GitHub Actions `ci`, `nightly-compat`, `release`, packaging scripts, release asset 生成の足場
- 実装済み: `M1` core read-only observation tools/resources, stdio MCP server, `typecheck`, `smoke:m1`
- 実装済み: `Godot 4.5+` では `OS.add_logger()` による editor console capture、`4.4` では `.godot/mcp` fallback
- 次の対象: `M1` の hardening と `M2` の edit/play loop
- 進行計画: [docs/implementation-milestones.md](/C:/Users/yuta/Desktop/Private/godot-loop-mcp/docs/implementation-milestones.md)
- CI/CD 計画: [docs/github-actions-cicd-plan.md](/C:/Users/yuta/Desktop/Private/godot-loop-mcp/docs/github-actions-cicd-plan.md)

## M0 Bootstrap

M0 の bridge 実装は動作確認済みです。

- 契約仕様: [docs/m0-bridge-contract.md](/C:/Users/yuta/Desktop/Private/godot-loop-mcp/docs/m0-bridge-contract.md)
- ローカル起動手順: [docs/m0-local-development.md](/C:/Users/yuta/Desktop/Private/godot-loop-mcp/docs/m0-local-development.md)
- マイルストーン: [docs/implementation-milestones.md](/C:/Users/yuta/Desktop/Private/godot-loop-mcp/docs/implementation-milestones.md)
- Asset Library チェックリスト: [docs/asset-library-release-checklist.md](/C:/Users/yuta/Desktop/Private/godot-loop-mcp/docs/asset-library-release-checklist.md)

確認済みの最小スモークテスト:

```powershell
npm --prefix packages/server run start
godot_console.exe --headless --editor --quit-after 240 --path .
```

ローカルで確認済みの CI parity コマンド:

```powershell
npm ci --prefix packages/server
./scripts/actions/run-server-bootstrap.ps1 -RepoRoot $PWD.Path
./scripts/actions/run-bridge-smoke.ps1 -RepoRoot $PWD.Path -GodotBinaryPath (Get-Command godot_console.exe).Source
```

GitHub Actions では 2026-03-12 時点で次を定義済みです。

- PR / `main`: `server-check`, `bridge-smoke`
- nightly: `windows-latest`, `ubuntu-latest` x `4.4.1-stable`, `4.5.1-stable`
- release: smoke, Addon ZIP, server tarball, `SHA256SUMS`, GitHub Release asset upload

## M1 Observation

M1 の core read-only observation は実装済みです。

- 手順: [docs/m1-local-development.md](/C:/Users/yuta/Desktop/Private/godot-loop-mcp/docs/m1-local-development.md)
- tools: `get_project_info`, `get_editor_state`, `get_scene_tree`, `find_nodes`, `get_open_scripts`, `view_script`, `get_output_logs`, `get_godot_errors`
- resources: `godot://project/info`, `godot://scene/current`, `godot://scene/tree`, `godot://scripts/open`, `godot://script/current`, `godot://errors/latest`
- logs: `Godot 4.5+` では addon ring buffer を優先し、`Godot 4.4` では `.godot/mcp` の addon/server log に fallback

確認済みコマンド:

```powershell
npm --prefix packages/server run typecheck
$env:GODOT_LOOP_MCP_GODOT_BIN = (Get-Command godot_console.exe).Source
npm --prefix packages/server run smoke:m1
```

## ライセンス

このプロジェクトは Apache License 2.0 で公開します。  
Copyright 2026 ayutaz.
