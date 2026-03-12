# M1 Local Development

2026-03-12 時点で、この手順による M1 read-only observation と hardening の typecheck / smoke を確認済みです。

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

`packages/server` では `typescript` と `@types/node` を devDependency として固定しています。

## 3. M1 observation smoke を実行する

```powershell
$env:GODOT_LOOP_MCP_GODOT_BIN = (Get-Command godot_console.exe).Source
npm --prefix packages/server run smoke:m1
```

この smoke は次を一括で確認します。

- stdio MCP server 起動
- Godot headless editor 起動
- Addon の handshake 完了
- `tools/list`, `resources/list`
- `get_project_info`
- `get_editor_state`
- `get_scene_tree`
- `get_open_scripts`
- `get_output_logs`
- `get_godot_errors`
- `godot://project/info`
- `godot://scene/current`
- `godot://scene/tree`
- addon 側 request error が MCP tool error として返ること
- `clear_output_logs` で stale runtime log を掃除したうえで
- Godot version に応じて `editor-console-buffer` / `bridge-log-fallback` の backend が切り替わること

補足:

- smoke 実行時は `dist/release*/addon-staging` のような legacy package staging directory を一時退避し、Godot の UID duplicate warning を避けます

## 4. 現状の log scope

`get_output_logs` と `get_godot_errors` は、`Godot 4.5+` では addon が `OS.add_logger()` を登録して editor console を ring buffer に保持し、その payload を優先して返します。

`Godot 4.4` では public API に同等手段がないため、`.godot/mcp/addon.log` と `.godot/mcp/server.log` を fallback として返します。

補足:

- capability manifest には `editor.console.capture` を追加し、`Godot 4.5+` で logger 登録に成功した場合だけ `enabled` になります
- `M2` 実装後は、headless play の直後に `runtime-log-file` backend が返ることがあります
- `smoke:m1` は先に `clear_output_logs` を呼び、`editor-console-buffer` と `bridge-log-fallback` のどちらが返るべきかを検証します
- runtime telemetry や tests 連携は引き続き M4 以降で拡張します

## 5. 現状の hardening

- `view_script` の不正 path は editor console に余計な load error を出さず、tool error として返します
- addon 側の request error は server 側で握りつぶさず、MCP tool error (`isError`) として返します
- `scripts/actions/package-addon.ps1` は staging を一時ディレクトリで作るため、今後の package 実行で `addon-staging` を project 配下に残しません
- `get_output_logs` / `get_godot_errors` は `Godot 4.5+` なら addon ring buffer、headless play 後は `runtime-log-file`、`4.4` なら `.godot/mcp` fallback を返します
