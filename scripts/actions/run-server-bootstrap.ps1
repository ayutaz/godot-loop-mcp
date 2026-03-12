param(
  [Parameter(Mandatory = $true)]
  [string]$RepoRoot,
  [string]$LogDir = (Join-Path $RepoRoot ".artifacts/server-bootstrap")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "common.ps1")

Ensure-EmptyDirectory -Path $LogDir
$stdoutPath = Join-Path $LogDir "server-stdout.log"
$stderrPath = Join-Path $LogDir "server-stderr.log"
$serverWorkdir = Join-Path $RepoRoot "packages/server"
$serverEnvPrefix = '$env:GODOT_LOOP_MCP_BRIDGE_ONLY=''1''; $env:GODOT_LOOP_MCP_LOG_DIR=''' + $LogDir.Replace("'", "''") + '''; '
$serverCommand = $serverEnvPrefix + "node --experimental-strip-types src/index.ts"

$process = $null
try {
  $process = Start-Process -FilePath "pwsh" `
    -ArgumentList @("-NoLogo", "-NoProfile", "-Command", $serverCommand) `
    -WorkingDirectory $serverWorkdir `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath `
    -PassThru
  Wait-FileContainsString -Path $stderrPath -Needle "bridge server listening." -TimeoutSeconds 20
}
finally {
  if ($null -ne $process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force
    $process.WaitForExit()
  }
}
