# godot-loop-mcp 実装マイルストーン

作成日: 2026-03-12  
更新日: 2026-03-12  
元ドキュメント: `docs/godot-4.4-mcp-technical-research.md`

## 目的

この文書は、技術調査をそのまま再掲するのではなく、実装順に落とし込んだマイルストーン計画です。  
`プロダクト`, `アーキテクチャ`, `Editor Addon`, `Runtime/Test`, `Security/Release` の 5 観点を統合し、MVP 完了条件と post-MVP の境界を明確にします。

## 前提

- サポート対象は `Godot 4.4+`
- 中核構成は `Godot Editor Addon + External MCP Server + Local Bridge`
- MVP では `inspect -> edit -> run -> verify` の開発ループ成立を最優先にする
- `resources` は早期導入する
- `prompts` は後続の UX 補助として扱う
- screenshot は `capability-gated` にする
- 危険機能 (`execute_editor_script`, `os_shell`, unrestricted file write) は MVP から外す

## マルチエージェント統合結論

- `プロダクト`: 最初に成立させるべき価値は「AI が Godot の現在状態を見て、軽微な修正を加え、再検証できること」
- `アーキテクチャ`: Addon と external server の責務を分け、境界は明示的な bridge protocol で固定する
- `Editor Addon`: Editor の現在状態を truth source にし、headless は fallback に限定する
- `Runtime/Test`: 標準ログ・例外回収と custom telemetry bridge を混同しない
- `Security/Release`: 危険機能より先に権限モデル、監査、配布形態を固める

## MVP 境界

MVP 完了は `M0` から `M2` の終了時点とします。  
この時点で AI は以下を実行できる必要があります。

- 現在の project / editor / scene / script / errors を観測できる
- scene/script に限定した軽微な変更ができる
- `play_scene` / `stop_scene` を実行できる
- 実行結果の logs/errors を再取得できる

`M3` 以降は MVP 拡張として扱います。  
2026-03-12 時点では `M4` と `M6` まで repo に反映済みで、`M5` は release hardening を残して進行中です。

## 現在の実装状況

2026-03-12 時点の実装状態は次です。

| Milestone | 状態 | 実装/確認内容 |
| --- | --- | --- |
| `M0` | 完了 | Addon skeleton, TypeScript server skeleton, `bridge.handshake.hello`, `bridge.handshake.sync`, 双方向 `bridge.ping`, capability logging, reconnect policy, ローカル手順書を追加済み |
| `M1` | 完了 | stdio MCP server, read-only observation tools/resources, `typecheck`, `smoke:m1` を追加。addon 側 error は MCP tool error に反映。smoke は legacy `addon-staging` を退避して UID duplicate warning を回避。`Godot 4.5+` では `OS.add_logger()` 由来の editor console capture、`4.4` では `.godot/mcp` fallback を返す |
| `M2` | 完了 | `WorkspaceWrite` manifest, scene/node/script write tools, `play_scene` / `stop_scene`, headless external runtime launch, `.godot/mcp/runtime.log`, `smoke:m2` を追加 |
| `M3` | 完了 | `search_project`, `get_uid`, `resolve_uid`, `resave_resources`, `get_selection`, `set_selection`, `focus_node`, capability-aware dynamic tool/resource exposure, `smoke:m3` を追加 |
| `M4` | 完了 | `run_tests`, dynamic prompts, resource templates, capability-gated screenshot/runtime debug surface, `smoke:m4` を追加 |
| `M5` | 進行中 | security level enforcement, `.godot/mcp/audit.log`, 既存の GitHub Actions workflows, packaging scripts, Asset Library checklist を実装。trusted publishing と release hardening が残作業 |
| `M6` | 完了 | `execute_editor_script`, `filesystem_write_raw`, `os_shell`, allowlist/opt-in gating, `smoke:m6` を追加 |

確認済みスモークテスト:

- `npm --prefix packages/server run start`
- `godot_console.exe --headless --editor --quit-after 240 --path .`
- addon 側で `Bridge handshake completed.` と `Ping acknowledged.` を確認
- server 側で `Addon hello accepted.` と `Addon handshake completed.` を確認
- `npm ci --prefix packages/server`
- `scripts/actions/run-server-bootstrap.ps1`
- `scripts/actions/run-bridge-smoke.ps1`
- `scripts/actions/install-godot.ps1` で `4.4.1-stable`, `4.5.1-stable` の取得を確認
- `npm --prefix packages/server run typecheck`
- `npm --prefix packages/server run smoke:m1`
- `npm --prefix packages/server run smoke:m2`
- `npm --prefix packages/server run smoke:m3`
- `npm --prefix packages/server run smoke:m4`
- `npm --prefix packages/server run smoke:m6`
- `scripts/actions/run-bridge-smoke.ps1` を hardening 後の plugin lifecycle で再確認

CI/CD 詳細計画:

- `docs/github-actions-cicd-plan.md`
- `docs/asset-library-release-checklist.md`
- `docs/m1-local-development.md`
- `docs/m2-local-development.md`
- `docs/m3-local-development.md`

## サマリー

| Milestone | 主担当観点 | 目的 | MVP |
| --- | --- | --- | --- |
| `M0` | Architecture | Addon と server の土台を成立させる | 必須 |
| `M1` | Editor Addon | 読み取り中心の観測ループを成立させる | 必須 |
| `M2` | Product | 編集と play/stop を含む最初の開発ループを成立させる | 必須 |
| `M3` | Protocol | search / UID / dynamic capabilities で運用性を上げる | 推奨 |
| `M4` | Runtime/Test | tests / screenshot / telemetry で検証ループを強化する | Post-MVP |
| `M5` | Security/Release | 配布、安全性、監査、CI を固める | Post-MVP |
| `M6` | Advanced Automation | 危険機能を制限付きで追加検証する | Post-MVP |

## M0: Foundation and Contracts

### 目的

Godot Addon と external MCP server がローカル接続し、互いの存在と capability を認識できる最小構成を作る。

### スコープ

- リポジトリ骨格の確定
- `addons/godot_loop_mcp/` の初期化
- `packages/server/` の初期化
- bridge protocol の最小仕様定義
- capability manifest の最小形定義
- 開発用ログと設定の置き場決定

### 成果物

- `plugin.cfg`, `plugin.gd` を含む Addon skeleton
- TypeScript ベースの MCP server skeleton
- `ping` と `handshake` の両方向通信
- version / capability / security level を含む初期メッセージ仕様
- ローカル開発手順書

### 完了条件

- Godot 4.4+ で Addon を有効化できる
- server をローカル起動できる
- Addon から server へ接続し、`ping` が往復する
- server 側で Addon capabilities を受け取ってログ出力できる
- 接続失敗時にタイムアウトと再接続方針が最低限定義されている

### 実装済み

- `project.godot` で `res://addons/godot_loop_mcp/plugin.cfg` を自動有効化
- `addons/godot_loop_mcp/plugin.gd` で ProjectSettings, Tools menu, log 出力, bridge lifecycle を実装
- `addons/godot_loop_mcp/bridge/` で `4-byte big-endian length prefix + JSON` の transport と Addon client を実装
- `addons/godot_loop_mcp/capabilities/capability_registry.gd` で `ReadOnly` の capability manifest を実装
- 現行 branch では `M2` に合わせて `WorkspaceWrite` manifest へ拡張済み
- `packages/server/src/index.ts` と `packages/server/src/transport/` で TCP server, handshake, heartbeat ping, capability logging を実装
- `docs/m0-bridge-contract.md` と `docs/m0-local-development.md` を追加

### 検証済み

- Godot 4.6 CLI で Addon の有効化を確認
- Node.js 22.14.0 で server 起動を確認
- `bridge.handshake.hello` -> `bridge.handshake.sync` -> `bridge.ping` の往復を確認
- Addon log と server stdout で capability 受信を確認

### 後回し項目

- scene/script の具体的な読み書き
- tests 実行
- screenshot
- 任意コード実行

## M1: Read-Only Observation MVP

### 目的

AI が Godot Editor の現在状態を安全に観測できるようにし、破壊的変更なしで状況把握できるようにする。

### スコープ

- `get_project_info`
- `get_editor_state`
- `get_scene_tree`
- `find_nodes`
- `get_open_scripts`
- `view_script`
- `get_godot_errors`
- `get_output_logs`
- 最小 resources の公開

### 成果物

- 読み取り専用 tool 群
- `godot://project/info`
- `godot://scene/current`
- `godot://scene/tree`
- `godot://script/current`
- `godot://errors/latest`

### 完了条件

- MCP client から現在の scene tree を取得できる
- 現在開いている script を列挙・参照できる
- editor の errors/logs を取得できる
- 大きい出力は paging か file fallback のどちらかで扱える
- `ReadOnly` レベルで書き込み系 tool が露出しない

### 実装済み

- `addons/godot_loop_mcp/observation/observation_service.gd` で `get_project_info`, `get_editor_state`, `get_scene_tree`, `find_nodes`, `get_open_scripts`, `view_script` を実装
- `addons/godot_loop_mcp/observation/editor_console_capture.gd` で `Godot 4.5+` の custom logger ring buffer を実装
- `addons/godot_loop_mcp/bridge/bridge_client.gd` に server -> addon の request dispatch を追加
- `packages/server/src/mcp/server.ts` で stdio MCP server と read-only tools/resources を追加
- `packages/server/src/observation/logs.ts` で `editor-console-buffer` と `.godot/mcp` fallback の payload を整理
- `packages/server/src/dev/m1Smoke.ts` と `packages/server/package.json` で `typecheck`, `smoke:m1` を追加
- `docs/m1-local-development.md` を追加

### 検証済み

- `npm --prefix packages/server run typecheck`
- `$env:GODOT_LOOP_MCP_GODOT_BIN = (Get-Command godot_console.exe).Source; npm --prefix packages/server run smoke:m1`
- `powershell -ExecutionPolicy Bypass -File scripts/actions/run-bridge-smoke.ps1 -RepoRoot $PWD.Path -GodotBinaryPath (Get-Command godot_console.exe).Source`

### 後回し項目

- play/stop
- scene/script の書き換え
- tests
- `Godot 4.4` では editor console 全体の public API がないため、引き続き `.godot/mcp` fallback を返す

## M2: Edit and Play Loop MVP

### 目的

`観測 -> 修正 -> play -> logs/errors 確認 -> stop` の最初の自己修復ループを成立させる。

### スコープ

- `play_scene`
- `stop_scene`
- `save_scene`
- `create_scene`
- `open_scene`
- `add_node`
- `move_node`
- `delete_node`
- `update_property`
- `create_script`
- `attach_script`
- `clear_output_logs`

### 成果物

- scene/node 編集 tool 群
- script 新規作成と attach の最小フロー
- play/stop 制御
- 書き込み前提の `WorkspaceWrite` レベル

### 完了条件

- 空 scene を作成して保存できる
- node の追加、移動、削除、property 更新ができる
- script を作成して node へ attach できる
- `play_scene` 実行後に logs/errors を再取得できる
- `stop_scene` 後に editor 状態が破綻しない
- 最小デモとして「1 ノード追加 -> script attach -> play -> log 確認」が通る

### 実装済み

- `addons/godot_loop_mcp/workspace/workspace_service.gd` で scene/node/script write tools と `play_scene` / `stop_scene` を実装
- `addons/godot_loop_mcp/plugin.gd` で observation/workspace dispatch と runtime state provider を配線
- `addons/godot_loop_mcp/observation/observation_service.gd` で `clear_output_logs`, `runtime-log-file`, `runtimeMode`, `runtimeLogPath` を追加
- `packages/server/src/mcp/server.ts` と `packages/server/src/mcp/catalog.ts` で M2 tools を公開
- `packages/server/src/dev/m2Smoke.ts` と `packages/server/package.json` で `smoke:m2` を追加
- `docs/m2-local-development.md` を追加

### 検証済み

- `npm --prefix packages/server run typecheck`
- `$env:GODOT_LOOP_MCP_GODOT_BIN = (Get-Command godot_console.exe).Source; npm --prefix packages/server run smoke:m2`
- `$env:GODOT_LOOP_MCP_GODOT_BIN = (Get-Command godot_console.exe).Source; npm --prefix packages/server run smoke:m1`

### 後回し項目

- tests framework 連携
- screenshot
- UID 管理の本格対応
- dynamic prompts

## M3: Search, UID, and Dynamic Capabilities

### 目的

MVP を運用可能な開発基盤に近づける。  
AI が project 全体を見失いにくいようにし、capability ベースの surface を安定化する。

### スコープ

- `search_project`
- `get_uid`
- `resolve_uid`
- `resave_resources`
- `get_selection`
- `set_selection`
- `focus_node`
- dynamic tools/resources 公開

### 成果物

- `type/path/text` の 3 モード検索
- UID 解決 API
- selection/focus API
- capability registry から tools/resources を組み立てる server 実装

### 完了条件

- asset, scene, script を project 横断で検索できる
- UID から resource を解決できる
- Addon が持たない機能は server 側で未公開になる
- resources 一覧が capability に応じて変化する
- AI が scene path と uid の両方で資産を追跡できる

### 実装済み

- `addons/godot_loop_mcp/project/project_service.gd` で `search_project`, `get_uid`, `resolve_uid`, `resave_resources`, `get_selection`, `set_selection`, `focus_node` を実装
- `addons/godot_loop_mcp/capabilities/capability_registry.gd` に `project.search`, `resource.uid`, `resource.resave`, `editor.selection.read`, `editor.selection.write`, `editor.focus` を追加
- `addons/godot_loop_mcp/plugin.gd` で project service dispatch と capability override merge を追加
- `packages/server/src/mcp/catalog.ts` で capability-aware catalog を定義し、ready session がない間は fallback log surface のみを公開
- `packages/server/src/mcp/server.ts` で M3 tools/resources と SDK の enable/disable による dynamic exposure を実装
- `packages/server/src/dev/m3Smoke.ts` と `packages/server/package.json` で `smoke:m3` を追加
- `docs/m3-local-development.md` を追加

### 検証済み

- `npm --prefix packages/server run typecheck`
- `$env:GODOT_LOOP_MCP_GODOT_BIN = (Get-Command godot_console.exe).Source; npm --prefix packages/server run smoke:m3`
- `$env:GODOT_LOOP_MCP_GODOT_BIN = (Get-Command godot_console.exe).Source; npm --prefix packages/server run smoke:m2`
- `$env:GODOT_LOOP_MCP_GODOT_BIN = (Get-Command godot_console.exe).Source; npm --prefix packages/server run smoke:m1`

### 後回し項目

- tests 実行
- screenshot
- resource templates
- 危険機能

## M4: Verification Loop Hardening

### 目的

play/stop ベースの検証から一歩進めて、テストと補助的な視覚観測を導入する。

### スコープ

- `run_tests`
- GdUnit4 / GUT 検出
- test result の整形と保存
- `get_editor_screenshot` (capability-gated)
- `get_running_scene_screenshot` (capability-gated)
- runtime custom telemetry bridge の最小導入

### 成果物

- tests framework adapter
- structured test results
- screenshot capability の有無を返す仕組み
- `EngineDebugger` / `EditorDebuggerPlugin` を使った custom telemetry channel

### 完了条件

- GdUnit4 または GUT が見つかれば `run_tests` が成功する
- どちらも無い場合は `capability unavailable` を返す
- screenshot 非対応環境では tool が出ないか、明示的に unavailable を返す
- custom telemetry message を 1 つ以上往復できる
- 通常 logs/errors と custom telemetry の責務が文書化されている

### 実装済み

- `addons/godot_loop_mcp/verification/verification_service.gd` で `run_tests`, screenshot, runtime debug event buffer を追加
- `addons/godot_loop_mcp/runtime/runtime_debug_capture.gd`, `runtime_debugger_plugin.gd`, `runtime_telemetry.gd` で最小 telemetry bridge を追加
- `packages/server/src/mcp/server.ts` で dynamic prompts と resource templates を公開
- `packages/server/src/dev/m4Smoke.ts` と `mockTestRunner.mjs` で tests/templates/prompts/audit の smoke を追加
- `docs/m4-local-development.md` を追加

### 検証済み

- `npm --prefix packages/server run typecheck`
- `$env:GODOT_LOOP_MCP_GODOT_BIN = (Get-Command godot_console.exe).Source; npm --prefix packages/server run smoke:m4`

### 後回し項目

- 任意 editor script 実行
- OS command 実行
- unrestricted file write

## M5: Security, Packaging, and CI

### 目的

ローカル実験段階から、配布可能で事故りにくい構成へ移す。

### スコープ

- security level enforcement
- audit log 実装
- GitHub Actions workflow topology (`ci`, `nightly-compat`, `release`) の整備
- Addon と server の配布手順整備
- npm trusted publishing と GitHub Release asset 生成
- Godot Asset Library 向け handoff 手順整備
- version matrix の明文化

補足:

- 詳細実行計画は `docs/github-actions-cicd-plan.md` を source of truth とする

### 成果物

- `ReadOnly`, `WorkspaceWrite`, `Dangerous` の実装
- `.godot/mcp/` への audit log
- GitHub Actions workflow (`ci`, `nightly-compat`, `release`)
- headless fallback を使う PR smoke job
- Godot version matrix を持つ nightly job
- Addon zip / npm package / checksum の release assets
- Addon zip / npm package のリリース手順
- 対応 Godot / Node.js / OS の互換表

### 実装済み

- `packages/server/src/config.ts` で server-side security level を env から解決
- `addons/godot_loop_mcp/config/plugin_settings.gd` と `capability_registry.gd` で addon-side security level / opt-in / allowlist を実装
- `packages/server/src/auditLogger.ts` と `packages/server/src/mcp/server.ts` で tool/resource/prompt の audit log を `.godot/mcp/audit.log` へ出力
- `ci.yml` で `server-check` と `bridge-smoke` を追加
- `nightly-compat.yml` で `windows-latest` / `ubuntu-latest` の nightly smoke matrix を追加
- `release.yml` で release smoke, Addon ZIP, server tarball, `SHA256SUMS`, GitHub Release upload を追加
- `scripts/actions/` に Godot install, smoke, packaging, checksum scripts を追加
- `docs/asset-library-release-checklist.md` を追加
- `packages/server/package-lock.json` と package metadata を追加

### 未完了

- reusable workflow への整理
- npm trusted publisher の repository 側設定
- package の `private: true` 解除と publishable 契約固定

### 完了条件

- 危険レベルに応じて tool 公開が変わる
- tool 呼び出しログに client 名、tool 名、引数ハッシュ、実行時間、失敗内容が残る
- PR で `server-check` と `bridge-smoke` が回る
- nightly で Godot version matrix が回る
- `v*` tag で GitHub Release assets が生成される
- server の npm publish が trusted publishing で明示実行できる
- Addon と server のバージョン対応を文書で追える

### 後回し項目

- 高権限の自動化機能解放
- リモート接続

## M6: Restricted Advanced Automation

### 目的

便利だが危険な自動化を、明示的な opt-in と制限付きで評価する。

### スコープ

- `execute_editor_script`
- `filesystem_write_raw`
- `os_shell`
- restricted execution policy
- 危険操作の二重確認または allowlist

### 完了条件

- `Dangerous` レベル以外では露出しない
- 実行ログと監査が残る
- allowlist か sandbox policy のどちらかがある
- README と docs に明示的な警告がある

### 実装済み

- `addons/godot_loop_mcp/dangerous/dangerous_service.gd` で `execute_editor_script`, `filesystem_write_raw`, `os_shell` を実装
- dangerous tools は `Dangerous` + opt-in / allowlist が揃ったときのみ capability が `enabled` になる
- `packages/server/src/dev/m6Smoke.ts` で dangerous mode の smoke を追加
- `docs/m6-local-development.md` と README に warning と有効化手順を追記

### 検証済み

- `npm --prefix packages/server run typecheck`
- `$env:GODOT_LOOP_MCP_GODOT_BIN = (Get-Command godot_console.exe).Source; npm --prefix packages/server run smoke:m6`

## 実装順の推奨

1. `M0` で bridge と capability 契約を先に固定する
2. `M1` で read-only observation を先に完成させる
3. `M2` で最初の self-repair loop を成立させる
4. `M3` で検索性と capability 動的公開を強化する
5. `M4` で tests と optional screenshot を追加する
6. `M5` で安全性と配布を整える
7. `M6` は最後に限定導入する

## 最初の issue 分解案

### Epic A: Bootstrap

- Addon skeleton を追加
- server skeleton を追加
- handshake protocol を定義
- ローカル起動手順を文書化

### Epic B: Read-Only MVP

- editor state reader
- scene tree reader
- script reader
- logs/errors reader
- resources 初期公開

### Epic C: Edit Loop MVP

- play/stop controller
- scene write API
- node mutation API
- script create/attach API
- write 権限レベル

### Epic D: Validation and Search

- project search
- UID tools
- tests adapter
- output persistence

### Epic E: Security and Release

- capability registry hardening
- audit log
- GitHub Actions CI
- nightly compatibility matrix
- release packaging
- npm trusted publishing
- Asset Library release checklist

## 成功指標

- AI が人手の補助なしで `scene を観測 -> 1 箇所修正 -> play -> logs 確認 -> stop` を完了できる
- `ReadOnly` モードで破壊的変更が露出しない
- capability が無い機能を server が誤って公開しない
- Godot 4.4+ の範囲で再現可能なセットアップ手順がある

## 非目標

- Unity の menu-item モデル完全互換
- 最初からの任意 GDScript 実行
- 最初からの full remote control
- screenshot を全 OS / 全 windowing system で保証すること
