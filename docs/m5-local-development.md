# M5 Local Development

2026-03-12 時点で、この手順に沿って M5 security / audit / release-hardening のローカル確認を進められます。

## 前提

- Node.js `22.14.0+`
- npm
- Godot `4.4+`
- `npm ci --prefix packages/server`

M5 には専用の `smoke:m5` はありません。現行 branch では `smoke:m4` と `smoke:m6`、および GitHub Actions workflow 実装を組み合わせて確認します。

## 1. security level を確認する

server 側の上限は env で決まります。

```powershell
$env:GODOT_LOOP_MCP_SECURITY_LEVEL = "WorkspaceWrite"
```

addon 側は env または `Project Settings` のどちらでも設定できます。

- `GODOT_LOOP_MCP_SECURITY_LEVEL`
- `godot_loop_mcp/security/level`

利用できる値:

- `ReadOnly`
- `WorkspaceWrite`
- `Dangerous`

既定値は server/addon ともに `WorkspaceWrite` です。dangerous tools は server と addon の両方が `Dangerous` でなければ露出しません。

## 2. dangerous opt-in / allowlist を確認する

dangerous mode は security level だけでは有効になりません。以下の env または project settings が必要です。

- editor script opt-in
  - env: `GODOT_LOOP_MCP_ENABLE_EDITOR_SCRIPT`
  - project setting: `godot_loop_mcp/dangerous/enable_editor_script`
- write allowlist
  - env: `GODOT_LOOP_MCP_ALLOWED_WRITE_PREFIXES`
  - project setting: `godot_loop_mcp/dangerous/allowed_write_prefixes`
- shell allowlist
  - env: `GODOT_LOOP_MCP_ALLOWED_SHELL_COMMANDS`
  - project setting: `godot_loop_mcp/dangerous/allowed_shell_commands`

例:

```powershell
$env:GODOT_LOOP_MCP_SECURITY_LEVEL = "Dangerous"
$env:GODOT_LOOP_MCP_ENABLE_EDITOR_SCRIPT = "true"
$env:GODOT_LOOP_MCP_ALLOWED_WRITE_PREFIXES = "res://tmp,res://scratch"
$env:GODOT_LOOP_MCP_ALLOWED_SHELL_COMMANDS = "cmd.exe,pwsh.exe"
```

`filesystem_write_raw` は allowlist prefix 配下だけ、`os_shell` は allowlist に入った executable だけ、`execute_editor_script` は explicit opt-in がある時だけ `enabled` になります。

## 3. audit log を確認する

audit log は `.godot/mcp/audit.log` に JSON Lines で追記されます。

1 行ごとに少なくとも次を含みます。

- `timestamp`
- `kind`
- `name`
- `status`
- `durationMs`
- `argHash`
- `sessionId`
- `addonName`
- `addonVersion`
- `addonSecurityLevel`
- `serverSecurityLevel`

PowerShell で末尾を確認する例:

```powershell
Get-Content .godot/mcp/audit.log -Tail 20
```

`status` は `success`, `error`, `denied` のいずれかです。

## 4. 現行のローカル確認経路

M5 の現行確認は次の組み合わせを前提にします。

```powershell
npm --prefix packages/server run typecheck
$env:GODOT_LOOP_MCP_GODOT_BIN = (Get-Command godot_console.exe).Source
npm --prefix packages/server run smoke:m4
npm --prefix packages/server run smoke:m6
```

確認できる点:

- capability / security level に応じた tool surface の変化
- prompt / resource template / dangerous tool の audit 記録
- allowlist / opt-in 不足時の deny
- `Dangerous` 有効時の editor script / write / shell 実行

## 5. GitHub Actions の現在地

workflow 実装は入っています。

- `.github/workflows/ci.yml`
- `.github/workflows/nightly-compat.yml`
- `.github/workflows/release.yml`

ただし、M5 の残作業もあります。

- `packages/server/package.json` はまだ `private: true`
- npm trusted publisher の repository 設定は未完了
- `run_tests` report の Actions 統合は未完了
- reusable workflow 化は未着手

詳細計画は [docs/github-actions-cicd-plan.md](/C:/Users/yuta/Desktop/Private/godot-loop-mcp/docs/github-actions-cicd-plan.md) を参照してください。
