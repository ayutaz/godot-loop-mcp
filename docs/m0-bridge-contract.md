# M0 Bridge Contract

## 目的

`addons/godot_loop_mcp` と `packages/server` が、M1 以降の tool/resource 公開に進む前に同じ接続契約を共有するための最小仕様です。

2026-03-12 時点で、この契約の最小実装は repo 内に反映済みです。

## 現在の実装マッピング

- Addon entrypoint: `addons/godot_loop_mcp/plugin.gd`
- Addon transport/client: `addons/godot_loop_mcp/bridge/bridge_protocol.gd`, `addons/godot_loop_mcp/bridge/bridge_client.gd`
- Addon capability manifest: `addons/godot_loop_mcp/capabilities/capability_registry.gd`
- Server entrypoint: `packages/server/src/index.ts`
- Server transport/session: `packages/server/src/transport/`
- Server capability manifest: `packages/server/src/capabilities/serverManifest.ts`

## Transport

- `localhost` TCP を使う
- framing は `4-byte big-endian length prefix + UTF-8 JSON`
- envelope は `JSON-RPC 2.0` 互換の `request / response / notification`

## 初期メッセージ

Addon は接続直後に `bridge.handshake.hello` を送ります。最低限、以下を含みます。

- `protocolVersion`
- `role`
- `product.name`
- `product.version`
- `securityLevel`
- `capabilities`
- `workspaceRoot`
- `reconnectPolicy`

server は `bridge.handshake.hello` の response で以下を返します。

- `sessionId`
- `protocolVersion`
- `role=server`
- `product`
- `securityLevel`
- `capabilities`
- `workspaceRoot`
- `reconnectPolicy`
- `bridge.heartbeatIntervalMs`
- `mcp` の予定 catalog

server は response の後に `bridge.handshake.sync` request を送り、Addon が `state=ready` で応答したら session を ready とみなします。

## Ping

- Addon は handshake 完了直後に `bridge.ping` を送る
- server も ready 後に heartbeat 間隔で `bridge.ping` を送る
- response は `nonce`, `receivedAtMs`, `role`, `sessionId` を返す

## Capability Manifest

最小形は次です。

```json
{
  "schemaVersion": "0.1.0",
  "securityLevel": "ReadOnly",
  "capabilities": [
    {
      "id": "bridge.handshake",
      "surface": "transport",
      "availability": "enabled",
      "description": "Negotiates addon and server identity."
    }
  ]
}
```

M0 では Addon が `enabled` と `planned` の両方を送って構いません。server はまず受信内容をログに残し、M1 から動的公開に使います。

現行 Addon manifest には次を含みます。

- `bridge.handshake` (`enabled`)
- `bridge.ping` (`enabled`)
- `project.info` (`planned`)
- `scene.read` (`planned`)
- `script.read` (`planned`)
- `runtime.debug` (`planned`)

## Security Levels

- `ReadOnly`: 読み取り専用
- `WorkspaceWrite`: 通常の scene/script 編集と保存
- `Dangerous`: 任意コード実行や OS 操作を含む

M0 の実装は Addon / server ともに `ReadOnly` 固定です。

## Timeout / Reconnect

初期値は次です。

- connect timeout: `5000ms`
- handshake timeout: `5000ms`
- heartbeat interval: `15000ms`
- idle timeout: `30000ms`
- reconnect initial delay: `2000ms`
- reconnect max delay: `10000ms`

Addon は接続失敗または handshake timeout 時に指数バックオフで再接続します。server は idle timeout を越えた session を切断します。

## Logs / Settings

- Godot addon settings: `ProjectSettings` の `godot_loop_mcp/bridge/*`
- addon log: `.godot/mcp/addon.log`
- server stdout: 常時出力
- server log: `.godot/mcp/server.log` が書き込み可能な場合に出力
