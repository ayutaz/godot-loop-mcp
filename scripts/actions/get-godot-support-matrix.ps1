param(
  [string]$FloorVersion = "4.4.1-stable",
  [string[]]$RunnerLabels = @("windows-latest", "ubuntu-latest")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Parse-StableTag {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Tag
  )

  $match = [regex]::Match($Tag, '^4\.(\d+)(?:\.(\d+))?-stable$')
  if (-not $match.Success) {
    return $null
  }

  return [pscustomobject]@{
    Tag = $Tag
    Major = 4
    Minor = [int]$match.Groups[1].Value
    Patch = if ($match.Groups[2].Success) { [int]$match.Groups[2].Value } else { 0 }
  }
}

function Get-LatestStableGodotVersion {
  $headers = @{
    "User-Agent" = "godot-loop-mcp-ci"
    "Accept" = "application/vnd.github+json"
  }

  if (-not [string]::IsNullOrWhiteSpace($env:GITHUB_TOKEN)) {
    $headers["Authorization"] = "Bearer $($env:GITHUB_TOKEN)"
  }

  $releases = Invoke-RestMethod `
    -Uri "https://api.github.com/repos/godotengine/godot-builds/releases?per_page=20" `
    -Headers $headers

  $stableVersions = @()
  foreach ($release in $releases) {
    if ($release.draft -or $release.prerelease) {
      continue
    }

    $parsedTag = Parse-StableTag -Tag $release.tag_name
    if ($null -ne $parsedTag) {
      $stableVersions += $parsedTag
    }
  }

  if ($stableVersions.Count -eq 0) {
    throw "Failed to resolve a stable Godot 4.x release from godotengine/godot-builds."
  }

  return ($stableVersions | Sort-Object -Property Major, Minor, Patch -Descending | Select-Object -First 1).Tag
}

$latestStableVersion = Get-LatestStableGodotVersion
$resolvedVersions = [System.Collections.Generic.List[string]]::new()
foreach ($candidate in @($FloorVersion, $latestStableVersion)) {
  if (-not $resolvedVersions.Contains($candidate)) {
    [void]$resolvedVersions.Add($candidate)
  }
}

$nightlyInclude = [System.Collections.Generic.List[object]]::new()
foreach ($runnerLabel in $RunnerLabels) {
  foreach ($godotVersion in $resolvedVersions) {
    [void]$nightlyInclude.Add([pscustomobject]@{
      os = $runnerLabel
      godot_version = $godotVersion
    })
  }
}

$nightlyMatrix = @{
  include = $nightlyInclude
} | ConvertTo-Json -Compress -Depth 4

if ($env:GITHUB_OUTPUT) {
  "floor_version=$FloorVersion" | Out-File -FilePath $env:GITHUB_OUTPUT -Encoding utf8 -Append
  "latest_stable_version=$latestStableVersion" | Out-File -FilePath $env:GITHUB_OUTPUT -Encoding utf8 -Append
  "ci_verification_version=$latestStableVersion" | Out-File -FilePath $env:GITHUB_OUTPUT -Encoding utf8 -Append
  "nightly_matrix=$nightlyMatrix" | Out-File -FilePath $env:GITHUB_OUTPUT -Encoding utf8 -Append
}

Write-Host "floor=$FloorVersion"
Write-Host "latest_stable=$latestStableVersion"
Write-Host "nightly_matrix=$nightlyMatrix"
