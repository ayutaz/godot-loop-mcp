# godot-loop-mcp

[English README](README.en.md)

`godot-loop-mcp` は Godot 4.4+ 向けの MCP ベース開発ループです。

このプロジェクトでは、次の構成を目指します。

- Godot Editor Addon による editor / runtime のライブ観測
- tools / resources / prompts を提供する外部 MCP Server
- inspect -> edit -> run -> verify を回せる AI 開発ループ

## ステータス

このリポジトリでは `M0` から `M6` の実装面が揃っており、残作業は `M5` の release hardening と publishing 設定に集約されています。

現在の到達点は、Unity の uLoopMCP に着想を得た `Godot Editor Addon + External MCP Server + Local TCP Bridge` の最小実装です。

- 実装済み: addon skeleton, TypeScript server skeleton, `handshake`, 双方向 `ping`, capability manifest, reconnect policy
- 実装済み: GitHub Actions `ci`, `nightly-compat`, `release`, packaging scripts, release asset 生成の足場
- 実装済み: `M1` read-only observation tools/resources, stdio MCP server, `typecheck`, `smoke:m1`, MCP tool error hardening
- 実装済み: `M2` scene/node/script write tools, `play_scene` / `stop_scene`, `clear_output_logs`, `smoke:m2`
- 実装済み: `M3` `search_project`, `get_uid`, `resolve_uid`, `resave_resources`, `get_selection`, `set_selection`, `focus_node`, `smoke:m3`
- 実装済み: `M4` `run_tests`, dynamic prompts, resource templates, capability-gated screenshot/runtime debug surface, `smoke:m4`
- 実装済み: `M5` security level enforcement と `.godot/mcp/audit.log`
- 実装済み: `M6` `execute_editor_script`, `filesystem_write_raw`, `os_shell`, allowlist/opt-in gating, `smoke:m6`
- 実装済み: active addon session の capability manifest に応じて MCP tools/resources を動的公開し、未接続時は fallback log surface のみを露出
- 実装済み: `Godot 4.5+` では `OS.add_logger()` による editor console capture、headless play output は `.godot/mcp/runtime.log` を返し、`4.4` では `.godot/mcp` fallback
- 進行中: GitHub Actions への `run_tests` / report artifact の本格統合、release hardening、trusted publishing 設定
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

M1 の read-only observation と hardening は実装済みです。

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

## M2 Edit/Play

M2 の edit/play loop は実装済みです。

- 手順: [docs/m2-local-development.md](/C:/Users/yuta/Desktop/Private/godot-loop-mcp/docs/m2-local-development.md)
- tools: `create_scene`, `open_scene`, `save_scene`, `play_scene`, `stop_scene`, `add_node`, `move_node`, `delete_node`, `update_property`, `create_script`, `attach_script`, `clear_output_logs`
- security level: `WorkspaceWrite`
- headless play: editor とは別の Godot process を起動し、`.godot/mcp/runtime.log` に runtime output を保存
- logs: external play の出力がある場合、`get_output_logs` / `get_godot_errors` は `runtime-log-file` backend を返す

確認済みコマンド:

```powershell
npm --prefix packages/server run typecheck
$env:GODOT_LOOP_MCP_GODOT_BIN = (Get-Command godot_console.exe).Source
npm --prefix packages/server run smoke:m2
```

## M3 Search/UID

M3 の search / UID / dynamic capability surface は実装済みです。

- 手順: [docs/m3-local-development.md](/C:/Users/yuta/Desktop/Private/godot-loop-mcp/docs/m3-local-development.md)
- tools: `search_project`, `get_uid`, `resolve_uid`, `resave_resources`, `get_selection`, `set_selection`, `focus_node`
- resources: `godot://selection/current`
- dynamic catalog: addon 未接続時は `clear_output_logs`, `get_output_logs`, `get_godot_errors`, `godot://errors/latest` のみを公開し、ready session 後に capability に応じて tools/resources が増える
- search modes: `path`, `type`, `text`

確認済みコマンド:

```powershell
npm --prefix packages/server run typecheck
$env:GODOT_LOOP_MCP_GODOT_BIN = (Get-Command godot_console.exe).Source
npm --prefix packages/server run smoke:m3
```

## M4 Verification

M4 の verification loop hardening は実装済みです。

- 手順: [docs/m4-local-development.md](/C:/Users/yuta/Desktop/Private/godot-loop-mcp/docs/m4-local-development.md)
- tools: `run_tests`, `get_editor_screenshot`, `get_running_scene_screenshot`, `get_runtime_debug_events`, `clear_runtime_debug_events`
- prompts: `godot_editor_strategy`, `godot_ui_layout_strategy`, `godot_debug_loop`, `godot_scene_edit_safety`
- resource templates: `godot://scene/{path}`, `godot://script/{path}`, `godot://node/{scenePath}/{nodePath}`, `godot://resource/{uid}`
- notes: screenshot は GUI editor でのみ enable。`runtime.debug` は GUI editor に加えて `runtime_telemetry.gd` の autoload 登録が必要で、headless では hidden

確認済みコマンド:

```powershell
npm --prefix packages/server run typecheck
$env:GODOT_LOOP_MCP_GODOT_BIN = (Get-Command godot_console.exe).Source
npm --prefix packages/server run smoke:m4
```

## M5/M6 Security

security enforcement と dangerous mode の最小実装は入っています。

- 手順: [docs/m5-local-development.md](/C:/Users/yuta/Desktop/Private/godot-loop-mcp/docs/m5-local-development.md)
- 手順: [docs/m6-local-development.md](/C:/Users/yuta/Desktop/Private/godot-loop-mcp/docs/m6-local-development.md)
- security levels: `ReadOnly`, `WorkspaceWrite`, `Dangerous`
- audit: `.godot/mcp/audit.log`
- dangerous tools: `execute_editor_script`, `filesystem_write_raw`, `os_shell`
- gating: server/addon の `Dangerous` 指定に加え、write prefix / shell allowlist / editor script opt-in が必要
- status: security enforcement と監査は実装済み。trusted publishing と release hardening は引き続き `M5` の残作業

確認済みコマンド:

```powershell
npm --prefix packages/server run typecheck
$env:GODOT_LOOP_MCP_GODOT_BIN = (Get-Command godot_console.exe).Source
npm --prefix packages/server run smoke:m6
```

## ライセンス

このプロジェクトは Apache License 2.0 で公開します。  
Copyright 2026 ayutaz.
