# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Godot Loop MCP — Godot 4.4+ 向けの MCP (Model Context Protocol) ブリッジ。AI エージェントが Godot エディタを観察・編集・実行・検証できるようにする。

二つのコンポーネントで構成:
- **Server** (`packages/server/`) — TypeScript / Node.js 22.14.0+。TCP ブリッジ + MCP stdio トランスポート
- **Addon** (`addons/godot_loop_mcp/`) — GDScript の EditorPlugin。ブリッジクライアントと各種サービスモジュール

## Common Commands

すべて `packages/server/` ディレクトリで実行:

```bash
npm run build          # TypeScript → dist/ にコンパイル (tsc -p tsconfig.build.json)
npm run typecheck      # 型チェックのみ (emit なし)
npm run dev            # 開発モード (--experimental-strip-types --watch)
npm run smoke:m1       # M1 スモークテスト (観察系)
npm run smoke:m2       # M2 スモークテスト (編集系)
npm run smoke:m3       # M3 スモークテスト (検索・UID)
npm run smoke:m4       # M4 スモークテスト (検証・プロンプト)
npm run smoke:m4:gui   # M4 GUI テスト (スクリーンショット・ランタイムデバッグ)
npm run smoke:m6       # M6 スモークテスト (Dangerous モード)
npm run pack:dry-run   # パッケージング検証
```

## Architecture

### 通信プロトコル

```
MCP Client (Claude等) ←stdio→ Server (Node.js) ←TCP:6010→ Addon (Godot)
```

- TCP フレーム: 4 バイト Big-Endian 長さプレフィクス + JSON ペイロード
- メッセージ形式: JSON-RPC 2.0 スタイル (request/response/notification)
- ハンドシェイク: hello → handshake.sync → ready、以後 ping/pong でライブネス維持

### Server 構成 (`packages/server/src/`)

| ディレクトリ | 役割 |
|---|---|
| `transport/` | TCP ブリッジプロトコル (フレーム, セッション状態マシン) |
| `mcp/` | MCP カタログ定義 (30+ ツール, 7 リソース, 4 プロンプト, 4 テンプレート) と stdio サーバー |
| `observation/` | エディタ/ランタイムログ読み取り (Godot 4.5+ コンソールキャプチャ対応) |
| `capabilities/` | サーバーケイパビリティマニフェスト構築 |
| `dev/` | スモークテストハーネスと M1〜M6 テスト |

エントリポイント: `src/index.ts` → TCP サーバー起動 → AddonSession 管理 → McpBridgeServer 連携

### Addon 構成 (`addons/godot_loop_mcp/`)

`plugin.gd` が EditorPlugin エントリポイント。以下のサービスを初期化:
- `observation/` — エディタ状態観察、コンソールキャプチャ
- `project/` — プロジェクト検索、リソース UID
- `workspace/` — シーン編集、スクリプト作成
- `verification/` — テスト検証
- `dangerous/` — 制限付き危険操作 (エディタスクリプト実行、ファイルシステム書き込み、シェルコマンド)
- `bridge/` — TCP クライアント、プロトコルハンドリング
- `runtime/` — ランタイムデバッガプラグイン、テレメトリ

### セキュリティレベル (3 段階)

1. **ReadOnly** — 観察のみ
2. **WorkspaceWrite** — シーン/スクリプト編集可
3. **Dangerous** — エディタスクリプト実行、ファイルシステム書き込み、シェルコマンド (明示的オプトインが必要)

## Key Environment Variables

| 変数 | デフォルト | 用途 |
|---|---|---|
| `GODOT_LOOP_MCP_HOST` | `127.0.0.1` | サーバーホスト |
| `GODOT_LOOP_MCP_PORT` | `6010` | TCP ポート |
| `GODOT_LOOP_MCP_SECURITY_LEVEL` | — | ReadOnly / WorkspaceWrite / Dangerous |
| `GODOT_LOOP_MCP_REPO_ROOT` | 自動検出 | プロジェクトルート明示指定 |
| `GODOT_LOOP_MCP_LOG_DIR` | `.godot/mcp` | ログディレクトリ |
| `GODOT_LOOP_MCP_BRIDGE_ONLY` | — | ブリッジのみモード (MCP stdio なし) |

## Version Management

バージョン番号は以下の 3 箇所で一致が必要 (CI で検証):
- `packages/server/package.json` の `version`
- `addons/godot_loop_mcp/plugin.cfg` の `version`
- `packages/server/src/capabilities/serverManifest.ts` の `SERVER_VERSION`

## CI/CD

- `ci.yml` — PR/push で TypeScript チェック + Godot スモークテスト (Windows)
- `release.yml` — `v*` タグで GitHub Releases + npm 公開
- `nightly-compat.yml` — Godot 4.4.1〜最新 stable + nightly の互換性テスト
- ビルドスクリプト: `scripts/actions/*.ps1` (PowerShell)
