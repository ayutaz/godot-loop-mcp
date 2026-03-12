# M6 Local Development

2026-03-12 時点で、この手順による M6 restricted advanced automation の `smoke:m6` を確認済みです。

## 1. 前提

- Node.js `22.14.0+`
- `godot_console.exe` がローカルにあること
- リポジトリ root で作業すること

## 2. dangerous mode の有効化

dangerous tools は default では hidden です。  
有効化には server と addon の両方で `Dangerous` を明示し、さらに allowlist か opt-in を設定します。

PowerShell 例:

```powershell
$env:GODOT_LOOP_MCP_SECURITY_LEVEL = "Dangerous"
$env:GODOT_LOOP_MCP_ENABLE_EDITOR_SCRIPT = "true"
$env:GODOT_LOOP_MCP_ALLOWED_WRITE_PREFIXES = "res://codex-smoke/danger"
$env:GODOT_LOOP_MCP_ALLOWED_SHELL_COMMANDS = "node"
```

## 3. M6 smoke

`smoke:m6` は次を確認します。

- `execute_editor_script`
- `filesystem_write_raw`
- `os_shell`
- `.godot/mcp/audit.log` への dangerous tool 記録

```powershell
$env:GODOT_LOOP_MCP_GODOT_BIN = (Get-Command godot_console.exe).Source
npm --prefix packages/server run smoke:m6
```

## 4. audit log

監査ログは `.godot/mcp/audit.log` に JSON Lines で出力されます。  
現行 entry には少なくとも次が入ります。

- `kind`
- `name`
- `status`
- `durationMs`
- `argHash`
- `sessionId`
- `addonSecurityLevel`
- `serverSecurityLevel`

## 5. 既知の制約

- `os_shell` は allowlisted executable のみ実行できる
- `filesystem_write_raw` は allowlisted workspace prefix のみ書き込める
- `execute_editor_script` は sandbox ではなく explicit opt-in 前提
