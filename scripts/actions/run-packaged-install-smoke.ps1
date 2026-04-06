param(
  [Parameter(Mandatory = $true)]
  [string]$RepoRoot,
  [Parameter(Mandatory = $true)]
  [string]$GodotBinaryPath,
  [string]$ArtifactsDir = "",
  [string]$PackageVersion = "vpackage-smoke",
  [int]$QuitAfterSeconds = 60
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "common.ps1")

if ([string]::IsNullOrWhiteSpace($ArtifactsDir)) {
  $ArtifactsDir = Join-Path $RepoRoot ".artifacts/packaged-install-smoke"
}

Ensure-EmptyDirectory -Path $ArtifactsDir
$packageOutputDir = Join-Path $ArtifactsDir "packages"
Ensure-EmptyDirectory -Path $packageOutputDir
$bridgePortListener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$bridgePortListener.Start()
$bridgePort = ([System.Net.IPEndPoint]$bridgePortListener.LocalEndpoint).Port
$bridgePortListener.Stop()

./scripts/actions/package-addon.ps1 -RepoRoot $RepoRoot -Version $PackageVersion -OutputDir $packageOutputDir
$addonArchive = Get-ChildItem -LiteralPath $packageOutputDir -Filter "godot-loop-mcp-addon-*.zip" | Select-Object -First 1
if ($null -eq $addonArchive) {
  throw "Failed to package addon archive."
}

$serverPackageRoot = Join-Path $RepoRoot "packages/server"
$serverArchiveName = $null
Push-Location $serverPackageRoot
try {
  $serverArchiveName = (npm pack --pack-destination $packageOutputDir | Select-Object -Last 1).Trim()
}
finally {
  Pop-Location
}

if ([string]::IsNullOrWhiteSpace($serverArchiveName)) {
  throw "npm pack did not produce a server archive."
}

$serverArchivePath = Join-Path $packageOutputDir $serverArchiveName
if (-not (Test-Path -LiteralPath $serverArchivePath)) {
  throw "Server archive '$serverArchivePath' was not found."
}

$installRoot = Join-Path $ArtifactsDir "install-root"
$tempProjectRoot = Join-Path $installRoot "project"
$tempNodeWorkspace = Join-Path $installRoot "node-workspace"
$mcpLogDir = Join-Path $tempProjectRoot ".godot/mcp"
Ensure-EmptyDirectory -Path $installRoot
Ensure-EmptyDirectory -Path $tempProjectRoot
Ensure-EmptyDirectory -Path $tempNodeWorkspace
Ensure-EmptyDirectory -Path $mcpLogDir

Copy-Item -LiteralPath (Join-Path $RepoRoot "project.godot") -Destination (Join-Path $tempProjectRoot "project.godot") -Force
Copy-Item -LiteralPath (Join-Path $RepoRoot "icon.svg") -Destination (Join-Path $tempProjectRoot "icon.svg") -Force
Expand-Archive -LiteralPath $addonArchive.FullName -DestinationPath $tempProjectRoot -Force

$tempProjectFilePath = Join-Path $tempProjectRoot "project.godot"
$tempProjectFileContent = Get-Content -LiteralPath $tempProjectFilePath -Raw
if ($tempProjectFileContent -match '(?ms)^\[godot_loop_mcp\]\r?\n') {
  $bridgePortRegex = [regex]::new('(?m)^bridge/port=\d+\s*$')
  $godotLoopMcpSectionRegex = [regex]::new('(?ms)(^\[godot_loop_mcp\]\r?\n)')
  if ($tempProjectFileContent -match '(?m)^bridge/port=\d+\s*$') {
    $tempProjectFileContent = $bridgePortRegex.Replace(
      $tempProjectFileContent,
      "bridge/port=$bridgePort",
      1
    )
  }
  else {
    $sectionReplacement = '$1' + "bridge/port=$bridgePort" + [Environment]::NewLine
    $tempProjectFileContent = $godotLoopMcpSectionRegex.Replace(
      $tempProjectFileContent,
      $sectionReplacement,
      1
    )
  }
}
else {
  $tempProjectFileContent = $tempProjectFileContent.TrimEnd() + [Environment]::NewLine + [Environment]::NewLine +
    "[godot_loop_mcp]" + [Environment]::NewLine + "bridge/port=$bridgePort" + [Environment]::NewLine
}
Set-Content -LiteralPath $tempProjectFilePath -Value $tempProjectFileContent -Encoding utf8

$installedPluginPath = Join-Path $tempProjectRoot "addons/godot_loop_mcp/plugin.cfg"
if (-not (Test-Path -LiteralPath $installedPluginPath)) {
  throw "Packaged addon did not install plugin.cfg into the temporary Godot project."
}
$installedPluginVersionLine = Get-Content -LiteralPath $installedPluginPath | Where-Object {
  $_ -match '^version="([^"]+)"$'
} | Select-Object -First 1
if ([string]::IsNullOrWhiteSpace($installedPluginVersionLine)) {
  throw "Installed addon plugin.cfg is missing a version line."
}
$installedPluginVersionMatch = [regex]::Match($installedPluginVersionLine, '^version="([^"]+)"$')
$expectedAddonVersion = $installedPluginVersionMatch.Groups[1].Value

$workspacePackageJson = Join-Path $tempNodeWorkspace "package.json"
Set-Content -LiteralPath $workspacePackageJson -Value "{`"name`":`"godot-loop-mcp-packaged-smoke`",`"private`":true}" -Encoding ascii

Push-Location $tempNodeWorkspace
try {
  & npm install --save-exact --no-audit --no-fund $serverArchivePath
  if ($LASTEXITCODE -ne 0) {
    throw "npm install of the packaged server archive failed."
  }
}
finally {
  Pop-Location
}

$serverEntryPoint = Join-Path $tempNodeWorkspace "node_modules/@godot-loop-mcp/server/dist/index.js"
if (-not (Test-Path -LiteralPath $serverEntryPoint)) {
  throw "Installed packaged server entrypoint '$serverEntryPoint' was not found."
}

$serverStdoutPath = Join-Path $ArtifactsDir "server-stdout.log"
$serverStderrPath = Join-Path $ArtifactsDir "server-stderr.log"
$godotStdoutPath = Join-Path $ArtifactsDir "godot-stdout.log"
$godotStderrPath = Join-Path $ArtifactsDir "godot-stderr.log"
$addonLogPath = Join-Path $mcpLogDir "addon.log"
$serverFileLogPath = Join-Path $mcpLogDir "server.log"

$serverProcess = $null
$godotProcess = $null
$originalBridgeOnly = $env:GODOT_LOOP_MCP_BRIDGE_ONLY
$originalLogDir = $env:GODOT_LOOP_MCP_LOG_DIR
$originalRepoRoot = $env:GODOT_LOOP_MCP_REPO_ROOT
$originalPort = $env:GODOT_LOOP_MCP_PORT

try {
  $env:GODOT_LOOP_MCP_BRIDGE_ONLY = "1"
  $env:GODOT_LOOP_MCP_LOG_DIR = $mcpLogDir
  $env:GODOT_LOOP_MCP_REPO_ROOT = $tempProjectRoot
  $env:GODOT_LOOP_MCP_PORT = "$bridgePort"

  $serverProcess = Start-Process -FilePath "node" `
    -ArgumentList @($serverEntryPoint) `
    -WorkingDirectory $tempNodeWorkspace `
    -RedirectStandardOutput $serverStdoutPath `
    -RedirectStandardError $serverStderrPath `
    -PassThru

  Wait-FileContainsString -Path $serverStderrPath -Needle "bridge server listening." -TimeoutSeconds 30

  $godotArguments = @(
    "--headless",
    "--editor",
    "--quit-after",
    "$QuitAfterSeconds",
    "--path",
    $tempProjectRoot
  )

  $godotProcess = Start-Process -FilePath $GodotBinaryPath `
    -ArgumentList $godotArguments `
    -RedirectStandardOutput $godotStdoutPath `
    -RedirectStandardError $godotStderrPath `
    -PassThru

  $godotTimeoutMilliseconds = (($QuitAfterSeconds + 30) * 1000)
  if (-not $godotProcess.WaitForExit($godotTimeoutMilliseconds)) {
    Stop-Process -Id $godotProcess.Id -Force -ErrorAction SilentlyContinue
    throw "Packaged install smoke timed out after $QuitAfterSeconds seconds (+30s buffer)."
  }

  if ($godotProcess.ExitCode -ne 0) {
    throw "Packaged install smoke failed with exit code $($godotProcess.ExitCode)."
  }

  Wait-FileContainsString -Path $addonLogPath -Needle "Bridge handshake completed." -TimeoutSeconds 20
  Wait-FileContainsString -Path $addonLogPath -Needle "Ping acknowledged." -TimeoutSeconds 20
  Wait-FileContainsString -Path $serverStderrPath -Needle "Addon hello accepted." -TimeoutSeconds 20
  Wait-FileContainsString -Path $serverStderrPath -Needle "Addon handshake completed." -TimeoutSeconds 20
  Assert-FileContainsString -Path $serverFileLogPath -Needle "Addon hello accepted."
  Assert-FileContainsString -Path $serverFileLogPath -Needle "Addon handshake completed."
  $addonIdentityNeedle = '"addon":{"name":"godot-loop-mcp-addon","version":"' + $expectedAddonVersion + '"}'
  Assert-FileContainsString `
    -Path $serverFileLogPath `
    -Needle $addonIdentityNeedle
}
finally {
  if ($null -ne $godotProcess -and -not $godotProcess.HasExited) {
    Stop-Process -Id $godotProcess.Id -Force -ErrorAction SilentlyContinue
    [void]$godotProcess.WaitForExit(5000)
  }
  if ($null -ne $serverProcess -and -not $serverProcess.HasExited) {
    Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
    [void]$serverProcess.WaitForExit(5000)
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

  if ($null -eq $originalRepoRoot) {
    Remove-Item Env:GODOT_LOOP_MCP_REPO_ROOT -ErrorAction SilentlyContinue
  }
  else {
    $env:GODOT_LOOP_MCP_REPO_ROOT = $originalRepoRoot
  }

  if ($null -eq $originalPort) {
    Remove-Item Env:GODOT_LOOP_MCP_PORT -ErrorAction SilentlyContinue
  }
  else {
    $env:GODOT_LOOP_MCP_PORT = $originalPort
  }
}
