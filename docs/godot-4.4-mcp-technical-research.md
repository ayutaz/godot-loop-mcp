# Godot 4.4+ 向け MCP 技術調査

調査日: 2026-03-12

## 実装追記

この文書は設計判断の調査記録です。  
2026-03-12 時点で `M0: Foundation and Contracts` から `M3: Search, UID, and Dynamic Capabilities` までは repo に反映済みで、`M5` の CI/CD 基盤にも着手済みです。

- 現行の bridge 契約: `docs/m0-bridge-contract.md`
- 現行のローカル起動手順: `docs/m0-local-development.md`
- 現行の M1 観測手順: `docs/m1-local-development.md`
- 現行の M2 編集/実行手順: `docs/m2-local-development.md`
- 現行の M3 search/UID 手順: `docs/m3-local-development.md`
- 現行の進行計画: `docs/implementation-milestones.md`
- 現行の CI/CD 計画: `docs/github-actions-cicd-plan.md`

実装済みの範囲は `Addon skeleton + TypeScript server skeleton + localhost TCP bridge + handshake + bidirectional ping + read/write observation surface + 4.5+ editor console capture + search/UID/dynamic catalog + GitHub Actions CI/CD groundwork` です。  
この調査文書より現行挙動の source of truth を優先する場合は、上記文書と実装コードを参照してください。2026-03-12 時点では `M0` から `M3` が実装済みで、現行挙動は `docs/m0-bridge-contract.md`, `docs/m1-local-development.md`, `docs/m2-local-development.md`, `docs/m3-local-development.md` を優先します。

## 結論

uLoopMCP をベンチマークにして Godot 向け MCP を作るなら、最も妥当な方針は `Godot Editor Addon + 外部 MCP Server + ローカル双方向ブリッジ` のハイブリッド構成です。  
既存の Godot MCP は大きく `headless/CLI 型` と `Editor Addon 常駐型` に分かれますが、uLoopMCP の強みである「AI が開発ループを回し続けられること」を Godot で再現するには、Editor の現在状態、開いている Scene/Script、実行中ゲーム、エラー、スクリーンショットへ直接アクセスできる Addon 常駐型が中核になります。

Godot 4.4 を最低保証にする判断は、API の必然というより製品・運用判断として妥当です。理由は 3 つあります。

1. `ResourceUID` と `uid://` を含む UID ベース設計は Godot 4.0 系から可能であり、4.4 採用理由を「UID が使えるから」ではなく「互換範囲を固定するため」と整理できる。
2. 既存 Godot MCP 実装や比較対象を 4.4 系に寄せると、検証対象を絞りやすい。
3. テスト基盤として有力な GdUnit4 の互換表でも 4.4 系が明示的にサポートされている。

補足: これは「Godot 4.4 でないと Addon が作れない」という意味ではありません。  
推論としては、4.4 を下限にした方が製品仕様、CI、ドキュメント、サポート運用をかなり単純化できます。

## 調査の要約

### uLoopMCP から抽出すべきベンチマーク要件

uLoopMCP の本質は、単に Unity を操作することではなく、AI に次の開発ループを与えている点です。

- `compile`
- `run-tests`
- `get-logs`
- `clear-console`
- `get-hierarchy`
- `unity-search`
- `screenshot`
- `play/stop`
- `execute-dynamic-code`

さらに設計面で重要なのは以下です。

- 外部 MCP Server と Editor 内ブリッジを分離している
- Editor 側ツールを動的に公開できる
- セキュリティレベルを持つ
- 大きい出力をファイルへ逃がせる
- AI が「修正 -> 検証 -> 観察」を反復しやすい

Godot 版も、このループを基準に機能を選ぶべきです。単なる `scene を作る MCP` では uLoopMCP の代替になりません。

### 既存 Godot MCP の類型

| 実装 | 型 | 強み | 弱み | uLoopMCP ベンチマークとの距離 |
| --- | --- | --- | --- | --- |
| `bradypp/godot-mcp` | Node.js + Godot headless/CLI | 導入が軽い、Scene/UID 操作が分かりやすい、read-only mode がある | Editor の生状態に弱い、ライブな階層/選択/スクリーンショットに弱い | 中 |
| `matula/godot-mcp-server` | Node.js + CLI | 構成が最小、Addon 不要 | ほぼバッチ処理型、Editor 常駐観測ができない | 低 |
| `ee0pdt/Godot-MCP` | Godot Addon + FastMCP + WebSocket | Resources と Tools の両方を持つ、Editor 状態に近い | 実装が若く、セキュリティと堅牢性はこれから | 高 |
| `Dokujaa/Godot-MCP` | Godot Addon + Python FastMCP + TCP | Editor 制御、スクリプト/アセット操作、Prompt 提供まである | 任意操作が強く安全境界が薄い、機能が広く品質ばらつきリスク | 中〜高 |
| `GDAI MCP` | 商用/製品系 Addon | ツール面が広い、エラー取得やスクリーンショットなど実運用寄り | 実装詳細が閉じている | 高 |

### 既存実装から見えたパターン

#### 1. CLI/headless 型

例: `bradypp/godot-mcp`, `matula/godot-mcp-server`

特徴:

- `godot --headless --path ... --script ...` で一回ごとに処理する
- Scene や resource を直接作る
- `run_project` は別プロセスで起動し stdout/stderr を拾う
- 導入が簡単

限界:

- Editor で現在開いている Scene / Script / Selection を取りにくい
- 実行中ゲームと Editor のあいだの観測ループが弱い
- uLoopMCP の `get-hierarchy`, `screenshot`, `play-mode`, `dynamic code` に相当する体験が薄い

#### 2. Editor Addon 常駐型

例: `ee0pdt/Godot-MCP`, `Dokujaa/Godot-MCP`, `GDAI MCP`

特徴:

- `EditorPlugin` が Godot Editor 内で常駐する
- 外部 MCP server とは TCP / WebSocket で接続する
- Scene tree, current script, selection, editor state に直接アクセスできる
- スクリーンショット、実行制御、エラー取得がやりやすい

課題:

- セキュリティ設計が必須
- 接続管理、タイムアウト、再接続、バージョン互換を丁寧に作る必要がある
- Addon と外部 server の 2 面保守になる

#### 3. ハイブリッド型が本命

uLoopMCP ベンチマークを満たすには、次の役割分担が最も自然です。

- Godot Addon:
  - Editor 状態、Scene、Script、Runtime、エラー、スクリーンショットへのアクセス
- 外部 MCP Server:
  - MCP tools/resources の提供と、必要に応じた prompts
  - クライアント互換
  - 接続管理
  - 出力整形
- headless fallback:
  - プロジェクト検索
  - UID 再生成
  - CI 用テストや非対話操作

## 15 人の専門家レビュー

以下は「15 人の専門家が別々に見たと仮定した観点レビュー」を 1 つに統合したものです。

| 専門家 | 見解 | 具体的な提案 |
| --- | --- | --- |
| 1. プロダクト設計 | 目標は「Godot を操作する」ではなく「AI の自己修復ループを成立させる」こと | MVP から `errors/logs + scene tree + open script + play/stop` を入れる |
| 2. MCP プロトコル | Godot 版は `resources` を早期に整備し、`prompts` は後続の UX 補助として入れるのがよい | `godot://scene/current`, `godot://script/current`, `godot://project/info` を resources 化し、prompts は Phase 2 以降に回す |
| 3. Godot Editor Addon | Editor 常駐でないと現在の編集状態にアクセスしづらい | 中核は `EditorPlugin` に置く |
| 4. Runtime/Debugger | 実行中ゲームの観測がないと uLoop 的な修正ループが弱い | `EditorDebuggerPlugin` と `EngineDebugger` で custom runtime telemetry bridge を検証し、標準ログ/例外回収とは分けて設計する |
| 5. Scene/Node 操作 | Godot は Node/Scene が中心で Unity の GameObject/Prefab と違う | API 名は `get_scene_tree`, `add_node`, `move_node`, `update_property` に寄せる |
| 6. Script 操作 | ファイル編集だけでなく「今開いている script」を扱える価値が高い | `get_open_scripts`, `view_script`, `edit_file`, `attach_script` を分離する |
| 7. Asset/UID | `ResourceUID` を前提にすると参照整合が改善する。ただし 4.4 下限の主根拠にはしない | `get_uid`, `resolve_uid`, `resave_resources` を入れる |
| 8. 検索 | Unity Search の完全互換は難しいが需要は高い | `search_project` を `type/path/text` の 3 モードで用意する |
| 9. テスト | Godot には Unity Test Runner 相当の標準一本化がない | GdUnit4 と GUT を検出してラップする `run_tests` を作る |
| 10. セキュリティ | 任意 GDScript 実行は便利だが最も危険 | `execute_editor_script` は Phase 3、かつ `Disabled/Restricted/Full` の段階制にする |
| 11. クロスプラットフォーム | Godot 利用者は Windows/macOS/Linux に散る | Node.js + TS を server 側の第一候補にする |
| 12. パフォーマンス | 毎回 headless 起動するだけでは反復ループが遅い | 常駐 Addon 接続を基本、headless は fallback に限定する |
| 13. UX/DX | AI は「何ができるか」を知らないと失敗しやすい | 接続時に capabilities を返し、MCP tools を動的公開する |
| 14. リリース運用 | Addon と server を別々に配ると更新事故が起きやすい | npm package と Godot Asset/zip を同時リリースし、互換表を明示する |
| 15. 競合/OSS 分析 | 既存実装は機能の断片はあるが、uLoop のような検証ループ最適化が弱い | 差別化点を `self-hosted dev loop for Godot` に置く |

## Godot 4.4+ で使うべき主要 API

### Editor 側

- `EditorPlugin`
  - dock/bottom panel の追加
  - Addon のライフサイクル管理
- `EditorInterface`
  - `get_edited_scene_root`
  - `open_scene_from_path`
  - `save_scene`
  - `get_script_editor`
- `EditorSelection`
  - 現在選択中ノード取得

### Runtime / Debug 側

- `EditorDebuggerPlugin`
  - debugger session の capture
  - custom message の受信フック
- `EngineDebugger`
  - runtime 側からの custom message 送信

推論:

`EngineDebugger.send_message` を実行中ゲーム側、`EditorDebuggerPlugin._capture` を Editor 側で使う構成は、Godot の Runtime -> Editor の custom event 橋として自然です。  
ただし、これだけで標準の例外・ログ収集まで一元化できるとは限りません。MVP では「構造化した runtime telemetry を push できる」ことを狙い、通常ログや例外の取得経路は別に設計する方が安全です。

### 視覚観測

- `DisplayServer.screen_get_image`

注意:

公式 API から確認できるのは画面単位のキャプチャで、OS や windowing system の制約も受けます。  
Unity の `EditorWindow` 単位キャプチャに完全一致する公開 API は今回確認した資料では見つけられませんでした。  
そのため screenshot は必須機能ではなく capability-gated にし、`screenshot.editor` / `screenshot.game` を公開できる環境だけで有効化するのが現実的です。MVP は「Editor 全体」または「実行中ゲーム window」キャプチャが取れれば十分で、後続で panel crop を検討します。

### ファイル識別

- `ResourceUID`
  - `id_to_text`
  - `text_to_id`
  - `has_id`

注意:

`ResourceUID` は Godot 4.0 系から利用可能です。  
したがって、ここは 4.4 固有機能として扱うのではなく、「4.4 で互換保証を固定する」という製品判断と切り分けて記述する方が正確です。

### headless fallback

- `godot --headless`
- `--path`
- `--script`

## uLoopMCP 対応表

| uLoopMCP の価値 | Godot での相当案 | 実装難易度 | 優先度 |
| --- | --- | --- | --- |
| `compile` | `validate_project` または `get_godot_errors` | 中 | 高 |
| `run-tests` | `run_tests` (GdUnit4/GUT ラッパー) | 中 | 高 |
| `get-logs` | `get_godot_errors`, `get_output_logs` | 低 | 高 |
| `clear-console` | `clear_output_logs` | 低 | 高 |
| `play/stop` | `play_scene`, `stop_scene` | 低 | 高 |
| `get-hierarchy` | `get_scene_tree` | 低 | 高 |
| `unity-search` | `search_project` | 中 | 高 |
| `screenshot` | `get_editor_screenshot`, `get_running_scene_screenshot` (capability-gated) | 中 | 中 |
| `find-gameobjects` | `find_nodes` | 低 | 中 |
| `execute-menu-item` | `editor_action` の明示 API | 中 | 低 |
| `get-menu-items` | 1:1 互換は薄い。capabilities 公開で代替 | 高 | 低 |
| `execute-dynamic-code` | `execute_editor_script` | 高 | 低 |

重要な差分:

- Godot は Unity のような「公開メニュー列挙 API」を前提にしにくい
- Godot は GDScript / Scene / Resource を直接扱う比率が高い
- `compile` は Unity より概念が弱く、`errors/validation` が中心になる

## 推奨アーキテクチャ

### 全体像

```text
MCP Client
  -> External MCP Server (TypeScript)
  -> Local Bridge (JSON-RPC over TCP)
  -> Godot Editor Addon
  -> Godot Editor / Runtime
```

### 推奨理由

#### 1. TypeScript を server 側の第一候補にする

理由:

- uLoopMCP と同じく Node.js/TypeScript で MCP SDK の相性が良い
- Claude Code / Cursor / VS Code 周辺の MCP 事例が多い
- JSON-RPC、再接続、ログ整形、resources と optional prompts の実装がしやすい

Python でも可能ですが、今回のベンチマークが uLoopMCP であること、既存 Godot 実装でも Node 系が多いことから、第一候補は TypeScript が妥当です。

#### 2. 通信は localhost の双方向 JSON-RPC

推奨:

- Transport: localhost TCP
- Message: JSON-RPC 2.0
- Framing: 長さ prefix か `Content-Length`

理由:

- uLoopMCP と思想が近い
- push notification が作りやすい
- 動的 tool refresh に向く

補足:

既存 Godot 実装には WebSocket 型もあります。  
WebSocket でも成立しますが、今回の調査では「Godot 版 uLoop」を狙うなら、transport そのものより `双方向イベント` と `再接続性` の方が重要です。

#### 3. Addon 側に capability registry を持つ

Addon は起動時に自分の capabilities を server に返します。例:

- `scene.read`
- `scene.write`
- `script.read`
- `script.write`
- `runtime.debug`
- `screenshot.editor`
- `screenshot.game`
- `tests.gdunit4`
- `tests.gut`
- `danger.execute_editor_script`

外部 MCP Server はこれを見て tools/resources を動的公開します。  
これが uLoopMCP の「Editor 側の真実を server が反映する」設計に一番近いです。

## 推奨ツールセット

### Phase 0: 読み取り中心 MVP

完了条件: AI が現在の editor/project 状態を破壊的変更なしで観測できる。

- `ping`
- `get_project_info`
- `get_editor_state`
- `get_scene_tree`
- `find_nodes`
- `get_open_scripts`
- `view_script`
- `get_godot_errors`
- `get_output_logs`
- `search_project`

### Phase 1: 開発ループの成立

完了条件: AI が `観測 -> play/stop -> 軽微な scene/script 変更 -> 再観測` を回せる。

- `play_scene`
- `stop_scene`
- `save_scene`
- `create_scene`
- `add_node`
- `move_node`
- `delete_node`
- `update_property`
- `create_script`
- `attach_script`
- `clear_output_logs`

### Phase 2: uLoopMCP への本格追従

完了条件: テスト、UID、resources、必要なら screenshot まで含めて運用機能を広げられる。

- `run_tests`
- `get_uid`
- `resolve_uid`
- `resave_resources`
- `open_scene`
- `focus_node`
- `get_selection`
- `set_selection`
- `export_packed_scene`
- `get_editor_screenshot` (capability-gated)
- `get_running_scene_screenshot` (capability-gated)

### Phase 3: 危険機能

- `execute_editor_script`
- `filesystem_write_raw`
- `os_shell`

この層は disabled default にすべきです。

## Resources / Prompts 設計

既存 Godot MCP の中では `ee0pdt/Godot-MCP` と `Dokujaa/Godot-MCP` がここを意識しています。  
Godot 版では tools に加えて resources を早期導入する価値が高く、prompts は後続の UX 補助として扱うのがよいです。

### Resources

- `godot://project/info`
- `godot://project/settings`
- `godot://scene/current`
- `godot://scene/tree`
- `godot://selection/current`
- `godot://script/current`
- `godot://scripts/open`
- `godot://errors/latest`

### Resource templates

- `godot://scene/{path}`
- `godot://script/{path}`
- `godot://node/{scene_path}/{node_path}`
- `godot://resource/{uid}`

### Prompts

Prompts は user-controlled な補助機能なので、自己修復ループの中核には置かず、Phase 2 以降の DX 改善として導入する前提にします。

- `godot_editor_strategy`
- `godot_ui_layout_strategy`
- `godot_debug_loop`
- `godot_scene_edit_safety`

uLoopMCP は skill ベースで UX を補っていますが、Godot 版は MCP の `prompts` を併用すると人間オペレータ向けの誘導を追加しやすくなります。

## テスト戦略

Godot の大きな差分は、Unity Test Runner のような「事実上の標準 1 本」が弱いことです。  
そのため `run_tests` はフレームワーク抽象化で設計するべきです。

推奨方針:

1. GdUnit4 が見つかれば最優先で使う
2. GUT が見つかれば fallback に使う
3. どちらも無ければ capability unavailable を返す

理由:

- GdUnit4 は Godot 4 向けの統合的なテスト基盤で、GDScript/C# と scene testing に強い
- GUT も Godot 4 系で広く使われる

## セキュリティ方針

uLoopMCP の良い点は、危険機能を「あるけど雑に開かない」ことです。Godot 版でも同じ原則が必要です。

### 推奨セキュリティレベル

| レベル | 内容 |
| --- | --- |
| `ReadOnly` | 読み取り専用。scene/script/resource の参照のみ |
| `WorkspaceWrite` | scene/script の通常編集、保存、play/stop、tests |
| `Dangerous` | 任意 script 実行、OS 操作、外部プロセス、raw file write |

### 最初から禁止すべきもの

- `OS.execute` の素通し
- `FileAccess` / `DirAccess` の unrestricted 実行
- 任意ネットワークアクセス
- 任意 editor script 実行の default enabled

### 監査ログ

少なくとも以下は `.godot/mcp/` などへ残すべきです。

- 接続クライアント名
- tool 呼び出し名
- 引数ハッシュ
- 実行時間
- 危険レベル
- 失敗内容

## 推奨ディレクトリ構成

```text
godot-loop-mcp/
  addons/
    godot_loop_mcp/
      plugin.cfg
      plugin.gd
      bridge/
      tools/
      resources/
      runtime/
      ui/
  packages/
    server/
      src/
        mcp/
        transport/
        capabilities/
        tools/
        resources/
        prompts/
  docs/
```

## 実装ロードマップ

### Sprint 1

- EditorPlugin 起動
- localhost bridge 接続
- `ping`
- `get_project_info`
- `get_editor_state`
- `get_scene_tree`
- `get_open_scripts`
- `get_godot_errors`
- 最小 resources (`godot://project/info`, `godot://scene/current`)

### Sprint 2

- `play_scene` / `stop_scene`
- `create_scene`
- `add_node`
- `update_property`
- `view_script`
- `attach_script`
- `save_scene`
- `clear_output_logs`

### Sprint 3

- `search_project`
- capabilities ベースの動的 tool 公開
- core resources (`godot://scene/tree`, `godot://scripts/open`, `godot://errors/latest`)
- prompts の足場づくり (optional)

### Sprint 4

- `run_tests` with GdUnit4/GUT detection
- UID tools
- `get_editor_screenshot` / `get_running_scene_screenshot` (capability-gated)
- output persistence
- security levels

### Sprint 5

- `execute_editor_script` の restricted 実験
- runtime custom debugger message bridge
- CI / packaging / version matrix

## 最終提言

### 採るべき方針

- Godot 4.4+ を最低保証にする
- ただし 4.4 下限の主根拠は API の有無ではなく、互換保証と運用簡素化に置く
- uLoopMCP と同じく `Editor 内ブリッジ + 外部 MCP server` を採る
- MVP から `観測 -> 修正 -> 再検証` のループを優先する
- `resources` は tools と同格で扱い、`prompts` は後続の UX 補助として扱う
- 危険機能は後回しにする

### 採らない方がよい方針

- headless/CLI だけで完結させる
- 最初から任意 GDScript 実行を開放する
- Unity の menu-item モデルをそのまま移植しようとする
- Scene/Script をすべてテキスト直編集で済ませる

### ひとことで言うと

Godot 版の勝ち筋は、「Godot を操作できる MCP」ではなく「Godot の自己修復型開発ループを回せる MCP」を作ることです。  
そのための中心技術は `EditorPlugin`, `EditorInterface`, 必要に応じた `EditorDebuggerPlugin` / `EngineDebugger` の custom event bridge, `ResourceUID`, そして外部 MCP Server との双方向ブリッジです。

## 参考ソース

### ベンチマーク

- uLoopMCP README  
  https://github.com/hatayama/uLoopMCP
- uLoopMCP Unity architecture  
  https://github.com/hatayama/uLoopMCP/blob/main/Packages/docs/ARCHITECTURE_Unity.md
- uLoopMCP TypeScript architecture  
  https://github.com/hatayama/uLoopMCP/blob/main/Packages/docs/ARCHITECTURE_TypeScript.md
- uLoopMCP tool reference  
  https://github.com/hatayama/uLoopMCP/blob/main/Packages/src/TOOL_REFERENCE.md

### 既存 Godot MCP

- bradypp/godot-mcp  
  https://github.com/bradypp/godot-mcp
- ee0pdt/Godot-MCP  
  https://github.com/ee0pdt/Godot-MCP
- matula/godot-mcp-server  
  https://github.com/matula/godot-mcp-server
- Dokujaa/Godot-MCP  
  https://github.com/Dokujaa/Godot-MCP
- GDAI MCP Docs  
  https://gdaimcp.com/docs/
- GDAI MCP Supported Tools  
  https://gdaimcp.com/docs/supported-tools

### Godot 4.4 公式

- Command line tutorial  
  https://docs.godotengine.org/en/4.4/tutorials/editor/command_line_tutorial.html
- `EditorPlugin`  
  https://docs.godotengine.org/en/4.4/classes/class_editorplugin.html
- `EditorInterface`  
  https://docs.godotengine.org/en/4.4/classes/class_editorinterface.html
- `EditorSelection`  
  https://docs.godotengine.org/en/4.4/classes/class_editorselection.html
- `EditorDebuggerPlugin`  
  https://docs.godotengine.org/en/4.4/classes/class_editordebuggerplugin.html
- `EngineDebugger`  
  https://docs.godotengine.org/en/4.4/classes/class_enginedebugger.html
- `DisplayServer`  
  https://docs.godotengine.org/en/4.4/classes/class_displayserver.html
- `EditorScript`  
  https://docs.godotengine.org/en/4.4/classes/class_editorscript.html
- `ResourceUID`  
  https://docs.godotengine.org/en/4.4/classes/class_resourceuid.html

### MCP 公式

- MCP Docs  
  https://modelcontextprotocol.io/docs/getting-started/intro
- MCP Spec: Resources  
  https://modelcontextprotocol.io/specification/2025-06-18/server/resources
- MCP Spec: Prompts  
  https://modelcontextprotocol.io/specification/2025-06-18/server/prompts

### テスト基盤

- GdUnit4  
  https://github.com/MikeSchulze/gdUnit4
- GUT  
  https://github.com/bitwes/Gut
