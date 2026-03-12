# M1 Local Development

2026-03-12 時点で、この手順による M1 read-only observation の typecheck と smoke を確認済みです。

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
- `godot://project/info`
- `godot://scene/current`
- `godot://scene/tree`

## 4. 現状の log scope

`get_output_logs` と `get_godot_errors` は、現時点では Godot 全体の editor console ではなく、`.godot/mcp/addon.log` と `.godot/mcp/server.log` を参照します。

これは M1 の安全な観測面を優先した暫定実装で、runtime telemetry や tests 連携は M4 以降で拡張します。
