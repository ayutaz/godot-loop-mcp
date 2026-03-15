# godot-loop-mcp

[English README](README.en.md)

`godot-loop-mcp` は Godot 4.4+ 向けの MCP 開発ループです。

- Godot Editor Addon
- external MCP server
- local TCP bridge

目的は `inspect -> edit -> run -> verify` を Godot で回せることです。

## 現在の状態

- 実装面は `M0` から `M6` まで反映済み
- GitHub Release は `v0.1.3` を公開済み
- npm package は `@godot-loop-mcp/server@0.1.3` を公開済み
- release workflow は `v*` tag push で GitHub Release と npm publish まで通る

## クイックスタート

Addon:

- GitHub Release の `godot-loop-mcp-addon-*.zip` を展開して `addons/godot_loop_mcp/` に置く
- `Project Settings > Plugins` で `Godot Loop MCP` を有効化する

Server:

```powershell
npm install --save-dev @godot-loop-mcp/server
npx @godot-loop-mcp/server
```

Godot 側の最小確認:

```powershell
godot_console.exe --headless --editor --quit-after 240 --path .
```

期待値:

- addon log に `Bridge handshake completed`
- server log に `Addon handshake completed`

## ローカル開発

```powershell
npm ci --prefix packages/server
npm --prefix packages/server run typecheck
```

主な smoke:

```powershell
$env:GODOT_LOOP_MCP_GODOT_BIN = (Get-Command godot_console.exe).Source
npm --prefix packages/server run smoke:m1
npm --prefix packages/server run smoke:m2
npm --prefix packages/server run smoke:m3
npm --prefix packages/server run smoke:m4
npm --prefix packages/server run smoke:m6
```

GUI 前提の検証:

```powershell
$env:GODOT_LOOP_MCP_GODOT_GUI_BIN = (Get-Command godot.exe).Source
npm --prefix packages/server run smoke:m4:gui
```

## ドキュメント

- 実装状況と quick reference: [docs/implementation-milestones.md](docs/implementation-milestones.md)
- CI/CD 運用: [docs/github-actions-cicd-plan.md](docs/github-actions-cicd-plan.md)
- Asset Library handoff: [docs/asset-library-release-checklist.md](docs/asset-library-release-checklist.md)
- 調査アーカイブ: [docs/godot-4.4-mcp-technical-research.md](docs/godot-4.4-mcp-technical-research.md)

## 現在の制約

- `Godot 4.5+` では editor console capture を優先し、`4.4` では `.godot/mcp` fallback を返す
- screenshot と `runtime.debug` は capability-gated
- 危険機能は explicit opt-in と allowlist 前提
- Godot Asset Library への公開は半手動運用

## ライセンス

Apache-2.0
