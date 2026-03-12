# M0 Local Development

2026-03-12 時点で、この手順による M0 スモークテストを確認済みです。

## 前提

- Node.js `22.14.0+`
- npm
- Godot `4.4+`

このリポジトリでは Node `22.14.0` と Godot CLI `4.6.0` を確認済みです。

## 1. server を起動する

```powershell
npm --prefix packages/server run start
```

既定値:

- host: `127.0.0.1`
- port: `6010`

環境変数で上書きできます。

- `GODOT_LOOP_MCP_HOST`
- `GODOT_LOOP_MCP_PORT`
- `GODOT_LOOP_MCP_HEARTBEAT_MS`
- `GODOT_LOOP_MCP_LOG_DIR`

## 2. Godot Editor で addon を起動する

```powershell
godot.exe --path .
```

`project.godot` で `res://addons/godot_loop_mcp/plugin.cfg` を有効化済みです。  
起動すると Addon が bridge に接続し、`handshake` と最初の `ping` を実行します。

接続先は `Project Settings > godot_loop_mcp/bridge/*` で変えられます。

## 3. 疎通を確認する

server 側:

- server stdout または `.godot/mcp/server.log` に `Addon hello accepted.`
- server stdout または `.godot/mcp/server.log` に `Addon capability registered.`
- server stdout または `.godot/mcp/server.log` に `Addon handshake completed.`

addon 側:

- `.godot/mcp/addon.log` に `Bridge handshake completed.`
- `.godot/mcp/addon.log` に `Ping acknowledged.`

## 4. CLI スモークテスト

server を別ターミナルで起動した状態で、次で headless editor 起動確認ができます。

```powershell
godot_console.exe --headless --editor --quit-after 240 --path .
```

期待する確認点:

- Addon が `Bridge state changed -> connecting -> handshaking -> ready` を出す
- `Bridge handshake completed.` が出る
- `Ping acknowledged.` が出る

## 5. 手動接続操作

Editor の `Project > Tools` メニューに次を追加しています。

- `Godot Loop MCP: Connect`
- `Godot Loop MCP: Disconnect`

## 6. 既知の注意点

- headless 実行時に Windows 環境で証明書ストア警告が出ることがありますが、bridge 成否とは別です
- headless 実行環境によっては editor settings 保存エラーが出ることがありますが、M0 の handshake/ping 確認自体は可能です

## 7. M0 の範囲

M0 は bridge の足場だけを対象にします。

- 実装済み: addon skeleton, TCP bridge, handshake, bidirectional ping, capability logging
- 未着手: scene/script 読み書き, tests, screenshot, 任意コード実行
