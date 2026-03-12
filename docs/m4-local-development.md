# M4 Local Development

2026-03-12 時点で、この手順による M4 verification loop hardening の `typecheck` と `smoke:m4` を確認済みです。

## 1. 前提

- Node.js `22.14.0+`
- `godot_console.exe` がローカルにあること
- リポジトリ root で作業すること

## 2. typecheck

```powershell
npm --prefix packages/server run typecheck
```

## 3. M4 smoke

`smoke:m4` は headless editor で次を確認します。

- `run_tests` の custom adapter 経路
- dynamic prompts
- MCP resource templates
- `.godot/mcp/audit.log` への記録
- headless では screenshot / runtime debug tools が hidden になること

```powershell
$env:GODOT_LOOP_MCP_GODOT_BIN = (Get-Command godot_console.exe).Source
npm --prefix packages/server run smoke:m4
```

## 4. run_tests adapter

`run_tests` は次の優先順で adapter を決めます。

1. `GODOT_LOOP_MCP_TEST_COMMAND` / `GODOT_LOOP_MCP_TEST_ARGS`
2. `godot_loop_mcp/tests/custom_command` / `custom_args_json`
3. GdUnit4 の既定 runner
4. GUT の既定 runner

custom adapter の env 例:

```powershell
$env:GODOT_LOOP_MCP_TEST_COMMAND = "node"
$env:GODOT_LOOP_MCP_TEST_ARGS = "[`"$PWD\\packages\\server\\src\\dev\\mockTestRunner.mjs`"]"
```

## 5. prompts / resource templates

現行実装の prompt 名:

- `godot_editor_strategy`
- `godot_ui_layout_strategy`
- `godot_debug_loop`
- `godot_scene_edit_safety`

現行実装の resource template:

- `godot://scene/{path}`
- `godot://script/{path}`
- `godot://node/{scenePath}/{nodePath}`
- `godot://resource/{uid}`

## 6. 既知の制約

- `get_editor_screenshot` / `get_running_scene_screenshot` は GUI editor でのみ enable される
- `runtime.debug` は `EditorDebuggerPlugin` に加えて `res://addons/godot_loop_mcp/runtime/runtime_telemetry.gd` を `GodotLoopMcpRuntimeTelemetry` として autoload 登録した GUI editor play でのみ enable される
- headless smoke では capability gating の確認までを対象にし、GUI capture の実画像確認は含めない
