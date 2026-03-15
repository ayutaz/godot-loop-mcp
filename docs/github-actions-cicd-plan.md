# GitHub Actions CI/CD 運用

更新日: 2026-03-15

この文書は `godot-loop-mcp` の現行 CI/CD 運用をまとめた runbook です。  
実装前提の計画や phase 分割は削除し、現在動いている workflow と release 手順だけを残しています。

## 現在の workflow

| Workflow | Trigger | 目的 |
| --- | --- | --- |
| `ci.yml` | `pull_request`, `push` to `main` | server check, bridge smoke, verification smoke |
| `nightly-compat.yml` | `schedule`, `workflow_dispatch` | OS / Godot version matrix の定期確認 |
| `release.yml` | `push` tags: `v*`, `workflow_dispatch` | release packaging, GitHub Release, npm publish |
| `reusable-server-check.yml` | reusable | Node setup, `typecheck`, `pack/publish dry-run`, bootstrap |
| `reusable-godot-smoke.yml` | reusable | Godot install, smoke 実行, artifact upload |

## 現在の配布モデル

正式配布物:

- Addon ZIP
- server `.tgz`
- `SHA256SUMS.txt`
- `test-reports-*.zip`

公開先:

1. GitHub Releases
2. npm: `@godot-loop-mcp/server`
3. Godot Asset Library は手動 handoff

現行の canonical release path:

1. `main` に release 対応変更を merge
2. `v*` tag を push
3. `release.yml` が packaging / GitHub Release / npm publish を実行

## `ci.yml`

常設 job:

- `server-check`
- `bridge-smoke`
- `verification-smoke`

責務:

- `packages/server` の `typecheck`
- `npm pack --dry-run`
- `npm publish --dry-run`
- Addon handshake smoke
- verification surface の smoke

失敗時 artifact:

- server bootstrap logs
- bridge smoke logs
- `.godot/mcp`
- `test-reports`

## `nightly-compat.yml`

目的:

- PR で常時回すには重い matrix を nightly で切り分ける
- Godot minor version 差分の早期検知
- OS 差分の早期検知

現行 matrix:

- `windows-latest`
- `ubuntu-latest`
- `4.4.1-stable`
- `4.5.1-stable`

## `release.yml`

tag push 時の job:

- `server-check`
- `bridge-smoke`
- `verification-smoke`
- `package-addon`
- `package-server`
- `publish-github-release`
- `publish-npm`

`workflow_dispatch` の扱い:

- packaging / GitHub Release の再実行には使える
- `publish-npm` は走らない
- npm publish の canonical path は `v*` tag push

## npm publish

前提:

- package: `@godot-loop-mcp/server`
- registry publish: public
- npm CLI: `11.11.1`
- provenance: 有効
- trusted publishing: GitHub Actions OIDC

GitHub 側の前提:

- repository variable: `NPM_PUBLISH_ENABLED=true`
- environment: `npm`
- job permission: `id-token: write`

npm 側の前提:

- Trusted Publisher に次を登録
  - owner: `ayutaz`
  - repository: `godot-loop-mcp`
  - workflow: `release.yml`
  - environment: `npm`

運用メモ:

- 初回設定後に publisher 情報を直した場合は failed release run の `publish-npm` を rerun して反映確認する
- token publish は非常用に限定し、常用しない

## GitHub Release

release asset:

- `godot-loop-mcp-addon-v*.zip`
- `godot-loop-mcp-server-v*.tgz`
- `SHA256SUMS.txt`
- `test-reports-v*.zip`

release source of truth:

- tag 名
- release notes
- GitHub Actions artifacts

## 権限方針

原則:

- workflow permissions は最小化
- `id-token: write` は `publish-npm` のみ
- content write は GitHub Release 作成 job のみ

environment:

- `release`
- `npm`

## 再実行方針

- CI failure は同一 run の rerun で原因切り分け
- external setting 修正後の npm publish は failed `publish-npm` rerun を優先
- broken release artifact は `release.yml` の rerun で再生成
- nightly matrix failure は PR block ではなく互換性調査として扱う

## 残る手動作業

- Godot Asset Library への submit
- release notes の人手確認
- 必要なら npm token の revoke / rotation

Asset Library handoff は次を参照:

- `docs/asset-library-release-checklist.md`

## 参照

- milestone / quick reference: `docs/implementation-milestones.md`
- archived research rationale: `docs/godot-4.4-mcp-technical-research.md`
