param(
  [string]$RepoRoot = "",
  [Parameter(Mandatory = $true)]
  [string]$GodotBinaryPath,
  [string]$ArtifactsDir = "",
  [int]$QuitAfterSeconds = 60
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "common.ps1")

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
  $RepoRoot = (Get-Location).Path
}

if ([string]::IsNullOrWhiteSpace($ArtifactsDir)) {
  $ArtifactsDir = Join-Path $RepoRoot ".artifacts/bridge-smoke"
}

$mcpLogDir = Join-Path $RepoRoot ".godot/mcp"
Ensure-EmptyDirectory -Path $ArtifactsDir
Ensure-EmptyDirectory -Path $mcpLogDir

$serverStdoutPath = Join-Path $ArtifactsDir "server-stdout.log"
$serverStderrPath = Join-Path $ArtifactsDir "server-stderr.log"
$godotStdoutPath = Join-Path $ArtifactsDir "godot-stdout.log"
$godotStderrPath = Join-Path $ArtifactsDir "godot-stderr.log"
$addonLogPath = Join-Path $mcpLogDir "addon.log"
$serverFileLogPath = Join-Path $mcpLogDir "server.log"

$serverProcess = $null
$scanConflictState = Suspend-GodotScanConflicts -RepoRoot $RepoRoot
try {
  $serverEnvPrefix = '$env:GODOT_LOOP_MCP_BRIDGE_ONLY=''1''; $env:GODOT_LOOP_MCP_LOG_DIR=''' + $mcpLogDir.Replace("'", "''") + '''; '
  $serverCommand = $serverEnvPrefix + "node --experimental-strip-types src/index.ts"
  $serverProcess = Start-Process -FilePath "pwsh" `
    -ArgumentList @("-NoLogo", "-NoProfile", "-Command", $serverCommand) `
    -WorkingDirectory (Join-Path $RepoRoot "packages/server") `
    -RedirectStandardOutput $serverStdoutPath `
    -RedirectStandardError $serverStderrPath `
    -PassThru

  Wait-FileContainsString -Path $serverStderrPath -Needle "bridge server listening." -TimeoutSeconds 20

  $godotArguments = @(
    "--headless",
    "--editor",
    "--quit-after",
    "$QuitAfterSeconds",
    "--path",
    $RepoRoot
  )

  $godotProcess = Start-Process -FilePath $GodotBinaryPath `
    -ArgumentList $godotArguments `
    -RedirectStandardOutput $godotStdoutPath `
    -RedirectStandardError $godotStderrPath `
    -PassThru `
    -Wait

  if ($godotProcess.ExitCode -ne 0) {
    throw "Godot smoke run failed with exit code $($godotProcess.ExitCode)."
  }

  Wait-FileContainsString -Path $addonLogPath -Needle "Bridge handshake completed." -TimeoutSeconds 20
  Wait-FileContainsString -Path $addonLogPath -Needle "Ping acknowledged." -TimeoutSeconds 20
  Wait-FileContainsString -Path $serverStderrPath -Needle "Addon hello accepted." -TimeoutSeconds 20
  Wait-FileContainsString -Path $serverStderrPath -Needle "Addon handshake completed." -TimeoutSeconds 20

  Assert-FileContainsString -Path $serverFileLogPath -Needle "Addon hello accepted."
  Assert-FileContainsString -Path $serverFileLogPath -Needle "Addon handshake completed."
}
finally {
  if ($null -ne $scanConflictState) {
    Resume-GodotScanConflicts -State $scanConflictState
  }
  if ($null -ne $serverProcess -and -not $serverProcess.HasExited) {
    Stop-Process -Id $serverProcess.Id -Force
    $serverProcess.WaitForExit()
  }
}
