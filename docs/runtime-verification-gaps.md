# Runtime Verification Gaps

Status: 2026-04-05 時点で主要 gap は対応済みです。  
実装は「Add runtime verification MCP tools」の変更で追加されています。  
この文書は、対応前に見つかった課題の記録として残します。

更新日: 2026-04-05

この文書は、`godot-loop-mcp` を使って外部プロジェクトの runtime 動作確認を行った際に見つかった課題、問題点、要望をまとめたものです。  
今回の起点は、`godot-piper-plus` の音声合成と再生確認を Codex から行おうとしたケースでした。

## 背景

確認したかったこと:

- Godot の Play 実行中に `PiperTTS.initialize()` が通るか
- ボタン操作経由で音声合成が走るか
- `AudioStreamPlayer` に stream が入り、実際に再生状態へ遷移したか
- エラーが出た場合に runtime 側でどこまで追跡できるか

今回の確認で分かったのは、`godot-loop-mcp` 本体には runtime 制御と GUI runtime 観測の土台がある一方、現在の Codex 側接続では logs/errors の一部 surface しか使えず、実際の runtime 検証を最後まで閉じられない、という点です。

## 確認できたこと

### 既に `godot-loop-mcp` 側へ実装されている surface

次の runtime 関連 surface は、server / addon 実装上は存在しています。

- `play_scene`
- `stop_scene`
- `get_running_scene_screenshot`
- `get_runtime_debug_events`
- `clear_runtime_debug_events`
- `simulate_mouse`

参照:

- `packages/server/src/mcp/server.ts`
- `packages/server/src/mcp/catalog.ts`
- `addons/godot_loop_mcp/verification/verification_service.gd`
- `addons/godot_loop_mcp/workspace/workspace_service.gd`

### 今回の Codex 側で実際に使えた surface

今回の実行環境で利用できた `godotLoopMCP` tool は次だけでした。

- `clear_output_logs`
- `get_output_logs`
- `get_godot_errors`

このため、Codex からは runtime を play/stop したり、running scene screenshot や runtime debug event を直接取得したり、mouse input を送ったりできませんでした。

### 別経路で確認できたこと

shell 経由で `godot_console.exe --headless --path . -s <temp script>` を実行すると、`PiperTTS.initialize()` と `synthesize()` までは確認できました。  
ただしこれは `godot-loop-mcp` の runtime 制御ではなく、直接起動した Godot process です。

## 課題

### 1. Codex から見える tool surface が不完全

`godot-loop-mcp` 本体では runtime 制御と GUI runtime 観測の tool が実装済みでも、現在の Codex 側接続ではそれらが利用できません。  
結果として、「MCP で確認する」と言っても、実態としては logs/errors の読み取りに限定されます。

### 2. logs/errors だけでは再生確認を閉じられない

`get_output_logs` と `get_godot_errors` では次は確認できます。

- 初期化成功/失敗
- `push_error` の発生
- headless runtime の標準出力

しかし次は確認できません。

- `AudioStreamPlayer.play()` が呼ばれたか
- ノードの `playing` 状態が `true` になったか
- 再生位置が進んだか
- 音が実際に出るべき状態になったか

音声系の検証では、この不足がそのまま詰まりどころになります。

### 3. shell 直起動 runtime と MCP runtime capture の境界が分かりづらい

`get_output_logs` / `get_godot_errors` が読む runtime log は、`play_scene` が起動した external runtime 向けです。  
shell から直接起動した Godot process の出力は、現在の MCP runtime capture には自動では載りません。

このため、Codex 側では次のような誤解が起きやすいです。

- shell で動かした runtime も MCP の `get_output_logs` で取れると思ってしまう
- `play_scene` 未使用でも runtime 側の状態が拾えると思ってしまう

### 4. GUI runtime 検証の前提条件が利用側に伝わりにくい

`get_running_scene_screenshot` と `runtime.debug` は GUI editor と capability 前提ですが、利用側から見ると「使えない理由」が分かりにくいです。  
「未実装」なのか「未接続」なのか「headless だから不可」なのかを切り分けにくい状態です。

## 問題点

今回のユースケースで実際に問題になった点は次です。

- Codex から Godot の Play ボタン相当を叩いて、そのまま runtime を追う流れを MCP だけで閉じられない
- 実行中 scene の node state を取得できないため、UI ボタン押下後の状態遷移を確認できない
- audio 系では「合成できた」と「再生できた」の間に観測断面がない
- shell fallback を使うと MCP の runtime 観測系と分断される

## 要望

### 1. Codex 側に runtime 系 tool をフル公開したい

最低限、次は Codex から直接使える状態にしたいです。

- `play_scene`
- `stop_scene`
- `get_running_scene_screenshot`
- `get_runtime_debug_events`
- `clear_runtime_debug_events`
- `simulate_mouse`

`godot-loop-mcp` 本体では既に存在するため、優先度としては「新規実装」より「接続と公開の整備」が先です。

### 2. running scene の状態確認 surface が欲しい

runtime 観測として次のどれか、または複数が欲しいです。

- running scene の node tree 取得
- node path 指定で property 読み取り
- signal 発火待ち
- 条件待ち
  - 例: `AudioStreamPlayer.playing == true`
  - 例: `Label.text` に特定文字列が出る

候補名:

- `get_running_scene_tree`
- `get_running_node`
- `get_running_node_property`
- `wait_for_runtime_condition`
- `wait_for_runtime_signal`

### 3. audio 再生確認向けの専用観測が欲しい

音声系の検証では、少なくとも次のどれかがあると有効です。

- `AudioStreamPlayer` 一覧と `playing` / `stream_paused` / 再生位置
- `AudioServer` bus peak meter
- 直近に再生キューされた audio buffer の長さ、sample rate、hash
- runtime 側で最後に `play()` された node path

ここがあると、「音が出たか」を人間の耳以外でもかなり高い精度で判定できます。

### 4. shell 実行との境界を docs で明記したい

少なくとも次は README か quick reference に明記したいです。

- `play_scene` 起動 runtime のみが MCP runtime capture 対象であること
- shell 直起動 runtime は MCP runtime capture へ自動接続されないこと
- GUI 必須 tool と headless で使える tool の一覧

## 最小到達目標

Codex から次ができる状態を、runtime 検証の最小完成形としたいです。

1. `play_scene` で対象 scene を起動する
2. `simulate_mouse` または同等の手段で UI を操作する
3. `get_runtime_debug_events` または running node/property 読み取りで状態遷移を確認する
4. audio 系では `AudioStreamPlayer` の再生状態または audio telemetry を確認する
5. 必要に応じて `get_running_scene_screenshot` で画面状態も確認する

この流れが通れば、「MCP で実際に動作確認した」と言える範囲がかなり明確になります。
