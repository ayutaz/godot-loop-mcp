# M2 Local Development

2026-03-12 時点で、この手順による M2 edit/play loop の typecheck / smoke を確認済みです。

## 前提

- Node.js `22.14.0+`
- npm
- Godot CLI `4.4+`

このリポジトリでは Node `22.14.0` と Godot CLI `4.6.0` を確認済みです。

## 1. 依存を入れる

```powershell
npm ci --prefix packages/server
```

## 2. TypeScript を型検査する

```powershell
npm --prefix packages/server run typecheck
```

## 3. M2 edit/play smoke を実行する

```powershell
$env:GODOT_LOOP_MCP_GODOT_BIN = (Get-Command godot_console.exe).Source
npm --prefix packages/server run smoke:m2
```

この smoke は次を一括で確認します。

- stdio MCP server 起動
- Godot headless editor 起動
- Addon の handshake 完了
- `clear_output_logs`
- `create_scene`
- `add_node`
- `move_node`
- `update_property`
- `create_script`
- `attach_script`
- `delete_node`
- `save_scene`
- `open_scene`
- `play_scene`
- `stop_scene`
- `get_output_logs`
- `get_godot_errors`

## 4. M2 write/play surface

M2 で追加された tool は次です。

- `create_scene`
- `open_scene`
- `save_scene`
- `play_scene`
- `stop_scene`
- `add_node`
- `move_node`
- `delete_node`
- `update_property`
- `create_script`
- `attach_script`
- `clear_output_logs`

security level は `WorkspaceWrite` です。

## 5. 現状の play/log 挙動

headless editor では `play_scene` が editor 内 Play Mode ではなく、別の Godot runtime process を起動します。runtime の stdout/stderr 相当は `.godot/mcp/runtime.log` に保存されます。

`get_editor_state` には次が追加されています。

- `runtimeMode`
- `runtimeLogPath`

`get_output_logs` と `get_godot_errors` は次の優先順です。

- external runtime の出力がある場合: `runtime-log-file`
- `Godot 4.5+` の editor console capture が有効な場合: `editor-console-buffer`
- 上記が使えない場合: `.godot/mcp` の fallback

## 6. 既知メモ

- Windows headless では runtime process 実行中に `runtime.log` が read lock されることがあるため、`smoke:m2` は `stop_scene` 後に runtime output を検証します
- `smoke:m2` は開始前と play 前に `clear_output_logs` を呼び、stale log を消してから判定します
- `plugin.gd` は editor 側終了時に external runtime process を cleanup します
