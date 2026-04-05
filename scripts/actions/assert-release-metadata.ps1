param(
  [Parameter(Mandatory = $true)]
  [string]$RepoRoot,
  [Parameter(Mandatory = $true)]
  [string]$ReleaseTag
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "common.ps1")

if ([string]::IsNullOrWhiteSpace($ReleaseTag) -or -not $ReleaseTag.StartsWith("v")) {
  throw "ReleaseTag must start with 'v'. actual='$ReleaseTag'"
}

$expectedVersion = $ReleaseTag.Substring(1)
$serverPackagePath = Join-Path $RepoRoot "packages/server/package.json"
$addonCapabilityRegistryPath = Join-Path $RepoRoot "addons/godot_loop_mcp/capabilities/capability_registry.gd"
$pluginConfigPath = Join-Path $RepoRoot "addons/godot_loop_mcp/plugin.cfg"

$serverPackage = Get-Content -LiteralPath $serverPackagePath -Raw | ConvertFrom-Json
if ($serverPackage.version -ne $expectedVersion) {
  throw "packages/server/package.json version must match $ReleaseTag. actual='$($serverPackage.version)'"
}

$pluginVersionLine = Get-Content -LiteralPath $pluginConfigPath | Where-Object { $_ -match '^version="([^"]+)"$' } | Select-Object -First 1
if ([string]::IsNullOrWhiteSpace($pluginVersionLine)) {
  throw "addons/godot_loop_mcp/plugin.cfg is missing a version line."
}

$pluginVersionMatch = [regex]::Match($pluginVersionLine, '^version="([^"]+)"$')
$pluginVersion = $pluginVersionMatch.Groups[1].Value
if ($pluginVersion -ne $expectedVersion) {
  throw "addons/godot_loop_mcp/plugin.cfg version must match $ReleaseTag. actual='$pluginVersion'"
}

$addonCapabilityRegistryVersionLine = Get-Content -LiteralPath $addonCapabilityRegistryPath | Where-Object { $_ -match '^const PLUGIN_VERSION := "([^"]+)"$' } | Select-Object -First 1
if ([string]::IsNullOrWhiteSpace($addonCapabilityRegistryVersionLine)) {
  throw "addons/godot_loop_mcp/capabilities/capability_registry.gd is missing a PLUGIN_VERSION line."
}

$addonCapabilityRegistryVersionMatch = [regex]::Match($addonCapabilityRegistryVersionLine, '^const PLUGIN_VERSION := "([^"]+)"$')
$addonCapabilityRegistryVersion = $addonCapabilityRegistryVersionMatch.Groups[1].Value
if ($addonCapabilityRegistryVersion -ne $expectedVersion) {
  throw "addons/godot_loop_mcp/capabilities/capability_registry.gd PLUGIN_VERSION must match $ReleaseTag. actual='$addonCapabilityRegistryVersion'"
}

$readmeExpectations = @(
  @{
    Path = Join-Path $RepoRoot "README.md"
    Needles = @(
      ('GitHub Release: `v{0}`' -f $expectedVersion),
      ('npm: `@godot-loop-mcp/server@{0}`' -f $expectedVersion)
    )
  },
  @{
    Path = Join-Path $RepoRoot "README.en.md"
    Needles = @(
      ('GitHub Release: `v{0}`' -f $expectedVersion),
      ('npm: `@godot-loop-mcp/server@{0}`' -f $expectedVersion)
    )
  },
  @{
    Path = Join-Path $RepoRoot "docs/implementation-milestones.md"
    Needles = @(
      ('GitHub Release: `v{0}`' -f $expectedVersion),
      ('npm: `@godot-loop-mcp/server@{0}`' -f $expectedVersion)
    )
  }
)

foreach ($expectation in $readmeExpectations) {
  foreach ($needle in $expectation.Needles) {
    Assert-FileContainsString -Path $expectation.Path -Needle $needle
  }
}

Write-Host "Release metadata matches $ReleaseTag"
