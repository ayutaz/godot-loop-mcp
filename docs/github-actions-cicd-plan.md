# GitHub Actions CI/CD 計画

作成日: 2026-03-12  
更新日: 2026-03-13  
対象リポジトリ: `godot-loop-mcp`

## 目的

この文書は、`godot-loop-mcp` の GitHub Actions ベース CI/CD 実行計画を定義します。  
目的は 3 つです。

- Pull Request ごとに壊れていないことを短時間で検証する
- Godot / Node.js の互換性を定期確認する
- tag ベースで Addon と server を再現可能に配布する

## 現在の実装状況

2026-03-12 時点で、次は実装済みです。

- `.github/workflows/ci.yml`
- `.github/workflows/nightly-compat.yml`
- `.github/workflows/release.yml`
- `scripts/actions/install-godot.ps1`
- `scripts/actions/run-server-bootstrap.ps1`
- `scripts/actions/run-bridge-smoke.ps1`
- `scripts/actions/package-addon.ps1`
- `scripts/actions/write-sha256.ps1`
- `packages/server/package-lock.json`

現時点で残っている差分は次です。

- `packages/server/package.json` はまだ `private: true`
- npm trusted publisher の repository 側設定は未実施
- `run_tests` 系 workflow と test report asset の CI 統合は未実装
  - repo には `run_tests` adapter と `smoke:m4` があるが、Actions workflow にはまだ接続していない
- `export_presets.cfg` は未作成
- reusable workflow 化はまだ行っていない

補足:

このため、現行の CD は `GitHub Release asset 生成` までは自動化し、`npm publish` は explicit opt-in + repository variable 前提の dormant job として置いています。

ローカル検証の source of truth:

- `docs/implementation-milestones.md`

## マルチエージェント統合結論

- `QA 観点`: PR で回すのは高速で壊れにくい smoke に絞り、重い互換 matrix は nightly へ分離する
- `Release 観点`: 配布の source of truth は git tag と GitHub Release に置く
- `Package 観点`: server の npm publish は long-lived token ではなく OIDC trusted publishing を前提にする
- `Security 観点`: job permissions は最小化し、release 系だけ `id-token: write` を許可する
- `Ops 観点`: reusable workflow, concurrency, artifact retention を最初から設計に入れる

## 配布方針

配布チャネルは次の 3 本立てにします。

1. `GitHub Release`
   - すべての正式配布物の集約地点
   - `addon zip`, `npm pack tarball`, `SHA256SUMS`, `smoke logs` を添付する
2. `npm`
   - `@godot-loop-mcp/server` を publish 対象にする
   - publish は trusted publishing 設定完了後に `workflow_dispatch` で明示実行する
3. `Godot Asset Library`
   - GitHub Release に添付した Addon ZIP を元に公開する
   - 公式 docs 上は Web フォーム前提なので、自動 submit ではなく半手動運用にする

推論:

Godot Asset Library には人手レビューと Web 入力が残るため、ここまで完全自動化すると運用が不安定になります。  
したがって現行の自動終端は `GitHub Release` とし、`npm publish` は trusted publishing 設定完了後に有効化、Asset Library は `release candidate を生成済みの手動昇格` として扱うのが妥当です。

## Workflow トポロジ

作成する workflow は次の構成を前提にします。

### 1. `ci.yml`

用途:

- `pull_request`
- `push` to `main`

責務:

- server の高速検証
- Godot bridge の最小 smoke
- 失敗時 artifact の保存

想定 job:

- `server-check`
- `bridge-smoke`
- `docs-guard` 任意

### 2. `nightly-compat.yml`

用途:

- `schedule`
- `workflow_dispatch`

責務:

- Godot minor version matrix の定期確認
- 将来の test framework adapter 検証
- OS 差分の早期検知

想定 job:

- `compat-godot-matrix`
- `compat-framework-matrix`

### 3. `release.yml`

用途:

- `push` tags: `v*`
- `workflow_dispatch`

責務:

- full CI の再実行
- Addon ZIP 作成
- `npm pack`
- GitHub Release 生成と asset 添付
- npm trusted publishing

想定 job:

- `verify-release`
- `package-addon`
- `package-server`
- `publish-github-release`
- `publish-npm` (manual opt-in)

### 4. reusable workflows

現行実装では、まず direct workflow で `ci`, `nightly-compat`, `release` を成立させています。  
reusable workflow への切り出しは、M5 の後半で重複が増えた時点で行います。

## CI 実行計画

### Phase A: M0 ベースライン CI

開始条件:

- 現在の M0 を GitHub Actions 上で再現できるようにする

PR で回す job:

- `server-check`
  - `actions/checkout`
  - `actions/setup-node`
  - `npm ci`
  - `npm pack --dry-run`
  - `run-server-bootstrap.ps1` で listen まで確認
- `bridge-smoke`
  - server をバックグラウンド起動
  - Godot headless editor を起動
  - `.godot/mcp/addon.log` と server log を artifact 化
  - `Bridge handshake completed.` と `Ping acknowledged.` を検証

初期 runner 方針:

- `windows-latest` を最初の正式 smoke にする

理由:

現時点の実測が Windows CLI ベースであり、M0 の再現性を先に固定した方が失敗原因を切り分けやすいからです。  
`ubuntu-latest` は nightly から追加し、Linux headless 差分を吸収してから PR 常設へ上げます。

### Phase B: M1 Read-Only CI

開始条件:

- `get_project_info`, `get_editor_state`, `get_scene_tree`, `get_output_logs` などの read-only surface が実装される

追加 job:

- `observation-integration`
  - fixture project か sample scene を開く
  - resource/tool 呼び出し結果を snapshot で検証
  - `Godot 4.5+` では `editor-console-buffer`、`4.4` では `bridge-log-fallback` を検証
  - large output の paging か file fallback を検証

現状メモ:

- `smoke:m1` で version-aware log backend の切り替え確認は実装済み
- CI の専用 `observation-integration` job はまだ未追加

### Phase C: M2 Edit/Play CI

開始条件:

- scene 編集と `play_scene` / `stop_scene` が実装される

追加 job:

- `edit-loop-integration`
  - scene 生成
  - node 追加
  - script attach
  - play
  - log 取得
  - stop

重要方針:

- 破壊的な編集検証は使い捨て fixture project 上でのみ実行する
- PR CI では 1 本の短い golden path に絞る

現状メモ:

- ローカルでは `smoke:m2` を実装済み
- Windows headless では `play_scene` が external runtime process を起動し、`runtime-log-file` backend を検証対象にする

### Phase D: M4 Verification CI

開始条件:

- `run_tests` adapter と screenshot capability の有無判定は repo 実装済み
- CI workflow へ組み込む段階に入る

追加 job:

- `gdunit4-adapter`
- `gut-adapter`
- `telemetry-smoke`
- `screenshot-capability-check`

方針:

- screenshot は pass/fail の本体にせず capability report として扱う
- GdUnit4 / GUT は検出結果と report を artifact 保存する

## CD 実行計画

### Release トリガ

- 正式 release は `vX.Y.Z` tag を唯一の自動 release トリガにする
- 手動再実行は `workflow_dispatch` を許可する

補足:

`workflow_dispatch` は default branch 上の workflow を手動実行できます。  
tag push を唯一の自動 release 条件にしつつ、再発行や dry-run は手動で逃がせる形にします。

### Release 成果物

GitHub Release に添付する成果物:

- `godot-loop-mcp-addon-vX.Y.Z.zip`
- `godot-loop-mcp-server-vX.Y.Z.tgz`
- `SHA256SUMS.txt`
- `smoke-logs-vX.Y.Z.zip`

補足:

`test-reports-vX.Y.Z.zip` は CI workflow に `run_tests` job を組み込んだ時点で追加します。

### Addon packaging

ZIP には最低限次を含めます。

- `addons/godot_loop_mcp/**`
- `LICENSE`
- plugin folder 内の `README.md` コピー
- plugin folder 内の `LICENSE` コピー

理由:

Godot Asset Library の公式ガイドでは、plugin は `addons/<asset_name>/` 配下配置が推奨で、plugin folder 自体に `README` と `LICENSE` のコピーを置くことも推奨されています。  
さらに `.gitattributes` の `export-ignore` を使うと、配布不要ファイルを ZIP から落とせます。

### npm publish

npm publish の前提タスク:

- `packages/server/package.json` の `private: true` を外す
- `repository`, `files`, `bin` または entrypoint 契約を明記する
- lockfile を追加する
- `npm pack` が通るよう package 境界を固定する

publish 方針:

- npm trusted publishing を使う
- GitHub-hosted runner 上で実行する
- OIDC に必要な `id-token: write` だけ付与する
- provenance を有効にする
- 現行 workflow では `workflow_dispatch + publish_npm=true + repository variable` を満たした時だけ動かす

理由:

npm 公式 docs では trusted publishing と provenance を使うことで long-lived token を避けられます。  
この repo では release job に npm 書き込みトークンを置かない方針を採ります。

### Godot Asset Library handoff

Asset Library 側は次を release checklist に含めます。

- GitHub Release の Addon ZIP URL を確定
- asset icon の raw URL を確定
- 対応 Godot version を明記
- version / description / issues URL を更新
- reviewer 向け変更点要約を準備

チェックリスト:

- `docs/asset-library-release-checklist.md`

自動化しない範囲:

- Asset Library への最終 submit
- reviewer feedback 対応

## Workflow ごとの権限設計

`ci.yml`:

- `contents: read`

`nightly-compat.yml`:

- `contents: read`

`release.yml`:

- `publish-github-release`: `contents: write`
- `publish-npm`: `id-token: write`

補足:

- `publish-github-release` 以外に `contents: write` を与えない
- npm trusted publishing のため `publish-npm` だけ `id-token: write` を使う
- 将来 attestation を追加する場合だけ追加権限を検討する

## Runner / matrix 方針

PR の既定:

- Node.js `22.x`
- `windows-latest`

nightly の既定:

- Node.js `22.x`
- Godot `4.4.1-stable`, `4.5.1-stable`
- `windows-latest`, `ubuntu-latest`

将来追加候補:

- `4.6-stable`
- `macos-latest`

ただし:

macOS を早期に常設すると Actions 分数コストが高いので、最初は nightly でも採らず、利用者報告か screenshot 対応時点で再評価します。

## Artifacts / logging 方針

保存対象:

- `.godot/mcp/addon.log`
- `.godot/mcp/server.log`
- test report XML / JSON
- release packaging manifest

retention 方針:

- PR CI: `7` 日
- nightly: `14` 日
- release: `30` 日以上

理由:

GitHub Actions artifact は既定で期限付きなので、PR と release で保持日数を分ける方が運用しやすいです。

## Concurrency / 再実行方針

- `ci-${{ github.ref }}` で branch 単位 concurrency を設定する
- PR 更新時は古い CI を `cancel-in-progress: true` で止める
- release は concurrency で直列化する

理由:

Godot headless job は比較的重いため、古いコミットの smoke を走らせ続ける価値が低いです。  
GitHub Actions の concurrency を前提に branch 最新だけを検証します。

## Secrets / environments 方針

原則:

- CI では repository secrets を使わない
- release publish だけ environment を使う

推奨 environment:

- `release`
- `npm`

注意:

GitHub Docs では、private repository では environment 機能や protection rules にプラン依存の制約があります。  
この repo が private のまま運用される場合、required reviewers や wait timer に依存しすぎず、`protected tags + workflow_dispatch` を fallback にします。

## 実装タスク分解

### Step 1: CI 足場

完了済み:

- `.github/workflows/ci.yml` を追加
- Godot headless 実行手順を Actions 向けに固定
- log artifact upload を追加

### Step 2: package 契約

一部完了:

- `package-lock.json` を追加
- `packages/server/package.json` に package metadata と `pack` script を追加
- release asset 向け metadata を追加

### Step 3: release packaging

完了済み:

- Addon staging directory を作る script を追加
- ZIP 生成と checksum 生成を追加
- `npm pack` を release asset 化

### Step 4: trusted publishing

着手済み:

- `release.yml` に `publish-npm` job を追加
- provenance 前提の publish コマンドを追加

未完了:

- npm package に trusted publisher を設定

### Step 5: Asset Library checklist

完了済み:

- `docs/asset-library-release-checklist.md` を追加
- release ごとの入力項目を固定

## M5 完了条件への反映

`M5: Security, Packaging, and CI` は次を満たした時に完了とみなします。

- PR で `server-check` と `bridge-smoke` が常時動く
- nightly で Godot version matrix が回る
- `v*` tag で GitHub Release assets が生成される
- server の npm publish が trusted publishing で明示実行できる
- Asset Library 更新に必要な ZIP と checklist が release ごとに揃う

## 調査ソース

- GitHub Docs: Reusing workflow configurations  
  https://docs.github.com/en/actions/reference/workflows-and-actions/reusable-workflows
- GitHub Docs: Control the concurrency of workflows and jobs  
  https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/control-the-concurrency-of-workflows-and-jobs
- GitHub Docs: Store and share data with workflow artifacts  
  https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-what-your-workflow-does/storing-and-sharing-data-from-a-workflow
- GitHub Docs: Managing environments for deployment  
  https://docs.github.com/actions/managing-workflow-runs-and-deployments/managing-deployments/managing-environments-for-deployment
- GitHub Docs: Triggering a workflow  
  https://docs.github.com/actions/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow
- npm Docs: Trusted publishing for npm packages  
  https://docs.npmjs.com/trusted-publishers
- npm Docs: Generating provenance statements  
  https://docs.npmjs.com/generating-provenance-statements
- Godot Docs: Command line tutorial  
  https://docs.godotengine.org/en/4.4/tutorials/editor/command_line_tutorial.html
- Godot Docs: Submitting to the Asset Library  
  https://docs.godotengine.org/en/latest/community/asset_library/submitting_to_assetlib.html
