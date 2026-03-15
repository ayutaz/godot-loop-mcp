# Godot 4.4+ 向け MCP 技術調査アーカイブ

更新日: 2026-03-15

この文書は設計判断の根拠を残すための archive です。  
現行の挙動と運用の source of truth は次を優先してください。

- `docs/implementation-milestones.md`
- `docs/github-actions-cicd-plan.md`
- 実装コード

## 現在も有効な結論

この調査から残った主要判断は次です。

1. 中核構成は `Godot Editor Addon + External MCP Server + Local TCP Bridge`
2. `inspect -> edit -> run -> verify` を最優先にする
3. `resources` は早期導入し、`prompts` は後続の UX 補助として扱う
4. screenshot と runtime debug は capability-gated にする
5. 危険機能は最初から default 公開しない
6. `Godot 4.4+` は API 必須ではなく、互換保証と運用境界のための製品判断として採る

## ベンチマークから残った要件

uLoopMCP 比較で最後まで重要だった要件:

- editor / runtime の現在状態を観測できること
- scene/script に対する軽微な修正ができること
- `play/stop` と logs/errors 再取得ができること
- tests / screenshot / runtime telemetry を段階的に追加できること
- capabilities と security level に応じて surface を動的公開できること

Godot 版では Unity の menu-centered 体験よりも、Scene / Node / Script / Resource の直接操作が中心になる、という差分が残りました。

## 主要 API 判断

Editor:

- `EditorPlugin`
- `EditorInterface`
- `EditorSelection`

Runtime / debug:

- `EditorDebuggerPlugin`
- `EngineDebugger`

識別:

- `ResourceUID`

視覚観測:

- `DisplayServer.screen_get_image`

fallback:

- `godot --headless`

## 実装に反映された設計メモ

- Runtime custom telemetry と標準ログ/例外取得は別経路として設計する
- `Godot 4.5+` では editor console capture を優先し、`4.4` は log fallback を使う
- UID 解決は stale registry を考慮して fallback が必要
- dangerous tools は capability と allowlist の両方で制御する
- release は Addon と server を別成果物として出す

## 既知の注意

- screenshot は platform/windowing 制約がある
- `runtime.debug` は GUI editor と telemetry autoload 前提
- Asset Library handoff は人手確認が残る

## 参考ソース

ベンチマーク:

- https://github.com/hatayama/uLoopMCP
- https://github.com/hatayama/uLoopMCP/blob/main/Packages/docs/ARCHITECTURE_Unity.md
- https://github.com/hatayama/uLoopMCP/blob/main/Packages/docs/ARCHITECTURE_TypeScript.md

既存 Godot MCP:

- https://github.com/bradypp/godot-mcp
- https://github.com/matula/godot-mcp-server
- https://github.com/ee0pdt/Godot-MCP
- https://github.com/Dokujaa/Godot-MCP
- https://gdaimcp.com/docs/

Godot docs:

- https://docs.godotengine.org/en/4.4/classes/class_editorinterface.html
- https://docs.godotengine.org/en/4.4/classes/class_editordebuggerplugin.html
- https://docs.godotengine.org/en/4.4/classes/class_enginedebugger.html
- https://docs.godotengine.org/en/4.4/classes/class_displayserver.html
- https://docs.godotengine.org/en/4.0/classes/class_resourceuid.html

MCP:

- https://modelcontextprotocol.io/docs/getting-started/intro
- https://modelcontextprotocol.io/specification/2025-06-18/server/prompts

テスト基盤:

- https://github.com/MikeSchulze/gdUnit4
- https://github.com/bitwes/Gut
