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
$serverEntrypoint = if (Test-Path -LiteralPath (Join-Path $serverWorkdir "dist/index.js")) {
  @("dist/index.js")
}
else {
  @("--experimental-strip-types", "src/index.ts")
}
$originalBridgeOnly = $env:GODOT_LOOP_MCP_BRIDGE_ONLY
$originalLogDir = $env:GODOT_LOOP_MCP_LOG_DIR
$env:GODOT_LOOP_MCP_BRIDGE_ONLY = "1"
$env:GODOT_LOOP_MCP_LOG_DIR = $LogDir

$process = $null
try {
  $process = Start-Process -FilePath "node" `
    -ArgumentList $serverEntrypoint `
    -WorkingDirectory $serverWorkdir `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath `
    -PassThru
  Wait-FileContainsString -Path $stderrPath -Needle "bridge server listening." -TimeoutSeconds 20
}
finally {
  if ($null -ne $process -and -not $process.HasExited) {
    try {
      Stop-Process -Id $process.Id -Force -ErrorAction Stop
    }
    catch {
      if (-not $process.HasExited) {
        $process.Kill($true)
      }
    }
    [void]$process.WaitForExit(5000)
  }
  if ($null -eq $originalBridgeOnly) {
    Remove-Item Env:GODOT_LOOP_MCP_BRIDGE_ONLY -ErrorAction SilentlyContinue
  }
  else {
    $env:GODOT_LOOP_MCP_BRIDGE_ONLY = $originalBridgeOnly
  }
  if ($null -eq $originalLogDir) {
    Remove-Item Env:GODOT_LOOP_MCP_LOG_DIR -ErrorAction SilentlyContinue
  }
  else {
    $env:GODOT_LOOP_MCP_LOG_DIR = $originalLogDir
  }
}
