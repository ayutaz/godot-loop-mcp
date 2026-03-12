# M3 Local Development

2026-03-12 時点で、この手順による M3 search / UID / dynamic capability surface の typecheck / smoke を確認済みです。

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

## 3. M3 smoke を実行する

```powershell
$env:GODOT_LOOP_MCP_GODOT_BIN = (Get-Command godot_console.exe).Source
npm --prefix packages/server run smoke:m3
```

この smoke は次を一括で確認します。

- pre-session では fallback log tools/resources だけが見えること
- handshake 完了後に dynamic catalog が展開されること
- `search_project` の `path`, `type`, `text`
- `get_uid`
- `resolve_uid`
- `resave_resources`
- `get_selection`
- `set_selection`
- `focus_node`
- `godot://selection/current`

## 4. M3 search / UID surface

M3 で追加された tool は次です。

- `search_project`
- `get_uid`
- `resolve_uid`
- `resave_resources`
- `get_selection`
- `set_selection`
- `focus_node`

M3 で追加された resource は次です。

- `godot://selection/current`

## 5. 現行の dynamic catalog 挙動

server は Addon handshake 後に capability manifest を見て MCP tools/resources を enable します。

- Addon 未接続時:
  - tools: `clear_output_logs`, `get_output_logs`, `get_godot_errors`
  - resources: `godot://errors/latest`
- Addon ready 後:
  - `project.search`, `resource.uid`, `resource.resave`, `editor.selection.read`, `editor.selection.write`, `editor.focus` など、enabled capability に応じて surface を公開

`packages/server/src/mcp/server.ts` は SDK の enable/disable と list-changed notification を使い、catalog を差し替えずに一覧だけ更新します。

## 6. 検索の現状

- `path` と `type` は editor 側の resource filesystem を使う
- `text` は disk 上の text file を再帰走査する
- `text` 検索では `.godot`, `.git`, `node_modules` を除外する

## 7. 既知メモ

- brand-new directory に保存した resource は `update_file()` だけでは反映が遅れることがあるため、workspace/project service は必要時に `scan_sources()` へフォールバックします
- `search_project` は Godot project root を基準にするため、repo 直下の docs や server source も `text` 検索対象になり得ます
