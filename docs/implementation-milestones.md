# godot-loop-mcp 実装マイルストーン

更新日: 2026-03-15

この文書は現在の milestone 状態と quick reference の source of truth です。  
詳細な設計理由は `docs/godot-4.4-mcp-technical-research.md`、CI/CD 運用は `docs/github-actions-cicd-plan.md` を参照してください。

## 現在の到達点

- サポート対象: `Godot 4.4+`
- server 要件: `Node.js 22.14.0+`
- 最新公開版:
  - GitHub Release: `v0.2.0`
  - npm: `@godot-loop-mcp/server@0.2.0`
- 配布形態:
  - Addon は GitHub Release ZIP
  - server は npm package
  - release workflow は `v*` tag push で GitHub Release と npm publish を実行

## マイルストーン状態

| Milestone | 状態 | 要約 |
| --- | --- | --- |
| `M0` | 完了 | Addon / server skeleton, local TCP bridge, handshake, ping, capability manifest |
| `M1` | 完了 | read-only observation tools/resources, stdio MCP server, log/error observation |
| `M2` | 完了 | scene/node/script write surface, `play_scene`, `stop_scene`, runtime log loop |
| `M3` | 完了 | search, UID, selection, focus, dynamic catalog |
| `M4` | 完了 | `run_tests`, prompts, resource templates, screenshot/runtime debug surface |
| `M5` | 完了 | security level enforcement, audit log, GitHub Actions CI/CD, release packaging |
| `M6` | 完了 | restricted dangerous tools with allowlist / opt-in gating |

## ドキュメント分担

- 実装状況と quick reference: 本書
- CI/CD と release 運用: `docs/github-actions-cicd-plan.md`
- Asset Library handoff: `docs/asset-library-release-checklist.md`
- 設計理由と参考ソース: `docs/godot-4.4-mcp-technical-research.md`

## フェーズ別クイックリファレンス

### M0

役割:

- `localhost` TCP bridge
- `hello -> handshake.sync -> ready -> ping`
- capability manifest と reconnect policy

最短確認:

```powershell
npm ci --prefix packages/server
npm --prefix packages/server run start
godot_console.exe --headless --editor --quit-after 240 --path .
```

期待値:

- addon log: `Bridge handshake completed`, `Ping acknowledged`
- server log: `Addon hello accepted`, `Addon handshake completed`

### M1

主要 surface:

- `get_project_info`
- `get_editor_state`
- `get_scene_tree`
- `find_nodes`
- `get_open_scripts`
- `view_script`
- `get_output_logs`
- `get_godot_errors`

主要 resource:

- `godot://project/info`
- `godot://scene/current`
- `godot://scene/tree`
- `godot://scripts/open`
- `godot://script/current`
- `godot://errors/latest`

確認:

```powershell
$env:GODOT_LOOP_MCP_GODOT_BIN = (Get-Command godot_console.exe).Source
npm --prefix packages/server run smoke:m1
```

注意:

- `Godot 4.5+` は `OS.add_logger()` 由来の ring buffer を優先
- `Godot 4.4` は `.godot/mcp` addon/server log fallback

### M2

主要 surface:

- `create_scene`
- `open_scene`
- `save_scene`
- `add_node`
- `move_node`
- `delete_node`
- `update_property`
- `create_script`
- `attach_script`
- `play_scene`
- `stop_scene`
- `clear_output_logs`

確認:

```powershell
$env:GODOT_LOOP_MCP_GODOT_BIN = (Get-Command godot_console.exe).Source
npm --prefix packages/server run smoke:m2
```

注意:

- headless `play_scene` は別 runtime process を起動
- runtime output は `.godot/mcp/runtime.log`

### M3

主要 surface:

- `search_project`
- `get_uid`
- `resolve_uid`
- `resave_resources`
- `get_selection`
- `set_selection`
- `focus_node`

確認:

```powershell
$env:GODOT_LOOP_MCP_GODOT_BIN = (Get-Command godot_console.exe).Source
npm --prefix packages/server run smoke:m3
```

注意:

- addon session 未接続時は fallback log surface のみ
- handshake 後に capability-aware catalog を公開

### M4

主要 surface:

- `run_tests`
- prompts
- resource templates
- `get_editor_screenshot`
- `get_running_scene_screenshot`
- `runtime.debug`

確認:

```powershell
$env:GODOT_LOOP_MCP_GODOT_BIN = (Get-Command godot_console.exe).Source
npm --prefix packages/server run smoke:m4
```

追加確認:

```powershell
$env:GODOT_LOOP_MCP_GODOT_BIN = (Get-Command godot_console.exe).Source
npm --prefix packages/server run smoke:m4:adapters

$env:GODOT_LOOP_MCP_GODOT_GUI_BIN = (Get-Command godot.exe).Source
npm --prefix packages/server run smoke:m4:gui
```

注意:

- screenshot は GUI editor 前提
- `runtime.debug` は GUI editor と telemetry autoload 前提

### M5

主要機能:

- security level enforcement
- `.godot/mcp/audit.log`
- GitHub Actions `ci`, `nightly-compat`, `release`
- reusable workflows
- Addon ZIP / server tarball / `SHA256SUMS` / `test-reports`
- npm trusted publishing
- release tag / package version / plugin version / public docs の整合チェック
- packaged Addon ZIP / server `.tgz` を使う install smoke
- privileged actions の SHA pin

確認:

```powershell
Get-Content .godot/mcp/audit.log -Tail 20
```

補足:

- `publish-npm` は `v*` tag push のみで動く
- `workflow_dispatch` でも指定した tag ref を checkout して release packaging を再実行する
- `ci` / `release` は `4.4.1-stable` と current latest stable `4.x` を組み合わせて検証する
- `nightly-compat` は support floor + latest stable を Windows / Ubuntu で回す

### M6

主要機能:

- `execute_editor_script`
- `filesystem_write_raw`
- `os_shell`

確認:

```powershell
$env:GODOT_LOOP_MCP_SECURITY_LEVEL = "Dangerous"
$env:GODOT_LOOP_MCP_ENABLE_EDITOR_SCRIPT = "true"
$env:GODOT_LOOP_MCP_ALLOWED_WRITE_PREFIXES = "res://codex-smoke/danger"
$env:GODOT_LOOP_MCP_ALLOWED_SHELL_COMMANDS = "node"
$env:GODOT_LOOP_MCP_GODOT_BIN = (Get-Command godot_console.exe).Source
npm --prefix packages/server run smoke:m6
```

## 現在の制約

- `Godot 4.5+` の editor console capture と `4.4` fallback は挙動が異なる
- screenshot / runtime debug は capability-gated
- dangerous tools は default では公開されない
- Asset Library への反映は手動

## 検証コマンド

```powershell
npm --prefix packages/server run typecheck
$env:GODOT_LOOP_MCP_GODOT_BIN = (Get-Command godot_console.exe).Source
npm --prefix packages/server run smoke:m1
npm --prefix packages/server run smoke:m2
npm --prefix packages/server run smoke:m3
npm --prefix packages/server run smoke:m4
npm --prefix packages/server run smoke:m6
```

GUI:

```powershell
$env:GODOT_LOOP_MCP_GODOT_GUI_BIN = (Get-Command godot.exe).Source
npm --prefix packages/server run smoke:m4:gui
```

## 非目標

- リモート bridge を標準構成にすること
- unrestricted automation を default にすること
- Godot Asset Library submit を完全自動化すること
