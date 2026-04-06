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
$serverFileLogPath = Join-Path $LogDir "server.log"
$serverWorkdir = Join-Path $RepoRoot "packages/server"
$bridgePortListener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$bridgePortListener.Start()
$bridgePort = ([System.Net.IPEndPoint]$bridgePortListener.LocalEndpoint).Port
$bridgePortListener.Stop()
$serverEntrypoint = if (Test-Path -LiteralPath (Join-Path $serverWorkdir "dist/index.js")) {
  @("dist/index.js")
}
else {
  @("--experimental-strip-types", "src/index.ts")
}
$originalBridgeOnly = $env:GODOT_LOOP_MCP_BRIDGE_ONLY
$originalLogDir = $env:GODOT_LOOP_MCP_LOG_DIR
$originalPort = $env:GODOT_LOOP_MCP_PORT
$env:GODOT_LOOP_MCP_BRIDGE_ONLY = "1"
$env:GODOT_LOOP_MCP_LOG_DIR = $LogDir
$env:GODOT_LOOP_MCP_PORT = "$bridgePort"

$process = $null
try {
  $process = Start-Process -FilePath "node" `
    -ArgumentList $serverEntrypoint `
    -WorkingDirectory $serverWorkdir `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath `
    -PassThru
  Wait-FileContainsString -Path $serverFileLogPath -Needle "bridge server listening." -TimeoutSeconds 20
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
  if ($null -eq $originalPort) {
    Remove-Item Env:GODOT_LOOP_MCP_PORT -ErrorAction SilentlyContinue
  }
  else {
    $env:GODOT_LOOP_MCP_PORT = $originalPort
  }
}
