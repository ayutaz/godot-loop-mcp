param(
  [Parameter(Mandatory = $true)]
  [string]$RepoRoot,
  [Parameter(Mandatory = $true)]
  [string]$Version,
  [string]$OutputDir = (Join-Path $RepoRoot "dist/release")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "common.ps1")

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("godot-loop-mcp-addon-staging-" + [guid]::NewGuid().ToString("N"))
$stagingRoot = Join-Path $tempRoot "addon-staging"
$pluginStagingRoot = Join-Path $stagingRoot "addons/godot_loop_mcp"
$archivePath = Join-Path $OutputDir "godot-loop-mcp-addon-$Version.zip"

Ensure-EmptyDirectory -Path $OutputDir
Ensure-EmptyDirectory -Path $stagingRoot

try {
  New-Item -ItemType Directory -Path $pluginStagingRoot -Force | Out-Null

  Copy-Item -Path (Join-Path $RepoRoot "addons/godot_loop_mcp/*") -Destination $pluginStagingRoot -Recurse -Force
  Copy-Item -LiteralPath (Join-Path $RepoRoot "LICENSE") -Destination (Join-Path $stagingRoot "LICENSE") -Force
  Copy-Item -LiteralPath (Join-Path $RepoRoot "README.md") -Destination (Join-Path $pluginStagingRoot "README.md") -Force
  Copy-Item -LiteralPath (Join-Path $RepoRoot "LICENSE") -Destination (Join-Path $pluginStagingRoot "LICENSE") -Force

  if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
  }

  Compress-Archive -Path (Join-Path $stagingRoot "*") -DestinationPath $archivePath -Force

  if ($env:GITHUB_OUTPUT) {
    "archive_path=$archivePath" | Out-File -FilePath $env:GITHUB_OUTPUT -Encoding utf8 -Append
  }
}
finally {
  if (Test-Path -LiteralPath $tempRoot) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force
  }
}
