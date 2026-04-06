# godot-loop-mcp

[English README](README.en.md)

`godot-loop-mcp` は Godot 4.4+ 向けの MCP ベース開発支援ツールです。  
Godot Editor Addon と外部 MCP server をローカル TCP bridge で接続し、AI や外部クライアントから Godot project の観測、編集、実行、検証を行えるようにします。

## 主な機能

- editor / runtime の状態観測
- scene / node / script の編集
- `play_scene` / `stop_scene` による実行ループ
- project search, UID, selection, focus
- tests, prompts, resource templates
- capability-gated screenshot / runtime debug surface
- running scene tree / node / audio playback inspection
- security level, audit log, dangerous tool gating
- GitHub Release と npm package による配布

## サポート範囲

- Godot: `4.4+`
- Node.js: `22.14.0+`
- npm package: `@godot-loop-mcp/server`
- CI coverage: `4.4.1-stable` + current latest stable `4.x` on Windows, nightly also on Ubuntu
- 最新公開版:
  - GitHub Release: `v0.3.1`
  - npm: `@godot-loop-mcp/server@0.3.1`

## インストール

### 1. Addon

GitHub Release の `godot-loop-mcp-addon-*.zip` を展開し、Godot project の `addons/godot_loop_mcp/` に配置します。

その後、Godot の `Project Settings > Plugins` で `Godot Loop MCP` を有効化します。

### 2. Server

```powershell
npm install --save-dev @godot-loop-mcp/server
```

Godot project root で起動する場合:

```powershell
npx @godot-loop-mcp/server
```

project root 以外から起動する場合は `GODOT_LOOP_MCP_REPO_ROOT` を設定します。

## Logging

- 既定では CLI / editor console への出力は `Warn` 以上に抑え、詳細ログは `.godot/mcp/*.log` に残します
- server / proxy / daemon の閾値は `GODOT_LOOP_MCP_CONSOLE_LOG_LEVEL` と `GODOT_LOOP_MCP_FILE_LOG_LEVEL` で上書きできます
- addon の閾値は `Project Settings > godot_loop_mcp/log/console_level` と `godot_loop_mcp/log/file_level`、または同名 env で上書きできます

## クイックスタート

server:

```powershell
npx @godot-loop-mcp/server
```

Godot:

```powershell
godot_console.exe --headless --editor --quit-after 240 --path .
```

期待値:

- addon log に `Bridge handshake completed`
- server log に `Addon handshake completed`

## リポジトリ構成

```text
addons/godot_loop_mcp/   Godot Editor Addon
packages/server/         MCP bridge server
docs/                    運用・調査・配布ドキュメント
.github/workflows/       CI/CD
```

## 開発

```powershell
npm ci --prefix packages/server
npm --prefix packages/server run typecheck
```

代表的な smoke:

```powershell
$env:GODOT_LOOP_MCP_GODOT_BIN = (Get-Command godot_console.exe).Source
npm --prefix packages/server run smoke:m1
npm --prefix packages/server run smoke:m2
npm --prefix packages/server run smoke:m3
npm --prefix packages/server run smoke:m4
npm --prefix packages/server run smoke:m6
```

GUI 前提の確認:

```powershell
$env:GODOT_LOOP_MCP_GODOT_GUI_BIN = (Get-Command godot.exe).Source
npm --prefix packages/server run smoke:m4:gui
```

## Runtime Verification

- GUI editor で `play_scene` を使い、`autoload/GodotLoopMcpRuntimeTelemetry` が設定されている場合は `get_running_scene_tree` / `get_running_node` / `get_running_node_property` / `wait_for_runtime_condition` / `get_running_audio_players` を利用できます
- `get_running_scene_screenshot` / `get_runtime_debug_events` / `simulate_mouse` を含む runtime inspection surface は GUI editor 前提です
- headless editor の `play_scene` は外部 runtime process を起動し、MCP から取得できるのは主に `.godot/mcp/runtime.log` です
- shell から直接起動した Godot process は MCP runtime capture に自動接続されません

## ドキュメント

- 実装状況と quick reference: [docs/implementation-milestones.md](docs/implementation-milestones.md)
- runtime 検証の課題整理: [docs/runtime-verification-gaps.md](docs/runtime-verification-gaps.md)
- CI/CD 運用: [docs/github-actions-cicd-plan.md](docs/github-actions-cicd-plan.md)
- Asset Library handoff: [docs/asset-library-release-checklist.md](docs/asset-library-release-checklist.md)
- 設計判断のアーカイブ: [docs/godot-4.4-mcp-technical-research.md](docs/godot-4.4-mcp-technical-research.md)
- server package details: [packages/server/README.md](packages/server/README.md)

## 現在の制約

- `Godot 4.5+` では editor console capture を優先し、`4.4` では `.godot/mcp` fallback を返します
- screenshot と `runtime.debug` は capability-gated です
- dangerous tools は explicit opt-in と allowlist 前提です
- Godot Asset Library への公開は手動 handoff です

## ライセンス

Apache-2.0
